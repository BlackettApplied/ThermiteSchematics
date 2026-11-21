import { serialize } from "node:v8";
import { legendSheets } from "../packet/device-legend.js";
import { hasCompactFrame } from "../packet/frame-profile.js";
import { titleFrameContext } from "../internal/title-data/frame-context.js";
import {
  circuitInlineContext,
  type CircuitInlineContext,
} from "./circuit-inline-context.js";

interface Preview {
  ir: object;
  key: ReturnType<typeof serialize>;
  result: ReturnType<typeof legendSheets>;
}
const previews = new WeakMap<CircuitInlineContext, Preview[]>();

/** Internal drafts are plain data. Leave other representations to the original
 * export: key construction must not invoke accessors or discard prototypes. */
function plainData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object")
    return typeof value !== "function" && typeof value !== "symbol";
  if (seen.has(value)) return true;
  if (
    Object.getPrototypeOf(value) !==
    (Array.isArray(value) ? Array.prototype : Object.prototype)
  )
    return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(
      value,
      key,
    ) as PropertyDescriptor;
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      !plainData(descriptor.value, seen)
    )
      return false;
  }
  return true;
}

/** Fitting and index lookup ask the same export to measure identical drafts.
 * Reuse only that preview. Final notice/document finalization always runs fresh,
 * and the packet selector still applies its unchanged final guard. */
export const circuitPreviewSheets: typeof legendSheets = (
  ir,
  drafts,
  page,
  notice = false,
  documents,
) => {
  const context = circuitInlineContext.getStore();
  const input = [drafts, page, hasCompactFrame(page), titleFrameContext(page)];
  if (!context || notice || documents !== undefined || !plainData(input))
    return legendSheets(ir, drafts, page, notice, documents);
  // V8 preserves undefined, property order, holes, cycles and shared references.
  // Equal bytes are required; conservative misses only recompute the export.
  const key = serialize(input),
    entries = previews.get(context) ?? [];
  previews.set(context, entries);
  const saved = entries.find(
    (entry) => entry.ir === ir && entry.key.equals(key),
  );
  if (saved) return structuredClone(saved.result);
  const result = legendSheets(ir, drafts, page, notice, documents);
  if (result.ok) entries.push({ ir, key, result: structuredClone(result) });
  return result;
};
