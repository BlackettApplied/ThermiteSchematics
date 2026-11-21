import { expect, it } from "vitest";
import {
  candidateRoutes,
  defectGrowth,
  routeGrowth,
  type RouteDefects,
} from "../src/packet/rooted-clipped-routes.js";
import { fragmentDefects } from "../src/packet/route-fragments.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import { searchSettled } from "../src/packet/rooted-settled.js";
import { compareCandidates } from "../src/packet/rooted-score.js";
import type { RootedSearch } from "../src/packet/rooted-search.js";
const page = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
  widthMm: 431.8,
  heightMm: 279.4,
} as const;
const defects = (detours: number[], jogs: number[] = []): RouteDefects => ({
  jogs,
  detours,
});
it("does not offset an equal-total authored identity swap", () => {
  const before = new Map([
    ["wire-A", defects([4])],
    ["wire-B", defects([])],
  ]);
  const after = new Map([
    ["wire-A", defects([])],
    ["wire-B", defects([4])],
  ]);
  expect(defectGrowth(after, before)).toEqual([0, 0, 1, 4]);
});
it("detects worse severity even with unchanged occurrence counts", () => {
  expect(
    defectGrowth(
      new Map([["wire", defects([8], [2])]]),
      new Map([["wire", defects([7], [1])]]),
    ),
  ).toEqual([0, 1, 0, 1]);
});
function candidate(): RootedCandidate {
  return {
    prepared: {
      graph: {
        edges: [
          {
            id: "edge",
            kind: "conductor",
            elementIds: [
              { kind: "cable_conductor", cableUid: "cable", conductorId: "1" },
            ],
          },
        ],
      },
      layout: {
        edges: [
          {
            id: "edge",
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 30 },
              { x: 5, y: 30 },
              { x: 5, y: 0 },
            ],
          },
        ],
      },
    },
    grid: { xs: [0, 5], ys: [0, 30] },
    drafts: [
      {
        rootedSections: [
          { viewport: { x: 0, y: 0, w: 5, h: 30 }, continuedLocationIds: [] },
        ],
        rootedContent: { figures: 1, conductors: 1 },
        links: [],
      },
    ],
    scale: 1,
    jogs: new Map(),
    detours: new Map(),
    proximity: 0,
  } as unknown as RootedCandidate;
}
it("keys clipped caches by grid, final viewports, scale and composition", () => {
  const full = candidate(),
    partial = {
      ...full,
      grid: { xs: [0, 5], ys: [0, 10] },
      drafts: structuredClone(full.drafts),
    };
  partial.drafts[0]!.rootedSections![0]!.viewport.h = 10;
  const a = [...candidateRoutes(full).values()][0]!,
    b = [...candidateRoutes(partial).values()][0]!;
  expect(a.detours).toEqual([35]);
  expect(b.detours).toEqual([]);
  partial.drafts[0]!.rootedSections![0]!.viewport.h = 30;
  expect([...candidateRoutes(partial).values()][0]!.detours).toEqual([35]);
  partial.scale = 0.5;
  expect([...candidateRoutes(partial).values()][0]!.detours).toEqual([7.5]);
});
it("uses the same per-identity clipped check in early exit and score", () => {
  const unsafe = candidate(),
    safe = {
      ...unsafe,
      grid: { xs: [0, 5], ys: [0, 10] },
      drafts: structuredClone(unsafe.drafts),
    };
  safe.drafts[0]!.rootedSections![0]!.viewport.h = 10;
  const run = {
    candidates: [unsafe],
    native: [safe],
  } as unknown as RootedSearch;
  expect(routeGrowth(unsafe, safe)).toEqual([0, 0, 1, 35]);
  expect(searchSettled(run, page)).toBe(false);
  const twoPages = {
    ...safe,
    drafts: [...safe.drafts, ...structuredClone(safe.drafts)],
  };
  expect(
    compareCandidates(twoPages, unsafe, new Map(), page, new Map(), safe),
  ).toBeLessThan(0);
});
it("keeps the official thresholds without an extra detour epsilon", () => {
  const route = (height: number) => [
    { x: 0, y: 0 },
    { x: 0, y: height },
    { x: 5, y: height },
    { x: 5, y: 0 },
  ];
  expect(fragmentDefects(route(12.5), 1).detours).toEqual([]);
  expect(fragmentDefects(route(12.5000025), 1).detours[0]).toBeGreaterThan(0);
});
