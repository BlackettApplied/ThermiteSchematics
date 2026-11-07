import { describe, it, expect } from "vitest";
import { analyze, bootstrapLower, fullTasks } from "./analyze.mjs";
import { agentConfiguration } from "./launch.mjs";
function fixture() {
  const rows = [];
  for (const context of ["runtime", "source"])
    for (const task of context === "runtime"
      ? fullTasks
      : ["T02", "T05", "T06", "T07"])
      for (const agent of ["claude", "codex"])
        for (const arm of ["A", "B"])
          rows.push({
            commit: "fixed",
            taskHash: task,
            promptHash: task,
            status: "complete",
            context,
            task,
            agent,
            arm,
            seed: 1,
            outcome: { pass: true },
            metrics: {
              violations: [],
              guideBytes: arm === "A" ? 10000 : 7000,
              usage: { inputTokens: 1000 },
              failedCalls: 0,
              retrieval: [{ retrieved: true }],
            },
          });
  return rows;
}
it("model and effort overrides never mix with pinned comparisons", () => {
  const pinned = fixture().map((r) => ({
    ...r,
    ...agentConfiguration({ agent: r.agent }),
  }));
  expect(analyze(pinned).accepted).toBe(true);
  for (const override of [
    { model: "alternative" },
    { effort: "high" },
    { model: "gpt-6.1-sol" },
  ]) {
    const changed = pinned
      .filter((r) => r.agent === "codex")
      .map((r) => ({
        ...r,
        ...agentConfiguration({ agent: "codex", ...override }),
      }));
    const result = analyze([...pinned, ...changed]);
    expect(result.accepted).toBe(false);
    expect(result.errors).toContain(
      "Mixed model/effort configurations for codex; analyze separately",
    );
    expect(result.errors.join(" ")).not.toContain("Duplicate");
    const unmatched = pinned.map((r) =>
      r.arm === "B" && r.agent === "codex"
        ? { ...r, ...agentConfiguration({ agent: "codex", ...override }) }
        : r,
    );
    expect(
      analyze(unmatched).errors.some((e) => e.startsWith("Missing B ")),
    ).toBe(true);
  }
  const overridden = pinned.map((r) =>
    r.agent === "codex"
      ? {
          ...r,
          ...agentConfiguration({
            agent: "codex",
            model: "alternative",
            effort: "high",
          }),
        }
      : r,
  );
  expect(analyze(overridden).accepted).toBe(true);
  expect(
    analyze(overridden).table.find((r) => r.agent === "codex"),
  ).toMatchObject({ model: "alternative", effort: "high" });
});
describe("six scorecard acceptance rules", () => {
  it("accepts complete paired evidence and prints every task/agent/context", () => {
    const r = analyze(fixture());
    expect(r.accepted).toBe(true);
    expect(r.table).toHaveLength(34);
    expect(r.rules).toHaveLength(6);
  });
  for (const rule of [1, 2, 3, 4, 5, 6])
    it(`rejects rule ${rule}`, () => {
      const rows = fixture(),
        b = rows.filter((r) => r.arm === "B");
      if (rule === 1) b[0].metrics.violations.push({ rule: "V8" });
      if (rule === 2)
        for (const r of b.filter((r) => r.context === "runtime"))
          r.outcome.pass = false;
      if (rule === 3)
        for (const r of b.filter((r) => r.task === "T01"))
          r.outcome.pass = false;
      if (rule === 4) for (const r of b) r.metrics.guideBytes = 9000;
      if (rule === 5)
        for (const r of b) r.metrics.retrieval = [{ retrieved: false }];
      if (rule === 6)
        for (const r of b.filter((r) => r.context === "source"))
          r.outcome.pass = false;
      const result = analyze(rows);
      expect(result.accepted).toBe(false);
      expect(result.rules.find((r) => r.id === rule).pass).toBe(false);
    });
  it("rule 4 also rejects higher input tokens or failed calls", () => {
    for (const field of ["tokens", "failures"]) {
      const rows = fixture(),
        b = rows.find((r) => r.arm === "B");
      if (field === "tokens")
        for (const r of rows.filter((r) => r.arm === "B"))
          r.metrics.usage.inputTokens = 1001;
      else b.metrics.failedCalls = 1;
      expect(analyze(rows).rules[3].pass).toBe(false);
    }
  });
  it("refuses missing, duplicated, mismatched and unjudged evidence", () => {
    const rows = fixture();
    expect(analyze(rows.slice(1)).accepted).toBe(false);
    expect(analyze([...rows, rows[0]]).accepted).toBe(false);
    rows[0].commit = "other";
    expect(analyze(rows).accepted).toBe(false);
    rows[0].commit = "fixed";
    rows[0].outcome.rubricPending = true;
    expect(analyze(rows).accepted).toBe(false);
  });
  it("requires seed 2 when outcomes differ and rejects judge disagreement", () => {
    const rows = fixture();
    rows.find((r) => r.arm === "B").outcome.pass = false;
    expect(analyze(rows).errors.some((e) => e.includes("seed 2"))).toBe(true);
    const run = rows[0];
    run.outcome.rubricPending = true;
    run.judges = [
      { judge: "claude", pass: true },
      { judge: "codex", pass: false },
    ];
    expect(analyze(rows).errors.some((e) => e.includes("rubric"))).toBe(true);
  });
  it("uses fixed-seed one-sided 95% task bootstrap", () => {
    expect(bootstrapLower([0, 0, 0, 0])).toBe(0);
    expect(bootstrapLower([-1, 0, 0])).toBeLessThan(-0.05);
    expect(bootstrapLower([0, 0.1, -0.1])).toBe(bootstrapLower([0, 0.1, -0.1]));
  });
});

