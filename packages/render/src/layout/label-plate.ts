import {
  routeSegments,
  segmentTouchesBox,
  type InkBox,
} from "./ink-geometry.js";
import type { LayoutPoint } from "../types.js";

export function clearOwnedPlate(
  box: InkBox,
  routes: readonly (readonly LayoutPoint[])[],
  endInset: number,
  horizontalOnly = false,
) {
  const hidden = routes
    .flatMap(routeSegments)
    .filter(({ a, b }) => segmentTouchesBox(a, b, box));
  if (!hidden.length) return true;
  const run = hidden[0];
  if (!run || hidden.length !== 1) return false;
  const { a, b } = run;
  if (a.y === b.y)
    return (
      Math.min(a.x, b.x) < box.left - endInset &&
      Math.max(a.x, b.x) > box.right + endInset
    );
  return (
    !horizontalOnly &&
    a.x === b.x &&
    Math.min(a.y, b.y) < box.top - endInset &&
    Math.max(a.y, b.y) > box.bottom + endInset
  );
}
