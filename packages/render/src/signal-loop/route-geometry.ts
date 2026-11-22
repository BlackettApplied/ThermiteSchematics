import { n } from "../packet/svg.js";

type Point = { x: number; y: number };
export const routeTolerance = 1e-6;

/** Validate ELK's unrounded millimetres before output rounding can amplify noise. */
export function assertOrthogonalSegment(a: Point, b: Point) {
  if (
    ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
    (Math.abs(a.x - b.x) > routeTolerance &&
      Math.abs(a.y - b.y) > routeTolerance)
  )
    throw new Error("Non-orthogonal signal loop route.");
}

/** Keep a shared axis exactly shared when emitting three-decimal coordinates. */
export function snappedPath(raw: readonly Point[]) {
  const out: Point[] = [];
  raw.forEach((p, i) => {
    const previous = raw[i - 1],
      emitted = out[i - 1];
    if (previous) assertOrthogonalSegment(previous, p);
    out.push({
      x:
        previous && emitted && Math.abs(p.x - previous.x) <= routeTolerance
          ? emitted.x
          : Number(n(p.x)),
      y:
        previous && emitted && Math.abs(p.y - previous.y) <= routeTolerance
          ? emitted.y
          : Number(n(p.y)),
    });
  });
  return out;
}
