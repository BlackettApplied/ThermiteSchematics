import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";
import { lineAdditions } from "../../../scripts/health-continuity.mjs";
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
const path = "packages/cli/src/alpha.ts";
it("compares grandfathered values across two reviewed 65-line dev swaps against a v4 release", () => {
  const root = repo(),
    id = `${path}#prepareWiringDrawing`;
  const original = `function prepareWiringDrawing() {\n${Array.from({ length: 424 }, (_, n) => `void "original ${n}";\n`).join("")}}\n`;
  put(root, path, original);
  const releaseMetrics = metrics(root),
    releaseBudget = createBudget(releaseMetrics);
  save(root, releaseBudget);
  const release = commit(root, "v4 release");
  git(root, "update-ref", "refs/remotes/origin/release", release);
  git(root, "update-ref", "refs/remotes/origin/dev", release);
  let text = original,
    previous = releaseMetrics;
  for (const round of [0, 1]) {
    for (let n = round * 65; n < (round + 1) * 65; n++)
      text = text.replace(`"original ${n}"`, `"reviewed swap ${n}"`);
    put(root, path, text);
    const current = metrics(root);
    expect(
      lineAdditions(previous.bodyLines[id], current.bodyLines[id]).added,
    ).toBe(65);
    const result = run(root, ["--lower"], { GITHUB_BASE_REF: "dev" });
    expect(result.status, result.stderr).toBe(0);
    const sha = commit(root, `reviewed dev swap ${round}`);
    git(root, "update-ref", "refs/remotes/origin/dev", sha);
    previous = current;
  }
  const current = metrics(root),
    budget = JSON.parse(
      readFileSync(root + "/scripts/health-budget.json", "utf8"),
    );
  expect(
    lineAdditions(releaseMetrics.bodyLines[id], current.bodyLines[id]).added,
  ).toBe(130);
  const result = run(root, [], { GITHUB_BASE_REF: "release" });
  expect(result.status, result.stderr).toBe(0);
  const missing = structuredClone(budget);
  delete missing.grandfathered.functions[id];
  expect(
    historyRegressions(
      current,
      missing,
      releaseBudget,
      releaseMetrics,
      "release",
    ).join("\n"),
  ).toContain("ceiling 300 -> 426");
  const raised = structuredClone(budget);
  raised.grandfathered.functions[id]++;
  expect(
    historyRegressions(
      current,
      raised,
      releaseBudget,
      releaseMetrics,
      "release",
    ).join("\n"),
  ).toContain("cannot rise or be forged");
  put(root, "tools/brand-new.ts", fn(301, "newBody"));
  metrics(root);
  const attack = run(root, [], { GITHUB_BASE_REF: "release" });
  expect(attack.status).toBe(1);
  expect(attack.stderr).toContain(
    "ceiling 300 -> 301 (new or unmatched content)",
  );
});
it("uses a committed release budget without origin/dev and rejects an allowance raise", () => {
  const root = repo();
  put(root, path, fn(90));
  save(root, createBudget(metrics(root)));
  const base = commit(root, "release already has a budget");
  git(root, "update-ref", "refs/remotes/origin/release", base);
  put(root, path, fn(95));
  save(root, createBudget(metrics(root)));
  const env = { GITHUB_BASE_REF: "release" },
    history = readHistory(root, env);
  expect(history.budgetSource).toBe("committed");
  expect(history.revision).toBe(base);
  expect(history.information).toBeUndefined();
  const result = run(root, [], env);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("cannot rise");
  expect(result.stdout).not.toContain("Health bootstrap:");
});
it.each([false, true])(
  "rejects the former 52 to 72 to 82 allowance chain against release (committed base budget: %s)",
  (hasBudget) => {
    const root = repo();
    put(root, path, fn(52, "runThermite"));
    if (hasBudget) save(root, createBudget(metrics(root)));
    const release = commit(root, "release at 52 lines");
    git(root, "update-ref", "refs/remotes/origin/release", release);
    git(root, "update-ref", "refs/remotes/origin/dev", release);
    if (!hasBudget) {
      save(root, createBudget(metrics(root)));
      const bootstrap = commit(root, "dev commits its current-format budget");
      git(root, "update-ref", "refs/remotes/origin/dev", bootstrap);
    }
    const original = readFileSync(root + "/scripts/health-budget.json", "utf8");
    for (const size of [72, 82]) {
      put(root, path, fn(size, "runThermite"));
      const accepted = run(root, ["--accept", "--reason", "reviewed growth"], {
        GITHUB_BASE_REF: "dev",
      });
      expect(accepted.status).toBe(1);
      expect(accepted.stderr).toContain("cannot rise");
      expect(readFileSync(root + "/scripts/health-budget.json", "utf8")).toBe(
        original,
      );
      const forged = createBudget(metrics(root)),
        identity = "functions:" + path + "#runThermite";
      forged.reasons[identity] = [
        { identity, from: 70, to: size, reason: "exact but forbidden" },
      ];
      save(root, forged);
      const rejected = run(root, [], { GITHUB_BASE_REF: "release" });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("cannot rise");
      save(root, JSON.parse(original));
    }
    put(root, path, fn(52, "runThermite"));
    put(root, "packages/cli/src/new.ts", fn(301, "brandNew"));
    put(root, "tools/new.py", "# line\n".repeat(3001));
    metrics(root);
    const result = run(root, [], { GITHUB_BASE_REF: "release" });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "functions ceiling 300 -> 301 (new or unmatched content)",
    );
    expect(result.stderr).toContain(
      "files ceiling 3000 -> 3001 (new or unmatched content)",
    );
  },
);
