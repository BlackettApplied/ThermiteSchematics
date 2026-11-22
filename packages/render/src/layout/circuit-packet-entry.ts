import { types } from "node:util";
import { withRenderCache } from "../packet/render-cache.js";
import {
  renderSchematicPacket as renderOriginalPacket,
  renderSchematicSheets as renderOriginalSheets,
} from "../sheets.js";
import { withFontMetricCache } from "../symbols/font-metric-cache.js";
import { selectCircuitPacket } from "./circuit-packet-selection.js";
import { selectControlPrint } from "../packet/rooted-control-print.js";

const NOT_PLAIN = Symbol("not-plain");

function isSnapshotOf<T>(value: unknown, _source: T): value is T {
  return value !== NOT_PLAIN;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deeply snapshot plain JSON-like data using only own data descriptors,
 * never invoking getters, Proxy traps, or custom iterators. */
function snapshotPlain(value: unknown, seen = new Set<object>()): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return value;
  if (typeof value !== "object" || types.isProxy(value) || seen.has(value))
    return NOT_PLAIN;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return NOT_PLAIN;
      if (Object.getOwnPropertySymbols(value).length > 0) return NOT_PLAIN;
      const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lenDesc ||
        !("value" in lenDesc) ||
        typeof lenDesc.value !== "number"
      )
        return NOT_PLAIN;
      const len = lenDesc.value;
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== len + 1) return NOT_PLAIN;
      const copy: unknown[] = [];
      for (let i = 0; i < len; i++) {
        const desc = Object.getOwnPropertyDescriptor(value, String(i));
        if (!desc || !("value" in desc) || !desc.enumerable) return NOT_PLAIN;
        const item = snapshotPlain(desc.value, seen);
        if (item === NOT_PLAIN) return NOT_PLAIN;
        copy.push(item);
      }
      return copy;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return NOT_PLAIN;
    if (Object.getOwnPropertySymbols(value).length > 0) return NOT_PLAIN;
    const copy = proto === null ? Object.create(null) : {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc || !("value" in desc) || !desc.enumerable) return NOT_PLAIN;
      const field = snapshotPlain(desc.value, seen);
      if (field === NOT_PLAIN) return NOT_PLAIN;
      Object.defineProperty(copy, key, {
        value: field,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function snapshotPacketArgs(args: Parameters<typeof renderOriginalPacket>) {
  const request = snapshotPlain(args[1]);
  if (!isSnapshotOf(request, args[1]) || !isPlainObject(request))
    return undefined;
  const views = Object.getOwnPropertyDescriptor(request, "views")?.value;
  if (!Array.isArray(views) || views.length !== 1) return undefined;
  const view = Object.getOwnPropertyDescriptor(views, "0")?.value;
  if (!isPlainObject(view)) return undefined;
  const presentation =
    args[2] === undefined ? undefined : snapshotPlain(args[2]);
  if (!isSnapshotOf(presentation, args[2])) return undefined;
  return { request, presentation };
}

function snapshotSheetsArgs(args: Parameters<typeof renderOriginalSheets>) {
  const view = snapshotPlain(args[1]);
  if (!isSnapshotOf(view, args[1]) || !isPlainObject(view)) return undefined;
  const presentation =
    args[2] === undefined ? undefined : snapshotPlain(args[2]);
  const page = args[3] === undefined ? undefined : snapshotPlain(args[3]);
  const options = args[4] === undefined ? undefined : snapshotPlain(args[4]);
  if (
    !isSnapshotOf(presentation, args[2]) ||
    !isSnapshotOf(page, args[3]) ||
    !isSnapshotOf(options, args[4])
  )
    return undefined;
  return { view, presentation, page, options };
}

/** Keep final printable comparison outside NAV's packet implementation. */
export function renderSchematicPacket(
  ...args: Parameters<typeof renderOriginalPacket>
) {
  return withRenderCache(() =>
    withFontMetricCache(() =>
      selectControlPrint(
        () => selectCircuitPacket(args[1], () => renderOriginalPacket(...args)),
        () => snapshotPacketArgs(args),
        (snap) =>
          renderOriginalPacket(args[0], snap.request, snap.presentation),
      ),
    ),
  );
}

export function renderSchematicSheets(
  ...args: Parameters<typeof renderOriginalSheets>
) {
  return withRenderCache(() =>
    withFontMetricCache(() =>
      selectControlPrint(
        () => renderOriginalSheets(...args),
        () => snapshotSheetsArgs(args),
        (snap) =>
          renderOriginalSheets(
            args[0],
            snap.view,
            snap.presentation,
            snap.page,
            snap.options,
          ),
      ),
    ),
  );
}
