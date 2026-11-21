import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { compileCoreFixture } from "./fixtures.js";
import { viewDrafts } from "../src/packet/dispatch.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import { compactPlanningReceipts } from "../src/packet/frame-budget.js";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";

import { cachedCircuitView } from "../src/layout/circuit-view-cache.js";
import { renderCompactBenchmark } from "../src/internal/drawing-frame/benchmark.js";
import { circuitInlineTrace } from "../src/layout/circuit-inline-context.js";
import * as packetGuard from "../src/layout/circuit-packet-guard.js";
import * as frames from "../src/packet/frame-budget.js";
import * as composition from "../src/packet/rooted-compose.js";
afterEach(() => vi.restoreAllMocks());
let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
const view = {
  format: "schematic-view-request/0.1",
  family: "power",
  flow: "left-to-right",
  root: { by: "designation", value: "M1" },
} as const;
function page(compact = true) {
  const result = normalizePaperPage({
    size: "tabloid",
    orientation: "landscape",
  });
  if (!result.ok) throw Error("Invalid fixture paper");
  if (compact) useCompactFrame(result.value);
  return result.value;
}
it("allocates one logical power run across compact legacy and modern probes", async () => {
  const context = circuitLayoutContext();
  await circuitInlineContext.run(context, async () => {
    const result = await viewDrafts(
      ir,
      view,
      undefined,
      page(),
      "compact",
      new Map(),
    );
    expect(result.ok).toBe(true);
    expect(context.runs).toHaveLength(1);
    expect(context.runs[0]?.power?.original.drafts).toEqual(
      result.ok ? result.value : [],
    );
  });
}, 30000);
it("replays finished compact receipts on a fresh page with private copies", async () => {
  const context = circuitLayoutContext();
  await circuitInlineContext.run(context, async () => {
    const first = page();
    const baseline = await viewDrafts(
      ir,
      view,
      undefined,
      first,
      "compact",
      new Map(),
    );
    expect(baseline.ok).toBe(true);
    const receipts = compactPlanningReceipts(first);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.sheets.length).toBeGreaterThan(0);
    context.qualityPhase = true;
    context.cursor = 0;
    const second = page();
    expect(
      await viewDrafts(ir, view, undefined, second, "compact", new Map()),
    ).toEqual(baseline);
    expect(compactPlanningReceipts(second)).toEqual(receipts);
    const copy = compactPlanningReceipts(second);
    copy[0]?.sheets.splice(0);
    expect(compactPlanningReceipts(second)).toEqual(receipts);
    expect(compactPlanningReceipts(first)).toEqual(receipts);
  });
}, 30000);
it("includes the identity-only compact frame flag in view reuse eligibility", async () => {
  const context = circuitLayoutContext();
  await circuitInlineContext.run(context, async () => {
    const render = vi.fn(async () => ({ ok: true as const, value: [] }));
    await cachedCircuitView(ir, undefined, [], render, page(false));
    context.qualityPhase = true;
    context.cursor = 0;
    await cachedCircuitView(ir, undefined, [], render, page());
    expect(render).toHaveBeenCalledTimes(2);
  });
}, 30000);

it("keeps the compact-frame power repair behind the complete final packet guard", async () => {
  const trace: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
  const guard = vi.spyOn(packetGuard, "circuitPacketGuard");
  try {
    const result = await circuitInlineTrace.run(trace, () =>
      renderCompactBenchmark(ir, {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        page: { size: "tabloid", orientation: "landscape" },
        views: [view],
      }),
    );
    expect(result.ok).toBe(true);
    expect(trace[0]?.runs).toHaveLength(1);
    expect(trace[0]?.viewDecisions).toEqual([{ view: 0, reason: "accepted" }]);
    expect(guard).toHaveBeenCalled();
    if (!result.ok) return;
    const receipts = compactPlanningReceipts(result.value.page);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.sheets.length).toBe(result.value.sheets.length);
    expect(receipts[0]?.sheets.every((s) => s.lossPercent <= 2)).toBe(true);
  } finally {
    guard.mockRestore();
  }
}, 30000);

