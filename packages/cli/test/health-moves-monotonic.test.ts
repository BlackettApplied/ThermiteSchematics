import { expect, it } from "vitest";
import {
  createBudget,
  historyRegressions,
  acceptBudget,
} from "../../../scripts/health-ratchet.mjs";
import { repo, put, metrics } from "./health-fixture.js";

const sections = [
  "nonNullAssertions",
  "typeAssertions",
  "definiteAssignments",
  "skippedTests",
];
function operations(section: string, n: number) {
  return Array.from({ length: n }, (_, i) =>
    section === "nonNullAssertions"
      ? "void input!;"
      : section === "typeAssertions"
        ? "void (input as string);"
        : section === "definiteAssignments"
          ? `let a${i}!:string; void a${i};`
          : "it.skip('disabled',()=>{});",
  ).join("\n");
}
function counted(section: string, n: number, name: string) {
  return `function ${name}(input) {\n${operations(section, n)}\n}\n`;
}
// Preserve the old implicit cast baseline when replaying on pre-HEALTH-8 code.
function castBaseline(
  budget: ReturnType<typeof createBudget>,
  data: ReturnType<typeof metrics>,
) {
  budget.typeAssertions = Object.fromEntries(
    Object.entries(data.files)
      .filter(([, f]) => f.typeAssertions)
      .map(([k, f]) => [k, f.typeAssertions]),
  );
}
function countedFixture(section: string, mode = "valid") {
  const root = repo(),
    from = "packages/example/src/source.ts",
    to = "packages/example/src/lifted.ts",
    donor = "packages/example/src/donor.ts";
  const original =
    counted(section, 1, "lifted") + counted(section, 2, "retained");
  put(root, from, original);
  put(root, donor, counted(section, 1, "credit"));
  const base = metrics(root),
    before = createBudget(base);
  put(
    root,
    from,
    mode === "source-present"
      ? original
      : mode === "renamed-source"
        ? counted(section, 1, "renamed") + counted(section, 1, "retained")
        : mode === "outside"
          ? ""
          : counted(section, 2, "retained"),
  );
  put(
    root,
    donor,
    ["source-present", "double"].includes(mode)
      ? ""
      : counted(section, 1, "credit"),
  );
  put(
    root,
    to,
    counted(section, 1, "lifted") +
      (mode === "outside" ? operations(section, 2) : ""),
  );
  if (mode === "double")
    put(root, "packages/example/src/second.ts", counted(section, 1, "lifted"));
  const current = metrics(root),
    next = createBudget(current);
  castBaseline(before, base);
  castBaseline(next, current);
  next.ceilings = structuredClone(before.ceilings);
  for (const path of mode === "double"
    ? [to, "packages/example/src/second.ts"]
    : [to]) {
    next.moves[section + ":" + path] = {
      section,
      from,
      sourceBody: from + "#lifted",
      targetBody: path + "#lifted",
      sha256: base.bodyHashes[from + "#lifted"],
    };
    const identity = section + ":" + path;
    next.reasons[identity] = [
      {
        identity,
        from: 0,
        to: current.files[path][section],
        reason: "moved verbatim from " + from + " by HEALTH-8 extraction",
      },
    ];
  }
  if (mode === "stale") next[section][from] = before[section][from];
  return { current, next, before, base, from, to };
}
it.each(sections)(
  "funds a verbatim %s body move from its source reduction",
  (section) => {
    const { current, next, before, base, from, to } = countedFixture(section);
    expect(current.files[from][section]).toBe(base.files[from][section] - 1);
    expect(current.bodyCounters[to + "#lifted"][section]).toBe(1);
    expect(historyRegressions(current, next, before, base)).toEqual([]);
    const proposal = structuredClone(before);
    proposal.moves = structuredClone(next.moves);
    const recorded = acceptBudget(
      current,
      proposal,
      "moved verbatim from " + from + " by HEALTH-8 extraction",
      { budget: before, metrics: base },
    );
    expect(recorded[section]).toEqual(next[section]);
    expect(recorded.reasons[section + ":" + to]).toEqual(
      next.reasons[section + ":" + to],
    );
    expect(
      acceptBudget(current, next, "moved verbatim", {
        budget: before,
        metrics: base,
      })[section],
    ).toEqual(next[section]);
  },
);
for (const mode of [
  "source-present",
  "outside",
  "double",
  "stale",
  "renamed-source",
]) {
  it.each(sections)(
    "rejects a " + mode + " %s move despite exact reasons and unchanged totals",
    (section) => {
      const { current, next, before, base } = countedFixture(section, mode);
      const total = (data: typeof current) =>
        Object.values(data.files).reduce((n, f) => n + (f[section] ?? 0), 0);
      expect(total(current)).toBe(total(base));
      expect(
        historyRegressions(current, next, before, base).join("\n"),
      ).toContain("cannot rise");
    },
  );
}
