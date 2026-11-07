import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinCheckpoint } from "./checkpoint.mjs";
import { readRun, adjudicateRun } from "./records.mjs";
import { planAttempt, selectAttempts } from "./attempts.mjs";
it("checkpoint creation pins both hashes and version; overrides are explicit and persistent", () => {
  const a = { harnessHash: "h1", checkerHarnessHash: "c1", evalVersion: "1" },
    b = { ...a, harnessHash: "h2" };
  const first = pinCheckpoint(null, a);
  expect(() => pinCheckpoint(first, b)).toThrow(/mismatch/);
  const accepted = pinCheckpoint(first, b, { allowMismatch: true, now: 1 });
  expect(accepted.createdIdentity).toEqual(a);
  expect(accepted.identityOverrides).toHaveLength(1);
  expect(pinCheckpoint(accepted, b)).toEqual(accepted);
  expect(() => pinCheckpoint({}, b)).toThrow(/mismatch/);
});
for (const resolution of ["infrastructure", "agent-failure"])
  it(`recorded ${resolution} adjudication preserves evidence and first-complete selection`, () => {
    const work = mkdtempSync(join(tmpdir(), "eval-adjudication-"));
    try {
      const row = {
        task: "T01",
        context: "runtime",
        arm: "A",
        agent: "codex",
        seed: 1,
        attempt: 1,
        status: "needs-adjudication",
        outcome: { pass: false },
      };
      const bytes = JSON.stringify(row),
        file = join(work, "manifest.json");
      writeFileSync(file, bytes);
      expect(planAttempt([row]).kind).toBe("adjudicate");
      expect(planAttempt([row], false, { reopenInfra: "all" }).kind).toBe(
        "run",
      );
      const rerun = {
        ...row,
        attempt: 2,
        status: "complete",
        outcome: { pass: true },
      };
      expect(selectAttempts([row, rerun]).errors.join(" ")).toContain(
        "Unresolved adjudication",
      );
      adjudicateRun(work, {
        resolution,
        reason: "Inspected the local terminal event",
        operator: "tester",
        now: 1,
      });
      const decided = readRun(file);
      expect(readFileSync(file, "utf8")).toBe(bytes);
      const selection = selectAttempts([decided, rerun]);
      expect(selection.errors).toEqual([]);
      expect(selection.selected[0].attempt).toBe(
        resolution === "agent-failure" ? 1 : 2,
      );
      writeFileSync(file, bytes + " ");
      expect(() => readRun(file)).toThrow(/does not match/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
it("external checker catalogs are pinned independently of the framework", async () => {
  const { harnessIdentity } = await import("./checkpoint.mjs");
  const work = mkdtempSync(join(tmpdir(), "eval-checker-catalog-"));
  try {
    writeFileSync(join(work, "check.mjs"), "export default ()=>true;");
    const a = harnessIdentity({ tasksDir: work });
    writeFileSync(join(work, "check.mjs"), "export default ()=>false;");
    const b = harnessIdentity({ tasksDir: work });
    expect(a.harnessHash).toBe(b.harnessHash);
    expect(a.checkerHash).not.toBe(b.checkerHash);
    expect(() => pinCheckpoint(a, b)).toThrow(/mismatch/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
