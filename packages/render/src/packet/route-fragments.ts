import type { LayoutPoint } from "../types.js";
import type { InkBox } from "./rooted-ink.js";
import { required } from "../presentation/util.js";

/** SVG-to-mm conversion tolerance at the unchanged 3 mm policy boundary.
 * A renderer-side contract test binds this value to CHECK's exported constant. */
export const JOG_NUMERICAL_TOLERANCE_MM = 1e-5;

/** Clip each connected painted path, without joining disjoint re-entries. */
export function routeFragments(points: readonly LayoutPoint[], box: InkBox) {
  const result: LayoutPoint[][] = [];
  let piece: LayoutPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = required(points[i - 1], "Missing route start"),
      z = required(points[i], "Missing route end"),
      clipped = segment(a, z, box);
    if (!clipped) {
      if (piece.length > 1) result.push(piece);
      piece = [];
      continue;
    }
    const last = piece.at(-1);
    if (
      !last ||
      Math.hypot(last.x - clipped[0].x, last.y - clipped[0].y) > 0.001
    ) {
      if (piece.length > 1) result.push(piece);
      piece = [clipped[0]];
    }
    piece.push(clipped[1]);
  }
  if (piece.length > 1) result.push(piece);
  return result;
}
function segment(a: LayoutPoint, z: LayoutPoint, b: InkBox) {
  const dx = z.x - a.x,
    dy = z.y - a.y;
  let low = 0,
    high = 1;
  for (const [p, q] of [
    [-dx, a.x - b.x],
    [dx, b.x + b.w - a.x],
    [-dy, a.y - b.y],
    [dy, b.y + b.h - a.y],
  ] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return undefined;
    } else if (p < 0) low = Math.max(low, q / p);
    else high = Math.min(high, q / p);
  }
  if (low > high) return undefined;
  return [
    { x: a.x + low * dx, y: a.y + low * dy },
    { x: a.x + high * dx, y: a.y + high * dy },
  ] as const;
}
function distance(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Official physical criteria: >0.05 and <3 mm, and >2×Manhattan+20 mm.
 * Only CHECK's numerical conversion tolerance applies at the 3 mm boundary. */
export function fragmentDefects(source: readonly LayoutPoint[], scale: number) {
  const points: LayoutPoint[] = [];
  for (const raw of source) {
    const p = { x: raw.x * scale, y: raw.y * scale };
    while (
      points.length >= 2 &&
      distance(
        required(points.at(-1), "Missing route point"),
        required(points.at(-2), "Missing route point"),
        p,
      ) < 0.01
    )
      points.pop();
    points.push(p);
  }
  const lengths = points.slice(1).map((p, i) => {
    const a = required(points[i], "Missing route point");
    return Math.hypot(p.x - a.x, p.y - a.y);
  });
  const jogs = lengths
    .filter(
      (n, i) =>
        i > 0 &&
        i < lengths.length - 1 &&
        n > 0.05 &&
        n < 3 - JOG_NUMERICAL_TOLERANCE_MM,
    )
    .map((n) => 3 - n);
  const a = points[0],
    z = points.at(-1);
  const excess =
    a && z
      ? lengths.reduce((a, b) => a + b, 0) -
        2 * (Math.abs(z.x - a.x) + Math.abs(z.y - a.y)) -
        20
      : 0;
  return { jogs, detours: excess > 0 ? [excess] : [] };
}
