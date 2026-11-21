import { expand, type Rect } from "../device-legend/geometry.js";
import {
  navigationPlacementFamily,
  type NavigationPlacementFamily,
} from "./navigation-placement.js";
import type { SymbolGeometry } from "./navigation-symbols.js";
export interface NavigationVacancy {
  family: NavigationPlacementFamily;
  maximumClearWidthAtRequiredHeightMm: number;
  maximumClearHeightAtRequiredWidthMm: number;
}
/** Critical-edge scan of measured occupied rectangles, including fixed text clearance. */
export function measureNavigationVacancy(
  size: Rect,
  field: Rect,
  owner: Rect,
  ink: readonly Rect[],
  texts: readonly Rect[],
  locality?: SymbolGeometry,
): NavigationVacancy[] {
  const occupied = [
    ...ink.map((r) => expand(r, 1.5)),
    ...texts.map((r) => ({ x: r.x - 4, y: r.y, w: r.w + 8, h: r.h })),
  ];
  const families: NavigationPlacementFamily[] = [
    "beside",
    "below",
    "below-right",
    "zone-column",
    "margin-band",
  ];
  const result = families.map((family) => ({
    family,
    maximumClearWidthAtRequiredHeightMm: 0,
    maximumClearHeightAtRequiredWidthMm: 0,
  }));
  for (const transpose of [false, true]) {
    const flip = (r: Rect) =>
      transpose ? { x: r.y, y: r.x, w: r.h, h: r.w } : r;
    const area = flip(field),
      blocks = occupied.map(flip),
      request = flip(size);
    const levels = [
      ...new Set([
        area.y,
        area.y + area.h - request.h,
        ...blocks.flatMap((r) => [r.y - request.h, r.y + r.h]),
      ]),
    ].filter((y) => y >= area.y && y + request.h <= area.y + area.h);
    for (const y of levels)
      for (const span of freeSpans(area, blocks, y, request.h)) {
        const positions = [
          span.x,
          span.x + span.w - Math.min(request.w, span.w),
        ];
        for (const x of positions) {
          const box = flip({
            x,
            y,
            w: Math.min(request.w, span.w),
            h: request.h,
          });
          const family = navigationPlacementFamily(box, field, owner, locality),
            row = result.find((r) => r.family === family);
          if (!row) throw Error("Unknown navigation placement family");
          if (transpose)
            row.maximumClearHeightAtRequiredWidthMm = Math.max(
              row.maximumClearHeightAtRequiredWidthMm,
              span.w,
            );
          else
            row.maximumClearWidthAtRequiredHeightMm = Math.max(
              row.maximumClearWidthAtRequiredHeightMm,
              span.w,
            );
        }
      }
  }
  return result;
}
function freeSpans(
  area: Rect,
  blocks: readonly Rect[],
  y: number,
  h: number,
): { x: number; w: number }[] {
  const active = blocks
    .filter((r) => r.y < y + h && r.y + r.h > y)
    .sort((a, b) => a.x - b.x);
  const result: { x: number; w: number }[] = [];
  let start = area.x;
  for (const r of active) {
    const end = Math.min(r.x, area.x + area.w);
    if (end > start) result.push({ x: start, w: end - start });
    start = Math.max(start, r.x + r.w);
    if (start >= area.x + area.w) break;
  }
  if (start < area.x + area.w)
    result.push({ x: start, w: area.x + area.w - start });
  return result;
}
