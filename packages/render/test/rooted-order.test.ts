import { expect, it } from "vitest";
import {
  economyTerms,
  compareTerms,
  candidateOrder,
} from "../src/packet/rooted-order.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
const candidate = (distance: number, rank = 0) =>
  ({
    proximity: distance,
    localityExcess: Math.max(0, distance - 15),
    profile: undefined,
    grid: { xs: [0, 100 + rank], ys: [0, 100] },
    drafts: [],
  }) as unknown as RootedCandidate;
it("orders soft locality before utilisation on both sides of the exact useful guard", () => {
  expect(
    compareTerms(
      economyTerms(candidate(14.9), 0.400001),
      economyTerms(candidate(15.1), 0.6),
    ),
  ).toBeLessThan(0);
  expect(
    compareTerms(
      economyTerms(candidate(14.9), 0.3999999),
      economyTerms(candidate(15.1), 0.4),
    ),
  ).toBeLessThan(0);
  expect(
    compareTerms(
      economyTerms(candidate(14.9), 0.3),
      economyTerms(candidate(15.1), 0.31),
    ),
  ).toBeLessThan(0);
  expect(
    compareTerms(
      economyTerms(candidate(14.9), 0.5),
      economyTerms(candidate(15), 0.6),
    ),
  ).toBeGreaterThan(0);
});
it("quantizes distances to .001 mm without pairwise approximate comparisons", () => {
  expect(economyTerms(candidate(15.0004), 0.5)).toEqual(
    economyTerms(candidate(15), 0.5),
  );
  expect(
    compareTerms(
      economyTerms(candidate(15.0006), 0.5),
      economyTerms(candidate(15), 0.5),
    ),
  ).toBeGreaterThan(0);
});
it("is transitive across the guard and 15 mm, and finishes ties by a stable total key", () => {
  const values = [0.3999999, 0.4, 0.4000001, 0.5].flatMap((u) =>
    [14.9, 15, 15.1].map((d, i) => ({ c: candidate(d, i), u })),
  );
  const cmp = (a: (typeof values)[number], b: (typeof values)[number]) =>
    compareTerms(economyTerms(a.c, a.u), economyTerms(b.c, b.u)) ||
    candidateOrder(a.c).localeCompare(candidateOrder(b.c), "en");
  for (const a of values)
    for (const b of values)
      for (const c of values) {
        if (cmp(a, b) <= 0 && cmp(b, c) <= 0)
          expect(cmp(a, c)).toBeLessThanOrEqual(0);
      }
  const a = { c: candidate(15, 0), u: 0.5 },
    b = { c: candidate(15, 1), u: 0.5 };
  expect(cmp(a, b)).not.toBe(0);
  expect(Math.sign(cmp(a, b))).toBe(-Math.sign(cmp(b, a)));
});

it("orders complete candidate scores transitively and uses the declared grid tie direction", async () => {
  const { compareCandidates } = await import("../src/packet/rooted-score.js");
  const page = {
    size: "tabloid",
    orientation: "landscape",
    marginMm: 10,
    widthMm: 431.8,
    heightMm: 279.4,
  } as const;
  const full = (u: number, d: number, rank = 0) =>
    ({
      ...candidate(d, rank),
      jogs: new Map(),
      drafts: [
        {
          drawingBounds: { x: 0, y: 0, w: 100, h: 100 },
          rootedShapes: [{ x: 0, y: 0, w: 100, h: u * 100 }],
        },
      ],
    }) as unknown as RootedCandidate;
  const values = [0.3999999, 0.4, 0.4000001, 0.5].flatMap((u) =>
    [14.9, 15, 15.1].map((d) => full(u, d)),
  );
  const cmp = (a: RootedCandidate, b: RootedCandidate) =>
    compareCandidates(a, b, new Map(), page);
  for (const a of values)
    for (const b of values)
      for (const c of values)
        if (cmp(a, b) <= 0 && cmp(b, c) <= 0)
          expect(cmp(a, c)).toBeLessThanOrEqual(0);
  expect(cmp(full(0.5, 15, 0), full(0.5, 15, 1))).toBeLessThan(0);
});
