import type {
  ELK as ElkApi,
  ElkExtendedEdge,
  ElkLabel,
  ElkNode,
  ElkPort,
  LayoutOptions,
} from "elkjs/lib/elk-api.js";

import { compareConductiveElementId } from "@thermite/compiler";

import {
  compareLocationIdentity,
  comparePresentationLabel,
  comparePresentationNode,
  comparePresentationPort,
  compareTerminalId,
  compareText,
  PRESENTATION_CLASS_RANK,
} from "../ordering.js";
import { SYMBOL_CATALOG } from "../symbols/catalog.js";
import type { SymbolDefinition, SymbolSide } from "../symbols/types.js";
import type {
  DeviceGroup,
  JunctionPresentationNode,
  LocationGroup,
  NormalizedSchematicLayout,
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  PresentationNode,
  PresentationPort,
  RailPresentationNode,
  RenderOutcome,
  SelectedSubgraph,
  SymbolPresentationNode,
} from "../types.js";
import { createElkEngine } from "./elk-runtime.js";
import {
  DEVICE_LABEL_PADDING,
  DEVICE_PADDING,
  ELK_OPTIONS,
  type ElkOptionAssignment,
  type ElkOptionMetadataSnapshot,
  LABEL_PORT_HORIZONTAL_SPACING,
  LABEL_PORT_VERTICAL_SPACING,
  LOCATION_LABEL_PADDING,
  LOCATION_PADDING,
  minimumSizeValue,
  paddingValue,
  PARENT_SPACING_OPTIONS,
  rootLayoutOptions,
  sortOptionAssignments,
  validateOptionAssignmentsAgainstMetadata,
} from "./options.js";
import { normalizeAndValidateLayout } from "./validate-output.js";

export interface ElkAdapterBuild {
  readonly graph: ElkNode;
  readonly optionAssignments: readonly ElkOptionAssignment[];
}

export interface ElkLayoutRequestOptions {
  readonly catalog?: readonly SymbolDefinition[];
  readonly engine?: ElkApi;
  readonly selected?: Readonly<SelectedSubgraph>;
  readonly spacingProfile?: "compact" | "dense";
}

