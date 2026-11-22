import {
  continuationLabel,
  continuationHeaderWidth,
} from "../src/packet/continuation-label.js";
import { continuationInk } from "../src/packet/frame-banks.js";
import { compactFramePlan } from "../src/packet/frame-plan.js";
import { resolveRootedContinuations } from "../src/packet/continuation-resolve.js";
import { MAX_GRID_PLANS } from "../src/packet/safe-cuts.js";
import { MAX_FRAME_FOLD_PLANS } from "../src/packet/frame-fold-groups.js";
import {
  MAX_PLACEMENT_LAYOUTS,
  ROOTED_COMPACT_PROFILES,
} from "../src/packet/rooted-limits.js";
import { expect, it } from "vitest";
import {
  beginFramePlanning,
  compactPlanningReceipts,
  fieldLoss,
  frameField,
  frameBudgetFailure,
  frameBudgetOrder,
} from "../src/packet/frame-budget.js";
import { foldedBankProbes } from "../src/packet/frame-fold-groups.js";
import { selectRootedComposition } from "../src/packet/rooted-selection.js";
import { legacyFramePlacement } from "../src/packet/frame-legacy-placement.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import type { Draft, Link } from "../src/packet/types.js";
function fixture() {
  const normalized = normalizePaperPage({
    size: "a4",
    orientation: "landscape",
  });
  if (!normalized.ok) throw Error("Invalid fixture page");
  const page = normalized.value;
  useCompactFrame(page);
  const view = {
    format: "schematic-view/0.1",
    root: { deviceUid: "fixture", designation: "X1" },
    family: "control",
    flow: "left-to-right",
  } as const;
  const draft: Draft = {
    title: {
      projectName: "Synthetic field",
      revision: "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: "test",
      lines: [],
    },
    view,
    content: "",
    links: [],
    note: "Synthetic field",
    drawingBounds: { x: 35, y: 35, w: 200, h: 120 },
    rootedShapes: [{ x: 50, y: 50, w: 10, h: 10 }],
  };
  const reference = {
    drafts: [draft, structuredClone(draft)],
    scale: 0.25,
    prepared: { view, graph: { view, nodes: [], edges: [] } },
    bank: {
      width: 20,
      headerWidth: 16,
      single: false,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    grid: { xs: [0, 1, 2], ys: [0, 1] },
  } as unknown as RootedCandidate;
  beginFramePlanning(page, reference);
  return { page, reference };
}
function resized(reference: RootedCandidate, widths: number[]) {
  return {
    ...reference,
    drafts: reference.drafts.map((d, i) => ({
      ...d,
      drawingBounds: { x: 35, y: 35, w: widths[i] ?? 200, h: 120 },
    })),
  };
}
it("enforces each field independently without crediting another sheet's gain", () => {
  const { page, reference } = fixture();
  const legal = resized(reference, [196, 200]),
    illegal = resized(reference, [195.99, 250]);
  expect(frameBudgetFailure(legal, page)).toBeUndefined();
  expect(frameBudgetFailure(illegal, page)).toBe("drawing-field-loss");
  expect(frameBudgetOrder(legal, illegal, page)).toBeLessThan(0);
  expect(frameBudgetFailure({ ...reference, scale: 0.251 }, page)).toBe(
    "scale-change",
  );
  expect(
    frameBudgetFailure(
      { ...reference, drafts: reference.drafts.slice(0, 1) },
      page,
    ),
  ).toBe("page-count");
  expect(
    fieldLoss(
      frameField({ x: 0, y: 0, w: 100, h: 100 }),
      frameField({ x: 0, y: 0, w: 101, h: 100 }),
    ),
  ).toBe(0);
});
it("plans both cut sides for every part sharing a folded sheet", () => {
  const probes = [
    { links: [{ side: "left" }] },
    { links: [{ side: "right" }] },
  ] as unknown as Draft[];
  const result = foldedBankProbes(probes, [[0, 1]]);
  expect(result?.map((d) => d.links.map((l) => l.side))).toEqual([
    ["left", "right"],
    ["left", "right"],
  ]);
  expect(probes.map((d) => d.links.map((l) => l.side))).toEqual([
    ["left"],
    ["right"],
  ]);
});
it("retains legal legacy sheet geometry inside the compact frame with a receipt", () => {
  const { page, reference } = fixture(),
    before = structuredClone(reference.drafts);
  const result = legacyFramePlacement(reference, undefined, page);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(
    result.value.map((d) => ({
      ...d,
      drawingBounds: { ...d.drawingBounds, frameService: undefined },
    })),
  ).toEqual(
    before.map((d) => ({
      ...d,
      drawingBounds: { ...d.drawingBounds, frameService: undefined },
    })),
  );
  const [receipt] = compactPlanningReceipts(page);
  expect(receipt?.sheets.map((s) => [s.strategy, s.lossPercent])).toEqual([
    ["legacy-continuation-placement", 0],
    ["legacy-continuation-placement", 0],
  ]);
  expect(receipt?.fallback?.every((s) => !s.failure)).toBe(true);
});
it("refuses legacy placement that enters compact frame furniture and records its sheet", () => {
  const { page, reference } = fixture();
  reference.drafts[0]?.rootedShapes?.push({ x: 10, y: 50, w: 1, h: 1 });
  const result = legacyFramePlacement(reference, undefined, page);
  expect(result).toMatchObject({ ok: false, error: { code: "R006" } });
  const [receipt] = compactPlanningReceipts(page);
  expect(receipt?.termination).toBe("no-compatible-fallback");
  expect(receipt?.fallback?.[0]).toMatchObject({
    sheet: 1,
    lossPercent: 0,
    failure: expect.stringMatching(/frame furniture/),
  });
});

it("keeps a fitting sheet while falling back only its incompatible peer", () => {
  const { page, reference } = fixture(),
    modern = resized(reference, [196, 190]);
  const result = legacyFramePlacement(reference, modern, page);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.map((d) => d.drawingBounds?.w)).toEqual([196, 200]);
  const [receipt] = compactPlanningReceipts(page);
  expect(receipt?.sheets.map((s) => s.strategy)).toEqual([
    "folded-group",
    "legacy-continuation-placement",
  ]);
});

