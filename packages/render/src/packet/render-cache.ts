import { AsyncLocalStorage } from "node:async_hooks";
import type { NavigationGeometry } from "./navigation-walk.js";

// String.length counts UTF-16 code units: retained keys use at most twice
// the total-unit limit in character storage, even for tiny SVG node trees.
export const MAX_GEOMETRY_CACHE_KEY_UNITS = 256 * 1024;
export const MAX_GEOMETRY_CACHE_TOTAL_KEY_UNITS = 4 * 1024 * 1024;

export const renderCache = new AsyncLocalStorage<{
  entries: Map<string, NavigationGeometry[]>;
  nodes: number;
  keyUnits: number;
  snapshots: WeakMap<object, string>;
}>();

/** Share only within an immutable render operation, including its exact previews. */
export function withRenderCache<T>(render: () => Promise<T>): Promise<T> {
  return renderCache.getStore()
    ? render()
    : renderCache.run(
        {
          entries: new Map(),
          nodes: 0,
          keyUnits: 0,
          snapshots: new WeakMap(),
        },
        render,
      );
}
