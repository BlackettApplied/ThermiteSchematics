import { validateDeviceTagSources } from "../device-tags.js";
import type { ElectricalIr, IrTerminal, IrDevice } from "@thermite/compiler";
import type {
  SelectedSubgraph,
  PresentationGraph,
  DeviceGroup,
  PresentationNode,
  PresentationPort,
} from "../types.js";
import {
  type DeviceTypeSymbolMapping,
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
} from "../symbols/mappings.js";
import { invariant } from "./util.js";
import { graphSemanticOrder, type SemanticOrder } from "../semantic-order.js";
import { validateLocations, validateDeviceGroups } from "./validate-groups.js";
import { validateEdges } from "./validate-edges.js";
import { closedTraceValidationRecords } from "./validate-trace.js";
import { validateJunctions } from "./validate-junctions.js";
import {
  validateLabelsAndMetadata,
  validateProvenance,
} from "./validate-labels.js";
import { validateNodes } from "./validate-nodes.js";
import { comparePresentationNode, terminalIdKey } from "../ordering.js";
import { assertSemanticAttachments } from "../layout/topology-conservation.js";
import { validateOffViewIncidence } from "../off-view/validate.js";

export function validatePresentationGraph(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  graph: Readonly<PresentationGraph>,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
): void {
  invariant(graph.format === "schematic-presentation/0.1", "graph format");
  const order = graphSemanticOrder(graph);
  invariant(
    JSON.stringify(graph.view) === JSON.stringify(selected.view),
    "normalized view identity",
  );
  const deviceByUid = new Map(ir.devices.map((device) => [device.uid, device]));
  const { terminalByKey, netByTerminal } = validationTerminalIndexes(ir);
  const locationById = validateLocations(graph);
  const deviceGroupById = validateDeviceGroups(
    graph,
    deviceByUid,
    locationById,
  );

  const { portById, ownerByPortId, nodeById } =
    validateGraphNodesAndAttachments(
      graph,
      terminalByKey,
      netByTerminal,
      deviceByUid,
      deviceGroupById,
      ir,
      selected,
      mappings,
      order,
    );

  const conductorCountByPort = new Map<string, number>();
  validateEdges(graph, portById, ir, conductorCountByPort);
  for (const [portId, count] of conductorCountByPort) {
    const owner = ownerByPortId.get(portId);
    if (owner?.kind !== "junction") {
      invariant(count <= 1, `${portId} non-junction fanout`);
    }
  }

  const closedTraceRecords = closedTraceValidationRecords(ir, selected, graph);
  validateJunctions(
    graph,
    ownerByPortId,
    portById,
    closedTraceRecords,
    order,
    nodeById,
  );

  validateLabelsAndMetadata(graph, selected, deviceByUid);
  validateDeviceTagSources(ir, [
    ...graph.metadataTextSources,
    ...graph.deviceGroups.flatMap((g) => g.label.textSources),
    ...graph.nodes.flatMap((n) =>
      n.kind === "junction" ? [] : n.labels.flatMap((l) => l.textSources),
    ),
  ]);
  validateOffViewIncidence(ir, graph);
  validateProvenance(ir, graph, mappings, selected);
}

function validateGraphNodesAndAttachments(
  graph: Readonly<PresentationGraph>,
  terminalByKey: Map<string, IrTerminal>,
  netByTerminal: Map<string, string>,
  deviceByUid: Map<string, IrDevice>,
  deviceGroupById: Map<string, DeviceGroup>,
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  mappings: readonly DeviceTypeSymbolMapping[],
  order: SemanticOrder,
) {
  const nodeById = new Map<string, PresentationNode>();
  const portById = new Map<string, PresentationPort>();
  const ownerByPortId = new Map<string, PresentationNode>();
  validateNodes(
    graph,
    nodeById,
    portById,
    ownerByPortId,
    terminalByKey,
    netByTerminal,
    deviceByUid,
    deviceGroupById,
    ir,
    selected,
    mappings,
  );
  invariant(
    JSON.stringify(graph.nodes) ===
      JSON.stringify(
        [...graph.nodes].sort((a, b) =>
          comparePresentationNode(a, b, order.key),
        ),
      ),
    "presentation node order",
  );

  assertSemanticAttachments(
    ir,
    selected,
    graph,
    netByTerminal,
    portById,
    ownerByPortId,
  );
  return { portById, ownerByPortId, nodeById };
}

function validationTerminalIndexes(ir: Readonly<ElectricalIr>) {
  const terminalByKey = new Map(
    ir.terminals.map((terminal) => [terminalIdKey(terminal.id), terminal]),
  );
  const netByTerminal = new Map(
    ir.indexes.netIdByTerminal.map(({ key, value }) => [
      terminalIdKey(key),
      value,
    ]),
  );
  return { terminalByKey, netByTerminal };
}
