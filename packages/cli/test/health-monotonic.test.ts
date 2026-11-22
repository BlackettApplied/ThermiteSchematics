import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createBudget,
  historyRegressions,
  acceptBudget,
} from "../../../scripts/health-ratchet.mjs";
import { fn, repo, put, metrics } from "./health-fixture.js";

const sections = [
  "files",
  "functions",
  "nonNullAssertions",
  "typeAssertions",
  "definiteAssignments",
  "skippedTests",
  "duplicates",
];
function source(n: number, primary: boolean, section: string) {
  if (section === "files") return "// measured\n".repeat(900 + n);
  if (section === "functions") return fn(90 + n);
  if (section === "nonNullAssertions")
    return "declare const v:string|undefined;\n" + "void v!;\n".repeat(n);
  if (section === "typeAssertions")
    return "declare const v:unknown;\n" + "void (v as string);\n".repeat(n);
  if (section === "definiteAssignments")
    return Array.from({ length: n }, (_, i) => `let v${i}!: string;\n`).join(
      "",
    );
  if (section === "skippedTests")
    return "it.skip('disabled',()=>{});\n".repeat(n);
  const body = "{\n" + `value += ${primary ? 1 : 2};\n`.repeat(30) + "}\n";
  return Array.from(
    { length: n },
    (_, i) => `function f${i}(value) ${body}`,
  ).join("");
}
function scenario(section: string) {
  const root = repo(),
    path = "packages/example/src/current.ts",
    donor = "packages/example/src/donor.ts";
  put(root, path, source(section === "duplicates" ? 2 : 1, true, section));
  put(root, donor, source(section === "duplicates" ? 3 : 2, false, section));
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, source(section === "duplicates" ? 3 : 2, true, section));
  put(root, donor, source(section === "duplicates" ? 2 : 1, false, section));
  const current = metrics(root),
    next = createBudget(current);
  // Casts had only an implicit measured allowance before HEALTH-8.
  for (const [budget, data] of [
    [before, base],
    [next, current],
  ]) {
    budget.typeAssertions = Object.fromEntries(
      Object.entries(data.files)
        .filter(([, f]) => f.typeAssertions)
        .map(([k, f]) => [k, f.typeAssertions]),
    );
  }
  next.ceilings = structuredClone(before.ceilings);
  const key = Object.keys(next[section]).find(
    (k) =>
      next[section][k] > (before[section][k] ?? 0) && before[section][k] > 0,
  );
  expect(key).toBeDefined();
  if (!key) throw Error("Missing test identity");
  const identity = section + ":" + key;
  next.reasons[identity] = [
    {
      identity,
      from: before[section][key],
      to: next[section][key],
      reason: "An exact reason is no longer permission to raise",
    },
  ];
  return { current, before, next, base, section, key };
}
for (const target of ["dev", "release"]) {
  it.each(sections)(
    "rejects an exact-reason %s allowance raise against " + target,
    (section) => {
      const { current, before, next, base } = scenario(section);
      expect(
        historyRegressions(current, next, before, base, target).join("\n"),
      ).toContain("cannot rise");
    },
  );
}
it.each(sections)(
  "accept refuses an existing %s allowance raise",
  (section) => {
    const { current, before, next, base } = scenario(section);
    const budget = structuredClone(before);
    // Supply even the extra fresh-cast reason before accept: it is insufficient.
    budget.reasons = structuredClone(next.reasons);
    expect(() =>
      acceptBudget(current, budget, "reason", {
        budget: before,
        metrics: base,
      }),
    ).toThrow("cannot rise");
  },
);
it("transfers a verbatim function allowance only while retiring the source allowance", () => {
  const root = repo(),
    from = "packages/example/src/old.ts",
    to = "packages/example/src/new.ts";
  put(root, from, fn(90));
  const base = metrics(root),
    before = createBudget(base);
  put(root, to, fn(90));
  rmSync(join(root, from));
  const current = metrics(root),
    next = createBudget(current);
  next.moves[to + "#existing"] = {
    section: "functions",
    from: from + "#existing",
    sha256: base.bodyHashes[from + "#existing"],
  };
  expect(historyRegressions(current, next, before, base)).toEqual([]);
  next.functions[from + "#existing"] = before.functions[from + "#existing"];
  expect(historyRegressions(current, next, before, base).join("\n")).toContain(
    "cannot rise",
  );
});

it("an omitted cast map uses authenticated base counts rather than PR-head counts", async () => {
  const { upgradeBudget } = await import("../../../scripts/health-budget.mjs");
  const root = repo(),
    path = "packages/example/src/casts.ts";
  put(root, path, "declare const x:unknown; void(x as string);");
  const base = metrics(root),
    raw = createBudget(base);
  delete raw.typeAssertions;
  put(
    root,
    path,
    "declare const x:unknown; void(x as string); void(x as string);",
  );
  const current = metrics(root),
    upgraded = upgradeBudget(raw, current, base);
  expect(upgraded.typeAssertions[path]).toBe(1);
  const next = createBudget(current),
    identity = "typeAssertions:" + path;
  next.reasons[identity] = [
    { identity, from: 1, to: 2, reason: "not permission" },
  ];
  expect(historyRegressions(current, next, raw, base).join("\n")).toContain(
    "cannot rise",
  );
});
