import type { PresentationContext, MutablePresentationEdge } from "./model.js";
import type {
  SymbolPresentationNode,
  RailPresentationNode,
  RenderTextSource,
  PresentationGraph,
  RenderSummary,
} from "../types.js";
import {
  required,
  textSource,
  cloneTerminal,
  cloneFunction,
  cloneElement,
  conductorKey,
} from "./util.js";
import {
  structuralTupleId,
  compareRenderTextSource,
  compareText,
  terminalIdKey,
  compareTerminalId,
  functionIdKey,
  compareFunctionId,
} from "../ordering.js";
import {
  type ElectricalIr,
  compareConductiveElementId,
} from "@thermite/compiler";
import {
  type DeviceTypeSymbolMapping,
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
} from "../symbols/mappings.js";

export function metadataTextSources(
  context: PresentationContext,
  nodes: readonly (SymbolPresentationNode | RailPresentationNode)[],
  edges: readonly MutablePresentationEdge[],
): readonly RenderTextSource[] {
  const sources = context.selected.deviceUids.map((deviceUid) => {
    const device = required(
      context.deviceByUid.get(deviceUid),
      `Selected device ${deviceUid} is missing.`,
    );
    return textSource("device", [device.uid], "device.type", device.typeId);
  });
  if (
    context.selected.view.format === "schematic-view/0.2" &&
    context.selected.view.intent === "conductors"
  ) {
    sources.push(
      textSource(
        "cable",
        [context.selected.view.root.cableUid],
        "cable.designation",
        context.selected.view.root.designation,
      ),
    );
  }
  for (const node of nodes) {
    if (node.kind === "rail") {
      sources.push(
        textSource(
          "device",
          [node.deviceUid],
          "device.designation",
          node.designation,
        ),
      );
    } else if (node.representation === "aggregate") {
      for (const functionId of node.functionIds) {
        sources.push(
          textSource(
            "function",
            [functionId.deviceUid, functionId.functionKey],
            "function.key",
            functionId.functionKey,
          ),
        );
      }
    }
  }
  for (const edge of edges) {
    const conductor = edge.conductor;
    if (conductor?.kind !== "wire") continue;
    const wire = required(
      context.ir.wires.find(({ uid }) => uid === conductor.uid),
      `Selected wire ${conductor.uid} is missing.`,
    );
    if (wire.properties?.label === undefined) continue;
    sources.push(
      textSource("wire", [wire.uid], "wire.designation", wire.designation),
    );
  }
  return uniqueByKey(sources, (source) =>
    structuralTupleId(source.ownerKind, source.ownerId, source.field),
  ).sort(compareRenderTextSource);
}

function uniqueByKey<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyFor(value), value);
  return [...byKey.values()];
}

export function summarizePresentationGraph(
  ir: Readonly<ElectricalIr>,
  graph: Readonly<PresentationGraph>,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
): RenderSummary {
  const { designationByUid, functionOrderByKey, typeIdByDeviceUid } =
    summaryIndexes(ir, mappings);
  const deviceUids = uniqueByKey(
    graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : [node.deviceUid],
    ),
    (value) => value,
  ).sort(
    (left, right) =>
      compareText(
        designationByUid.get(left) ?? "",
        designationByUid.get(right) ?? "",
      ) || compareText(left, right),
  );
  const terminalIds = uniqueByKey(
    graph.nodes.flatMap((node) =>
      node.ports.map(({ terminal }) => cloneTerminal(terminal)),
    ),
    terminalIdKey,
  ).sort((left, right) =>
    compareTerminalId(
      left,
      right,
      (deviceUid) => designationByUid.get(deviceUid) ?? "",
    ),
  );
  const functionIds = uniqueByKey(
    graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : node.functionIds.map(cloneFunction),
    ),
    functionIdKey,
  ).sort((left, right) =>
    compareFunctionId(
      left,
      right,
      (deviceUid) => designationByUid.get(deviceUid) ?? "",
      (functionId) =>
        functionOrderByKey.get(
          structuralTupleId(
            typeIdByDeviceUid.get(functionId.deviceUid) ?? "",
            functionId.functionKey,
          ),
        ) ?? Number.MAX_SAFE_INTEGER,
    ),
  );
  const conductiveElementIds = uniqueByKey(
    graph.edges.flatMap(({ elementIds }) => elementIds.map(cloneElement)),
    conductorKey,
  ).sort(compareConductiveElementId);
  const netIds = uniqueByKey(
    [
      ...graph.edges.map(({ netId }) => netId),
      ...graph.nodes.flatMap((node) => node.ports.map(({ netId }) => netId)),
    ],
    (value) => value,
  ).sort(compareText);
  return {
    deviceUids,
    terminalIds,
    functionIds,
    conductiveElementIds,
    netIds,
    presentationNodeIds: graph.nodes.map(({ id }) => id),
  };
}

function summaryIndexes(
  ir: Readonly<ElectricalIr>,
  mappings: readonly DeviceTypeSymbolMapping[],
) {
  const designationByUid = new Map(
    ir.devices.map(({ uid, designation }) => [uid, designation]),
  );
  const functionOrderByKey = new Map<string, number>();
  const typeIdByDeviceUid = new Map(
    ir.devices.map(({ uid, typeId }) => [uid, typeId]),
  );
  for (const mapping of mappings) {
    mapping.functions.forEach(({ functionKey }, index) =>
      functionOrderByKey.set(
        structuralTupleId(mapping.typeId, functionKey),
        index,
      ),
    );
    mapping.aggregates.forEach((aggregate, aggregateIndex) =>
      aggregate.functionKeys.forEach((functionKey, memberIndex) =>
        functionOrderByKey.set(
          structuralTupleId(mapping.typeId, functionKey),
          mapping.functions.length + aggregateIndex * 1000 + memberIndex,
        ),
      ),
    );
  }
  return { designationByUid, functionOrderByKey, typeIdByDeviceUid };
}