it("keeps a smaller maximum loss ahead of a smaller total loss", () => {
  const { page, reference } = fixture();
  const uneven = resized(reference, [196.2, 200]); // [1.9, 0]
  const balanced = resized(reference, [198, 198]); // [1, 1]
  expect(frameBudgetOrder(balanced, uneven, page)).toBeLessThan(0);
  expect(frameBudgetOrder(uneven, balanced, page)).toBeGreaterThan(0);
});
it("does not let a second sheet's gain offset the first sheet's loss in ordering", () => {
  const { page, reference } = fixture();
  const gain = resized(reference, [196.2, 240]); // [1.9, 0], despite 20% gain
  const smallerLoss = resized(reference, [198, 200]); // [1, 0]
  expect(frameBudgetOrder(smallerLoss, gain, page)).toBeLessThan(0);
  expect(frameBudgetFailure(resized(reference, [195.8, 250]), page)).toBe(
    "drawing-field-loss",
  );
});
it("falls back when the modern native section partition differs", () => {
  const { page, reference } = fixture(),
    modern = resized(reference, [196, 200]);
  const legacy = reference.drafts[0],
    other = modern.drafts[0];
  if (!legacy || !other) throw Error("Missing partition fixture");
  legacy.rootedSections = [
    { viewport: { x: 0, y: 0, w: 100, h: 80 }, continuedLocationIds: [] },
  ];
  other.rootedSections = [
    { viewport: { x: 100, y: 0, w: 100, h: 80 }, continuedLocationIds: [] },
  ];
  const result = legacyFramePlacement(reference, modern, page);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value[0]?.drawingBounds?.w).toBe(200);
  expect(result.value[0]?.rootedSections).toEqual(legacy.rootedSections);
  expect(compactPlanningReceipts(page)[0]?.sheets[0]?.strategy).toBe(
    "legacy-continuation-placement",
  );
});
it("falls back when modern sheets come from another prepared layout", () => {
  const { page, reference } = fixture(),
    modern = resized(reference, [196, 200]);
  modern.prepared = structuredClone(reference.prepared);
  const result = legacyFramePlacement(reference, modern, page);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value[0]?.drawingBounds?.w).toBe(200);
  expect(compactPlanningReceipts(page)[0]?.sheets[0]?.strategy).toBe(
    "legacy-continuation-placement",
  );
});

