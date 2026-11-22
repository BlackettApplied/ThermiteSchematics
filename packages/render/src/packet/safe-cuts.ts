import { required } from "../presentation/util.js";
import type { Interval } from "./rooted-cuts.js";

export const MAX_GAP_POINTS = 256;
export const MAX_AXIS_PLANS = 6;
export const MAX_GRID_PLANS = MAX_AXIS_PLANS * MAX_AXIS_PLANS;
export const MAX_CUTS = 40;
export const MAX_GRID_SHEETS = 80;
export type AxisSearchCap = "gap-points" | "axis-plans" | "cuts";

export function mergedIntervals(items: readonly Interval[]) {
  const result: Interval[] = [];
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else result.push({ ...item });
  }
  return result;
}

function gapPoints(
  length: number,
  capacity: number,
  intervals: readonly Interval[],
  onCap?: (cap: AxisSearchCap) => void,
) {
  const merged = mergedIntervals(intervals),
    points = [0, length];
  let end = 0;
  for (const item of merged) {
    if (item.start > end) points.push(end, item.start, (end + item.start) / 2);
    end = Math.max(end, item.end);
  }
  if (end < length) points.push(end, (end + length) / 2);
  // Include capacity-spaced cuts in long empty gaps; never enter a protected span.
  for (let v = capacity; v < length && v / capacity < MAX_CUTS; v += capacity)
    points.push(v);
  const safe = [...new Set(points)]
    .filter(
      (v) =>
        v >= 0 && v <= length && !merged.some((i) => v > i.start && v < i.end),
    )
    .sort((a, b) => a - b);
  if (safe.length <= MAX_GAP_POINTS) return safe;
  onCap?.("gap-points");
  return safe.filter(
    (_, i) =>
      i === 0 ||
      i === safe.length - 1 ||
      Math.floor((i * (MAX_GAP_POINTS - 2)) / safe.length) !==
        Math.floor(((i - 1) * (MAX_GAP_POINTS - 2)) / safe.length),
  );
}

function pathOrder(a: number[], b: number[]) {
  const spread = (p: number[]) =>
    p
      .slice(1)
      .reduce(
        (s, v, i) => s + (v - required(p[i], "Missing rooted geometry")) ** 2,
        0,
      );
  return (
    a.length - b.length ||
    spread(a) - spread(b) ||
    a.reduce((s, v, i) => s || v - (b[i] ?? 0), 0)
  );
}

/** Bounded DAG search; retain several complete paths, including short first strips. */
export function safeAxisPlans(
  length: number,
  capacity: number,
  intervals: readonly Interval[],
  valid: (point: number) => boolean,
  validSpan?: (start: number, end: number) => boolean,
  onCap?: (cap: AxisSearchCap) => void,
) {
  if (!(capacity > 0)) return [];
  if (length > capacity * MAX_CUTS) {
    onCap?.("cuts");
    return [];
  }
  if (length <= capacity && (!validSpan || validSpan(0, length)))
    return [[0, length]];
  const points = gapPoints(length, capacity, intervals, onCap).filter(
    (v) => v === 0 || v === length || valid(v),
  );
  const states = new Map<number, number[][]>([[0, [[0]]]]);
  for (const end of points.slice(1)) {
    const options: number[][] = [];
    for (const [start, paths] of states) {
      if (end - start <= 0.001 || end - start > capacity + 0.001) continue;
      if (validSpan && !validSpan(start, end)) continue;
      for (const path of paths)
        if (path.length <= MAX_CUTS) options.push([...path, end]);
        else onCap?.("cuts");
    }
    if (options.length > MAX_AXIS_PLANS) onCap?.("axis-plans");
    if (options.length)
      states.set(end, options.sort(pathOrder).slice(0, MAX_AXIS_PLANS));
  }
  return states.get(length) ?? [];
}
