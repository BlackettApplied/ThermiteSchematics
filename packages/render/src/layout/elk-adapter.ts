import {
  compareAdapterNodes,
  designationLookup,
  sortedLeafPorts,
  sortedPorts,
  verticalPowerLanes,
  VERTICAL_POWER_EDGE_NODE_SPACING,
} from "./adapter-ordering.js";
import { contactCaptionRegion } from "../presentation/contact-caption.js";
import { contextJunctionInk } from "./context-reference-ink.js";
import { offViewAdapterLabels } from "./off-view-labels.js";
import { portPosition, quantizedInput } from "./port-geometry.js";
import { portBorderOffset } from "./port-geometry.js";
import { terminalContextAttachment } from "../terminal-context-reference.js";
import {
  graphSemanticOrder,
  compareSemanticElementIds,
  type SemanticOrder,
} from "../semantic-order.js";
import type {
  ElkExtendedEdge,
  ElkLabel,
  ElkNode,
  ElkPort,
  LayoutOptions,
} from "elkjs/lib/elk-api.js";

export {
  validateElkRuntimeOptions,
  serializeElkAdapterForTest,
} from "./elk-contract.js";
import type { RootedRecovery } from "./rooted-recovery.js";
import {
  compareLocationIdentity,
  comparePresentationLabel,
  compareTerminalId,
  compareText,
  PRESENTATION_CLASS_RANK,
} from "../ordering.js";
import type { SymbolSide } from "../symbols/types.js";
import type {
  DeviceGroup,
  JunctionPresentationNode,
  LocationGroup,
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  PresentationNode,
  PresentationPort,
  RailPresentationNode,
  SelectedSubgraph,
  SymbolPresentationNode,
} from "../types.js";
import {
  DEVICE_LABEL_PADDING,
  DEVICE_PADDING,
  ELK_OPTIONS,
  type ElkOptionAssignment,
  LABEL_PORT_HORIZONTAL_SPACING,
  LABEL_PORT_VERTICAL_SPACING,
  LOCATION_LABEL_PADDING,
  LOCATION_PADDING,
  minimumSizeValue,
  paddingValue,
  PARENT_SPACING_OPTIONS,
  rootLayoutOptions,
  sortOptionAssignments,
} from "./options.js";

export interface ElkAdapterBuild {
  readonly graph: ElkNode;
  readonly optionAssignments: readonly ElkOptionAssignment[];
}

export {
  layoutPresentationGraph,
  type ElkLayoutRequestOptions,
} from "./elk-layout.js";

