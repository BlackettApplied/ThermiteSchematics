import { expect, it } from "vitest";
import { sectionGroups } from "../src/packet/fold-stack.js";
import { sideSections } from "../src/packet/fold-side.js";
import { stripEnvelope, expandHeadings } from "../src/packet/strip-envelope.js";
import { sideCandidate, fixtureInk } from "./helpers/side-candidate.js";
import { contentPages, viewportContent } from "../src/packet/rooted-content.js";

it.each([2, 3, 4])(
  "composes %i existing TB strips in order without changing layout or cuts",
  (count) => {
    const c = sideCandidate(count),
      before = structuredClone(c);
    const result = sideSections(c, fixtureInk)!;
    expect(result).toHaveLength(1);
    expect(result[0]!.rootedSections).toHaveLength(count);
    expect(result[0]!.references!.map((r) => r.designation)).toEqual(
      Array.from({ length: count }, (_, i) => `D${i}`),
    );
    expect(
      result[0]!.references!.every(
        (r) => r.yMm === result[0]!.references![0]!.yMm,
      ),
    ).toBe(true);
    expect(
      result[0]!.references![1]!.xMm! - result[0]!.references![0]!.xMm!,
    ).toBe(26.375);
    expect(c).toEqual(before);
    for (const link of result[0]!.links) expect(link.to).toBe(1);
    const ids = [...result[0]!.content.matchAll(/\bid="([^"]+)"/gu)].map(
      (m) => m[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < count; i++)
      expect(result[0]!.content).toContain(`url(#side-${i}-fixture)`);
  },
);
it.each(["tail", "blank", "enclosure"])(
  "rejects each %s constituent even when the page has other figures",
  (kind) => {
    const c = sideCandidate(3, 2);
    if (kind === "blank")
      c.prepared = {
        ...c.prepared,
        layout: { ...c.prepared.layout, edges: [] },
      };
    if (kind === "enclosure")
      c.prepared = {
        ...c.prepared,
        layout: {
          ...c.prepared.layout,
          nodes: [
            ...c.prepared.layout.nodes,
            {
              id: "enclosure",
              kind: "location",
              x: 0,
              y: 280,
              width: 300,
              height: 150,
            },
          ],
        },
      };
    expect(sideSections(c, fixtureInk)).toBeUndefined();
  },
);
it("composes retained viewports after an empty leading grid row is omitted", () => {
  const c = sideCandidate(3, 0);
  c.prepared.layout.edges[0]!.points[0] = { x: 120, y: 230 };
  c.drafts[0]!.links = [];
  c.drafts[1]!.links = c.drafts[1]!.links.filter((l) => l.to !== 1);
  for (const draft of c.drafts)
    draft.rootedContent = viewportContent(
      c.prepared,
      draft.rootedSections![0]!.viewport,
    );
  const kept = contentPages(c.drafts);
  if (typeof kept === "string") throw Error(kept);
  c.drafts = kept;
  expect(c.drafts).toHaveLength(2);
  const result = sideSections(c, fixtureInk)!;
  expect(result).toHaveLength(1);
  expect(result[0]!.rootedSections).toHaveLength(2);
  expect(result[0]!.references!.map((r) => r.designation)).toEqual([
    "D1",
    "D2",
  ]);
  expect(result[0]!.links).toHaveLength(2);
  expect(result[0]!.links.every((l) => l.to === 1)).toBe(true);
});
it("retains LR, omitted-row, two-column, already composed and overwide originals", () => {
  const lr = sideCandidate();
  lr.prepared = {
    ...lr.prepared,
    view: { ...lr.prepared.view, flow: "left-to-right" },
  };
  expect(sideSections(lr, fixtureInk)).toBeUndefined();
  const omitted = sideCandidate();
  omitted.drafts.pop();
  expect(sideSections(omitted, fixtureInk)).toBeUndefined();
  const tiled = sideCandidate();
  tiled.grid.xs.push(400);
  expect(sideSections(tiled, fixtureInk)).toBeUndefined();
  const merged = sideCandidate();
  merged.drafts[0]!.rootedSections!.push(merged.drafts[1]!.rootedSections![0]!);
  expect(sideSections(merged, fixtureInk)).toBeUndefined();
  const wide = sideCandidate();
  for (const d of wide.drafts) d.drawingBounds!.w = 10;
  expect(sideSections(wide, fixtureInk)).toBeUndefined();
});
it("reserves every ordinary attachment, terminal marker and reference leader on X", () => {
  const c = sideCandidate(),
    p = c.prepared;
  const extra = {
    ...p,
    layout: {
      ...p.layout,
      edges: [
        ...p.layout.edges,
        {
          id: "boundary",
          points: [
            { x: 20, y: 40 },
            { x: 100, y: 40 },
          ],
        },
      ],
      ports: [{ id: "terminal", x: 200, y: 40, width: 0, height: 0 }],
      contextReferences: [
        {
          leaders: [
            [
              { x: 250, y: 40 },
              { x: 275, y: 40 },
            ],
          ],
        },
      ],
    },
  } as unknown as typeof p;
  const envelope = stripEnvelope(extra, -20, 130, 320, "x")!;
  expect(envelope).toEqual({ x: 15.25, y: -20, w: 264.5, h: 150 });
  expect(sideSections({ ...c, prepared: extra }, fixtureInk)).toBeDefined();
});
it("expands chained and near-touching X heading ink rather than clipping it", () => {
  expect(
    expandHeadings(
      { x: 100, y: 0, w: 20, h: 100 },
      [
        { x: 75, y: 0, w: 14, h: 50 },
        { x: 90, y: 0, w: 14, h: 50 },
      ],
      300,
      0,
      "x",
    ),
  ).toEqual({ x: 71, y: 0, w: 49, h: 100 });
  expect(
    expandHeadings(
      { x: 100, y: 0, w: 20, h: 100 },
      [{ x: 80, y: 0, w: 19.999, h: 50 }],
      300,
      0,
      "x",
    ).x,
  ).toBe(76);
});
it("includes terminal markers and card reservations even beyond the body", () => {
  const c = sideCandidate(),
    p = c.prepared;
  const terminal = {
    ...p,
    layout: {
      ...p.layout,
      ports: [{ id: "terminal", x: 200, y: 40, width: 0, height: 0 }],
    },
  } as unknown as typeof p;
  const t = stripEnvelope(terminal, -20, 130, 320, "x")!;
  expect(t.x + t.w).toBe(206.75);
  const card = {
    ...p,
    layout: {
      ...p.layout,
      labels: [
        {
          id: "card",
          ownerKind: "node",
          ownerId: "node-0",
          role: "off-view",
          x: 10,
          y: 30,
          width: 50,
          height: 40,
        },
      ],
    },
  } as unknown as typeof p;
  expect(stripEnvelope(card, -20, 130, 320, "x")!.x).toBe(5.25);
});

it("uses the exact physical strip/gap capacity without a fit epsilon", () => {
  expect(sectionGroups([12.375, 12.375], 38.75)).toEqual([[0, 1]]);
  expect(sectionGroups([12.375, 12.375], 38.749999)).toEqual([[0], [1]]);
});