function continuationFixture() {
  const f = fixture();
  f.reference.drafts.forEach((d, i) => {
    const l: Link = {
      id: "C001",
      end: i === 0 ? 0 : 1,
      to: i === 0 ? 2 : 1,
      toZone: "A1",
      conductor: "W1",
      netId: "fixture-net",
      x: i === 0 ? 220 : 70,
      y: 80,
      side: i === 0 ? "right" : "left",
    };
    l.label = continuationLabel(l, 60, continuationHeaderWidth(1), false);
    d.links = [l];
  });
  resolveRootedContinuations(f.reference.drafts, f.page);
  const first = f.reference.drafts[0],
    link = first?.links[0];
  if (!first || !link?.label) throw Error("Missing continuation fixture");
  return { ...f, first, link, label: link.label };
}
it("refuses final glyphs inside a compact zone lane, with a per-sheet failure", () => {
  const { page, reference, first, link, label } = continuationFixture();
  const service = compactFramePlan(first.title, page).service,
    row = label.rows[0];
  if (!row) throw Error("Missing header row");
  const ink = continuationInk(link, true)[0];
  if (!ink) throw Error("Missing final glyph");
  row.x += service.x + service.w - ink.x - ink.w + 0.1;
  const result = legacyFramePlacement(reference, undefined, page);
  expect(result).toMatchObject({ ok: false, error: { code: "R006" } });
  const [receipt] = compactPlanningReceipts(page);
  expect(receipt?.termination).toBe("no-compatible-fallback");
  expect(receipt?.fallback?.[0]).toMatchObject({
    sheet: 1,
    failure: expect.stringMatching(
      /Final continuation .* compact service area/,
    ),
  });
});
it("checks final glyph ink against native content even when reserved row ink is elsewhere", () => {
  const { page, reference, first, link, label } = continuationFixture();
  const ink = continuationInk(link, true)[0];
  if (!ink) throw Error("Missing final glyph");
  first.rootedShapes = [{ x: ink.x + 1, y: ink.y + 0.2, w: 1, h: 1 }];
  for (const row of label.rows) row.ink = { x: 100, y: 140, w: 1, h: 1 };
  const result = legacyFramePlacement(reference, undefined, page);
  expect(result).toMatchObject({ ok: false, error: { code: "R006" } });
  const [receipt] = compactPlanningReceipts(page);
  expect(receipt?.termination).toBe("no-compatible-fallback");
  expect(receipt?.fallback?.[0]).toMatchObject({
    sheet: 1,
    failure: expect.stringMatching(/cannot keep clear ink/),
  });
});
it("receipts use the search's enforcing limits", () => {
  const { page } = fixture();
  expect(compactPlanningReceipts(page)[0]?.candidateLimit).toEqual({
    gridsPerBank: MAX_GRID_PLANS,
    banksPerLayout: 0,
    foldsPerGrid: MAX_FRAME_FOLD_PLANS,
    layouts: MAX_PLACEMENT_LAYOUTS + ROOTED_COMPACT_PROFILES.length + 1,
  });
});

it.each(["scale", "pages"] as const)(
  "ranks a legal positive loss before a zero-loss %s failure",
  (failure) => {
    const { page, reference } = fixture();
    const legal = resized(reference, [198, 198]);
    const illegal =
      failure === "scale"
        ? { ...reference, scale: 0.251 }
        : { ...reference, drafts: reference.drafts.slice(0, 1) };
    expect(frameBudgetFailure(legal, page)).toBeUndefined();
    expect(frameBudgetFailure(illegal, page)).toBe(
      failure === "scale" ? "scale-change" : "page-count",
    );
    expect(frameBudgetOrder(legal, illegal, page)).toBeLessThan(0);
    expect(frameBudgetOrder(illegal, legal, page)).toBeGreaterThan(0);
  },
);
it("measures a quantized anchor-sequence loss despite an unchanged endpoint rectangle", () => {
  const before = frameField({ x: 0, y: 0, w: 100, h: 100 });
  const after = frameField({ x: 0.0002, y: 0, w: 100, h: 100 });
  expect(after.area).toBe(before.area);
  expect(after.anchorArea).toBeLessThan(before.anchorArea);
  expect(fieldLoss(before, after)).toBeGreaterThan(0);
});
it("rejects a 2.01 percent modern field at the legacy-placement keep boundary", () => {
  const { page, reference } = fixture();
  const modern = resized(reference, [195.98, 196]);
  expect(frameBudgetFailure(modern, page)).toBe("drawing-field-loss");
  const result = legacyFramePlacement(reference, modern, page);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  expect(result.value.map((d) => d.drawingBounds?.w)).toEqual([200, 196]);
  expect(
    compactPlanningReceipts(page)[0]?.sheets.map((s) => s.strategy),
  ).toEqual(["legacy-continuation-placement", "folded-group"]);
});

it("retains the legal winner over an over-budget composed alternative", () => {
  const { page, reference } = fixture();
  const winner = resized(reference, [198, 198]);
  const composed = resized(reference, [195.98, 200]);
  expect(frameBudgetFailure(winner, page)).toBeUndefined();
  expect(frameBudgetFailure(composed, page)).toBe("drawing-field-loss");
  expect(selectRootedComposition(winner, composed, page)).toBe(winner);
  const better = resized(reference, [199, 200]);
  expect(selectRootedComposition(winner, better, page)).toBe(better);
});
