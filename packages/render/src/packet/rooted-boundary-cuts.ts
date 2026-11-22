import type { NormalizedSchematicLayout } from "../types.js";
import type { DrawingBounds } from "./types.js";
import { required } from "../presentation/util.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";
import { protectedDrawingIntervals } from "./rooted-geometry.js";
import { cuts } from "./rooted-cuts.js";

/** One additional complete proposal; presentation-only joins stay indivisible.
 * This changes only cut selection, never a route point or authored identity. */
export function boundarySafeGrid(
  layout: NormalizedSchematicLayout,
  b: DrawingBounds,
  scale: number,
) {
  const boundaries = layout.edges.filter((e) => e.kind === "boundary-segment");
  if (!boundaries.length) return undefined;
  const { protectedX, protectedY } = protectedDrawingIntervals(layout, pad);
  for (const edge of boundaries)
    for (let i = 1; i < edge.points.length; i++) {
      const a = required(edge.points[i - 1], "Missing route point"),
        z = required(edge.points[i], "Missing route point");
      if (a.x === z.x)
        protectedY.push({
          start: Math.min(a.y, z.y) + pad,
          end: Math.max(a.y, z.y) + pad,
        });
      if (a.y === z.y)
        protectedX.push({
          start: Math.min(a.x, z.x) + pad,
          end: Math.max(a.x, z.x) + pad,
        });
    }
  const xs = cuts(layout.width + 2 * pad, b.w / scale, protectedX),
    ys = cuts(layout.height + 2 * pad, b.h / scale, protectedY);
  return xs && ys ? { xs, ys, greedy: true } : undefined;
}
