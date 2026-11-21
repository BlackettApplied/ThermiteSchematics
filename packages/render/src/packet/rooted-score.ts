import { frameBudgetOrder } from "./frame-budget.js";
import { localityRegression } from "./rooted-locality.js";
import { candidateOrder, compareTerms, economyTerms } from "./rooted-order.js";
import { routeGrowth } from "./rooted-clipped-routes.js";
import { required } from "../presentation/util.js";
import { unionInk, intersectInk } from "./rooted-ink.js";
import type { RootedCandidate } from "./rooted-build.js";
import type { PaperPage } from "./types.js";
export function candidateUtilisation(
  candidate: RootedCandidate,
  page: PaperPage,
) {
  const values = candidate.drafts
    .flatMap((d) => {
      const bounds = d.drawingBounds ?? {
        x: 20,
        y: 25,
        w: page.widthMm - 56,
        h: page.heightMm - 80,
      };
      const ink = unionInk(
        (d.rootedShapes ?? []).flatMap((s) => {
          const clipped = intersectInk(s, bounds);
          return clipped ? [clipped] : [];
        }),
      );
      const nominal = d.rootedScoreBounds ?? bounds;
      return ink ? [(ink.w * ink.h) / (nominal.w * nominal.h)] : [];
    })
    .sort((a, b) => a - b);
  const n = values.length;
  return n
    ? (required(values[Math.floor((n - 1) / 2)], "Missing rooted geometry") +
        required(values[Math.floor(n / 2)], "Missing rooted geometry")) /
        2
    : 0;
}
export function newJogs(
  c: RootedCandidate,
  baseline: ReadonlyMap<string, number>,
) {
  return [...c.jogs].reduce(
    (sum, [id, n]) => sum + Math.max(0, n - (baseline.get(id) ?? 0)),
    0,
  );
}
export function newDetours(
  c: RootedCandidate,
  baseline: ReadonlyMap<string, number>,
) {
  return [...(c.detours ?? new Map<string, number>())].reduce(
    (sum, [id, n]) => sum + Math.max(0, n - (baseline.get(id) ?? 0)),
    0,
  );
}
/** Total order over route safety, pages, guarded utilisation/locality and a
 * deterministic placement/grid/composition key. No route points are modified. */
export function compareCandidates(
  a: RootedCandidate,
  b: RootedCandidate,
  baseline: ReadonlyMap<string, number>,
  page: PaperPage,
  baselineDetours: ReadonlyMap<string, number> = new Map(),
  reference?: RootedCandidate,
  localityReference?: RootedCandidate,
) {
  const ar = reference
    ? [...routeGrowth(a, reference, false), ...routeGrowth(a, reference)]
    : [];
  const br = reference
    ? [...routeGrowth(b, reference, false), ...routeGrowth(b, reference)]
    : [];
  const physical = ar.map((v, i) => v - (br[i] ?? 0)).find((v) => v !== 0) ?? 0;
  return (
    frameBudgetOrder(a, b, page) ||
    newJogs(a, baseline) - newJogs(b, baseline) ||
    newDetours(a, baselineDetours) - newDetours(b, baselineDetours) ||
    physical ||
    a.drafts.length - b.drafts.length ||
    Number(localityRegression(a, localityReference)) -
      Number(localityRegression(b, localityReference)) ||
    compareTerms(
      economyTerms(a, candidateUtilisation(a, page)),
      economyTerms(b, candidateUtilisation(b, page)),
    ) ||
    (candidateOrder(a) < candidateOrder(b)
      ? -1
      : candidateOrder(a) > candidateOrder(b)
        ? 1
        : 0)
  );
}
