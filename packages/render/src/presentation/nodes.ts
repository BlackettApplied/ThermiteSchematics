import {
  contactCaptionWidth,
  verticalContactCaption,
} from "./contact-caption.js";
import type {
  PresentationContext,
  SymbolRepresentation,
  BoundaryRecord,
  PresentationGroups,
  SelectedEndpointFacts,
} from "./model.js";
import type {
  BoundaryConstraint,
  SymbolPresentationNode,
  PresentationPort,
  SemanticAttachment,
  PresentationLabel,
  SchematicFlow,
  RailPresentationNode,
  SelectedBoundary,
} from "../types.js";
import {
  symbolCaption,
  leafGeometry,
  representationBoundaryConstraint,
  semanticAttachmentKind,
  connectedTerminalPortHasLabel,
  netForTerminal,
  boundaryTextSources,
  collapsedFunctionIds,
} from "./node-labels.js";
import {
  cloneFunction,
  required,
  orientationFor,
  orderedPowerLanes,
  cloneTerminal,
  labelWidth,
  orientedSide,
  presentationLabel,
  textSource,
} from "./util.js";
import {
  comparePresentationLabel,
  terminalIdKey,
  comparePresentationPort,
  structuralTupleId,
  compareText,
  comparePresentationNode,
} from "../ordering.js";
import type {
  SymbolSide,
  SymbolDefinition,
  SymbolPortDefinition,
  SymbolPortBinding,
} from "../symbols/types.js";
import {
  representationBindings,
  representationIsCompleteSourceBoundary,
  addImplicitTerminalRepresentations,
} from "./context.js";
import { compareCompleteTerminal, designationFor } from "./util.js";
import type { AggregateSymbolRule } from "../symbols/mappings.js";
import type { FunctionId, IrDevice } from "@thermite/compiler";
import type { SemanticOrder } from "../semantic-order.js";
import type { UnsupportedSymbolMappingError } from "../errors.js";
import { buildGroups } from "./groups.js";

function buildSymbolNode(
  context: PresentationContext,
  representation: SymbolRepresentation,
  _boundaries: ReadonlyMap<string, BoundaryRecord>,
  constraints: ReadonlyMap<string, BoundaryConstraint>,
  groups: PresentationGroups,
): SymbolPresentationNode {
  const { symbol, orientation, deviceGroup, locationGroup } = symbolNodeContext(
    context,
    representation,
    groups,
  );
  const { nodeLabel, printableText } = symbolCaption(
    context,
    representation,
    symbol,
  );
  const { ports, labels } = buildSymbolPorts(
    symbol,
    nodeLabel,
    printableText,
    representation,
    orientation,
    context,
  );
  const orderedPower = orderedPowerLanes(context.selected);
  const caption = required(labels[0], "Missing symbol caption.");
  const geometry = leafGeometry(
    symbol,
    orientation,
    orderedPower ? caption : nodeLabel,
    caption,
    orderedPower,
  );
  const attachments = buildSymbolAttachments(context, representation, ports);
  const boundaryConstraint = representationBoundaryConstraint(
    representation,
    constraints,
  );
  return {
    kind: "symbol",
    representation: representation.kind,
    id: representation.id,
    deviceUid: representation.device.uid,
    designation: representation.device.designation,
    typeId: representation.device.typeId,
    functionIds: representation.functionIds.map(cloneFunction),
    symbolId: representation.rule.symbolId,
    classification: representation.rule.classification,
    parentId: deviceGroup.id,
    ...(boundaryConstraint === undefined ? {} : { boundaryConstraint }),
    locationGroupId: locationGroup.id,
    deviceGroupId: deviceGroup.id,
    orientation,
    symbolSize: geometry.symbolSize,
    width: geometry.width,
    height: geometry.height,
    primitiveOrigin: geometry.primitiveOrigin,
    ports,
    attachments,
    labels: labels.sort(comparePresentationLabel),
  };
}

