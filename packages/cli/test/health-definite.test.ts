import { expect, it } from "vitest";
import {
  createBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";
import { measureSources } from "../../../scripts/health-measure.mjs";
import { upgradeBudget } from "../../../scripts/health-budget.mjs";
import {
  repo,
  put,
  metrics,
  save,
  commit,
  git,
  run,
} from "./health-fixture.js";

const path = "packages/example/src/definite.ts";
const measured = (text: string) => measureSources([path], () => text);
it("counts definite-assignment fields and variables, not non-null uses or optional fields", () => {
  const current = measured(
    "let ready!: string; class Box { value!: number; optional?: number } ready!;",
  );
  expect(current.files[path].definiteAssignments).toBe(2);
});
it("rejects a non-null to definite-assignment substitution without buying headroom", () => {
  const before = measured(
    "declare const input: string | undefined; const value = input!;",
  );
  const current = measured(
    "declare const input: string | undefined; let value!: string; if(input !== undefined) value = input;",
  );
  const budget = createBudget(before);
  expect(
    historyRegressions(current, budget, budget, before).join("\n"),
  ).toContain("definiteAssignments");
});
it("banks definite-assignment ceilings and per-file allowances downward", async () => {
  const { lowerBudget } = await import("../../../scripts/health-ratchet.mjs");
  const before = measured("let first!: string; let second!: string;");
  const current = measured("let first!: string;");
  const budget = createBudget(before);
  expect(budget.ceilings.definiteAssignments).toBe(2);
  const lower = lowerBudget(current, budget, { budget, metrics: before });
  expect(lower.ceilings.definiteAssignments).toBe(1);
  expect(lower.definiteAssignments[path]).toBe(1);
  expect(
    historyRegressions(before, budget, lower, current).join("\n"),
  ).toContain("cannot rise");
});

it("seeds legacy v4 definite-assignment baselines from measured source with a reason", () => {
  const before = measured("let first!: string;");
  const legacy = createBudget(before);
  delete legacy.definiteAssignments;
  delete legacy.ceilings.definiteAssignments;
  const upgraded = upgradeBudget(legacy, before);
  expect(upgraded.ceilings.definiteAssignments).toBe(1);
  expect(upgraded.definiteAssignments[path]).toBe(1);
  expect(upgraded.reasons["definiteAssignments:" + path]).toEqual([
    expect.objectContaining({
      from: 0,
      to: 1,
      reason: expect.stringContaining("Measured initial"),
    }),
  ]);
});

it("rejects a forged definite-assignment ceiling over a legacy authenticated base", () => {
  const root = repo();
  put(root, path, "let first!: string;");
  const before = metrics(root),
    legacy = createBudget(before);
  delete legacy.definiteAssignments;
  delete legacy.ceilings.definiteAssignments;
  save(root, legacy);
  git(root, "branch", "dev", commit(root));
  put(root, path, "let first!: string; let second!: string;");
  save(root, createBudget(metrics(root)));
  const result = run(root);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain(
    "ceilings.definiteAssignments cannot rise: 1 -> 2",
  );
});

it("does not re-authorize a declaration move by deleting the counter section", () => {
  const root = repo(),
    moved = "packages/example/src/moved.ts";
  put(root, path, "let first!: string;");
  const budget = createBudget(metrics(root));
  save(root, budget);
  git(root, "branch", "dev", commit(root));
  put(root, path, "let first: string;");
  put(root, moved, "let second!: string;");
  delete budget.definiteAssignments;
  delete budget.ceilings.definiteAssignments;
  save(root, budget);
  git(root, "add", "-A");
  const result = run(root);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain(
    moved + ": definite-assignment declarations 0 -> 1",
  );
});

it("rejects a partial counter section instead of normalizing away a forged ceiling", () => {
  const root = repo();
  put(root, path, "let first!: string;");
  const budget = createBudget(metrics(root));
  save(root, budget);
  git(root, "branch", "dev", commit(root));
  delete budget.definiteAssignments;
  budget.ceilings.definiteAssignments = 2;
  save(root, budget);
  const result = run(root);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("Incomplete definiteAssignments baseline");
});
