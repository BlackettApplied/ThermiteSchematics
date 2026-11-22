import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { createBudget, lowerBudget } from "../../../scripts/health-ratchet.mjs";
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
const path = "packages/cli/src/index.ts";
it("fails closed on the review's committed forgery in a depth-one clone without dev refs", () => {
  const root = repo();
  put(root, path, fn(90));
  save(root, createBudget(metrics(root)));
  commit(root, "honest");
  git(root, "branch", "-M", "claude/c7a");
  put(root, path, fn(604, "brandNew"));
  const forged = createBudget(metrics(root));
  forged.ceilings.nonNullAssertions = 5000;
  forged.ceilings.skippedTests = 500;
  forged.thresholds.functionLines = 200;
  forged.thresholds.fileLines = 2000;
  forged.grandfathered.functions[`${path}#brandNew`] = 900;
  save(root, forged);
  commit(root, "committed forgery");
  const clone = join(root, "ci-clone");
  git(
    root,
    "clone",
    "--quiet",
    "--depth",
    "1",
    "--single-branch",
    "--branch",
    "claude/c7a",
    pathToFileURL(root).href,
    clone,
  );
  const result = run(clone);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("no health baseline");
  expect(git(clone, "rev-parse", "--is-shallow-repository")).toBe("true");
  expect(() => readHistory(clone, { GITHUB_BASE_REF: "" })).toThrow(
    "no health baseline",
  );
});
it("an empty repository also fails closed unless the synthetic opt-in is explicit", () => {
  const root = repo();
  put(root, path, fn(3));
  save(root, createBudget(metrics(root)));
  expect(run(root).status).toBe(1);
  expect(run(root, [], { THERMITE_HEALTH_ALLOW_NO_BASE: "1" }).status).toBe(0);
});
function staleFixture() {
  const root = repo();
  put(root, path, fn(400));
  const first = metrics(root),
    budget = createBudget(first);
  save(root, budget);
  const old = commit(root, "old allowance");
  git(root, "branch", "dev", old);
  put(root, path, fn(350));
  const reduced = metrics(root);
  save(root, lowerBudget(reduced, budget, { budget, metrics: first }));
  const recent = commit(root, "bank reduction");
  git(root, "update-ref", "refs/remotes/origin/dev", recent);
  put(root, path, fn(375));
  save(root, createBudget(metrics(root)));
  const forged = commit(root, "attempt regain");
  return { root, old, recent, forged };
}
it("uses the newer origin/dev rather than stale local dev", () => {
  const { root, recent } = staleFixture();
  expect(readHistory(root, { GITHUB_BASE_REF: "" }).revision).toBe(recent);
  const result = run(root);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("350 -> 375");
});
it("uses a newer local dev if it contains origin/dev", () => {
  const { root, old, recent } = staleFixture();
  git(root, "update-ref", "refs/remotes/origin/dev", old);
  git(root, "update-ref", "refs/heads/dev", recent);
  expect(readHistory(root, { GITHUB_BASE_REF: "" }).revision).toBe(recent);
  expect(run(root).status).toBe(1);
});
it("PR target release takes priority even when dev points at the forged PR head", () => {
  const { root, recent, forged } = staleFixture();
  git(root, "update-ref", "refs/remotes/origin/release", recent);
  git(root, "update-ref", "refs/remotes/origin/dev", forged);
  git(root, "update-ref", "refs/heads/dev", forged);
  const env = { GITHUB_BASE_REF: "release" };
  expect(readHistory(root, env).revision).toBe(recent);
  const result = run(root, [], env);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("350 -> 375");
});
it("a missing PR target fails closed with a fetch instruction", () => {
  const { root } = staleFixture();
  const result = run(root, [], { GITHUB_BASE_REF: "release" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "PR baseline refs/remotes/origin/release is missing",
  );
  expect(result.stderr).toContain("fetch-depth: 0");
});
it("CI fetches complete base history in both jobs", () => {
  const yaml = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  expect(yaml.match(/fetch-depth: 0/g)).toHaveLength(2);
  expect(yaml.match(/Verify fetched health baseline/g)).toHaveLength(2);
  expect(
    readFileSync(
      new URL("../../../scripts/ordinary-ci.authority.yml", import.meta.url),
      "utf8",
    ),
  ).toBe(yaml);
});
it.each(["CI", "GITHUB_ACTIONS"])(
  "ignores the synthetic opt-in whenever %s is set",
  (name) => {
    const root = repo();
    put(root, path, fn(604, "forged"));
    save(root, createBudget(metrics(root)));
    commit(root, "forgery without a baseline");
    for (const value of ["true", "false", ""]) {
      const result = run(root, [], {
        [name]: value,
        THERMITE_HEALTH_ALLOW_NO_BASE: "1",
      });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("no health baseline");
    }
  },
);
it.each(["forged", "main", "refs/heads/dev", "dev/../forged"])(
  "rejects unsupported GITHUB_BASE_REF %s locally and in CI",
  (target) => {
    const root = repo();
    put(root, path, fn(604, "forged"));
    save(root, createBudget(metrics(root)));
    const sha = commit(root, "forged budget");
    git(root, "update-ref", "refs/remotes/origin/forged", sha);
    for (const extra of [{}, { CI: "true" }, { GITHUB_ACTIONS: "true" }]) {
      const result = run(root, [], {
        ...extra,
        GITHUB_BASE_REF: target,
        THERMITE_HEALTH_ALLOW_NO_BASE: "1",
      });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("GITHUB_BASE_REF must be dev or release");
    }
  },
);
