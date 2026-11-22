import { expect } from "vitest";
import type { Point, InkShape } from "./source-isolation.js";

const inherited = (element: Element, attribute: string): string | null =>
  element.getAttribute(attribute) ??
  (element.parentElement ? inherited(element.parentElement, attribute) : null);

/** Union painted collinear segments, including neighbouring solid strokes and
 * their caps. Pattern repeats that merge into a stem/bar are not visible dashes.
 * Coordinates and dash lengths are read from emitted SVG, never catalog flags. */
export function visibleLinkInk(
  owner: Element,
  start: Point,
  end: Point,
  shape: (element: Element) => InkShape,
) {
  const length = Math.hypot(end.x - start.x, end.y - start.y),
    ux = (end.x - start.x) / length,
    uy = (end.y - start.y) / length;
  const along = (p: Point) => (p.x - start.x) * ux + (p.y - start.y) * uy;
  const across = (p: Point) => (p.x - start.x) * uy - (p.y - start.y) * ux;
  const intervals: [number, number][] = [];
  for (const element of owner.querySelectorAll("line,polyline")) {
    const ink = shape(element),
      ps = ink.points;
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1]!,
        b = ps[i]!;
      if (Math.abs(across(a)) > 0.001 || Math.abs(across(b)) > 0.001) continue;
      const from = along(a),
        to = along(b),
        span = Math.abs(to - from),
        sign = to >= from ? 1 : -1,
        cap =
          inherited(element, "stroke-linecap") === "butt" ? 0 : ink.stroke / 2;
      const pattern = inherited(element, "stroke-dasharray");
      if (!pattern || pattern === "none") {
        intervals.push([Math.min(from, to) - cap, Math.max(from, to) + cap]);
        continue;
      }
      // These marks emit line dash patterns; resolve their scale independently.
      expect(element.localName).toBe("line");
      const localLength = Math.hypot(
          Number(element.getAttribute("x2")) -
            Number(element.getAttribute("x1")),
          Number(element.getAttribute("y2")) -
            Number(element.getAttribute("y1")),
        ),
        scale = span / localLength;
      const values = pattern.split(/[ ,]+/).map((v) => Number(v) * scale);
      expect(values).toHaveLength(2);
      const dash = values[0]!,
        gap = values[1]!;
      expect(dash).toBeGreaterThan(0);
      expect(gap).toBeGreaterThan(0);
      const offset =
        Number(inherited(element, "stroke-dashoffset") ?? 0) * scale;
      for (let at = -offset; at < span; at += dash + gap) {
        const lo = Math.max(0, at),
          hi = Math.min(span, at + dash);
        if (hi <= lo) continue;
        const p = from + sign * lo,
          q = from + sign * hi;
        intervals.push([Math.min(p, q) - cap, Math.max(p, q) + cap]);
      }
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  for (const interval of intervals) {
    const last = runs.at(-1);
    if (last && interval[0] <= last[1] + 0.001)
      last[1] = Math.max(last[1], interval[1]);
    else runs.push([...interval]);
  }
  const dashes = runs.filter(([lo, hi]) => hi > 0.001 && lo < length - 0.001);
  expect(
    dashes.length,
    "free-standing visible dash runs",
  ).toBeGreaterThanOrEqual(2);
  for (const dash of dashes) {
    expect(dash[0]).toBeGreaterThanOrEqual(-0.001);
    expect(dash[1]).toBeLessThanOrEqual(length + 0.001);
    expect(dash[1] - dash[0]).toBeGreaterThanOrEqual(0.8);
    const index = runs.indexOf(dash);
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(runs.length - 1);
    expect(dash[0] - runs[index - 1]![1]).toBeGreaterThanOrEqual(0.5);
    expect(runs[index + 1]![0] - dash[1]).toBeGreaterThanOrEqual(0.5);
  }
  return runs;
}
