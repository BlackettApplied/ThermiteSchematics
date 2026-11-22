import type { PresentationContext, MutablePresentationEdge } from "./model.js";
import type {
  TerminalId,
  FunctionId,
  ConductiveElementId,
  IrDevice,
} from "@thermite/compiler";
import {
  compareFunctionId,
  compareTerminalId,
  structuralTupleId,
  compareRenderTextSource,
  compareText,
} from "../ordering.js";
import type {
  SelectedSubgraph,
  RenderTextSource,
  PresentationLabelOwnerKind,
  PresentationLabelRole,
  PresentationLabel,
  LocationIdentity,
  PresentationEdge,
  PresentationGraph,
} from "../types.js";
import type { SymbolSide, SymbolDefinition } from "../symbols/types.js";
import { preservesVerticalPowerLaneOrder } from "../symbols/catalog.js";
import { continuousLabelSlot } from "../text-metrics.js";
import { type SvgSemanticIdPrefix, svgSemanticId } from "../svg/escape.js";

export function cloneTerminal(terminal: TerminalId): TerminalId {
  return { deviceUid: terminal.deviceUid, terminalKey: terminal.terminalKey };
}

export function cloneFunction(functionId: FunctionId): FunctionId {
  return {
    deviceUid: functionId.deviceUid,
    functionKey: functionId.functionKey,
  };
}

export function cloneElement(
  elementId: ConductiveElementId,
): ConductiveElementId {
  return elementId.kind === "cable_conductor"
    ? {
        kind: elementId.kind,
        cableUid: elementId.cableUid,
        conductorId: elementId.conductorId,
      }
    : { kind: elementId.kind, uid: elementId.uid };
}

