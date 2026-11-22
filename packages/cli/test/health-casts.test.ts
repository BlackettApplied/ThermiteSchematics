import { expect, it } from "vitest";
import ts from "typescript";
import {
  countTypeAssertions,
  typeAssertionRegressions,
} from "../../../scripts/health-casts.mjs";
import {
  createBudget,
  regressions,
  acceptBudget,
} from "../../../scripts/health-ratchet.mjs";
import {
  repo,
  put,
  metrics,
  save,
  commit,
  git,
  run,
} from "./health-fixture.js";
it("counts as/angle assertions but excludes as const, angle const and satisfies", () => {
  const source = ts.createSourceFile(
    "casts.ts",
    "const a=x as string; const b=<number>x; const c=x as const; const d=<const>x; const e=x satisfies string;",
    ts.ScriptTarget.Latest,
    true,
  );
  expect(source.parseDiagnostics).toEqual([]);
  expect(countTypeAssertions(source).count).toBe(2);
});
it("rejects the C7e cbe6108 substitution: 1008 to 993 non-null, 17 points of false headroom", () => {
  const root = repo(),
    path = "packages/render/src/view-spec.ts";
  const before =
    "declare const input:{value?:string};\n" +
    "void input.value!;\n".repeat(1008);
  put(root, path, before);
  const base = metrics(root),
    budget = createBudget(base);
  budget.ceilings.nonNullAssertions = 1010;
  save(root, budget);
  const sha = commit(root);
  git(root, "branch", "dev", sha);
  const after = before.replace(
    "void input.value!;\n".repeat(15),
    "void (input.value as string);\n".repeat(15),
  );
  put(root, path, after);
  const current = metrics(root),
    reference = { budget: structuredClone(budget), metrics: base };
  expect(base.files[path].nonNullAssertions).toBe(1008);
  expect(current.files[path].nonNullAssertions).toBe(993);
  expect(
    budget.ceilings.nonNullAssertions - current.files[path].nonNullAssertions,
  ).toBe(17);
  expect(regressions(current, budget, reference)).toEqual([
    expect.stringContaining("Type assertion allowance requires exact reason"),
    expect.stringContaining("type assertions 0 -> 15"),
  ]);
  expect(() =>
    acceptBudget(current, budget, "not an implicit cast allowance", reference),
  ).toThrow("cannot rise");
  const result = run(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("0 -> 15");
  expect(result.stderr).not.toMatch(/Cannot parse|compile error/i);
});
it("requires an exact per-file cast allowance and preserves every earlier reason", () => {
  const root = repo(),
    path = "packages/example/src/cast.ts",
    id = "typeAssertions:" + path;
  put(root, path, "declare const x:unknown; void x;");
  const base = metrics(root),
    budget = createBudget(base);
  put(root, path, "declare const x:unknown; void (x as string);");
  const current = metrics(root),
    reference = { budget: structuredClone(budget), metrics: base };
  expect(typeAssertionRegressions(current, budget, reference)).toHaveLength(1);
  budget.reasons[id] = [
    {
      identity: id,
      from: 0,
      to: 1,
      reason: "Reviewed narrowing after an explicit guard",
    },
  ];
  expect(typeAssertionRegressions(current, budget, reference)).toEqual([]);
  budget.reasons[id][0].to = 2;
  expect(typeAssertionRegressions(current, budget, reference)).toHaveLength(1);
});

it("round 2 rejects re-adding 15 casts under a stale reason from the base", () => {
  const root = repo(),
    path = "packages/example/src/readded.ts",
    id = "typeAssertions:" + path,
    before = "declare const input:unknown;\n" + "void input;\n".repeat(15);
  put(root, path, before);
  const base = metrics(root),
    budget = createBudget(base);
  budget.reasons[id] = [
    { identity: id, from: 0, to: 15, reason: "Earlier cast review" },
  ];
  save(root, budget);
  git(root, "branch", "dev", commit(root));
  put(root, path, before.replaceAll("void input;", "void (input as string);"));
  const current = metrics(root),
    reference = { budget: structuredClone(budget), metrics: base };
  expect(base.files[path].typeAssertions).toBe(0);
  expect(current.files[path].typeAssertions).toBe(15);
  expect(typeAssertionRegressions(current, budget, reference)).toEqual([
    expect.stringContaining("Type assertion allowance requires exact reason"),
  ]);
  expect(() =>
    acceptBudget(current, budget, "generic reason", reference),
  ).toThrow("cannot rise");
  const rejected = run(root);
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain("Type assertion");
  expect(rejected.stderr).not.toMatch(/Cannot parse|compile error/i);
  budget.reasons[id].push({
    identity: id,
    from: 0,
    to: 15,
    reason: "Re-reviewed these casts in this change",
  });
  expect(typeAssertionRegressions(current, budget, reference)).toEqual([]);
  save(root, budget);
  const stillRejected = run(root);
  expect(stillRejected.status).toBe(1);
  expect(stillRejected.stderr).toContain("type assertions");
});
it("requires a new appended cast record with the authenticated base count", () => {
  const root = repo(),
    path = "packages/example/src/fresh.ts",
    id = "typeAssertions:" + path;
  put(root, path, "declare const input:unknown; void input;");
  const base = metrics(root),
    budget = createBudget(base),
    old = { identity: id, from: 0, to: 1, reason: "Earlier review" };
  budget.reasons[id] = [old];
  const reference = { budget: structuredClone(budget), metrics: base };
  put(root, path, "declare const input:unknown; void (input as string);");
  const current = metrics(root);
  budget.reasons[id].push(structuredClone(old));
  expect(typeAssertionRegressions(current, budget, reference)).toHaveLength(1);
  budget.reasons[id] = [{ ...old, reason: "Rewritten rather than appended" }];
  expect(typeAssertionRegressions(current, budget, reference)).toHaveLength(1);
  budget.reasons[id] = [old, { ...old, from: 1, reason: "Wrong base count" }];
  expect(typeAssertionRegressions(current, budget, reference)).toHaveLength(1);
  budget.reasons[id] = [old, { ...old, reason: "New review" }];
  expect(typeAssertionRegressions(current, budget, reference)).toEqual([]);
  expect(typeAssertionRegressions(base, reference.budget, reference)).toEqual(
    [],
  );
});

it.each([
  ["spaces", " Earlier   review "],
  ["newline", "Earlier\nreview"],
  ["tab", "Earlier\treview"],
  ["nonbreaking space", "\u00a0Earlier\u00a0review\u00a0"],
  ["removed separator", "Earlierreview"],
  ["inserted separators", "Ear lier rev iew"],
])(
  "round 3 rejects a whitespace-only cast reason replay: %s",
  (_name, reason) => {
    const root = repo(),
      path = "packages/example/src/whitespace.ts",
      id = "typeAssertions:" + path;
    put(root, path, "declare const input:unknown; void input;");
    const base = metrics(root),
      budget = createBudget(base);
    const old = { identity: id, from: 0, to: 1, reason: "Earlier review" };
    budget.reasons[id] = [old];
    const reference = { budget: structuredClone(budget), metrics: base };
    put(root, path, "declare const input:unknown; void (input as string);");
    const current = metrics(root);
    budget.reasons[id].push({ ...old, reason });
    expect(typeAssertionRegressions(current, budget, reference)).toHaveLength(
      1,
    );
    budget.reasons[id].push({ ...old, reason: "A genuinely new review" });
    expect(typeAssertionRegressions(current, budget, reference)).toEqual([]);
  },
);
