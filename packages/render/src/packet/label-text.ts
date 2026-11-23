import { required } from "../presentation/util.js";
import { printableTextMetrics } from "../text-metrics.js";
import { wrapIdentity } from "./label-wrap.js";

const cache = new Map<string, ReturnType<typeof printableTextMetrics>>();

/** Literal source characters, using the same pinned faces as SVG and PDF. */
export function labelMetrics(value: string, size = 2.5) {
  const key = JSON.stringify([size, value]);
  let m = cache.get(key);
  if (!m) {
    m = Object.freeze(printableTextMetrics(value, size, false, true));
    if (cache.size >= 8192)
      cache.delete(required(cache.keys().next().value, "Missing cache key"));
    cache.set(key, m);
  }
  return {
    ...m,
    width: Math.max(m.advance, m.right) - Math.min(0, m.left),
  };
}

/** No inserted hyphens, discarded spaces or split combining characters. */
export function labelRows(
  value: string,
  width: number,
  size = 2.5,
  measure = (text: string) => labelMetrics(text, size).width,
): string[] {
  return wrapIdentity(value, width, measure);
}
