import type {
  PresentationGraph,
  PresentationNode,
  PresentationPort,
  DeviceGroup,
  SelectedSubgraph,
} from "../types.js";
import type { IrTerminal, IrDevice, ElectricalIr } from "@thermite/compiler";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import { invariant, sameTerminal } from "./util.js";
import { comparePresentationPort, terminalIdKey } from "../ordering.js";
import { assertSymbolTruth } from "../layout/topology-conservation.js";

export function validateNodes(
  graph: Readonly<PresentationGraph>,
  nodeById: Map<string, PresentationNode>,
  portById: Map<string, PresentationPort>,
  ownerByPortId: Map<string, PresentationNode>,
  terminalByKey: Map<string, IrTerminal>,
  netByTerminal: Map<string, string>,
  deviceByUid: Map<string, IrDevice>,
  deviceGroupById: Map<string, DeviceGroup>,
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  mappings: readonly DeviceTypeSymbolMapping[],
) {
  for (const node of graph.nodes) {
    invariant(!nodeById.has(node.id), `${node.id} unique node`);
    nodeById.set(node.id, node);
    validateNodePorts(
      node,
      portById,
      ownerByPortId,
      terminalByKey,
      netByTerminal,
    );
    const sortedPorts = [...node.ports].sort((left, right) =>
      comparePresentationPort(
        left,
        right,
        (deviceUid) => deviceByUid.get(deviceUid)?.designation ?? "",
      ),
    );
    invariant(
      JSON.stringify(node.ports) === JSON.stringify(sortedPorts),
      `${node.id} port order`,
    );
    if (node.kind === "junction") {
      invariant(
        node.ports.every(({ order }, index) => order === index),
        `${node.id} dense junction port order`,
      );
    }
    validateNodeParent(node, deviceGroupById, ir, selected, mappings);
  }
}

function validateNodeParent(
  node: PresentationNode,
  deviceGroupById: Map<string, DeviceGroup>,
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  mappings: readonly DeviceTypeSymbolMapping[],
) {
  if (node.kind === "symbol") {
    const group = deviceGroupById.get(node.parentId);
    invariant(group !== undefined, `${node.id} device parent`);
    invariant(
      group.deviceUid === node.deviceUid,
      `${node.id} exact device parent`,
    );
    invariant(
      node.deviceGroupId === group.id,
      `${node.id} tagged device parent`,
    );
    invariant(
      node.locationGroupId === group.parentId,
      `${node.id} location parent`,
    );
    assertSymbolTruth(ir, selected, node, mappings);
  } else if (node.kind === "rail") {
    invariant(node.parentId === "root", `${node.id} rail root parent`);
    invariant(node.classification === "rail", `${node.id} rail classification`);
    invariant(node.ports.length === 1, `${node.id} one rail port`);
    invariant(
      sameTerminal(node.ports[0].terminal, node.boundary.terminal) &&
        node.ports[0].netId === node.boundary.netId,
      `${node.id} rail terminal/net provenance`,
    );
    if (node.boundary.potentialUid !== undefined) {
      const potential = ir.potentials.find(
        ({ uid }) => uid === node.boundary.potentialUid,
      );
      invariant(potential !== undefined, `${node.id} potential exists`);
      invariant(
        sameTerminal(potential.terminal, node.boundary.terminal) &&
          potential.netId === node.boundary.netId,
        `${node.id} exact authored potential anchor`,
      );
    }
  }
}

function validateNodePorts(
  node: PresentationNode,
  portById: Map<string, PresentationPort>,
  ownerByPortId: Map<string, PresentationNode>,
  terminalByKey: Map<string, IrTerminal>,
  netByTerminal: Map<string, string>,
) {
  for (const port of node.ports) {
    invariant(!portById.has(port.id), `${port.id} unique port`);
    portById.set(port.id, port);
    ownerByPortId.set(port.id, node);
    const terminal = terminalByKey.get(terminalIdKey(port.terminal));
    invariant(terminal !== undefined, `${port.id} terminal exists`);
    invariant(
      netByTerminal.get(terminalIdKey(port.terminal)) === port.netId,
      `${port.id} query-owned compiler net`,
    );
    if (node.kind === "symbol") {
      invariant(
        port.terminal.deviceUid === node.deviceUid,
        `${port.id} same-device terminal`,
      );
      invariant(
        node.representation === "terminal"
          ? port.memberFunctionId === undefined
          : port.memberFunctionId !== undefined,
        `${port.id} required member function or terminal context`,
      );
      invariant(
        port.label === port.terminal.terminalKey,
        `${port.id} exact terminal label`,
      );
    } else if (node.kind === "rail") {
      invariant(
        port.memberFunctionId === undefined,
        `${port.id} no rail member function`,
      );
      invariant(
        port.label === port.terminal.terminalKey,
        `${port.id} exact rail terminal label`,
      );
    } else {
      invariant(
        port.memberFunctionId === undefined,
        `${port.id} no junction member function`,
      );
      invariant(port.label === "", `${port.id} no junction label`);
    }
  }
}