function symbolNodeContext(
  context: PresentationContext,
  representation: SymbolRepresentation,
  groups: PresentationGroups,
) {
  const symbol = required(
    context.symbolById.get(representation.rule.symbolId),
    `Presentation symbol ${representation.rule.symbolId} is missing.`,
  );
  const deviceGroup = required(
    groups.deviceByUid.get(representation.device.uid),
    `Presentation device group ${representation.device.uid} is missing.`,
  );
  const locationGroup = required(
    groups.locationByDeviceUid.get(representation.device.uid),
    `Presentation location group ${representation.device.uid} is missing.`,
  );
  const orientation = orientationFor(context.selected);
  return { symbol, orientation, deviceGroup, locationGroup };
}

function buildSymbolAttachments(
  context: PresentationContext,
  representation: SymbolRepresentation,
  ports: {
    netId: string;
    side: SymbolSide;
    offset: number;
    order: number;
    label: string;
    memberFunctionId?: { deviceUid: string; functionKey: string };
    id: string;
    symbolPortId: string;
    terminal: { deviceUid: string; terminalKey: string };
  }[],
) {
  const attachmentKind = semanticAttachmentKind(context, representation);
  const portsByTerminal = new Map<string, PresentationPort[]>();
  for (const port of ports) {
    const key = terminalIdKey(port.terminal);
    portsByTerminal.set(key, [...(portsByTerminal.get(key) ?? []), port]);
  }
  const attachments = [...portsByTerminal.values()]
    .map((terminalPorts): SemanticAttachment => ({
      kind: attachmentKind,
      nodeId: representation.id,
      terminal: cloneTerminal((terminalPorts[0] as PresentationPort).terminal),
      netId: (terminalPorts[0] as PresentationPort).netId,
      portIds: terminalPorts.map(({ id }) => id),
    }))
    .sort((left, right) =>
      compareCompleteTerminal(context, left.terminal, right.terminal),
    );
  return attachments;
}

function buildSymbolPorts(
  symbol: SymbolDefinition,
  nodeLabel: PresentationLabel,
  printableText: string,
  representation: SymbolRepresentation,
  orientation: SchematicFlow,
  context: PresentationContext,
) {
  const portDefinitionById = new Map(
    symbol.ports.map((definition) => [definition.id, definition]),
  );
  const printedLabel = { ...nodeLabel, printableText };
  const captionWidth = verticalContactCaption(
    orientation,
    printedLabel,
    symbol.id,
  )
    ? contactCaptionWidth(printedLabel)
    : orderedPowerLanes(context.selected)
      ? labelWidth(printableText)
      : Math.max(nodeLabel.width, labelWidth(printableText));
  const labels: PresentationLabel[] = [
    {
      ...nodeLabel,
      printableText,
      width: captionWidth,
      textLength: Number((captionWidth - 6).toFixed(3)),
    },
  ];
  const ports = mapSymbolPorts(
    representation,
    portDefinitionById,
    orientation,
    context,
    symbol,
    labels,
  );
  ports.sort((left, right) =>
    comparePresentationPort(left, right, (deviceUid) =>
      designationFor(context, deviceUid),
    ),
  );
  return { ports, labels };
}

function mapSymbolPorts(
  representation: SymbolRepresentation,
  portDefinitionById: Map<string, SymbolPortDefinition>,
  orientation: SchematicFlow,
  context: PresentationContext,
  symbol: SymbolDefinition,
  labels: PresentationLabel[],
) {
  return representationBindings(representation).map((binding) => {
    const { definition, terminal } = buildSymbolPort(
      portDefinitionById,
      binding,
      representation,
    );
    const memberFunctionId =
      representation.kind === "terminal"
        ? undefined
        : {
            deviceUid: representation.device.uid,
            functionKey:
              representation.kind === "aggregate"
                ? (binding as AggregateSymbolRule["bindings"][number])
                    .memberFunctionKey
                : (representation.functionIds[0] as FunctionId).functionKey,
          };
    const transformed = orientedSide(
      definition.side,
      definition.offset,
      orientation,
      symbol.id,
    );
    const id = structuralTupleId("port", representation.id, definition.id);
    const terminalLabel = presentationLabel(
      "port",
      id,
      "terminal",
      terminal.terminalKey,
      [
        textSource(
          "terminal",
          [terminal.deviceUid, terminal.terminalKey, definition.id],
          "terminal.key",
          terminal.terminalKey,
        ),
      ],
    );
    if (
      connectedTerminalPortHasLabel(context, symbol, terminal, definition.id)
    ) {
      labels.push(terminalLabel);
    }
    return {
      id,
      symbolPortId: definition.id,
      terminal,
      ...(memberFunctionId === undefined ? {} : { memberFunctionId }),
      netId: netForTerminal(context, terminal),
      side: transformed.side,
      offset: transformed.offset,
      order: definition.order,
      label: terminal.terminalKey,
    };
  });
}

