import { compileProject } from "@thermite/compiler";
import { expect, it, vi } from "vitest";
import { contentPages, segmentVisible } from "../src/packet/rooted-content.js";
import {
  clipRootedInk,
  viewportShapes,
  routeDetours,
} from "../src/packet/rooted-ink.js";
import {
  searchRootedCandidates,
  nativeWinner,
  rootedWinner,
} from "../src/packet/rooted-search.js";
import { compareCandidates } from "../src/packet/rooted-score.js";
import {
  prepareSchematicDrawing,
  type PreparedSchematicDrawing,
} from "../src/renderer.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import type { Draft } from "../src/packet/types.js";
import {
  reserveOffViewCards,
  annotationPortPosition,
} from "../src/off-view/placement.js";
import { nativeReservations } from "../src/off-view/native.js";
import * as validation from "../src/layout/validate-output.js";

const page = {
  size: "tabloid" as const,
  orientation: "landscape" as const,
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};
const request = {
  format: "schematic-view-request/0.1" as const,
  family: "control" as const,
  root: { by: "designation" as const, value: "K1" },
  flow: "left-to-right" as const,
};

it("removes empty enclosure cells and remaps every continuation destination", () => {
  const d = (figures: number, conductors: number, to?: number) =>
    ({
      rootedContent: { figures, conductors },
      links: to ? [{ to }] : [],
    }) as unknown as Draft;
  const result = contentPages([d(0, 0), d(1, 1, 3), d(1, 1, 2)]);
  expect(typeof result).not.toBe("string");
  if (typeof result === "string") return;
  expect(result).toHaveLength(2);
  expect(result.map((r) => r.links[0]!.to)).toEqual([2, 1]);
  expect(contentPages([d(1, 1, 2), d(0, 1, 1)])).toContain(
    "conductor-only tail",
  );
});

it("clips shape envelopes and does not mistake a surrounding wire for visible ink", () => {
  const view = { x: 0, y: 0, w: 20, h: 20 };
  expect(segmentVisible({ x: -10, y: -10 }, { x: 100, y: -10 }, view)).toBe(
    false,
  );
  expect(segmentVisible({ x: 100, y: -10 }, { x: 100, y: 100 }, view)).toBe(
    false,
  );
  expect(segmentVisible({ x: -10, y: -10 }, { x: 100, y: 100 }, view)).toBe(
    true,
  );
  const p = {
    graph: { nodes: [], edges: [{ id: "w", kind: "conductor" }] },
    layout: {
      nodes: [],
      edges: [
        {
          id: "w",
          points: [
            { x: -10, y: -10 },
            { x: 100, y: 100 },
          ],
        },
      ],
    },
  } as unknown as PreparedSchematicDrawing;
  expect(viewportShapes(p, view, 0.25, 30, 40)).toEqual([
    { x: 30, y: 40, w: 5, h: 5 },
  ]);
});

it("retains the original printable placement without a placement search", async () => {
  const c = await compileProject("examples/off-view-connections");
  if (!c.ok) throw Error(JSON.stringify(c));
  const run = await searchRootedCandidates(
    c.ir,
    request,
    c.presentation,
    page,
    true,
  );
  expect(run.earlyExit).toBe(true);
  expect(run.attempts).toBe(0);
  expect(nativeWinner(run)).toBeDefined();
});

it("counts the existing detour criterion and ranks new detours before page savings", () => {
  const p = {
    graph: { nodes: [], edges: [{ id: "w", kind: "conductor" }] },
    layout: {
      edges: [
        {
          id: "w",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 20, y: 200 },
            { x: 20, y: 0 },
          ],
        },
      ],
    },
  } as unknown as PreparedSchematicDrawing;
  expect(routeDetours(p, 0.25).get("w")).toBe(1);
  const candidate = (pages: number, detours: number) =>
    ({
      drafts: Array.from({ length: pages }, () => ({})),
      jogs: new Map(),
      detours: new Map([["w", detours]]),
      proximity: 0,
    }) as unknown as RootedCandidate;
  expect(
    compareCandidates(candidate(2, 0), candidate(1, 1), new Map(), page),
  ).toBeLessThan(0);
  expect(
    compareCandidates(
      candidate(2, 0),
      candidate(1, 1),
      new Map(),
      page,
      new Map([["w", 1]]),
    ),
  ).toBeGreaterThan(0);
});