interface OptionGroup {
  readonly targetKind: ElkOptionAssignment["targetKind"];
  readonly options: Readonly<LayoutOptions>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ELK adapter invariant: ${message}`);
}

function quantizedInput(value: number): number {
  invariant(Number.isFinite(value), "adapter geometry must be finite");
  const quantized = Number(value.toFixed(3));
  return Object.is(quantized, -0) ? 0 : quantized;
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
  return {
    ...adapterLabel(label),
    x: quantizedInput(
      vertical
        ? node.kind === "rail"
          ? 5
          : 8
        : (node.width - label.width) / 2,
    ),
    y: node.kind === "rail" ? 5 : 4,
    layoutOptions: assignedOptions(label.id, assignments, {
      targetKind: "node-label",
      options: { [ELK_OPTIONS.nodeLabelsPlacement]: "INSIDE" },
    }),
  };
}

function designationLookup(graph: PresentationGraph): (uid: string) => string {
  const values = new Map<string, string>();
  for (const group of graph.deviceGroups)
    values.set(group.deviceUid, group.designation);
  for (const node of graph.nodes) {
    if (node.kind !== "junction") values.set(node.deviceUid, node.designation);
  }
  return (uid) => values.get(uid) ?? uid;
}

function sortedPorts(
  graph: PresentationGraph,
  ports: readonly PresentationPort[],
): readonly PresentationPort[] {
  const designationFor = designationLookup(graph);
  return [...ports].sort((left, right) =>
    comparePresentationPort(left, right, designationFor),
  );
}

function portPosition(
  node: SymbolPresentationNode | RailPresentationNode,
  port: PresentationPort,
): Readonly<{ x: number; y: number }> {
  const origin = node.primitiveOrigin;
  switch (port.side) {
    case "west":
      return {
        x: quantizedInput(origin.x),
        y: quantizedInput(origin.y + port.offset * node.symbolSize.height),
      };
    case "east":
      return {
        x: quantizedInput(origin.x + node.symbolSize.width),
        y: quantizedInput(origin.y + port.offset * node.symbolSize.height),
      };
    case "north":
      return {
        x: quantizedInput(origin.x + port.offset * node.symbolSize.width),
        y: quantizedInput(origin.y),
      };
    case "south":
      return {
        x: quantizedInput(origin.x + port.offset * node.symbolSize.width),
        y: quantizedInput(origin.y + node.symbolSize.height),
      };
  }
}

function uppercaseSide(side: SymbolSide): string {
  return side.toUpperCase();
}

function portBorderOffset(
  side: SymbolSide,
  position: Readonly<{ x: number; y: number }>,
  width: number,
  height: number,
): number {
  // ELK 0.12 places a side-constrained zero-size port on the node border. A
  // negative border offset keeps the FIXED_POS anchor at the D6 primitive.
  switch (side) {
    case "west":
      return -position.x;
    case "east":
      return -(width - position.x);
    case "north":
      return -position.y;
    case "south":
      return -(height - position.y);
  }
}

function labelsForPort(
  node: SymbolPresentationNode | RailPresentationNode,
  portId: string,
): readonly PresentationLabel[] {
  return node.labels
    .filter((label) => label.ownerKind === "port" && label.ownerId === portId)
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
  graph: PresentationGraph,
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
  const ports = sortedPorts(graph, node.ports);
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    layoutOptions: assignedOptions(node.id, assignments, {
      targetKind: "node",
      options: nodeOptions,
    }),
    labels: node.labels
      .filter(
        (label) =>
          label.ownerId === node.id &&
          (label.role === "function" ||
            label.role === "aggregate" ||
            label.role === "rail"),
      )
      .sort(comparePresentationLabel)
      .map((label) => leafHeaderLabel(node, label, assignments)),
    ports: ports.map((port, index) =>
      adapterPort(graph, node, port, index, assignments),
    ),
  };
}

function junctionNode(
  graph: PresentationGraph,
  node: JunctionPresentationNode,
  assignments: ElkOptionAssignment[],
): ElkNode {
  const ports = sortedPorts(graph, node.ports);
  return {
    id: node.id,
    width: 6,
    height: 6,
    layoutOptions: assignedOptions(node.id, assignments, {
      targetKind: "node",
      options: { [ELK_OPTIONS.portConstraints]: "FIXED_POS" },
    }),
    ports: ports.map((port, index) => ({
      id: port.id,
      x: 3,
      y: 3,
      width: 0,
      height: 0,
      layoutOptions: assignedOptions(port.id, assignments, {
        targetKind: "port",
        options: {
          [ELK_OPTIONS.portSide]: uppercaseSide(port.side),
          [ELK_OPTIONS.portIndex]: String(index),
          [ELK_OPTIONS.portBorderOffset]: "-3",
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
): LayoutOptions {
  const isLocation = kind === "location";
  const minimumWidth = Math.max(isLocation ? 32 : 16, label.width + 16);
  const parentOptions: LayoutOptions = {
    ...PARENT_SPACING_OPTIONS,
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
        compareText(left.designation, right.designation) ||
        compareText(left.deviceUid, right.deviceUid),
    );
}

function deviceNode(
  graph: PresentationGraph,
  group: DeviceGroup,
  assignments: ElkOptionAssignment[],
): ElkNode {
  const children = graph.nodes
    .filter(({ parentId }) => parentId === group.id)
    .sort(comparePresentationNode);
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
    ),
    labels: [adapterLabel(group.label)],
    children: children.map((node) => nodeAdapter(graph, node, assignments)),
  };
}

function locationNode(
  graph: PresentationGraph,
  group: LocationGroup,
  assignments: ElkOptionAssignment[],
): ElkNode {
  const deviceChildren = sortedDeviceGroups(graph, group.id).map((device) =>
    deviceNode(graph, device, assignments),
  );
  const junctionChildren = graph.nodes
    .filter(
      (node): node is JunctionPresentationNode =>
        node.kind === "junction" && node.parentId === group.id,
    )
    .sort(comparePresentationNode)
    .map((node) => junctionNode(graph, node, assignments));
  return {
    id: group.id,
    layoutOptions: compoundOptions(
      group.id,
      group.label,
      "location",
      false,
      assignments,
    ),
    labels: [adapterLabel(group.label)],
    children: [...deviceChildren, ...junctionChildren],
  };
}

function compareElementLists(
  left: PresentationEdge,
  right: PresentationEdge,
): number {
  const count = Math.min(left.elementIds.length, right.elementIds.length);
  for (let index = 0; index < count; index++) {
    const compared = compareConductiveElementId(
      left.elementIds[index]!,
      right.elementIds[index]!,
    );
    if (compared !== 0) return compared;
  }
  return left.elementIds.length - right.elementIds.length;
}

function sortedEdges(graph: PresentationGraph): readonly PresentationEdge[] {
  const designationFor = designationLookup(graph);
  const netDisplay = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.netLabel !== undefined)
      netDisplay.set(edge.netId, edge.netLabel.text);
  }
  return [...graph.edges].sort(
    (left, right) =>
      compareText(
        netDisplay.get(left.netId) ?? left.netId,
        netDisplay.get(right.netId) ?? right.netId,
      ) ||
      compareText(left.netId, right.netId) ||
      left.pathRank - right.pathRank ||
      compareElementLists(left, right) ||
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
      compareText(left.sourcePortId, right.sourcePortId) ||
      compareText(left.targetPortId, right.targetPortId) ||
      compareText(left.id, right.id),
  );
}

function edgeAdapter(
  edge: PresentationEdge,
  prioritizeDirection: boolean,
  assignments: ElkOptionAssignment[],
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
            label.role === "net" ? "TAIL" : "CENTER",
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
  selected?: Readonly<SelectedSubgraph>,
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
      node.typeId === "core:prox-pnp-3wire",
  );
  if (root === undefined) return undefined;
  if (selected !== undefined) {
    const signalPaths = selected.paths.filter(({ lane }) => lane === "signal");
    invariant(signalPaths.length === 1, "PNP trace selected signal path");
    const first = signalPaths[0]!.steps.find(
      (step) => step.kind === "conductor",
    );
    invariant(first?.kind === "conductor", "PNP trace first signal conductor");
    const matches = graph.edges.filter(
      (edge) =>
        edge.kind === "conductor" &&
        edge.elementIds.length === 1 &&
        compareConductiveElementId(edge.elementIds[0]!, first.elementId) === 0,
    );
    invariant(matches.length === 1, "PNP trace first signal edge identity");
    return matches[0]!.id;
  }
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
      componentEdges.length === componentPortIds.size &&
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
    (left, right) =>
      left.rank - right.rank || compareText(left.edge.id, right.edge.id),
  )[0]?.edge;
  invariant(
    firstSignalConductor !== undefined,
    "PNP trace root stable first signal conductor",
  );
  return firstSignalConductor.id;
}

export function buildElkAdapterGraph(
  graph: Readonly<PresentationGraph>,
  selected?: Readonly<SelectedSubgraph>,
): ElkAdapterBuild {
  invariant(
    graph.format === "schematic-presentation/0.1",
    "wrong graph format",
  );
  const assignments: ElkOptionAssignment[] = [];
  const locationChildren = [...graph.locationGroups]
    .sort((left, right) =>
      compareLocationIdentity(left.identity, right.identity),
    )
    .map((group) => locationNode(graph, group, assignments));
  const rootLeafChildren = graph.nodes
    .filter(({ parentId }) => parentId === "root")
    .sort(comparePresentationNode)
    .map((node) => nodeAdapter(graph, node, assignments));
  const hasRootPortLabels = graph.nodes.some(
    (node) =>
      node.kind === "rail" &&
      node.parentId === "root" &&
      node.labels.some(({ role }) => role === "terminal"),
  );
  const rootOptions = {
    ...rootLayoutOptions(graph.view.flow),
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
  const prioritizedEdgeId = pnpTraceFirstSignalEdgeId(graph, selected);
  const edges = sortedEdges(graph);
  const adapter: ElkNode = {
    id: "root",
    layoutOptions: assignedOptions("root", assignments, {
      targetKind: "parent",
      options: rootOptions,
    }),
    children: [...locationChildren, ...rootLeafChildren],
    edges: edges.map((edge) =>
      edgeAdapter(edge, edge.id === prioritizedEdgeId, assignments),
    ),
  };
  return Object.freeze({
    graph: adapter,
    optionAssignments: sortOptionAssignments(assignments),
  });
}

export async function validateElkRuntimeOptions(
  build: Readonly<ElkAdapterBuild>,
  engine: ElkApi = createElkEngine(),
): Promise<readonly ElkOptionMetadataSnapshot[]> {
  const targets: Record<ElkOptionAssignment["targetKind"], Set<string>> = {
    parent: new Set([build.graph.id]),
    node: new Set(),
    port: new Set(),
    "node-label": new Set(),
    edge: new Set(),
    "edge-label": new Set(),
  };
  const visit = (node: Readonly<ElkNode>): void => {
    if (node.id !== build.graph.id) targets.node.add(node.id);
    if (node.children !== undefined) targets.parent.add(node.id);
    for (const port of node.ports ?? []) targets.port.add(port.id);
    for (const label of node.labels ?? []) {
      invariant(typeof label.id === "string", `node ${node.id} label ID`);
      targets["node-label"].add(label.id);
    }
    for (const edge of node.edges ?? []) {
      targets.edge.add(edge.id);
      for (const label of edge.labels ?? []) {
        invariant(typeof label.id === "string", `edge ${edge.id} label ID`);
        targets["edge-label"].add(label.id);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(build.graph);
  for (const assignment of build.optionAssignments) {
    invariant(
      targets[assignment.targetKind].has(assignment.targetId),
      `${assignment.option} targets non-${assignment.targetKind} ${assignment.targetId}`,
    );
  }
  return validateOptionAssignmentsAgainstMetadata(
    await engine.knownLayoutOptions(),
    build.optionAssignments,
  );
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

export function serializeElkAdapterForTest(
  build: Readonly<ElkAdapterBuild>,
): string {
  return JSON.stringify(
    canonicalSerializable({
      graph: build.graph,
      optionAssignments: build.optionAssignments,
    }),
    undefined,
    2,
  );
}

export async function layoutPresentationGraph(
  graph: Readonly<PresentationGraph>,
  options: Readonly<ElkLayoutRequestOptions> = {},
): Promise<RenderOutcome<NormalizedSchematicLayout>> {
  const catalog = options.catalog ?? SYMBOL_CATALOG;
  const engine = options.engine ?? createElkEngine();
  const build = buildElkAdapterGraph(graph, options.selected);
  await validateElkRuntimeOptions(build, engine);
  const input = structuredClone(build.graph);
  if (options.spacingProfile) {
    const dense = options.spacingProfile === "dense";
    const compact = (node: ElkNode): void => {
      if (node.children?.length) {
        node.layoutOptions = {
          ...node.layoutOptions,
          [ELK_OPTIONS.nodeNodeSpacing]: dense ? "12" : "18",
          [ELK_OPTIONS.nodeNodeBetweenLayersSpacing]: dense ? "20" : "40",
          [ELK_OPTIONS.edgeNodeSpacing]: dense ? "10" : "12",
          [ELK_OPTIONS.componentComponentSpacing]: dense ? "16" : "24",
        };
        node.children.forEach(compact);
      }
    };
    compact(input);
  }
  const output = await engine.layout(input);
  return normalizeAndValidateLayout(graph, build.graph, output, catalog);
}
