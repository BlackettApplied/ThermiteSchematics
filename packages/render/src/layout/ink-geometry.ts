import { inkGap as boxDistance, strokeBoxes } from "../symbols/caption-ink.js";
import type { LayoutPoint } from "../types.js";
import { required } from "../presentation/util.js";
export type InkBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export const INK_EPSILON = 1e-7;
export function routeSegments(route: readonly LayoutPoint[]) {
  return route
    .slice(1)
    .map((b, i) => ({ a: required(route[i], "Missing route point"), b }));
}
export function pointInsideBox(p: LayoutPoint, box: InkBox) {
  return (
    p.x >= box.left - INK_EPSILON &&
    p.x <= box.right + INK_EPSILON &&
    p.y >= box.top - INK_EPSILON &&
    p.y <= box.bottom + INK_EPSILON
  );
}
export function segmentTouchesBox(a: LayoutPoint, b: LayoutPoint, box: InkBox) {
  return (
    Math.max(a.x, b.x) >= box.left - INK_EPSILON &&
    Math.min(a.x, b.x) <= box.right + INK_EPSILON &&
    Math.max(a.y, b.y) >= box.top - INK_EPSILON &&
    Math.min(a.y, b.y) <= box.bottom + INK_EPSILON
  );
}
export function routeInkDistance(
  ink: InkBox,
  routes: readonly (readonly LayoutPoint[])[],
  stroke: number,
) {
  // Rooted conductor paths have square caps and mitered orthogonal corners.
  // Stroke rectangles include that painted corner; a round distance buffer
  // would falsely report clearance there. At butt-ended circuit landings the
  // extra half-stroke endpoint reservation is conservative.
  return Math.min(
    ...routes.flatMap((r) =>
      strokeBoxes(
        routeSegments(r).map(({ a, b }) => [a, b] as const),
        stroke,
      ).map((box) => boxDistance(ink, box)),
    ),
  );
}

export function rectInkBox(r: {
  x: number;
  y: number;
  width: number;
  height: number;
}): InkBox {
  return { left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
}
