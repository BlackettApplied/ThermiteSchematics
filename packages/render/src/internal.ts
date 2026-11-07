/** Shared internal helpers for selection identities/errors and render-wide
 * freezing/canonicalization. H2 should reuse this home when consolidating the
 * protected presentation and symbol copies; it is not a public package API. */
import type {
  TerminalId,
  FunctionId,
  ConductiveElementId,
} from "@thermite/compiler";
import type { ConductiveEdgeView } from "@thermite/query";
import type {
  IncompletePathError,
  UnsupportedSymbolMappingError,
} from "./errors.js";
import { compareText, terminalIdKey } from "./ordering.js";

export function cloneTerminal(id: TerminalId): TerminalId {
  return Object.freeze({
    deviceUid: id.deviceUid,
    terminalKey: id.terminalKey,
  });
}

/** Error context is detached and frozen, just like the original error envelope. */
export function withStoppedTerminals<
  E extends IncompletePathError | UnsupportedSymbolMappingError,
>(error: E, terminals: readonly TerminalId[]): E {
  return Object.freeze({
    ...error,
    details: Object.freeze({
      ...error.details,
      terminalIds: Object.freeze(terminals.map(cloneTerminal)),
    }),
  }) as E;
}

export function cloneFunction(id: FunctionId): FunctionId {
  return Object.freeze({
    deviceUid: id.deviceUid,
    functionKey: id.functionKey,
  });
}

export function cloneConductor(id: ConductiveElementId): ConductiveElementId {
  return id.kind === "cable_conductor"
    ? Object.freeze({
        kind: id.kind,
        cableUid: id.cableUid,
        conductorId: id.conductorId,
      })
    : Object.freeze({ kind: id.kind, uid: id.uid });
}

export function conductorKey(id: ConductiveElementId): string {
  return id.kind === "cable_conductor"
    ? JSON.stringify([id.kind, id.cableUid, id.conductorId])
    : JSON.stringify([id.kind, id.uid]);
}

export function reconstructedElementId(
  edge: ConductiveEdgeView,
): ConductiveElementId {
  switch (edge.element.kind) {
    case "wire":
      return { kind: "wire", uid: edge.element.uid };
    case "jumper":
      return { kind: "jumper", uid: edge.element.uid };
    case "cable_conductor":
      return {
        kind: "cable_conductor",
        cableUid: edge.element.cableUid,
        conductorId: edge.element.conductorId,
      };
  }
}

export function sameTerminal(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

export function sameEndpointPair(
  left: readonly [TerminalId, TerminalId],
  right: readonly [TerminalId, TerminalId],
): boolean {
  return (
    (sameTerminal(left[0], right[0]) && sameTerminal(left[1], right[1])) ||
    (sameTerminal(left[0], right[1]) && sameTerminal(left[1], right[0]))
  );
}

export function addUnique<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
  description: string,
): void {
  if (map.has(key)) throw new Error(`Duplicate ${description}.`);
  map.set(key, value);
}

export function addTerminal(
  terminals: Map<string, TerminalId>,
  terminal: TerminalId,
): void {
  terminals.set(terminalIdKey(terminal), cloneTerminal(terminal));
}

export function deepFreeze<Value>(
  value: Value,
  seen = new Set<object>(),
): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

export function canonicalSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSerializable);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareText)
      .map((key) => [key, canonicalSerializable(record[key])]),
  );
}
