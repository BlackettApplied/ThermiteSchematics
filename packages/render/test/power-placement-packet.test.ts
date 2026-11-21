import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import { compileCoreFixture } from "./fixtures.js";
import { renderSchematicPacket } from "../src/index.js";
import { renderSchematicPacket as originalPacket } from "../src/sheets.js";
import type { RenderedPacket, SchematicPacketRequest } from "../src/sheets.js";
import {
  circuitInlineTrace,
  circuitInlineContext,
  circuitLayoutCacheKey,
} from "../src/layout/circuit-inline-context.js";
import * as packetGuard from "../src/layout/circuit-packet-guard.js";
import * as quality from "../src/layout/power-placement.js";
import * as prepared from "../src/off-view/prepared.js";
import * as measured from "../src/layout/circuit-route-quality.js";
import * as recovery from "../src/packet/rooted-placements.js";
import { elkWorkScope, ElkWorkBudgetError } from "../src/layout/elk-work.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
afterEach(() => vi.restoreAllMocks());
const request: SchematicPacketRequest = {
  format: "schematic-packet-request/0.1",
  layout: "compact",
  page: { size: "tabloid", orientation: "landscape" },
  views: [
    {
      format: "schematic-view-request/0.1",
      family: "power",
      flow: "left-to-right",
      root: { by: "designation", value: "M1" },
    },
  ],
};

// Independent measurement of the actual printed SVG, without the planner's
// defect helpers, winner scores or eligibility metadata as an oracle.
function printedJogs(packet: RenderedPacket, designation: string) {
  return packet.sheets.flatMap((sheet) => {
    const document = parseHTML(sheet.svg).document;
    return [
      ...document.querySelectorAll(`path[data-designation="${designation}"]`),
    ].flatMap((path) => {
      const svg = path.closest("svg[data-layout-config-version]")!;
      const scale =
        Number(svg.getAttribute("width")) /
        Number(svg.getAttribute("viewBox")!.split(" ")[2]);
      let x = 0,
        y = 0;
      const segments: number[] = [];
      for (const match of path
        .getAttribute("d")!
        .matchAll(/([MLHV])\s+([\d.-]+)(?:\s+([\d.-]+))?/gu)) {
        const nextX = match[1] === "V" ? x : Number(match[2]);
        const nextY =
          match[1] === "H" ? y : Number(match[1] === "V" ? match[2] : match[3]);
        if (match[1] !== "M")
          segments.push(Math.hypot(nextX - x, nextY - y) * scale);
        x = nextX;
        y = nextY;
      }
      return segments.slice(1, -1).filter((n) => n > 0.05 && n < 3 - 0.00001);
    });
  });
}

it("repairs the synthetic starter's printed LTR middle-phase jog without exposing the first-attempt L3 jog", async () => {
  const before = await originalPacket(ir, request),
    after = await renderSchematicPacket(ir, request);
  if (!before.ok || !after.ok) throw Error(JSON.stringify({ before, after }));
  expect(printedJogs(before.value, "W-PWR-002").length).toBeGreaterThan(0);
  for (const jog of printedJogs(before.value, "W-PWR-002"))
    expect(jog).toBeCloseTo(1.5, 4);
  expect(printedJogs(after.value, "W-PWR-002")).toEqual([]);
  expect(printedJogs(before.value, "W-PWR-006")).toEqual([]);
  expect(printedJogs(after.value, "W-PWR-006")).toEqual([]);
  expect(after.value.sheets.length).toBeLessThanOrEqual(
    before.value.sheets.length,
  );
}, 30000);

it("charges the one extra input to the existing recovery pool and reuses exact inputs on recomposition", async () => {
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  const result = await circuitInlineTrace.run(traces, () =>
    renderSchematicPacket(ir, request),
  );
  expect(result.ok).toBe(true);
  const context = traces[0]!,
    run = context.runs[0]!;
  expect(run.qualityAttempts).toBe(1);
  expect(run.attempts).toBe(run.power!.work.calls);
  expect(run.attempts).toBeLessThanOrEqual(48);
  expect(run.power!.work.calls).toBe(context.layouts.size);
  expect(context.permittedInputs.size).toBe(1);
  expect(context.viewDecisions).toEqual([{ view: 0, reason: "accepted" }]);
}, 30000);

