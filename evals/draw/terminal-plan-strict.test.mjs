import { beforeAll, afterAll, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { launch, drawingContextOptions } from "./browser.mjs";
import {
  terminalPlanFixture,
  strictTerminalRows,
  measureTerminalPlan,
} from "./terminal-plan-strict-fixture.mjs";
import { mutateTerminalSvg } from "./terminal-plan-svg-mutants.mjs";
import { terminalPlanAudits } from "./terminal-plan-strict.mjs";
import { evaluateSheet } from "./evaluate.mjs";
let browser, context, page, fixture, split;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
  fixture = await terminalPlanFixture(page);
  split = await terminalPlanFixture(page, "operator-console");
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
  if (fixture) await rm(fixture.directory, { recursive: true, force: true });
  if (split) await rm(split.directory, { recursive: true, force: true });
});
it.each([
  ["missing-strip", "strip-terminal-coverage"],
  ["dropped-core", "strip-conductor-incidence"],
  ["wrong-peer", "strip-conductor-incidence"],
  ["missing-bridge", "strip-bridge-geometry"],
  ["extra-bridge", "strip-extra-bridge"],
  ["wrong-order", "strip-wrong-order"],
  ["missing-continuation", "strip-order-continuation"],
  ["broken-reference", "strip-row-reference"],
  ["identity-only", "strip-terminal-coverage"],
  ["hidden-root", "strip-terminal-coverage"],
])("strict DQ-23 rejects actual %s SVG", async (name, kind) => {
  const source = name === "missing-continuation" ? split : fixture;
  const packet = structuredClone(source.packet);
  let changed = 0;
  for (const s of packet.sheets) {
    if (name !== "broken-reference" && s.view.kind !== "terminal-strip")
      continue;
    const mutant = await mutateTerminalSvg(page, s.svg, name);
    s.svg = mutant.svg;
    changed += mutant.changed;
  }
  expect(changed).toBeGreaterThan(0);
  const measured = await measureTerminalPlan({ ...source, packet }, page);
  if (name === "identity-only") {
    const before = source.geometries.flatMap(
      (g) => g.terminalStripInk?.terminals ?? [],
    );
    const after = measured.geometries.flatMap(
      (g) => g.terminalStripInk?.terminals ?? [],
    );
    expect(after.map((t) => t.key)).toEqual(before.map((t) => t.key));
    expect(after.every((t) => t.rect === null && !t.texts.length)).toBe(true);
  }
  const rows = strictTerminalRows(measured);
  expect(rows.some((r) => r.status === "fail")).toBe(true);
  const findings = rows.flatMap((r) => r.evidence.findings);
  expect(findings.some((f) => f.kind === kind)).toBe(true);
  expect(
    findings.every((f) => f.nativeLocator?.startsWith("terminal-plan/")),
  ).toBe(true);
});
it("strict sheet evaluation actually invokes the complete sibling-view oracle", () => {
  const x = fixture,
    s = x.packet.sheets[0];
  const rows = evaluateSheet(
    { id: "check7" },
    s,
    x.packet,
    x.geometries[0],
    x.ir,
    [],
    [],
    [],
    x.tables,
    x.geometries,
    x.request,
  );
  expect(rows.find((r) => r.dq === "DQ-23")).toMatchObject({ status: "pass" });
});
it("missing measurement is infrastructure, never coverage or not applicable", () => {
  const geometries = structuredClone(fixture.geometries);
  delete geometries[1].terminalStripInk;
  const rows = strictTerminalRows({ ...fixture, geometries });
  expect(rows.some((r) => r.status === "infrastructure-error")).toBe(true);
});
it("a completely missing strip sheet is a failure on its native inventory view", async () => {
  const packet = structuredClone(fixture.packet);
  packet.sheets = packet.sheets.filter((s) => s.view.kind !== "terminal-strip");
  const x = await measureTerminalPlan({ ...fixture, packet }, page);
  expect(strictTerminalRows(x)[0]).toMatchObject({ status: "fail" });
  expect(
    terminalPlanAudits(x.packet, x.geometries, x.ir, x.request)[0].assessment,
  ).toBe("fail");
});
it("defines no requested terminal plan and an empty native selection as not applicable", () => {
  expect(
    terminalPlanAudits(fixture.packet, [], fixture.ir, { views: [] }),
  ).toEqual([
    {
      assessment: "not-applicable",
      reason: "No requested terminal plan",
      sheets: [],
    },
  ]);
  const ir = {
    ...fixture.ir,
    devices: [],
    deviceTypes: [],
    wires: [],
    jumpers: [],
    cables: [],
  };
  const rows = terminalPlanAudits({ sheets: [] }, [], ir, fixture.request);
  expect(rows[0]).toMatchObject({
    assessment: "not-applicable",
    reason: "Empty native terminal selection",
  });
});
async function withCrossing(source) {
  const packet = structuredClone(source.packet);
  let changed = 0;
  for (const sheet of packet.sheets) {
    if (sheet.view.kind !== "terminal-strip") continue;
    const mutant = await mutateTerminalSvg(
      page,
      sheet.svg,
      "stub-crosses-bridge",
    );
    sheet.svg = mutant.svg;
    changed += mutant.changed;
  }
  expect(changed).toBe(1);
  return measureTerminalPlan({ ...source, packet }, page);
}
it("keeps native terminal views separate even with identical titles", async () => {
  const request = {
    format: "schematic-packet-request/0.1",
    index: false,
    views: ["TB1", "JB1"].map((device) => ({
      format: "documentation-view-request/0.1",
      kind: "terminals",
      filter: { devices: [device] },
    })),
  };
  const x = await terminalPlanFixture(page, "motor-starter", request);
  try {
    const { packet, geometries, ir } = await withCrossing(x);
    const audits = terminalPlanAudits(packet, geometries, ir, x.request);
    expect(audits.map((a) => a.findings.map((f) => f.kind))).toEqual([
      ["strip-approach-conductor-bridge"],
      [],
    ]);
    expect(audits[0].sheets.every((s) => !audits[1].sheets.includes(s))).toBe(
      true,
    );
  } finally {
    await rm(x.directory, { recursive: true, force: true });
  }
});
it("strict DQ-23 assigns an injected crossing to the painted sheet alone", async () => {
  expect(
    strictTerminalRows(fixture).filter((r) => r.status === "fail"),
  ).toEqual([]);
  const rows = strictTerminalRows(await withCrossing(fixture));
  expect(
    fixture.packet.sheets.some((s) => s.view.kind === "terminal-strip"),
  ).toBe(true);
  const failed = rows.filter((r) => r.status === "fail");
  expect(failed).toHaveLength(1);
  expect(failed[0].sheet).toBe(
    fixture.packet.sheets.find((s) => s.view.kind === "terminal-strip").number,
  );
  expect(failed[0].evidence).toMatchObject({
    findingCount: 1,
    findings: [{ kind: "strip-approach-conductor-bridge" }],
    approachCounts: [{ conductorBridgePairs: expect.any(Number) }],
  });
});