it("repairs symbol intersections using the reason even when wording changes", async () => {
  const c = await compileProject("examples/off-view-connections");
  if (!c.ok) throw Error(JSON.stringify(c));
  const spy = vi
    .spyOn(validation, "normalizeAndValidateLayout")
    .mockReturnValueOnce({
      ok: false,
      failureKind: "symbol-intersection",
      error: {
        code: "R004",
        family: "control",
        root: "K1",
        message: "Reworded geometric diagnostic",
      },
    });
  try {
    const p = await prepareSchematicDrawing(c.ir, request, c.presentation);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
  } finally {
    spy.mockRestore();
  }
});

it.each([
  ["K1", "W-CTL-006"],
  ["K2", "W-CTL-009"],
] as const)(
  "avoids the new conveyor detour at %s (%s)",
  async (root, wire) => {
    const c = await compileProject("examples/conveyor-line");
    if (!c.ok) throw Error(JSON.stringify(c));
    const run = await searchRootedCandidates(
      c.ir,
      { ...request, root: { by: "designation", value: root } },
      c.presentation,
      page,
      true,
    );
    const best = rootedWinner(run, page);
    if (!best) throw Error(JSON.stringify(run.errors));
    const uid = c.ir.wires.find((w) => w.designation === wire)!.uid;
    const e = best.prepared.graph.edges.find((e) =>
      e.elementIds.some((id) => id.kind === "wire" && id.uid === uid),
    )!;
    expect(best.detours?.get(e.id) ?? 0).toBe(0);
  },
  30000,
);

it("computes a fallback no-card baseline for standard letter portrait", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  const run = await searchRootedCandidates(
    c.ir,
    {
      ...request,
      family: "power",
      root: { by: "designation", value: "M1" },
      flow: "top-to-bottom",
    },
    c.presentation,
    {
      ...page,
      size: "letter",
      orientation: "portrait",
      widthMm: 215.9,
      heightMm: 279.4,
    },
    false,
  );
  expect(nativeWinner(run)).toBeDefined();
  expect(run.native.some((c) => !c.grid.greedy)).toBe(true);
});

it("keeps stacked source cards in displayed terminal order and close to their poles", async () => {
  const c = await compileProject("examples/conveyor-line");
  if (!c.ok) throw Error(JSON.stringify(c));
  const p = await prepareSchematicDrawing(
    c.ir,
    { ...request, family: "power", root: { by: "designation", value: "M2" } },
    c.presentation,
  );
  if (!p.ok) throw Error(JSON.stringify(p));
  const source = p.value.graph.nodes.find(
    (n) => n.kind !== "junction" && n.designation === "SRC1",
  )!;
  if (source.kind === "junction") throw Error("Expected source glyph");
  const pairs = source.labels
    .filter((l) => l.offView)
    .map((l) => ({
      terminal: l.offView!.terminalName,
      card: p.value.layout.labels.find((v) => v.id === l.id)!,
      port: p.value.layout.ports.find((v) => v.id === l.ownerId)!,
    }))
    .sort((a, b) => a.port.y - b.port.y);
  let compared = 0;
  for (let i = 0; i < pairs.length; i++)
    for (const b of pairs.slice(i + 1)) {
      const a = pairs[i]!;
      if (
        Math.max(a.card.x, b.card.x) <
        Math.min(a.card.x + a.card.width, b.card.x + b.card.width)
      ) {
        expect(a.card.y + a.card.height / 2).toBeLessThanOrEqual(
          b.card.y + b.card.height / 2,
        );
        compared++;
      }
    }
  expect(compared).toBeGreaterThan(0);
  const l3 = pairs.find((p) => p.terminal === "SRC1.L3")!;
  expect(
    Math.hypot(
      Math.max(l3.card.x - l3.port.x, 0, l3.port.x - l3.card.x - l3.card.width),
      Math.max(
        l3.card.y - l3.port.y,
        0,
        l3.port.y - l3.card.y - l3.card.height,
      ),
    ) * 0.32,
  ).toBeLessThan(20);
});

