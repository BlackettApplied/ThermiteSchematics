import { textClusters } from "../text-metrics.js";

export const MAX_WRAP_CANDIDATES = 64;
export const MAX_WRAP_FIT_PROBES = 32;
const WIDTH_CACHE_LIMIT = 8192;
class LabelWrapInvariantError extends Error {
  readonly name = "LabelWrapInvariantError";
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new LabelWrapInvariantError(message);
  return value;
}
const separator = (cluster: string) => /^[-./ ]$/u.test(cluster);
type Cost = readonly [number, number, number, number];
interface State {
  next: number;
  cost: Cost;
}

function memoized(measure: (value: string) => number) {
  const cache = new Map<string, number>();
  return (value: string) => {
    let width = cache.get(value);
    if (width === undefined) {
      width = measure(value);
      if (cache.size >= WIDTH_CACHE_LIMIT)
        cache.delete(required(cache.keys().next().value, "Missing width key"));
      cache.set(value, width);
    }
    return width;
  };
}

function before(a: Cost, b: Cost) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return (
        required(a[i], "Missing left cost") <
        required(b[i], "Missing right cost")
      );
  }
  return false;
}

/** Literal tokens include their separator, including repeated/trailing spaces. */
export function identityTokens(value: string) {
  const result: string[] = [];
  let token = "";
  for (const cluster of textClusters(value)) {
    token += cluster;
    if (separator(cluster)) {
      result.push(token);
      token = "";
    }
  }
  if (token) result.push(token);
  return result;
}

function rowsAt(chars: readonly string[], ends: readonly number[]) {
  let start = 0;
  return ends.map((end) => {
    const row = chars.slice(start, end).join("");
    start = end;
    return row;
  });
}

/** A JS array has at most 2^32-1 entries: 32 binary probes suffice. */
export function fittingEnd(
  chars: readonly string[],
  start: number,
  fits: (value: string) => boolean,
) {
  let low = start + 1,
    high = chars.length,
    end = low;
  for (let probe = 0; low <= high && probe < MAX_WRAP_FIT_PROBES; probe++) {
    const middle = Math.floor((low + high) / 2);
    if (fits(chars.slice(start, middle).join(""))) {
      end = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  // Preserve an oversized cluster; the caller's existing ink-fit check refuses.
  return end;
}

function balanceLast(
  chars: readonly string[],
  ends: number[],
  fits: (value: string) => boolean,
) {
  if (ends.length < 2) return;
  const end = required(ends.at(-1), "Missing final row"),
    previous = required(ends.at(-2), "Missing previous row"),
    start = ends.at(-3) ?? 0;
  if (end - previous >= 3) return;
  if (fits(chars.slice(start, end).join(""))) {
    ends.splice(-2, 2, end);
    return;
  }
  for (const cut of [Math.floor((start + end) / 2), end - 3]) {
    if (
      cut - start >= 3 &&
      end - cut >= 3 &&
      fits(chars.slice(start, cut).join("")) &&
      fits(chars.slice(cut, end).join(""))
    ) {
      ends[ends.length - 2] = cut;
      return;
    }
  }
}

/** Wide banks use one greedy state per emitted row, not a suffix-wide search.
 * Each state probes at most 32 widths and inspects at most 64 separator breaks;
 * balancing adds at most five width probes. No source character is changed. */
function wideRows(
  chars: readonly string[],
  fits: (value: string) => boolean,
  preferredSeparator: (value: string) => boolean = separator,
) {
  const ends: number[] = [];
  for (let start = 0; start < chars.length;) {
    let end = fittingEnd(chars, start, fits);
    const stop = Math.max(start + 2, end - MAX_WRAP_CANDIDATES);
    for (let cut = end; cut > stop; cut--) {
      if (
        (cut === chars.length ||
          preferredSeparator(
            required(chars[cut - 1], "Missing separator cluster"),
          )) &&
        (cut === chars.length || chars.length - cut >= 3)
      ) {
        end = cut;
        break;
      }
    }
    ends.push(end);
    balanceLast(chars, ends, fits);
    start = end;
  }
  return rowsAt(chars, ends);
}

/** At most 64 candidate breaks per grapheme state; memoized pinned widths.
 * The cost prefers no 1/2-cluster orphans, then authored separators, fewer rows
 * and less unused width. Backpointers avoid copying growing suffix-row arrays.
 * At a fitting 64-cluster prefix, try the bounded wide-row fallback once. */
export function wrapIdentity(
  value: string,
  width: number,
  measure: (value: string) => number,
  preferredSeparator: (value: string) => boolean = separator,
): string[] {
  const measured = memoized(measure),
    fits = (text: string) => measured(text) <= width + 0.001;
  if (fits(value) || !value) return [value];
  const chars = textClusters(value),
    count = chars.length,
    states: State[] = [];
  let triedWide = false;
  states[count] = { next: count, cost: [0, 0, 0, 0] };
  for (let start = count - 1; start >= 0; start--) {
    let row = "",
      best: State | undefined;
    const limit = Math.min(count, start + MAX_WRAP_CANDIDATES);
    for (let end = start + 1; end <= limit; end++) {
      row += required(chars[end - 1], "Missing row cluster");
      const used = measured(row);
      if (used > width + 0.001 && end > start + 1) break;
      if (end < count && end === limit && fits(row) && !triedWide) {
        const rows = wideRows(chars, fits, preferredSeparator);
        if (rows.every((r) => textClusters(r).length >= 3)) return rows;
        // A fitting long row can be split into 3–64-cluster rows. Continuing
        // the capped DP retains every feasible orphan-free partition.
        triedWide = true;
      }
      const tail = required(states[end], "Missing wrap state").cost;
      const cost: Cost = [
        tail[0] + (end - start <= 2 && count > 2 ? 1 : 0),
        tail[1] +
          (end < count &&
          !preferredSeparator(required(chars[end - 1], "Missing row cluster"))
            ? 1
            : 0),
        tail[2] + 1,
        tail[3] + (width - used) ** 2,
      ];
      if (!best || before(cost, best.cost)) best = { next: end, cost };
    }
    states[start] = required(best, "Missing literal wrap");
  }
  const ends: number[] = [];
  for (let at = 0; at < count;) {
    at = required(states[at], "Missing wrap state").next;
    ends.push(at);
  }
  return rowsAt(chars, ends);
}
