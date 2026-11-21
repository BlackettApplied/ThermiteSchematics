import { required } from "../presentation/util.js";
export interface Interval {
  start: number;
  end: number;
}
/** Cuts only in whitespace between indivisible devices, rails and labels. */
export function cuts(
  length: number,
  capacity: number,
  protectedIntervals: Interval[],
): number[] | null {
  const result = [0];
  const intervals = protectedIntervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end)
      last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  while (
    length - required(result.at(-1), "Missing rooted geometry") >
    capacity + 0.001
  ) {
    const start = required(result.at(-1), "Missing rooted geometry");
    let cut = start + capacity;
    for (let i = merged.length - 1; i >= 0; i--) {
      const interval = required(merged[i], "Missing rooted geometry");
      if (cut > interval.start && cut < interval.end) cut = interval.start;
    }
    if (cut - start < capacity * 0.2 || result.length >= 40) return null;
    result.push(cut);
  }
  result.push(length);
  return result;
}