interface OptionGroup {
  readonly targetKind: ElkOptionAssignment["targetKind"];
  readonly options: Readonly<LayoutOptions>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ELK adapter invariant: ${message}`);
}

function assignedOptions(
  targetId: string,
  assignments: ElkOptionAssignment[],
  ...groups: readonly OptionGroup[]
): LayoutOptions {
  const values = new Map<string, string>();
  for (const group of groups) {
    for (const [option, value] of Object.entries(group.options)) {
      const prior = values.get(option);
      invariant(
        prior === undefined || prior === value,
        `conflicting values for ${option} on ${targetId}`,
      );
      if (prior !== undefined) continue;
      values.set(option, value);
      assignments.push({
        targetKind: group.targetKind,
        targetId,
        option,
        value,
      });
    }
  }
  return Object.fromEntries(
    [...values].sort(([left], [right]) => compareText(left, right)),
  );
}

function adapterLabel(label: PresentationLabel): ElkLabel & { id: string } {
  return {
    id: label.id,
    text: label.text,
    width: label.width,
    height: label.height,
  };
}

function leafHeaderLabel(
  node: SymbolPresentationNode | RailPresentationNode,
  label: PresentationLabel,
  assignments: ElkOptionAssignment[],
): ElkLabel & { id: string } {
  const vertical = node.orientation === "top-to-bottom";
  const box = node.contentBox ?? { x: 0, y: 0, width: node.width };
  const caption =
    node.kind === "symbol" ? contactCaptionRegion(node, label) : undefined;
  return {
    ...adapterLabel(label),
    x:
      box.x +
      quantizedInput(
        caption
          ? caption.x
          : vertical
            ? node.kind === "rail"
              ? 5
              : 8
            : (box.width - label.width) / 2,
      ),
    y: (caption?.y ?? (node.kind === "rail" ? 5 : 4)) + box.y,
    layoutOptions: assignedOptions(label.id, assignments, {
      targetKind: "node-label",
      options: { [ELK_OPTIONS.nodeLabelsPlacement]: "INSIDE" },
    }),
  };
}

function uppercaseSide(side: SymbolSide): string {
  return side.toUpperCase();
}

function labelsForPort(
  node: SymbolPresentationNode | RailPresentationNode,
  portId: string,
): readonly PresentationLabel[] {
  return node.labels
    .filter(
      (label) =>
        label.role !== "off-view" &&
        label.ownerKind === "port" &&
        label.ownerId === portId,
    )
    .sort(comparePresentationLabel);
}

function hasLabeledZeroIncidencePort(
  graph: PresentationGraph,
  node: SymbolPresentationNode | RailPresentationNode,
): boolean {
  const incidentPortIds = new Set(
    graph.edges.flatMap(({ sourcePortId, targetPortId }) => [
      sourcePortId,
      targetPortId,
    ]),
  );
  return node.ports.some(
    (port) =>
      labelsForPort(node, port.id).length > 0 && !incidentPortIds.has(port.id),
  );
}

function adapterPort(
  node: SymbolPresentationNode | RailPresentationNode,
  port: PresentationPort,
  index: number,
  assignments: ElkOptionAssignment[],
): ElkPort {
  const position = portPosition(node, port);
  return {
    id: port.id,
    x: position.x,
    y: position.y,
    width: 0,
    height: 0,
    layoutOptions: assignedOptions(port.id, assignments, {
      targetKind: "port",
      options: {
        [ELK_OPTIONS.portSide]: uppercaseSide(port.side),
        [ELK_OPTIONS.portIndex]: String(index),
        [ELK_OPTIONS.portBorderOffset]: String(
          quantizedInput(
            portBorderOffset(port.side, position, node.width, node.height),
          ),
        ),
      },
    }),
    labels: labelsForPort(node, port.id).map(adapterLabel),
  };
}

function leafNode(
  graph: PresentationGraph,
  node: SymbolPresentationNode | RailPresentationNode,
  assignments: ElkOptionAssignment[],
): ElkNode {
  const nodeOptions: LayoutOptions = {
    [ELK_OPTIONS.nodeLabelsPlacement]:
      node.orientation === "top-to-bottom"
        ? "INSIDE H_LEFT V_TOP"
        : "INSIDE H_CENTER V_TOP",
    [ELK_OPTIONS.portConstraints]: "FIXED_POS",
    [ELK_OPTIONS.portLabelsPlacement]: hasLabeledZeroIncidencePort(graph, node)
      ? "OUTSIDE ALWAYS_SAME_SIDE"
      : "OUTSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE",
    ...(node.boundaryConstraint === undefined
      ? {}
      : { [ELK_OPTIONS.layerConstraint]: node.boundaryConstraint }),
  };
  const ports = sortedLeafPorts(graph, node);
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    layoutOptions: assignedOptions(node.id, assignments, {
      targetKind: "node",
      options: nodeOptions,
    }),
    labels: [
      ...offViewAdapterLabels(node),
      ...node.labels
        .filter(
          (label) =>
            label.ownerId === node.id &&
            (label.role === "function" ||
              label.role === "aggregate" ||
              label.role === "rail"),
        )
        .sort(comparePresentationLabel)
        .map((label) => leafHeaderLabel(node, label, assignments)),
    ],
    ports: ports.map((port, index) =>
      adapterPort(node, port, index, assignments),
    ),
  };
}

function junctionNode(
  graph: PresentationGraph,
  node: JunctionPresentationNode,
  assignments: ElkOptionAssignment[],
): ElkNode {
  const ports = sortedPorts(graph, node.ports);
  const ink = contextJunctionInk(graph, node);
  return {
    id: node.id,
    width: ink.width,
    height: ink.height,
    layoutOptions: assignedOptions(node.id, assignments, {
      targetKind: "node",
      options: { [ELK_OPTIONS.portConstraints]: "FIXED_POS" },
    }),
    ...(ink.labels.length
      ? {
          labels: ink.labels.map(({ label, x, y }) => ({
            ...adapterLabel(label),
            x,
            y,
            layoutOptions: assignedOptions(label.id, assignments, {
              targetKind: "node-label",
              options: { [ELK_OPTIONS.nodeLabelsPlacement]: "INSIDE" },
            }),
          })),
        }
      : {}),
    ports: ports.map((port, index) => ({
      id: port.id,
      x: ink.anchor.x,
      y: ink.anchor.y,
      width: 0,
      height: 0,
      layoutOptions: assignedOptions(port.id, assignments, {
        targetKind: "port",
        options: {
          [ELK_OPTIONS.portSide]: uppercaseSide(port.side),
          [ELK_OPTIONS.portIndex]: String(index),
          [ELK_OPTIONS.portBorderOffset]: String(
            portBorderOffset(port.side, ink.anchor, ink.width, ink.height),
          ),
        },
      }),
      labels: [],
    })),
  };
}

function nodeAdapter(
  graph: PresentationGraph,
  node: PresentationNode,
  assignments: ElkOptionAssignment[],
): ElkNode {
  return node.kind === "junction"
    ? junctionNode(graph, node, assignments)
    : leafNode(graph, node, assignments);
}

function compoundOptions(
  id: string,
  label: PresentationLabel,
  kind: "location" | "device",
  containsPortBearingLeaves: boolean,
  assignments: ElkOptionAssignment[],
  verticalPower: boolean,
): LayoutOptions {
  const isLocation = kind === "location";
  const minimumWidth = Math.max(isLocation ? 32 : 16, label.width + 16);
  const parentOptions: LayoutOptions = {
    ...PARENT_SPACING_OPTIONS,
    ...(verticalPower
      ? { [ELK_OPTIONS.edgeNodeSpacing]: VERTICAL_POWER_EDGE_NODE_SPACING }
      : {}),
    [ELK_OPTIONS.padding]: paddingValue(
      isLocation ? LOCATION_PADDING : DEVICE_PADDING,
    ),
    [ELK_OPTIONS.nodeLabelsPadding]: paddingValue(
      isLocation ? LOCATION_LABEL_PADDING : DEVICE_LABEL_PADDING,
    ),
    ...(containsPortBearingLeaves
      ? {
          [ELK_OPTIONS.labelPortHorizontalSpacing]: String(
            LABEL_PORT_HORIZONTAL_SPACING,
          ),
          [ELK_OPTIONS.labelPortVerticalSpacing]: String(
            LABEL_PORT_VERTICAL_SPACING,
          ),
        }
      : {}),
  };
  const nodeOptions: LayoutOptions = {
    [ELK_OPTIONS.nodeLabelsPlacement]: "INSIDE H_LEFT V_TOP",
    [ELK_OPTIONS.nodeSizeConstraints]: "NODE_LABELS MINIMUM_SIZE",
    [ELK_OPTIONS.nodeSizeMinimum]: minimumSizeValue(
      minimumWidth,
      isLocation ? 54 : 38,
    ),
  };
  return assignedOptions(
    id,
    assignments,
    { targetKind: "parent", options: parentOptions },
    { targetKind: "node", options: nodeOptions },
  );
}

function deviceRank(graph: PresentationGraph, group: DeviceGroup): number {
  return Math.min(
    ...graph.nodes
      .filter(
        (node): node is SymbolPresentationNode =>
          node.kind === "symbol" && node.parentId === group.id,
      )
      .map((node) => PRESENTATION_CLASS_RANK[node.classification]),
  );
}

function sortedDeviceGroups(
  graph: PresentationGraph,
  locationId: string,
): readonly DeviceGroup[] {
  return graph.deviceGroups
    .filter(({ parentId }) => parentId === locationId)
    .sort(
      (left, right) =>
        deviceRank(graph, left) - deviceRank(graph, right) ||
        compareText(left.designation, right.designation),
    );
}

function deviceNode(
  graph: PresentationGraph,
  group: DeviceGroup,
  assignments: ElkOptionAssignment[],
  order: SemanticOrder,
): ElkNode {
  const children = graph.nodes
    .filter(({ parentId }) => parentId === group.id)
    .sort((left, right) => compareAdapterNodes(graph, left, right, order));
  const containsPortBearingLeaves = children.some(
    (node) => node.kind === "symbol" && node.ports.length > 0,
  );
  return {
    id: group.id,
    layoutOptions: compoundOptions(
      group.id,
      group.label,
      "device",
      containsPortBearingLeaves,
      assignments,
      verticalPowerLanes(graph),
    ),
    labels: [adapterLabel(group.label)],
    children: children.map((node) => nodeAdapter(graph, node, assignments)),
  };
}

function locationNode(
  graph: PresentationGraph,
  group: LocationGroup,
  assignments: ElkOptionAssignment[],
  order: SemanticOrder,
): ElkNode {
  const deviceChildren = sortedDeviceGroups(graph, group.id).map((device) =>
    deviceNode(graph, device, assignments, order),
  );
  const junctionChildren = graph.nodes
    .filter(
      (node): node is JunctionPresentationNode =>
        node.kind === "junction" && node.parentId === group.id,
    )
    .sort((left, right) => compareAdapterNodes(graph, left, right, order))
    .map((node) => junctionNode(graph, node, assignments));
  return {
    id: group.id,
    layoutOptions: compoundOptions(
      group.id,
      group.label,
      "location",
      false,
      assignments,
      verticalPowerLanes(graph),
    ),
    labels: [adapterLabel(group.label)],
    children: [...deviceChildren, ...junctionChildren],
  };
}

function compareElementLists(
  order: SemanticOrder,
  left: PresentationEdge,
  right: PresentationEdge,
): number {
  for (
    let i = 0;
    i < Math.min(left.elementIds.length, right.elementIds.length);
    i++
  ) {
    const compared = compareSemanticElementIds(
      order,
      left.elementIds[i]!,
      right.elementIds[i]!,
    );
    if (compared) return compared;
  }
  return left.elementIds.length - right.elementIds.length;
}

function sortedEdges(
  graph: PresentationGraph,
  order: SemanticOrder,
): readonly PresentationEdge[] {
  const designationFor = designationLookup(graph);
  const netDisplay = new Map<string, string>();
  const semanticNets = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.netLabel !== undefined)
      netDisplay.set(edge.netId, edge.netLabel.text);
    {
      const terminals = semanticNets.get(edge.netId) ?? new Set<string>();
      edge.endpoints.forEach((t) =>
        terminals.add(
          JSON.stringify([designationFor(t.deviceUid), t.terminalKey]),
        ),
      );
      semanticNets.set(edge.netId, terminals);
    }
  }
  const netKeys = new Map(
    [...semanticNets].map(([id, terminals]) => [
      id,
      JSON.stringify([...terminals].sort(compareText)),
    ]),
  );
  const netKey = (id: string) => netKeys.get(id)!;
  return [...graph.edges].sort(
    (left, right) =>
      compareText(
        netDisplay.get(left.netId) ?? netKey(left.netId),
        netDisplay.get(right.netId) ?? netKey(right.netId),
      ) ||
      compareText(netKey(left.netId), netKey(right.netId)) ||
      left.pathRank - right.pathRank ||
      compareElementLists(order, left, right) ||
      compareTerminalId(
        left.endpoints[0],
        right.endpoints[0],
        designationFor,
      ) ||
      compareTerminalId(
        left.endpoints[1],
        right.endpoints[1],
        designationFor,
      ) ||
      order.compare(left.sourcePortId, right.sourcePortId) ||
      order.compare(left.targetPortId, right.targetPortId),
  );
}

function edgeAdapter(
  edge: PresentationEdge,
  prioritizeDirection: boolean,
  assignments: ElkOptionAssignment[],
  recovery?: RootedRecovery,
): ElkExtendedEdge {
  const labels = [edge.label, edge.netLabel]
    .filter((label): label is PresentationLabel => label !== undefined)
    .sort(comparePresentationLabel)
    .map((label): ElkLabel & { id: string } => ({
      ...adapterLabel(label),
      layoutOptions: assignedOptions(label.id, assignments, {
        targetKind: "edge-label",
        options: {
          [ELK_OPTIONS.edgeLabelsPlacement]:
            label.role === "net"
              ? recovery !== "trace-order" && recovery?.has(label.id)
                ? "HEAD"
                : "TAIL"
              : "CENTER",
          [ELK_OPTIONS.edgeLabelsInline]: "false",
        },
      }),
    }));
  return {
    id: edge.id,
    sources: [edge.sourcePortId],
    targets: [edge.targetPortId],
    labels,
    ...(prioritizeDirection
      ? {
          layoutOptions: assignedOptions(edge.id, assignments, {
            targetKind: "edge",
            options: { [ELK_OPTIONS.priorityDirection]: "2" },
          }),
        }
      : {}),
  };
}

function pnpTraceFirstSignalEdgeId(
  graph: PresentationGraph,
): string | undefined {
  if (
    graph.view.format !== "schematic-view/0.2" ||
    graph.view.intent !== "trace" ||
    graph.view.root.kind !== "device" ||
    !("deviceUid" in graph.view.root)
  ) {
    return undefined;
  }
  const rootDeviceUid = graph.view.root.deviceUid;
  const root = graph.nodes.find(
    (node): node is SymbolPresentationNode =>
      node.kind === "symbol" &&
      node.deviceUid === rootDeviceUid &&
      node.symbolId === "ais:switch-sensor-pnp",
  );
  if (root === undefined) return undefined;
  const signalPort = root.ports.find(
    ({ symbolPortId }) => symbolPortId === "signal",
  );
  invariant(signalPort !== undefined, "PNP trace root signal port");
  const incidentSignalEdges = graph.edges.filter(
    (edge) =>
      edge.sourcePortId === signalPort.id ||
      edge.targetPortId === signalPort.id,
  );
  invariant(
    incidentSignalEdges.length === 1,
    "PNP trace root signal attachment",
  );
  const signalAttachment = incidentSignalEdges[0]!;
  if (signalAttachment.kind === "conductor") return signalAttachment.id;

  const junctionPortId =
    signalAttachment.sourcePortId === signalPort.id
      ? signalAttachment.targetPortId
      : signalAttachment.sourcePortId;
  const junctionOwners = graph.nodes.filter(
    (node): node is JunctionPresentationNode =>
      node.kind === "junction" &&
      node.ports.some(({ id }) => id === junctionPortId),
  );
  invariant(
    junctionOwners.length === 1,
    "PNP trace root signal attachment junction",
  );
  const junction = junctionOwners[0]!;
  invariant(
    signalAttachment.netId === signalPort.netId &&
      junction.netId === signalPort.netId &&
      junction.terminal.deviceUid === signalPort.terminal.deviceUid &&
      junction.terminal.terminalKey === signalPort.terminal.terminalKey,
    "PNP trace root signal attachment identity",
  );

  const ownerByPortId = new Map(
    graph.nodes.flatMap((node) =>
      node.ports.map((port) => [port.id, node] as const),
    ),
  );
  const componentById = new Map<string, JunctionPresentationNode>();
  const pending = [junction];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (componentById.has(current.id)) continue;
    componentById.set(current.id, current);
    const portIds = new Set(current.ports.map(({ id }) => id));
    for (const edge of graph.edges) {
      if (edge.kind !== "boundary-segment") continue;
      const localSource = portIds.has(edge.sourcePortId);
      const localTarget = portIds.has(edge.targetPortId);
      if (localSource === localTarget) continue;
      const other = ownerByPortId.get(
        localSource ? edge.targetPortId : edge.sourcePortId,
      );
      if (
        other?.kind === "junction" &&
        other.netId === junction.netId &&
        other.terminal.deviceUid === junction.terminal.deviceUid &&
        other.terminal.terminalKey === junction.terminal.terminalKey
      ) {
        pending.push(other);
      }
    }
  }
  const componentPortIds = new Set(
    [...componentById.values()].flatMap((node) =>
      node.ports.map(({ id }) => id),
    ),
  );
  const componentEdges = graph.edges.filter(
    (edge) =>
      componentPortIds.has(edge.sourcePortId) ||
      componentPortIds.has(edge.targetPortId),
  );
  const attachmentEdges = componentEdges.filter(
    (edge) =>
      edge.kind === "boundary-segment" &&
      componentPortIds.has(edge.sourcePortId) !==
        componentPortIds.has(edge.targetPortId),
  );
  const firstSignalConductors = componentEdges.filter(
    (edge) => edge.kind === "conductor",
  );
  invariant(
    attachmentEdges.length === 1 &&
      attachmentEdges[0]!.id === signalAttachment.id &&
      firstSignalConductors.length >= 2 &&
      componentEdges.reduce(
        (count, edge) =>
          count +
          Number(componentPortIds.has(edge.sourcePortId)) +
          Number(componentPortIds.has(edge.targetPortId)),
        0,
      ) === componentPortIds.size &&
      firstSignalConductors.every(
        (edge) =>
          edge.elementIds.length === 1 &&
          edge.netId === signalPort.netId &&
          componentPortIds.has(edge.sourcePortId) !==
            componentPortIds.has(edge.targetPortId),
      ) &&
      [...componentPortIds].every(
        (id) =>
          componentEdges.filter(
            (edge) => edge.sourcePortId === id || edge.targetPortId === id,
          ).length === 1,
      ),
    "PNP trace root first signal conductor fan-out",
  );
  const orderedSignalConductors = firstSignalConductors.map((edge) => {
    const portId = componentPortIds.has(edge.sourcePortId)
      ? edge.sourcePortId
      : edge.targetPortId;
    const owner = ownerByPortId.get(portId);
    const port = owner?.ports.find(({ id }) => id === portId);
    invariant(port !== undefined, "PNP trace root signal conductor port");
    const match = /^conductor-(0|[1-9][0-9]*)$/.exec(port.symbolPortId);
    invariant(match !== null, "PNP trace signal conductor stable rank");
    return { edge, rank: Number(match[1]) };
  });
  invariant(
    [...orderedSignalConductors]
      .sort((left, right) => left.rank - right.rank)
      .every(({ rank }, index) => rank === index),
    "PNP trace root signal conductor order",
  );
  const firstSignalConductor = orderedSignalConductors.sort(
    (left, right) => left.rank - right.rank,
  )[0]?.edge;
  invariant(
    firstSignalConductor !== undefined,
    "PNP trace root stable first signal conductor",
  );
  return firstSignalConductor.id;
}

export function buildElkAdapterGraph(
  graph: Readonly<PresentationGraph>,
  _selected?: Readonly<SelectedSubgraph>,
  recovery?: RootedRecovery,
): ElkAdapterBuild {
  invariant(
    graph.format === "schematic-presentation/0.1",
    "wrong graph format",
  );
  const assignments: ElkOptionAssignment[] = [];
  const order = graphSemanticOrder(graph);
  const locationChildren = [...graph.locationGroups]
    .sort((left, right) =>
      compareLocationIdentity(left.identity, right.identity),
    )
    .map((group) => locationNode(graph, group, assignments, order));
  const rootLeafChildren = graph.nodes
    .filter(({ parentId }) => parentId === "root")
    .sort((left, right) => compareAdapterNodes(graph, left, right, order))
    .map((node) => nodeAdapter(graph, node, assignments));
  const hasRootPortLabels = graph.nodes.some(
    (node) =>
      node.kind === "rail" &&
      node.parentId === "root" &&
      node.labels.some(({ role }) => role === "terminal"),
  );
  const rootOptions = {
    ...rootLayoutOptions(graph.view.flow),
    ...(recovery === "trace-order"
      ? { [ELK_OPTIONS.considerModelOrderStrategy]: "NONE" }
      : {}),
    ...(verticalPowerLanes(graph)
      ? { [ELK_OPTIONS.edgeNodeSpacing]: VERTICAL_POWER_EDGE_NODE_SPACING }
      : {}),
    ...(hasRootPortLabels
      ? {
          [ELK_OPTIONS.labelPortHorizontalSpacing]: String(
            LABEL_PORT_HORIZONTAL_SPACING,
          ),
          [ELK_OPTIONS.labelPortVerticalSpacing]: String(
            LABEL_PORT_VERTICAL_SPACING,
          ),
        }
      : {}),
  };
  const prioritizedEdgeId = pnpTraceFirstSignalEdgeId(graph);
  const edges = sortedEdges(graph, order);
  const adapter: ElkNode = {
    id: "root",
    layoutOptions: assignedOptions("root", assignments, {
      targetKind: "parent",
      options: rootOptions,
    }),
    children: [...locationChildren, ...rootLeafChildren],
    edges: edges
      .filter((edge) => !terminalContextAttachment(graph, edge))
      .map((edge) =>
        edgeAdapter(edge, edge.id === prioritizedEdgeId, assignments, recovery),
      ),
  };
  return Object.freeze({
    graph: adapter,
    optionAssignments: sortOptionAssignments(assignments),
  });
}