it("rejects a power alternative that fails the compact field guard", async () => {
  const context = circuitLayoutContext();
  await circuitInlineContext.run(context, async () => {
    const baseline = await viewDrafts(
      ir,
      view,
      undefined,
      page(),
      "compact",
      new Map(),
    );
    context.qualityPhase = true;
    context.selected.add(0);
    context.cursor = 0;
    vi.spyOn(frames, "frameBudgetFailure").mockReturnValue("scale-change");
    const result = await viewDrafts(
      ir,
      view,
      undefined,
      page(),
      "compact",
      new Map(),
    );
    expect(result).toEqual(baseline);
    expect(context.runs[0]?.qualityAttempts).toBe(1);
    expect(context.runs[0]?.power?.selected).toBeUndefined();
  });
}, 30000);

it("compares composed power fields before preferring a smaller field", async () => {
  const context = circuitLayoutContext();
  await circuitInlineContext.run(context, async () => {
    await viewDrafts(ir, view, undefined, page(), "compact", new Map());
    context.qualityPhase = true;
    context.selected.add(0);
    context.cursor = 0;
    const smaller = new WeakSet<object>();
    vi.spyOn(composition, "composeRootedWinner").mockImplementation(
      (_ir, candidate) => {
        const changed = {
          ...candidate,
          drafts: structuredClone(candidate.drafts),
        };
        for (const draft of changed.drafts)
          if (draft.drawingBounds) draft.drawingBounds.w *= 0.9;
        smaller.add(changed);
        return changed;
      },
    );
    const check = vi.spyOn(frames, "frameBudgetFailure");
    await viewDrafts(ir, view, undefined, page(), "compact", new Map());
    expect(check.mock.calls.length).toBeGreaterThan(0);
    expect(check.mock.calls.some(([candidate]) => smaller.has(candidate))).toBe(
      false,
    );
  });
}, 30000);

it("preserves finalized fallback drafts when a modern sheet was kept and no alternative is selected", async () => {
  const context = circuitLayoutContext();
  const legacy = await import("../src/packet/frame-legacy-placement.js");
  const rooted = await import("../src/packet/rooted.js");
  const fallback = legacy.legacyFramePlacement;
  const kept = vi
    .spyOn(legacy, "legacyFramePlacement")
    .mockImplementation((reference, modern, p) => {
      const result = fallback(reference, modern, p);
      if (result.ok) {
        // Distinguishable finalized modern metadata; quality must preserve it verbatim.
        for (const draft of result.value)
          draft.rootedBank = { ...reference.bank, left: 7 };
        result.value[0]!.rootedFit!.basePages = 2;
        result.value[0]!.rootedLegendSource!.grid = {
          xs: [0, 500],
          ys: [0, 500],
        };
        // Feed the finalized modern sheet through the real fallback keep branch.
        frames.beginFramePlanning(p, reference);
        return fallback(reference, { ...reference, drafts: result.value }, p);
      }
      return result;
    });
  vi.spyOn(frames, "frameBudgetFailure").mockReturnValue("scale-change");
  await circuitInlineContext.run(context, async () => {
    const originalPage = page();
    const original = await rooted.drawingDrafts(
      ir,
      view,
      undefined,
      originalPage,
      "compact",
    );
    expect(original.ok).toBe(true);
    expect(kept).toHaveBeenCalled();
    expect(
      compactPlanningReceipts(originalPage)
        .at(-1)
        ?.fallback?.every((s) => s.strategy === "folded-group"),
    ).toBe(true);
    const expected = JSON.stringify(original);
    context.qualityPhase = true;
    context.cursor = 0;
    const after = await rooted.drawingDrafts(
      ir,
      view,
      undefined,
      page(),
      "compact",
    );
    expect(JSON.stringify(after)).toBe(expected);
    if (after.ok) after.value[0]!.rootedBank!.left = 99;
    expect(JSON.stringify(original)).toBe(expected);
  });
}, 30000);
