import type { Rect } from "../device-legend/geometry.js";

export const NAVIGATION_CLEARANCE_MM = 1.5;
export const NAVIGATION_TEXT_CLEARANCE_MM = 4;

function firstX(xs: readonly number[], predicate: (x: number) => boolean) {
  let low = 0,
    high = xs.length;
  while (low < high) {
    const middle = (low + high) >>> 1,
      x = xs[middle];
    if (x === undefined) throw Error("Missing navigation edge");
    if (predicate(x)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Sorted x edges; reject exactly the original clearance predicate's intervals.
 * Test sums directly in binary search, rather than subtracting rounded bounds. */
export function clearNavigationXs(
  xs: readonly number[],
  y: number,
  w: number,
  h: number,
  obstacles: readonly Rect[],
  texts: readonly Rect[],
  textVerticalClearanceMm = 0,
) {
  const changes = new Int32Array(xs.length + 1);
  const block = (other: Rect, gap: number) => {
    const first = firstX(xs, (x) => !(x + w + gap <= other.x)),
      last = firstX(xs, (x) => other.x + other.w + gap <= x);
    if (first >= last) return;
    changes[first] = (changes[first] ?? 0) + 1;
    changes[last] = (changes[last] ?? 0) - 1;
  };
  for (const other of obstacles)
    if (!(
      y + h + NAVIGATION_CLEARANCE_MM <= other.y ||
      other.y + other.h + NAVIGATION_CLEARANCE_MM <= y
    ))
      block(other, NAVIGATION_CLEARANCE_MM);
  for (const other of texts)
    if (!(
      y + h + textVerticalClearanceMm <= other.y ||
      other.y + other.h + textVerticalClearanceMm <= y
    ))
      block(other, NAVIGATION_TEXT_CLEARANCE_MM);
  let blocked = 0;
  return xs.filter((_, index) => {
    blocked += changes[index] ?? 0;
    return blocked === 0;
  });
}