export function conductorKey(elementId: ConductiveElementId): string {
  return elementId.kind === "cable_conductor"
    ? structuralTupleId(
        elementId.kind,
        elementId.cableUid,
        elementId.conductorId,
      )
    : structuralTupleId(elementId.kind, elementId.uid);
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

export function required<Value>(
  value: Value | undefined,
  message: string,
): Value {
  if (value === undefined) throw new Error(message);
  return value;
}

export function orientationFor(
  selected: Readonly<SelectedSubgraph>,
): "left-to-right" | "top-to-bottom" {
  return selected.view.flow;
}

export function orderedPowerLanes(
  selected: Readonly<SelectedSubgraph>,
): boolean {
  return (
    selected.view.flow === "top-to-bottom" &&
    selected.view.family === "power" &&
    new Set(selected.paths.map((p) => p.lane).filter((lane) => lane !== "PE"))
      .size >= 3
  );
}

export function orientedSide(
  side: SymbolSide,
  offset: number,
  orientation: "left-to-right" | "top-to-bottom",
  symbolId?: SymbolDefinition["id"],
): Readonly<{ side: SymbolSide; offset: number }> {
  if (orientation === "left-to-right") return { side, offset };
  const preserveLanes = preservesVerticalPowerLaneOrder(symbolId);
  switch (side) {
    case "west":
      return { side: "north", offset: preserveLanes ? offset : 1 - offset };
    case "east":
      return { side: "south", offset: preserveLanes ? offset : 1 - offset };
    case "north":
      return { side: preserveLanes ? "west" : "east", offset };
    case "south":
      return { side: preserveLanes ? "east" : "west", offset };
  }
}

export function orientedSymbolSize(
  symbol: SymbolDefinition,
  orientation: "left-to-right" | "top-to-bottom",
): Readonly<{ width: number; height: number }> {
  return orientation === "left-to-right"
    ? { width: symbol.size.width, height: symbol.size.height }
    : { width: symbol.size.height, height: symbol.size.width };
}

export function labelWidth(text: string): number {
  return continuousLabelSlot(text);
}

export function textSource(
  ownerKind: Extract<RenderTextSource["ownerKind"], SvgSemanticIdPrefix>,
  parts: readonly string[],
  field: RenderTextSource["field"],
  value: string,
): RenderTextSource {
  return {
    ownerKind,
    ownerId: svgSemanticId(ownerKind, parts),
    field,
    value,
  };
}

export function presentationLabel(
  ownerKind: PresentationLabelOwnerKind,
  ownerId: string,
  role: PresentationLabelRole,
  text: string,
  textSources: readonly RenderTextSource[],
): PresentationLabel {
  const width = labelWidth(text);
  return {
    id: structuralTupleId("label", ownerKind, ownerId, role),
    ownerKind,
    ownerId,
    role,
    text,
    textSources: [...textSources].sort(compareRenderTextSource),
    width,
    height: 14,
    textLength: Number((width - 6).toFixed(3)),
  };
}

export function locationIdentity(device: IrDevice): LocationIdentity {
  return device.location === undefined
    ? ["virtual", "UNSPECIFIED"]
    : ["authored", device.location];
}

export function locationGroupId(identity: LocationIdentity): string {
  return structuralTupleId("location", identity[0], identity[1]);
}

export function deviceGroupId(deviceUid: string): string {
  return structuralTupleId("device", deviceUid);
}

export function immutableEdge(edge: MutablePresentationEdge): PresentationEdge {
  if (edge.sourcePortId === "" || edge.targetPortId === "") {
    throw new Error(`Presentation edge ${edge.id} has an unbound endpoint.`);
  }
  return {
    id: edge.id,
    ...(edge.authoredOrderKey === undefined
      ? {}
      : { authoredOrderKey: edge.authoredOrderKey }),
    parentId: "root",
    kind: edge.kind,
    sourcePortId: edge.sourcePortId,
    targetPortId: edge.targetPortId,
    netId: edge.netId,
    elementIds: edge.elementIds.map(cloneElement),
    ...(edge.conductor === undefined
      ? {}
      : { conductor: structuredClone(edge.conductor) }),
    endpoints: [
      cloneTerminal(edge.endpoints[0]),
      cloneTerminal(edge.endpoints[1]),
    ],
    pathRank: edge.pathRank,
    ...(edge.label === undefined ? {} : { label: edge.label }),
    ...(edge.netLabel === undefined ? {} : { netLabel: edge.netLabel }),
  };
}

export function cloneView(selected: Readonly<SelectedSubgraph>) {
  if (selected.view.format === "schematic-view/0.1") {
    return {
      format: "schematic-view/0.1" as const,
      family: selected.view.family,
      root: {
        deviceUid: selected.view.root.deviceUid,
        designation: selected.view.root.designation,
      },
      flow: selected.view.flow,
    };
  }
  if (selected.view.intent === "trace") {
    return {
      format: "schematic-view/0.2" as const,
      family: "control" as const,
      intent: "trace" as const,
      root: { ...selected.view.root },
      target: { ...selected.view.target },
      includePower: selected.view.includePower,
      flow: selected.view.flow,
    };
  }
  if (selected.view.intent === "conductors") {
    return {
      format: "schematic-view/0.2" as const,
      family: "control" as const,
      intent: "conductors" as const,
      root: { ...selected.view.root },
      flow: selected.view.flow,
    };
  }
  return {
    format: "schematic-view/0.2" as const,
    family: "control" as const,
    intent: "loads" as const,
    root: { ...selected.view.root },
    flow: selected.view.flow,
  };
}

function canonicalSerializable(value: unknown): unknown {
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

export function serializePresentationGraphForTest(
  graph: Readonly<PresentationGraph>,
): string {
  return JSON.stringify(canonicalSerializable(graph));
}

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Presentation invariant: ${message}`);
}

export function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    new Set(left).size === new Set(right).size &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

export function exactTerminalTuple(
  left: readonly [TerminalId, TerminalId],
  right: readonly [TerminalId, TerminalId],
): boolean {
  return sameTerminal(left[0], right[0]) && sameTerminal(left[1], right[1]);
}

export function designationFor(
  context: PresentationContext,
  deviceUid: string,
): string {
  return context.deviceByUid.get(deviceUid)?.designation ?? "";
}

function mappingOrderForFunction(
  context: PresentationContext,
  functionId: FunctionId,
): number {
  const device = context.deviceByUid.get(functionId.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (mapping === undefined) return Number.MAX_SAFE_INTEGER;
  const functionIndex = mapping.functions.findIndex(
    ({ functionKey }) => functionKey === functionId.functionKey,
  );
  if (functionIndex >= 0) return functionIndex;
  for (const [aggregateIndex, aggregate] of mapping.aggregates.entries()) {
    const memberIndex = aggregate.functionKeys.indexOf(functionId.functionKey);
    if (memberIndex >= 0) {
      return mapping.functions.length + aggregateIndex * 1_000 + memberIndex;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

export function compareCompleteFunction(
  context: PresentationContext,
  left: FunctionId,
  right: FunctionId,
): number {
  return compareFunctionId(
    left,
    right,
    (deviceUid) => designationFor(context, deviceUid),
    (functionId) => mappingOrderForFunction(context, functionId),
  );
}

export function compareCompleteTerminal(
  context: PresentationContext,
  left: TerminalId,
  right: TerminalId,
): number {
  return compareTerminalId(left, right, (deviceUid) =>
    designationFor(context, deviceUid),
  );
}