function buildSymbolPort(
  portDefinitionById: Map<string, SymbolPortDefinition>,
  binding: SymbolPortBinding & { readonly memberFunctionKey?: string },
  representation: SymbolRepresentation,
) {
  const definition: SymbolPortDefinition = required(
    portDefinitionById.get(binding.portId),
    `Presentation binding ${binding.portId} has no symbol port.`,
  );
  const terminal = {
    deviceUid: representation.device.uid,
    terminalKey: binding.terminalKey,
  };
  return { definition, terminal };
}

function buildRailNode(
  context: PresentationContext,
  record: BoundaryRecord,
  representations: readonly SymbolRepresentation[],
): RailPresentationNode {
  const { device, boundary, definition, orientation, symbol, symbolId } =
    railNodeContext(record, context);
  const id = structuralTupleId(
    "rail",
    device.uid,
    boundary.terminal.terminalKey,
    boundary.kind,
  );
  const railLabel = presentationLabel(
    "rail",
    id,
    "rail",
    boundary.label,
    boundaryTextSources(context, boundary),
  );
  const { portId, geometry, port, terminalLabel } = buildRailPort(
    definition,
    orientation,
    id,
    boundary,
    device,
    symbol,
    railLabel,
  );
  const attachment: SemanticAttachment = buildRailAttachment(
    id,
    boundary,
    portId,
  );
  return {
    kind: "rail",
    id,
    parentId: "root",
    boundaryConstraint: record.constraint,
    deviceUid: device.uid,
    designation: device.designation,
    typeId: device.typeId,
    functionIds: collapsedFunctionIds(
      context,
      boundary.terminal,
      representations,
    ),
    symbolId,
    classification: "rail",
    orientation,
    symbolSize: geometry.symbolSize,
    width: geometry.width,
    height: geometry.height,
    primitiveOrigin: geometry.primitiveOrigin,
    boundary: {
      kind: boundary.kind,
      terminal: cloneTerminal(boundary.terminal),
      netId: boundary.netId,
      ...(boundary.potentialUid === undefined
        ? {}
        : { potentialUid: boundary.potentialUid }),
      label: boundary.label,
    },
    ports: [port],
    attachments: [attachment],
    labels: [railLabel, terminalLabel].sort(comparePresentationLabel),
  };
}

function railNodeContext(record: BoundaryRecord, context: PresentationContext) {
  const boundary = record.boundary;
  const device = required(
    context.deviceByUid.get(boundary.terminal.deviceUid),
    `Boundary ${terminalIdKey(boundary.terminal)} has no device.`,
  );
  const symbolId =
    record.constraint === "FIRST"
      ? ("ais:rail-source" as const)
      : ("ais:rail-return" as const);
  const symbol = required(
    context.symbolById.get(symbolId),
    `Rail symbol ${symbolId} is missing.`,
  );
  const definition = required(
    symbol.ports[0],
    `Rail symbol ${symbolId} has no port.`,
  );
  const orientation = orientationFor(context.selected);
  return { device, boundary, definition, orientation, symbol, symbolId };
}

function buildRailAttachment(
  id: string,
  boundary: SelectedBoundary,
  portId: string,
): SemanticAttachment {
  return {
    kind: "collapsed-boundary",
    nodeId: id,
    terminal: cloneTerminal(boundary.terminal),
    netId: boundary.netId,
    portIds: [portId],
  };
}