it("uses logical requests rather than legacy proposal counters for quality eligibility", async () => {
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  await circuitInlineTrace.run(traces, () =>
    renderSchematicPacket(ir, request),
  );
  const run = traces[0]!.runs[0]!;
  run.attempts = 48;
  run.power!.search.attempts = 48;
  run.qualityAttempts = 0;
  expect(run.power!.work.calls).toBeLessThan(48);
  expect(quality.powerPlacementAvailable(run)).toBe(true);
}, 30000);

it.each(["logical", "economy", "exhausted"] as const)(
  "keeps the complete original at the shared %s limit",
  async (limit) => {
    const select = quality.selectPowerPlacement;
    vi.spyOn(quality, "selectPowerPlacement").mockImplementation(
      async (ir, run, page) => {
        if (limit === "logical") run.power!.work.calls = 48;
        if (limit === "exhausted") {
          run.power!.work.exhausted = true;
          run.power!.work.calls = 1;
        }
        if (limit === "economy")
          run.power!.search.economyStartedAt = run.power!.search.attempts - 4;
        return select(ir, run, page);
      },
    );
    const before = await originalPacket(ir, request),
      traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
    const after = await circuitInlineTrace.run(traces, () =>
      renderSchematicPacket(ir, request),
    );
    expect(after).toEqual(before);
    expect(traces[0]!.runs[0]!.qualityAttempts).toBe(0);
    expect(quality.powerPlacementAvailable(traces[0]!.runs[0]!)).toBe(false);
  },
  30000,
);

it("retains the original packet when the shared final locality/conservation guard vetoes the repaired view", async () => {
  const before = await originalPacket(ir, request);
  vi.spyOn(packetGuard, "circuitPacketGuard").mockReturnValue(false);
  expect(await renderSchematicPacket(ir, request)).toEqual(before);
}, 30000);

it("keeps TTB power, including the source-turn retry, byte-identical", async () => {
  const q = {
    ...request,
    views: request.views.map((v) => ({ ...v, flow: "top-to-bottom" as const })),
  };
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  const before = await originalPacket(ir, q),
    after = await circuitInlineTrace.run(traces, () =>
      renderSchematicPacket(ir, q),
    );
  expect(after).toEqual(before);
  expect(traces).toEqual([]);
}, 30000);

it("propagates a programming error instead of treating it as a quality fit failure", async () => {
  const error = new TypeError("synthetic power layout bug");
  vi.spyOn(prepared, "relayoutDrawing").mockRejectedValue(error);
  await expect(renderSchematicPacket(ir, request)).rejects.toBe(error);
}, 30000);

it("keeps a view with no measured printed jog byte-identical, with no quality input", async () => {
  const before = await originalPacket(ir, request);
  vi.spyOn(measured, "circuitHasJogs").mockReturnValue(false);
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  expect(
    await circuitInlineTrace.run(traces, () =>
      renderSchematicPacket(ir, request),
    ),
  ).toEqual(before);
  expect(traces[0]!.runs[0]!.qualityAttempts).toBe(0);
}, 30000);

it("refuses a second distinct quality input for the same view", async () => {
  const before = await originalPacket(ir, request);
  let completed = 0;
  vi.spyOn(prepared, "relayoutDrawing").mockImplementation(
    async (p, engine) => {
      const second = { id: "second synthetic quality input" };
      // Isolate the per-view configuration guard from the packet miss veto.
      circuitInlineContext
        .getStore()!
        .permittedInputs.add(circuitLayoutCacheKey(second));
      await engine.layout({ id: "first synthetic quality input" });
      completed++;
      await engine.layout(second);
      completed++;
      return { ok: true, value: p };
    },
  );
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  expect(
    await circuitInlineTrace.run(traces, () =>
      renderSchematicPacket(ir, request),
    ),
  ).toEqual(before);
  expect(traces[0]!.runs[0]!.qualityAttempts).toBe(1);
  expect(completed).toBe(1);
}, 30000);

