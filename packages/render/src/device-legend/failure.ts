import type { LegendTag } from "./reference.js";
import { required } from "../presentation/util.js";
import { expand, intersection, inside, type Rect } from "./geometry.js";
import { legendLayouts, type LegendLayout } from "./placement.js";

const area = (b: Rect) => b.w * b.h;
export const MAX_FREE_REGIONS = 64;
export const MAX_FREE_REGION_OBSTACLES = 512;
const regionOrder = (a: Rect, b: Rect) =>
  area(b) - area(a) || a.y - b.y || b.x - a.x;
function residuals(region: Rect, blocked: Rect): Rect[] {
  const cut = intersection(region, blocked);
  if (!cut || cut.w <= 0 || cut.h <= 0) return [region];
  return [
    { ...region, w: cut.x - region.x },
    { ...region, x: cut.x + cut.w, w: region.x + region.w - cut.x - cut.w },
    { ...region, h: cut.y - region.y },
    { ...region, y: cut.y + cut.h, h: region.y + region.h - cut.y - cut.h },
  ].filter((b) => b.w > 0 && b.h > 0);
}
function conservativeRegion(bounds: Rect, obstacles: readonly Rect[]): Rect {
  let free = bounds;
  for (const obstacle of obstacles) {
    free = residuals(free, expand(obstacle, 3.13)).sort(regionOrder)[0] ?? {
      ...bounds,
      w: 0,
      h: 0,
    };
    if (!area(free)) break;
  }
  return free;
}
/** Maximal empty rectangles after 3 mm ink/frame clearance. Keep all four
 * residual rectangles, including overlapping ones; discard only contained
 * capacities. Greedily retaining one residual can miss the largest free pocket. */
export function legendFreeRegions(
  bounds: Rect,
  obstacles: readonly Rect[],
): Rect[] {
  return legendFreeRegionSearch(bounds, obstacles).regions;
}
/** Bound pairwise containment pruning. Beyond the obstacle cap, one linear
 * greedy pass still checks every obstacle. Dropped pockets can understate
 * capacity, but every returned rectangle remains clear of all obstacles. */
export function legendFreeRegionSearch(
  bounds: Rect,
  obstacles: readonly Rect[],
) {
  if (obstacles.length > MAX_FREE_REGION_OBSTACLES)
    return {
      regions: [conservativeRegion(bounds, obstacles)],
      bounded: true,
      peakRegions: 1,
      maximalObstacleTests: 0,
    };
  let free = [bounds];
  let bounded = false,
    peakRegions = 1,
    maximalObstacleTests = 0;
  for (const obstacle of obstacles) {
    maximalObstacleTests++;
    const blocked = expand(obstacle, 3.13);
    if (!intersection(bounds, blocked)) continue;
    const next = free.flatMap((region) => residuals(region, blocked));
    free = next.filter(
      (b, i) =>
        !next.some(
          (other, j) =>
            j !== i && inside(b, other) && (area(b) < area(other) || j < i),
        ),
    );
    free.sort(regionOrder);
    if (free.length > MAX_FREE_REGIONS) {
      free.length = MAX_FREE_REGIONS;
      bounded = true;
    }
    peakRegions = Math.max(peakRegions, free.length);
    if (!free.length) {
      free = [{ ...bounds, w: 0, h: 0 }];
      break;
    }
  }
  return { regions: free, bounded, peakRegions, maximalObstacleTests };
}

const ratio = (required: number, available: number) =>
  available > 0 ? required / available : Infinity;
export function legendFitDiagnostic(
  tags: readonly LegendTag[],
  available: Rect,
) {
  const layout = required(
    legendLayouts(tags).sort(
      (a, b) =>
        Math.max(ratio(a.box.w, available.w), ratio(a.box.h, available.h)) -
          Math.max(ratio(b.box.w, available.w), ratio(b.box.h, available.h)) ||
        area(a.box) - area(b.box),
    )[0],
    "Missing legend size",
  );
  const horizontal =
    ratio(layout.box.w, available.w) >= ratio(layout.box.h, available.h);
  return {
    layout,
    available,
    ...constrainingRow(layout, available, horizontal),
  };
}
function constrainingRow(
  layout: LegendLayout,
  available: Rect,
  horizontal: boolean,
) {
  for (const entry of layout.entries)
    for (const row of entry.tag.rows)
      if (
        horizontal
          ? entry.x + row.ink.x + row.ink.w + 3 > available.w
          : entry.y + row.ink.y + row.ink.h + 1 > available.h
      )
        return { tag: entry.tag, field: row.field as string };
  // The frame/title or inter-entry padding can be the limiting reservation.
  return {
    tag: required(layout.entries[0], "Missing legend entry").tag,
    field: horizontal ? "legend heading" : "entry",
  };
}