function buildRailPort(
  definition: SymbolPortDefinition,
  orientation: SchematicFlow,
  id: string,
  boundary: SelectedBoundary,
  device: IrDevice,
  symbol: SymbolDefinition,
  railLabel: PresentationLabel,
) {
  const transformed = orientedSide(
    definition.side,
    definition.offset,
    orientation,
  );
  const portId = structuralTupleId("port", id, definition.id);
  const terminalLabel = presentationLabel(
    "port",
    portId,
    "terminal",
    boundary.terminal.terminalKey,
    [
      textSource(
        "terminal",
        [device.uid, boundary.terminal.terminalKey, definition.id],
        "terminal.key",
        boundary.terminal.terminalKey,
      ),
    ],
  );
  const geometry = leafGeometry(symbol, orientation, railLabel);
  const port: PresentationPort = {
    id: portId,
    symbolPortId: definition.id,
    terminal: cloneTerminal(boundary.terminal),
    netId: boundary.netId,
    side: transformed.side,
    offset: transformed.offset,
    order: definition.order,
    label: boundary.terminal.terminalKey,
  };
  return { portId, geometry, port, terminalLabel };
}

export function attachmentsByTerminal(
  order: SemanticOrder,
  nodes: readonly (SymbolPresentationNode | RailPresentationNode)[],
): ReadonlyMap<string, readonly SemanticAttachment[]> {
  const byTerminal = new Map<string, SemanticAttachment[]>();
  for (const node of nodes) {
    for (const attachment of node.attachments) {
      const key = terminalIdKey(attachment.terminal);
      byTerminal.set(key, [...(byTerminal.get(key) ?? []), attachment]);
    }
  }
  for (const attachments of byTerminal.values()) {
    attachments.sort(
      (left, right) =>
        order.compare(left.nodeId, right.nodeId) ||
        compareText(left.kind, right.kind),
    );
  }
  return byTerminal;
}

function projectedTerminalRepresentations(
  context: PresentationContext,
): SymbolRepresentation[] {
  return (context.selected.terminalOwners ?? []).map(
    ({ terminal, ownerFunctionIds }) => {
      const device = required(
        context.deviceByUid.get(terminal.deviceUid),
        "Missing terminal context device",
      );
      return {
        id: structuralTupleId("terminal", device.uid, terminal.terminalKey),
        kind: "terminal",
        device,
        deviceType: required(
          context.typeById.get(device.typeId),
          "Missing terminal context type",
        ),
        functionIds: [],
        rule: {
          functionKey: required(
            ownerFunctionIds[0],
            "Missing terminal context owner",
          ).functionKey,
          families: ["control"],
          symbolId: "ais:terminal",
          bindings: ["in", "out"].map((portId) => ({
            portId,
            terminalKey: terminal.terminalKey,
          })),
          classification: "terminal",
          traversalRole: "terminal-display",
        },
      };
    },
  );
}

export function buildSymbolAndRailNodes(
  context: PresentationContext,
  allRepresentations: readonly SymbolRepresentation[],
  endpoints: SelectedEndpointFacts,
):
  | {
      readonly ok: true;
      readonly value: Readonly<{
        groups: PresentationGroups;
        nodes: readonly (SymbolPresentationNode | RailPresentationNode)[];
      }>;
    }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const { boundaries, constraints } = endpoints;
  const renderableSelected = allRepresentations.filter((representation) =>
    representationIsCompleteSourceBoundary(representation, boundaries),
  );
  const withImplicit = addImplicitTerminalRepresentations(
    context,
    renderableSelected,
    boundaries,
  );
  if (!withImplicit.ok) return withImplicit;
  const representations = [
    ...withImplicit.value,
    ...projectedTerminalRepresentations(context),
  ];
  const groups = buildGroups(context, representations);
  const symbols = representations.map((representation) =>
    buildSymbolNode(context, representation, boundaries, constraints, groups),
  );
  const coveredBoundaryTerminals = new Set(
    symbols.flatMap((node) =>
      node.attachments.map(({ terminal }) => terminalIdKey(terminal)),
    ),
  );
  const rails = [...boundaries]
    .filter(([key]) => !coveredBoundaryTerminals.has(key))
    .map(([, record]) => buildRailNode(context, record, allRepresentations));
  return {
    ok: true,
    value: {
      groups,
      nodes: [...symbols, ...rails].sort((a, b) =>
        comparePresentationNode(a, b, context.order.key),
      ),
    },
  };
}