it("propagates a recovery programming error instead of treating it as budget exhaustion", async () => {
  const error = new TypeError("synthetic recovery bug");
  vi.spyOn(recovery, "placements").mockRejectedValueOnce(error);
  await expect(renderSchematicPacket(ir, request)).rejects.toBe(error);
}, 30000);

it("retains the exact legacy result when the logical recovery pool is exhausted", async () => {
  const placements = recovery.placements;
  vi.spyOn(recovery, "placements").mockImplementation(async (...args) => {
    if (elkWorkScope.getStore())
      throw new ElkWorkBudgetError("synthetic logical exhaustion");
    return placements(...args);
  });
  const result = await originalPacket(ir, { ...request, layout: "standard" });
  if (!result.ok) throw Error(JSON.stringify(result));
  const printed = new Set(
    result.value.sheets.flatMap((s) =>
      [
        ...parseHTML(s.svg).document.querySelectorAll("path[data-designation]"),
      ].map((p) => p.getAttribute("data-designation")),
    ),
  );
  expect([...printed].sort()).toEqual(
    Array.from(
      { length: 13 },
      (_, i) => `W-PWR-${String(i + 1).padStart(3, "0")}`,
    ),
  );
}, 30000);

it("charges a logical and economy attempt for a cached quality configuration with zero dispatches", async () => {
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  const result = await circuitInlineTrace.run(traces, () =>
    renderSchematicPacket(ir, request),
  );
  if (!result.ok) throw Error(JSON.stringify(result));
  const context = traces[0]!,
    run = context.runs[0]!,
    state = run.power!;
  state.search.attempts = 3;
  state.search.economyStartedAt = 0;
  state.decided = false;
  state.selected = undefined;
  run.qualityAttempts = 0;
  const calls = state.work.calls,
    dispatches = state.work.dispatches;
  await circuitInlineContext.run(context, () =>
    quality.selectPowerPlacement(ir, run, result.value.page),
  );
  expect(state.search.attempts).toBe(4);
  expect(state.work.calls).toBe(calls + 1);
  expect(state.work.dispatches).toBe(dispatches);
  expect(run.qualityAttempts).toBe(1);
}, 30000);

it("refuses a second routing configuration even when its input is cached", async () => {
  const before = await originalPacket(ir, request);
  let completed = 0;
  vi.spyOn(prepared, "relayoutDrawing").mockImplementation(
    async (p, engine) => {
      const second = { id: "cached second quality input" };
      circuitInlineContext
        .getStore()!
        .layouts.set(circuitLayoutCacheKey(second), second);
      await engine.layout({ id: "first quality input" });
      completed++;
      await engine.layout(second);
      completed++;
      return { ok: true, value: p };
    },
  );
  expect(await renderSchematicPacket(ir, request)).toEqual(before);
  expect(completed).toBe(1);
}, 30000);

it("does not accept or print a quality rerender when the run produced no alternative", async () => {
  const before = await originalPacket(ir, request);
  vi.spyOn(prepared, "relayoutDrawing").mockResolvedValue({
    ok: false,
    error: {
      code: "R006",
      root: "M1",
      reason: "unprintable-layout",
      message: "No synthetic alternative",
    },
  });
  vi.spyOn(packetGuard, "circuitPacketGuard").mockReturnValue(true);
  const traces: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  expect(
    await circuitInlineTrace.run(traces, () =>
      renderSchematicPacket(ir, request),
    ),
  ).toEqual(before);
  expect(traces[0]!.selected.size).toBe(0);
  expect(traces[0]!.viewDecisions.some((d) => d.reason === "accepted")).toBe(
    false,
  );
}, 30000);
