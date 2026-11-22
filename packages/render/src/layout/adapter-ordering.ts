import {
  comparePresentationNode,
  comparePresentationPort,
  compareTerminalId,
  compareText,
} from "../ordering.js";
import type { SemanticOrder } from "../semantic-order.js";
import { preservesVerticalPowerLaneOrder } from "../symbols/catalog.js";
import type {
  PresentationGraph,
  PresentationNode,
  PresentationPort,
  RailPresentationNode,
  SymbolPresentationNode,
} from "../types.js";

export function verticalPowerLanes(graph: PresentationGraph): boolean {
  return (
    graph.view.family === "power" &&
    graph.view.flow === "top-to-bottom" &&
    graph.nodes.some(
      (node) =>
        node.kind === "symbol" &&
        preservesVerticalPowerLaneOrder(node.symbolId),
    )
  );
}

// Reserve the right-hand PE bypass beside the last pole for 18 mm sheet
// continuations at the minimum print scale. Compact profiles need this too.
export const VERTICAL_POWER_EDGE_NODE_SPACING = "32";

export function designationLookup(
  graph: PresentationGraph,
): (uid: string) => string {
  const values = new Map<string, string>();
  for (const group of graph.deviceGroups)
    values.set(group.deviceUid, group.designation);
  for (const node of graph.nodes) {
    if (node.kind !== "junction") values.set(node.deviceUid, node.designation);
  }
  return (uid) => values.get(uid) ?? "";
}

export function compareAdapterNodes(
  graph: PresentationGraph,
  left: PresentationNode,
  right: PresentationNode,
  order: SemanticOrder,
): number {
  if (left.kind === "junction" && right.kind === "junction") {
    return (
      compareTerminalId(
        left.terminal,
        right.terminal,
        designationLookup(graph),
      ) || comparePresentationNode(left, right, order.key)
    );
  }
  return comparePresentationNode(left, right, order.key);
}

export function sortedPorts(
  graph: PresentationGraph,
  ports: readonly PresentationPort[],
): readonly PresentationPort[] {
  const designationFor = designationLookup(graph);
  return [...ports].sort((left, right) =>
    comparePresentationPort(left, right, designationFor),
  );
}

export function sortedLeafPorts(
  graph: PresentationGraph,
  node: SymbolPresentationNode | RailPresentationNode,
): readonly PresentationPort[] {
  const ports = sortedPorts(graph, node.ports);
  if (
    node.kind !== "symbol" ||
    node.orientation !== "top-to-bottom" ||
    !preservesVerticalPowerLaneOrder(node.symbolId)
  )
    return ports;
  // ELK indices run clockwise: north is left-to-right, south right-to-left.
  // These lane families have all ports on one of those two sides. Their
  // semantic order stays intact; only ELK's perimeter indices change.
  if (
    new Set(ports.map((p) => p.side)).size !== 1 ||
    ports.some((p) => p.side !== "north" && p.side !== "south")
  )
    throw Error(
      `Vertical power lane family ${node.symbolId} requires a single north or south port side.`,
    );
  return [...ports].sort(compareVerticalPowerPorts);
}

export function compareVerticalPowerPorts(
  left: PresentationPort,
  right: PresentationPort,
): number {
  return (
    compareText(left.side, right.side) ||
    (left.side === "south"
      ? right.offset - left.offset
      : left.offset - right.offset)
  );
}