it("clips score ink again to the trimmed folded viewport", () => {
  const draft = {
    rootedShapes: [{ x: -10, y: 0, w: 40, h: 40 }],
  } as unknown as Draft;
  clipRootedInk(draft, { x: 0, y: 5, w: 20, h: 20 });
  expect(draft.rootedShapes).toEqual([{ x: 0, y: 5, w: 20, h: 20 }]);
  expect(draft.rootedInk).toEqual({ x: 0, y: 5, w: 20, h: 20 });
});

it("keeps the dense supply card close to its displayed minus terminal", async () => {
  const c = await compileProject("packages/core-library/test/fixtures/rm3");
  if (!c.ok) throw Error(JSON.stringify(c));
  const p = await prepareSchematicDrawing(
    c.ir,
    {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
      flow: "left-to-right",
    },
    c.presentation,
  );
  if (!p.ok) throw Error(JSON.stringify(p));
  const label = p.value.graph.nodes
    .flatMap((n) => (n.kind === "junction" ? [] : n.labels))
    .find((l) => l.offView?.terminalName === "PS1.-")!;
  const card = p.value.layout.labels.find((l) => l.id === label.id)!,
    port = p.value.layout.ports.find((v) => v.id === label.ownerId)!;
  expect(
    Math.hypot(
      Math.max(card.x - port.x, 0, port.x - card.x - card.width),
      Math.max(card.y - port.y, 0, port.y - card.y - card.height),
    ) * 0.25,
  ).toBeLessThan(10);
});

it("searches paper placements when the original standard K1 reservation refuses", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  const run = await searchRootedCandidates(
    c.ir,
    { ...request, flow: "top-to-bottom" },
    undefined,
    {
      ...page,
      size: "letter",
      orientation: "portrait",
      widthMm: 215.9,
      heightMm: 279.4,
    },
    false,
  );
  expect(run.attempts).toBeGreaterThan(0);
  expect(
    rootedWinner(run, {
      ...page,
      size: "letter",
      orientation: "portrait",
      widthMm: 215.9,
      heightMm: 279.4,
    }),
  ).toBeDefined();
});

it("keeps every bounded bank alternative in displayed terminal order", async () => {
  const c = await compileProject("examples/conveyor-line");
  if (!c.ok) throw Error(JSON.stringify(c));
  const p = await prepareSchematicDrawing(
    c.ir,
    { ...request, family: "power", root: { by: "designation", value: "M2" } },
    c.presentation,
  );
  if (!p.ok) throw Error(JSON.stringify(p));
  const graph = nativeReservations(p.value.graph);
  const owner = graph.nodes.find(
    (n) => n.kind !== "junction" && n.designation === "SRC1",
  )!;
  if (owner.kind === "junction") throw Error("Missing source");
  const cards = p.value.graph.nodes
    .find((n) => n.id === owner.id)!
    .labels.filter((l) => l.offView);
  let compared = 0;
  for (let rank = 0; rank < 128; rank++) {
    const placed = reserveOffViewCards(owner, [...cards].reverse(), {
      "*": rank,
    });
    if (!placed) continue;
    const rows = placed.labels
      .filter((l) => l.offView)
      .map((l) => ({
        l,
        anchor: annotationPortPosition(
          owner,
          owner.ports.find((p) => p.id === l.ownerId)!,
        ),
      }))
      .sort((a, b) => a.anchor.y - b.anchor.y);
    expect(
      placed.labels.filter((l) => l.offView).map((l) => l.ownerId),
    ).toEqual(rows.map((r) => r.l.ownerId));
    for (let i = 0; i < rows.length; i++)
      for (const b of rows.slice(i + 1)) {
        const a = rows[i]!,
          x = a.l.offView!.position,
          y = b.l.offView!.position;
        if (Math.max(x.x, y.x) < Math.min(x.x + a.l.width, y.x + b.l.width)) {
          expect(x.y + a.l.height / 2).toBeLessThanOrEqual(
            y.y + b.l.height / 2,
          );
          compared++;
        }
      }
  }
  expect(compared).toBeGreaterThan(8);
});
