import { continuationLabel } from "../src/packet/continuation-label.js";
import { gridLinks, rootedGrids } from "../src/packet/rooted-plans.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
import { expect, it } from "vitest";
import {
  safeAxisPlans,
  MAX_AXIS_PLANS,
  MAX_CUTS,
} from "../src/packet/safe-cuts.js";
import { rootedPageCostFailure } from "../src/packet/rooted-bound.js";
import {
  captionConstraint,
  textInk,
  inkOverlaps,
} from "../src/packet/rooted-caption.js";
import { normalizePaperPage, bounds } from "../src/packet/page.js";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { offViewFixture, control } from "./off-view-fixtures.js";
import type { Draft } from "../src/packet/types.js";

it("searches safe gaps deterministically, including short first strips, without weakening limits", () => {
  const forbidden = [{ start: 31.5, end: 243.2 }];
  const plan = () => safeAxisPlans(254, 223.4, forbidden, () => true);
  expect(plan()).toEqual(plan());
  expect(plan().length).toBeGreaterThan(0);
  expect(plan().length).toBeLessThanOrEqual(MAX_AXIS_PLANS);
  for (const path of plan()) {
    expect(path[1]).toBeLessThan(223.4 * 0.2);
    expect(path.length - 1).toBeLessThanOrEqual(MAX_CUTS);
    for (const [i, point] of path.entries()) {
      expect(point > 31.5 && point < 243.2).toBe(false);
      if (i) expect(point - path[i - 1]!).toBeLessThanOrEqual(223.4 + 0.001);
    }
  }
  expect(safeAxisPlans(100, 40, [{ start: 0, end: 70 }], () => true)).toEqual(
    [],
  );
  expect(safeAxisPlans(410, 10, [], () => true)).toEqual([]);
  expect(safeAxisPlans(100, 40, [], () => false)).toEqual([]);
});
it("reserves extra band space even when the uncut drawing fits, without cutting protected spans", () => {
  expect(
    safeAxisPlans(
      12,
      20,
      [],
      () => true,
      (a, b) => b - a <= 6,
    ),
  ).toEqual([[0, 6, 12]]);
  expect(
    safeAxisPlans(
      12,
      20,
      [{ start: 2, end: 10 }],
      () => true,
      (a, b) => b - a <= 6,
    ),
  ).toEqual([]);
});
it("applies the 2x bound to the complete packet, not separately to each view", () => {
  const drafts = Array.from({ length: 8 }, () => ({}) as Draft);
  drafts[0]!.rootedFit = {
    actualPages: 6,
    basePages: 2,
    context: "CB1.2/T1: W-PWR-014",
  };
  drafts[6]!.rootedFit = {
    actualPages: 2,
    basePages: 2,
    context: "PS1.-: W-CTL-002",
  };
  expect(rootedPageCostFailure(drafts)).toBeUndefined();
  drafts.push({} as Draft);
  drafts[0]!.rootedFit!.actualPages = 7;
  expect(rootedPageCostFailure(drafts)).toMatchObject({
    code: "R006",
    details: { shortfallSheets: 1 },
  });
});
it("reserves caption ink between wrapped notices and continuation labels and refuses a long caption", async () => {
  const f = await offViewFixture();
  try {
    const p = await prepareSchematicDrawing(f.ir, control());
    const page = normalizePaperPage({
      size: "letter",
      orientation: "portrait",
    });
    if (!p.ok || !page.ok) throw Error("Fixture failed");
    const raw = bounds(p.value.titleContext, page.value, p.value.view),
      b = { ...raw, y: raw.y + 4, h: raw.h - 4 };
    const caption = "CONTINUED LOCATION: MAIN-PANEL";
    const links = [
      {
        id: "C001",
        to: 2,
        conductor: "W1",
        netId: "net",
        side: "top" as const,
        x: b.x + 30,
        y: b.y,
      },
    ];
    expect(
      captionConstraint(
        caption,
        b,
        page.value,
        p.value.view,
        links.map((l) => ({ ...l, label: continuationLabel(l, 18, 18) })),
      ),
    ).toBeUndefined();
    expect(
      inkOverlaps(
        textInk(caption, b.x, b.y - 9, 2.5),
        textInk("C001 / 02", b.x + 30, b.y - 4, 2.5, false, "middle"),
      ),
    ).toBe(false);
    expect(
      captionConstraint(caption, b, page.value, p.value.view, [
        {
          ...links[0]!,
          y: b.y - 5,
          label: continuationLabel({ ...links[0]!, y: b.y - 5 }, 18, 18),
        },
      ]),
    ).toContain("overlaps");
    expect(
      captionConstraint(caption, { ...b, y: 42 }, page.value, p.value.view, []),
    ).toContain("overlaps");
    expect(
      captionConstraint(
        "CONTINUED LOCATION: " + "W".repeat(160),
        b,
        page.value,
        p.value.view,
        [],
      ),
    ).toMatch(/width by [\d.]+ mm/);
  } finally {
    await f.dispose();
  }
});

it("keeps continuation separation and the 80-sheet grid guard in the fallback", () => {
  const edges = [0, 8].map((y, i) => ({
    id: "wire" + i,
    netId: "n" + i,
    points: [
      { x: 0, y },
      { x: 100, y },
    ],
  }));
  const p = {
    graph: {
      edges: edges.map((e) => ({
        id: e.id,
        label: { text: e.id, role: "conductor", textSources: [] },
        elementIds: [{ kind: "wire", uid: e.id }],
        conductor: { kind: "wire", uid: e.id, designation: e.id },
      })),
    },
    layout: { edges },
  } as unknown as PreparedSchematicDrawing;
  const b = { x: 28, y: 47, w: 100, h: 100 };
  expect(gridLinks(p, { xs: [0, 50, 100], ys: [0, 100] }, b, 0.25)).toBe(false);
  expect(
    gridLinks(
      {
        graph: { edges: [] },
        layout: { edges: [] },
      } as unknown as PreparedSchematicDrawing,
      { xs: Array.from({ length: 82 }, (_, i) => i * 100), ys: [0, 100] },
      b,
      0.25,
    ),
  ).toBe(false);
});

it("uses the safe-grid fallback when the greedy 20 percent progress rule refuses", () => {
  const p = {
    graph: { edges: [] },
    layout: {
      width: 976,
      height: 100,
      nodes: [
        { id: "device", kind: "device", x: 170, y: 0, width: 800, height: 20 },
      ],
      labels: [],
      edges: [],
    },
  } as unknown as PreparedSchematicDrawing;
  const b = { x: 28, y: 47, w: 223.4, h: 200 };
  expect(rootedGrids(p, b, 0.25, false)).toEqual([]);
  const plans = rootedGrids(p, b, 0.25, true);
  expect(plans.length).toBeGreaterThan(0);
  expect(plans).toEqual(rootedGrids(p, b, 0.25, true));
  for (const grid of plans)
    expect((grid.xs.length - 1) * (grid.ys.length - 1)).toBeLessThanOrEqual(80);
});
