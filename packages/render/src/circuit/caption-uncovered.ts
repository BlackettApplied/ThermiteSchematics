import type { CircuitLabelState } from "./layout-routes.js";
type Segment = CircuitLabelState["segments"][number];
type Point = Segment["a"];
const EPSILON = 1e-7;
function uncovered(segment: Segment, foreign: readonly Segment[]) {
  const { a, b } = segment,
    vertical = Math.abs(a.x - b.x) < EPSILON,
    axis = vertical ? "y" : "x",
    fixed = vertical ? "x" : "y",
    low = Math.min(a[axis], b[axis]),
    high = Math.max(a[axis], b[axis]);
  if (
    ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
    Math.abs(a[fixed] - b[fixed]) >= EPSILON ||
    high - low <= EPSILON
  )
    return undefined;
  const intervals = foreign
      .filter(
        (s) =>
          [s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite) &&
          Math.abs(s.a[fixed] - a[fixed]) < EPSILON &&
          Math.abs(s.b[fixed] - a[fixed]) < EPSILON,
      )
      .map((s) => ({
        low: Math.max(low, Math.min(s.a[axis], s.b[axis])),
        high: Math.min(high, Math.max(s.a[axis], s.b[axis])),
      }))
      .filter((s) => s.high > s.low)
      .sort((s, t) => s.low - t.low),
    runs: { a: Point; b: Point }[] = [],
    point = (n: number) => (vertical ? { x: a.x, y: n } : { x: n, y: a.y });
  let end = low;
  for (const span of intervals) {
    if (span.low > end + EPSILON)
      runs.push({ a: point(end), b: point(span.low) });
    end = Math.max(end, span.high);
  }
  if (end < high - EPSILON) runs.push({ a: point(end), b: point(high) });
  return { length: high - low, runs };
}
/** Native interval subtraction, without changing any routed point or identity. */
export function uncoveredCaptionRuns(
  index: number,
  segments: readonly Segment[],
) {
  const own = segments.filter((s) => s.index === index),
    foreign = segments.filter((s) => s.index !== index);
  if (!own.length) return undefined;
  const runs: { a: Point; b: Point }[] = [];
  let ownedLength = 0;
  for (const s of own) {
    const result = uncovered(s, foreign);
    if (!result) return undefined;
    ownedLength += result.length;
    runs.push(...result.runs);
  }
  return {
    runs,
    ownedLength,
    uncoveredLength: runs.reduce(
      (n, s) => n + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
      0,
    ),
  };
}
