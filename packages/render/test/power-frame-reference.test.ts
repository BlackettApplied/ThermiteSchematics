import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import type { PowerPlacementState } from "../src/layout/power-placement.js";
import { circuitLayoutRun } from "../src/layout/circuit-inline.js";
import * as power from "../src/layout/power-placement.js";
import {
  beginFramePlanning,
  compactPlanningReceipts,
  finishFramePlanning,
  frameContext,
  replayCompactPlanningReceipts,
} from "../src/packet/frame-budget.js";
import {
  frameReferences,
  rememberPowerFrame,
  selectFramedPower,
} from "../src/packet/rooted-power-frame.js";
import { required } from "./fixtures.js";
import { documentPaper } from "./document-fixture.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import {
  configureTitleFrame,
  titleFrameContext,
  registerTitlePresentation,
} from "../src/internal/title-data/frame-context.js";
import { cachedCircuitView } from "../src/layout/circuit-view-cache.js";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const page = documentPaper();
  useCompactFrame(page);
  const view = {
    format: "schematic-view/0.1",
    family: "power",
    flow: "left-to-right",
    root: { deviceUid: "synthetic", designation: "M1" },
  };
  const legacy = {
    prepared: { view },
    scale: 0.25,
    bank: {},
    grid: {},
    drafts: [{ drawingBounds: { x: 35, y: 35, w: 200, h: 120 } }],
  } as unknown as RootedCandidate;
  const original = power.copyCandidate(legacy);
  required(required(original.drafts[0]).drawingBounds).w = 196;
  beginFramePlanning(page, legacy);
  finishFramePlanning(page, original, "existing-compact");
  const run = circuitLayoutRun();
  run.power = { original, native: original } as PowerPlacementState;
  frameReferences.set(original, legacy);
  rememberPowerFrame(run.power, original, page);
  return { page, legacy, original, run };
}

it("keeps a private legacy field reference instead of compounding compact loss", async () => {
  const { legacy, original, run } = fixture();
  required(required(legacy.drafts[0]).drawingBounds).w = 1;
  vi.spyOn(power, "selectPowerPlacement").mockImplementation(
    async (_ir, _run, working) => {
      const reference = frameContext(working, original.prepared.view);
      expect(reference?.receipt.referenceFields[0]?.w).toBe(200);
      expect(reference?.reference?.drafts[0]?.drawingBounds?.w).toBe(200);
      return power.copyCandidate(original);
    },
  );
  const target = documentPaper();
  useCompactFrame(target);
  await selectFramedPower({} as ElectricalIr, run, target);
  expect(compactPlanningReceipts(target)[0]?.referenceFields[0]?.w).toBe(200);
});

it("replays complete selected receipts with fresh rooted ordinals and isolated callers", async () => {
  const { page, original, run } = fixture();
  run.quality = true;
  required(run.power).selected = power.copyCandidate(original);
  vi.spyOn(power, "selectPowerPlacement").mockImplementation(async () =>
    power.copyCandidate(original),
  );
  const target = documentPaper();
  useCompactFrame(target);
  replayCompactPlanningReceipts(target, compactPlanningReceipts(page));
  await selectFramedPower({} as ElectricalIr, run, target);
  const first = compactPlanningReceipts(target);
  expect(first.map((r) => r.rootedViewOrdinal)).toEqual([0, 1]);
  expect(first[1]?.sheets[0]?.lossPercent).toBeCloseTo(2, 6);
  required(required(first[1]).referenceFields[0]).w = 1;
  const next = documentPaper();
  useCompactFrame(next);
  await selectFramedPower({} as ElectricalIr, run, next);
  expect(compactPlanningReceipts(next)[0]?.referenceFields[0]?.w).toBe(200);
  expect(compactPlanningReceipts(next)[0]?.rootedViewOrdinal).toBe(0);
  expect(
    compactPlanningReceipts(target).map((r) => r.rootedViewOrdinal),
  ).toEqual([0, 1]);
  expect(frameContext(next, original.prepared.view)).toBeUndefined();
});

it("preserves page-owned title inputs on the private power planning page", async () => {
  const { page, original, run } = fixture();
  const context = {
    presentation: { format: "project-presentation/0.3" as const },
    request: { format: "schematic-packet-request/0.2" as const, views: [] },
  };
  configureTitleFrame(page, context);
  vi.spyOn(power, "selectPowerPlacement").mockImplementation(
    async (_ir, _run, working) => {
      expect(working).not.toBe(page);
      expect(titleFrameContext(working)).toBe(context);
      return power.copyCandidate(original);
    },
  );
  await selectFramedPower({} as ElectricalIr, run, page);
});

it.each(["page", "presentation"])(
  "includes %s-owned title context in pre-assembly reuse",
  async (owner) => {
    const ir = {};
    const presentation = {};
    const context = circuitLayoutContext();
    const render = vi.fn(async () => ({ ok: true as const, value: [] }));
    await circuitInlineContext.run(context, async () => {
      for (const text of ["FIRST", "SECOND"]) {
        const page = documentPaper();
        const title = {
          presentation: {
            format: "project-presentation/0.3",
            frame: { header: { text } },
          },
          request: { format: "schematic-packet-request/0.2", views: [] },
        } as const;
        if (owner === "page") configureTitleFrame(page, title);
        else registerTitlePresentation(presentation, title);
        context.qualityPhase = true;
        await cachedCircuitView(ir, presentation, [], render, page);
      }
      expect(render).toHaveBeenCalledTimes(2);
    });
  },
);
