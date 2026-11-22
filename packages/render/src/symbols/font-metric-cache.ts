import { AsyncLocalStorage } from "node:async_hooks";
export interface FontMetrics {
  advance: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
  middleBaseline: number;
}
export const MAX_FONT_METRIC_CACHE_ENTRIES = 4096;
const scope = new AsyncLocalStorage<Map<string, FontMetrics>>();
/** One bounded cache per rooted-view search, shared by its async descendants.
 * Outside the scope, measurement stays uncached; parallel views stay isolated. */
export function withFontMetricCache<T>(work: () => Promise<T>): Promise<T> {
  return scope.getStore() ? work() : scope.run(new Map(), work);
}
export function cachedFontMetrics(
  args: readonly [string, number, boolean, boolean],
  compute: () => FontMetrics,
): FontMetrics {
  const cache = scope.getStore();
  if (!cache) return compute();
  const key = JSON.stringify(args),
    old = cache.get(key);
  if (old) return old;
  const result = Object.freeze(compute());
  if (cache.size < MAX_FONT_METRIC_CACHE_ENTRIES) cache.set(key, result);
  return result;
}