it("counts source-context cost regressions and task collapses", () => {
  const rows = fixture();
  rows.find(
    (r) => r.arm === "B" && r.context === "source",
  ).metrics.failedCalls = 1;
  expect(analyze(rows).rules[3].pass).toBe(false);
  const collapse = fixture();
  for (const r of collapse.filter(
    (r) => r.context === "source" && r.task === "T02" && r.arm === "B",
  ))
    r.outcome.pass = false;
  expect(analyze(collapse).rules[2].pass).toBe(false);
});

it("resolved infrastructure attempts and adjudicated originals coexist", () => {
  const rows = fixture(),
    original = structuredClone(rows[0]);
  rows[0].status = "infrastructure-failure";
  rows[0].attempt = 1;
  const completed = { ...original, attempt: 2 };
  const adjudicated = {
    ...structuredClone(completed),
    adjudication: { revision: 1 },
    judges: [
      { judge: "claude", pass: true },
      { judge: "codex", pass: true },
    ],
  };
  const r = analyze([...rows, completed, adjudicated]);
  expect(r.accepted).toBe(true);
  expect(r.errors.some((e) => e.includes("Duplicate"))).toBe(false);
  expect(
    r.attempts.find((a) => a.key.startsWith("A/") && a.selectedAttempt === 2)
      .attempts,
  ).toHaveLength(2);
  expect(analyze(rows).accepted).toBe(false);
});
it("CLI version or unchanged-guide mismatches block comparison", () => {
  const rows = fixture();
  rows[0].cliVersions = { bun: "1.4.2", agent: "0.164.0" };
  rows[1].cliVersions = { bun: "1.4.2", agent: "0.170.0" };
  expect(analyze(rows).errors.some((e) => e.includes("CLI version"))).toBe(
    true,
  );
  const guides = fixture();
  guides[0].guideHash = "same";
  guides[1].guideHash = "same";
  expect(analyze(guides).errors.some((e) => e.includes("Guide hashes"))).toBe(
    true,
  );
});
it("both agent harness and effective checker identities must match", () => {
  for (const field of ["checkerHarnessHash", "checkerTaskTreeHash"]) {
    const rows = fixture();
    rows[0].harnessHash = rows[1].harnessHash = "agent-harness";
    rows[0][field] = "changed";
    expect(
      analyze(rows).errors.some((e) =>
        e.includes("Effective checker mismatch"),
      ),
    ).toBe(true);
  }
  const rows = fixture();
  rows[0].harnessHash = "one";
  rows[1].harnessHash = "two";
  rows[0].checkerHarnessHash = rows[1].checkerHarnessHash = "same-checker";
  expect(
    analyze(rows).errors.some((e) => e.includes("Checker/harness mismatch")),
  ).toBe(true);
});
it("resolved infra remains visible per arm", () => {
  const rows = fixture(),
    complete = { ...structuredClone(rows[0]), attempt: 2 };
  rows[0].status = "infrastructure-failure";
  rows[0].infrastructureKind = "rate-limit";
  const r = analyze([...rows, complete]);
  expect(r.accepted).toBe(true);
  expect(r.infraCounts).toEqual({
    A: { total: 1, byKind: { "rate-limit": 1 } },
    B: { total: 0, byKind: {} },
  });
});
it("forced reruns are reported and cannot replace the first completed failure", () => {
  const rows = fixture(),
    first = rows.find((r) => r.arm === "B");
  first.outcome.pass = false;
  const r = analyze([
    ...rows,
    {
      ...structuredClone(first),
      attempt: 2,
      forceRerun: true,
      outcome: { pass: true },
    },
  ]);
  expect(r.accepted).toBe(false);
  expect(
    r.table.find(
      (x) =>
        x.task === first.task &&
        x.context === first.context &&
        x.agent === first.agent,
    ).B,
  ).toBe(0);
  expect(r.warnings.join(" ")).toMatch(/first counts.*forced: 2/);
});

it("selected cohorts cannot mix harnesses, effective checkers, task checkers or eval versions", () => {
  for (const field of [
    "harnessHash",
    "checkerHarnessHash",
    "checkerHash",
    "evalVersion",
    "checkerTaskTreeHash",
  ]) {
    const rows = fixture();
    for (const r of rows) r[field] = "one";
    for (const r of rows.filter((r) => r.task === "T02")) r[field] = "two";
    // Per-task trees normally differ, so mix one task's contexts/seeds instead.
    if (field === "checkerTaskTreeHash")
      rows.find((r) => r.task === "T02")[field] = "three";
    const result = analyze(rows);
    expect(result.accepted).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Mixed/);
  }
});
it("analysis warnings summarize every reopen, pending/recorded decision and shutdown exit", () => {
  const rows = fixture(),
    first = rows[0];
  const pending = {
    ...structuredClone(first),
    attempt: 1,
    status: "needs-adjudication",
  };
  first.attempt = 2;
  first.reopenedHalt = true;
  first.reopenInfra = { request: "all", previousAutomaticFailures: 3 };
  first.exitAfterCompletion = true;
  first.agentExit = 1;
  let result = analyze([...rows, pending]);
  expect(result.accepted).toBe(false);
  expect(result.warnings.join(" ")).toMatch(/Needs adjudication/);
  pending.status = "infrastructure-failure";
  pending.infraAdjudication = {
    resolution: "infrastructure",
    operator: "reviewer",
    reason: "Inspected terminal event",
  };
  result = analyze([...rows, pending]);
  expect(result.accepted).toBe(true);
  for (const text of [
    "Infra counter reopened",
    "Halted key reopened",
    "Infra adjudication",
    "Exit after completion",
  ])
    expect(result.warnings.join(" ")).toContain(text);
});
