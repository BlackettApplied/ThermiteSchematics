import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createBudget } from "../../../scripts/health-ratchet.mjs";
import { readHistory } from "../../../scripts/health-history.mjs";
import {
  repo,
  put,
  git,
  metrics,
  save,
  commit,
  run,
  fn,
} from "./health-fixture.js";

const path = "packages/cli/src/alpha.ts",
  env = { GITHUB_BASE_REF: "release" };
type State = number | "missing" | "invalid";
function fixture(state: State = 4) {
  const root = repo();
  put(root, path, fn(52, "existingDebt"));
  const release = commit(root, "release predates health budgets");
  git(root, "update-ref", "refs/remotes/origin/release", release);
  put(root, path, fn(380, "existingDebt") + "const admitted = value!;\n");
  const admitted = createBudget(metrics(root));
  if (state !== "missing") {
    const stored = structuredClone(admitted);
    if (typeof state === "number") stored.version = state;
    else stored.ceilings.fileLines = 0;
    save(root, stored);
  }
  const dev = commit(root, "dev admits existing debt");
  git(root, "update-ref", "refs/remotes/origin/dev", dev);
  put(root, path, fn(350, "existingDebt") + "const admitted = value!;\n");
  const current = createBudget(metrics(root));
  save(root, current);
  const head = commit(root, "PR shrinks admitted debt");
  return { root, release, dev, head, current };
}
it("uses the committed dev merge-base budget, reporting old release source only as information", () => {
  const { root, release, dev } = fixture();
  const history = readHistory(root, env);
  expect(history).toMatchObject({
    revision: dev,
    ref: "refs/remotes/origin/dev",
    target: "release",
    budgetSource: "dev-bootstrap",
  });
  expect(history.budget.grandfathered.functions[`${path}#existingDebt`]).toBe(
    380,
  );
  expect(history.information).toMatchObject({
    revision: release,
    ref: "refs/remotes/origin/release",
    nonNullAssertions: 0,
    skippedTests: 0,
    overCapFunctions: 0,
  });
  const result = run(root, [], env);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`refs/remotes/origin/dev@${dev}`);
  expect(result.stdout).toContain(
    `Source information only: refs/remotes/origin/release@${release}`,
  );
  expect(result.stdout).toContain("non-null assertions 0, skipped tests 0");
});
it.each(["ceiling", "body"])(
  "rejects a forged %s committed in the PR head over a budgetless base",
  (attack) => {
    const { root, current, dev } = fixture();
    if (attack === "ceiling") {
      current.ceilings.nonNullAssertions++;
      save(root, current);
    } else {
      put(root, "tools/brand-new.ts", fn(301, "brandNew"));
      // Even a forged grandfathered record in HEAD cannot supply its own authority.
      save(root, createBudget(metrics(root)));
    }
    commit(root, "committed forgery");
    expect(readHistory(root, env).revision).toBe(dev);
    for (const args of [
      [],
      ["--accept", "--reason", "cannot waive hard invariants"],
    ]) {
      const result = run(root, args, env);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(
        attack === "ceiling"
          ? "ceilings.nonNullAssertions cannot rise: 1 -> 2"
          : "functions ceiling 300 -> 301 (new or unmatched content)",
      );
    }
  },
);
it.each(["missing", "local-only", "unrelated", "merge-base-no-budget"])(
  "fails closed without a reachable committed dev bootstrap: %s",
  (kind) => {
    const { root, release, head } = fixture();
    git(root, "update-ref", "-d", "refs/remotes/origin/dev");
    if (kind === "local-only") git(root, "update-ref", "refs/heads/dev", head);
    if (kind === "unrelated" || kind === "merge-base-no-budget") {
      const parents = kind === "unrelated" ? [] : ["-p", release];
      const other = git(
        root,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        `${head}^{tree}`,
        ...parents,
        "-m",
        "separate dev history with a valid tip budget",
      );
      git(root, "update-ref", "refs/remotes/origin/dev", other);
    }
    const result = run(root, [], {
      ...env,
      THERMITE_HEALTH_ALLOW_NO_BASE: "1",
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      kind === "merge-base-no-budget"
        ? "has no committed health budget"
        : "no merge-base with refs/remotes/origin/dev",
    );
  },
);
it.each([2, 3, 5, "invalid"] as State[])(
  "rejects a dev bootstrap outside the valid current format: %s",
  (state) => {
    const { root } = fixture(state);
    const result = run(root, [], env);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "dev bootstrap requires a valid current-format budget",
    );
  },
);

function historicalReleaseWithCurrentTree() {
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const root = repo(),
    snapshot = join(root, "snapshot");
  const head = git(repository, "rev-parse", "HEAD");
  // Protected dev will carry this committed v4 budget after merge. Shared refs
  // stay untouched; only the disposable checkout models that promotion state.
  git(
    root,
    "clone",
    "--quiet",
    "--shared",
    "--single-branch",
    "--no-checkout",
    repository,
    snapshot,
  );
  git(snapshot, "checkout", "--quiet", "--detach", head);
  const changed = git(
    repository,
    "diff",
    "--name-only",
    "--diff-filter=AM",
    "-z",
    "HEAD",
  )
    .split("\0")
    .filter(Boolean);
  for (const path of changed)
    put(snapshot, path, readFileSync(join(repository, path), "utf8"));
  git(snapshot, "add", "-A");
  git(snapshot, "update-ref", "refs/remotes/origin/dev", head);
  git(
    snapshot,
    "update-ref",
    "refs/remotes/origin/release",
    "4579f587bcb01f2eb947f4a6d1a4993e99fc6725",
  );
  return { snapshot, head };
}
// Match scripts/test.mjs's 120-second limit, including direct Vitest runs.
// Each revision is authenticated and measured independently by the child CLI.
it("passes the real 4579f58 release target on the current tree with the committed v4 dev bootstrap", () => {
  const { snapshot, head } = historicalReleaseWithCurrentTree();
  const result = run(snapshot, [], env);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(
    `Health bootstrap: committed budget at refs/remotes/origin/dev@${head}`,
  );
  expect(result.stdout).toContain(
    "Source information only: refs/remotes/origin/release@4579f587bcb01f2eb947f4a6d1a4993e99fc6725",
  );
  expect(result.stdout).toContain("non-null assertions 873, skipped tests 37");
}, 120_000);
