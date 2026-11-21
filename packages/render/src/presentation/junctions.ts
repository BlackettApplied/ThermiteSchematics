import type { TerminalId } from "@thermite/compiler";
import type {
  EndpointUse,
  PresentationContext,
  MutablePresentationEdge,
  BuiltConductors,
  TraceSignalOrder,
  ClosedTraceIncidence,
} from "./model.js";
import type {
  SemanticAttachment,
  PresentationPort,
  JunctionPresentationNode,
  SymbolPresentationNode,
  RailPresentationNode,
} from "../types.js";
import {
  actuationIncidence,
  loadSourceIncidence,
  incidentVisibleNodeIds,
  junctionParentId,
  attachmentPort,
  primarySide,
  counterClockwiseSide,
  portForEndpointUse,
  terminalPassThroughException,
  isTwoArmLoadsSourceJunction,
  isTwoLanePnpTraceSignalJunction,
  traceSignalStepRank,
} from "./junction-incidence.js";
import {
  closedTraceIncidence,
  emitClosedTraceJunction,
} from "./closed-trace.js";
import {
  comparePresentationPort,
  structuralTupleId,
  compareText,
} from "../ordering.js";
import { designationFor } from "./util.js";
import { required, cloneTerminal, sameTerminal } from "./util.js";
import { compareDirectLoadsUses } from "./paths.js";
import { comparePresentationEdge } from "./conductors.js";

export function insertOpenJunction(
  netId: string,
  terminal: TerminalId,
  uses: EndpointUse[],
  context: PresentationContext,
  terminalAttachments: readonly SemanticAttachment[],
  portById: Map<string, PresentationPort>,
  twoArmLoadsSource: boolean,
  twoLanePnpTraceSignal: boolean,
  boundaryEdges: MutablePresentationEdge[],
  key: string,
  attachments: ReadonlyMap<string, readonly SemanticAttachment[]>,
  conductors: BuiltConductors,
  junctions: JunctionPresentationNode[],
  nodeById: Map<string, SymbolPresentationNode | RailPresentationNode>,
) {
  const { junctionId, junctionPorts } = generalJunctionConductorPorts(
    netId,
    terminal,
    uses,
    context,
    terminalAttachments,
    portById,
    twoArmLoadsSource,
    twoLanePnpTraceSignal,
  );
  generalJunctionAttachments(
    terminalAttachments,
    portById,
    uses,
    junctionId,
    terminal,
    netId,
    context,
    junctionPorts,
    boundaryEdges,
  );
  insertGeneralJunction(
    junctionPorts,
    context,
    key,
    uses,
    attachments,
    conductors,
    junctions,
    junctionId,
    nodeById,
    netId,
    terminal,
  );
}

export function terminalClosedIncidence(
  context: PresentationContext,
  defaultOrderedUses: EndpointUse[],
  terminalAttachments: readonly SemanticAttachment[],
  portById: Map<string, PresentationPort>,
  key: string,
  signalOrder: TraceSignalOrder | undefined,
) {
  return (
    actuationIncidence(context, defaultOrderedUses, terminalAttachments) ??
    loadSourceIncidence(
      context,
      defaultOrderedUses,
      terminalAttachments,
      portById,
    ) ??
    closedTraceIncidence(
      key,
      defaultOrderedUses,
      terminalAttachments,
      signalOrder,
      context.selected.view.flow,
    )
  );
}

export function connectPassThroughUses(
  uses: EndpointUse[],
  assignments: PresentationPort[],
) {
  for (const [index, use] of uses.entries()) {
    const portId = (assignments[index] as PresentationPort).id;
    if (use.end === "source") use.edge.sourcePortId = portId;
    else use.edge.targetPortId = portId;
  }
}

function insertGeneralJunction(
  junctionPorts: PresentationPort[],
  context: PresentationContext,
  key: string,
  uses: EndpointUse[],
  attachments: ReadonlyMap<string, readonly SemanticAttachment[]>,
  conductors: BuiltConductors,
  junctions: JunctionPresentationNode[],
  junctionId: string,
  nodeById: Map<string, SymbolPresentationNode | RailPresentationNode>,
  netId: string,
  terminal: TerminalId,
) {
  junctionPorts.sort((left, right) =>
    comparePresentationPort(left, right, (deviceUid) =>
      designationFor(context, deviceUid),
    ),
  );
  const visibleEndpointIds = incidentVisibleNodeIds(
    key,
    uses,
    attachments,
    conductors.endpointUses,
  );
  junctions.push({
    kind: "junction",
    id: junctionId,
    parentId: junctionParentId(visibleEndpointIds, nodeById),
    classification: "junction",
    netId,
    terminal,
    ports: junctionPorts,
  });
}

function generalJunctionAttachments(
  terminalAttachments: readonly SemanticAttachment[],
  portById: Map<string, PresentationPort>,
  uses: EndpointUse[],
  junctionId: string,
  terminal: TerminalId,
  netId: string,
  context: PresentationContext,
  junctionPorts: PresentationPort[],
  boundaryEdges: MutablePresentationEdge[],
) {
  for (const [attachmentIndex, attachment] of terminalAttachments.entries()) {
    const attachmentPort = required(
      portById.get(attachment.portIds[0] as string),
      `Junction attachment ${attachment.nodeId} has no port.`,
    );
    const hasOutgoing = uses.some(({ end }) => end === "source");
    const hasIncoming = uses.some(({ end }) => end === "target");
    const ownerToJunction = hasOutgoing && !hasIncoming;
    const junctionPortId = structuralTupleId(
      "port",
      junctionId,
      "attachment",
      attachment.nodeId,
    );
    const junctionPort: PresentationPort = {
      id: junctionPortId,
      symbolPortId: `attachment-${attachmentIndex}`,
      terminal: cloneTerminal(terminal),
      netId,
      side: primarySide(context, ownerToJunction ? "incoming" : "outgoing"),
      offset: 0.5,
      order: uses.length + attachmentIndex,
      label: "",
    };
    junctionPorts.push(junctionPort);
    boundaryEdges.push({
      id: structuralTupleId("boundary-segment", junctionId, attachment.nodeId),
      parentId: "root",
      kind: "boundary-segment",
      sourcePortId: ownerToJunction ? attachmentPort.id : junctionPortId,
      targetPortId: ownerToJunction ? junctionPortId : attachmentPort.id,
      netId,
      elementIds: [],
      endpoints: [cloneTerminal(terminal), cloneTerminal(terminal)],
      pathRank:
        uses.length === 0
          ? 0
          : Math.min(...uses.map(({ edge }) => edge.pathRank)),
    });
  }
}

function generalJunctionConductorPorts(
  netId: string,
  terminal: TerminalId,
  uses: EndpointUse[],
  context: PresentationContext,
  terminalAttachments: readonly SemanticAttachment[],
  portById: Map<string, PresentationPort>,
  twoArmLoadsSource: boolean,
  twoLanePnpTraceSignal: boolean,
) {
  const junctionId = structuralTupleId(
    "junction",
    netId,
    terminal.deviceUid,
    terminal.terminalKey,
  );
  const junctionPorts: PresentationPort[] = [];
  for (const [index, use] of uses.entries()) {
    const portId = structuralTupleId(
      "port",
      junctionId,
      "conductor",
      use.edge.id,
      use.end,
    );
    const port: PresentationPort = {
      id: portId,
      symbolPortId: `conductor-${index}`,
      terminal: cloneTerminal(terminal),
      netId,
      side:
        "intent" in context.selected.view &&
        context.selected.view.intent === "loads" &&
        uses.some((u) => u.end === "target") &&
        uses.some((u) => u.end === "source") &&
        use.end === "source"
          ? counterClockwiseSide(
              primarySide(
                context,
                attachmentPort(
                  terminalAttachments[0] as SemanticAttachment,
                  portById,
                ).symbolPortId === "return"
                  ? "incoming"
                  : "outgoing",
              ),
            )
          : (twoArmLoadsSource || twoLanePnpTraceSignal) && index === 1
            ? twoArmLoadsSource &&
              context.directLoadPair &&
              attachmentPort(
                terminalAttachments[0] as SemanticAttachment,
                portById,
              ).symbolPortId === "return"
              ? counterClockwiseSide(primarySide(context, "incoming"))
              : counterClockwiseSide(primarySide(context, "outgoing"))
            : primarySide(
                context,
                use.end === "target" ? "incoming" : "outgoing",
              ),
      offset: 0.5,
      order: index,
      label: "",
    };
    junctionPorts.push(port);
    if (use.end === "source") use.edge.sourcePortId = portId;
    else use.edge.targetPortId = portId;
  }
  return { junctionId, junctionPorts };
}

export function insertClosedJunction(
  context: PresentationContext,
  key: string,
  closed: ClosedTraceIncidence,
  attachments: ReadonlyMap<string, readonly SemanticAttachment[]>,
  conductors: BuiltConductors,
  nodeById: Map<string, SymbolPresentationNode | RailPresentationNode>,
  terminal: TerminalId,
  netId: string,
  terminalAttachments: readonly SemanticAttachment[],
  portById: Map<string, PresentationPort>,
  junctions: JunctionPresentationNode[],
  boundaryEdges: MutablePresentationEdge[],
) {
  const emitted = emitClosedTraceJunction(
    (deviceUid) => designationFor(context, deviceUid),
    junctionParentId(
      incidentVisibleNodeIds(
        key,
        closed.orderedUses,
        attachments,
        conductors.endpointUses,
      ),
      nodeById,
    ),
    key,
    terminal,
    netId,
    terminalAttachments,
    closed,
    portById,
  );
  junctions.push(...emitted.junctions);
  boundaryEdges.push(...emitted.boundaryEdges);
}

export function junctionAssignments(
  terminalAttachments: readonly SemanticAttachment[],
  uses: EndpointUse[],
  portById: Map<string, PresentationPort>,
  nodeById: Map<string, SymbolPresentationNode | RailPresentationNode>,
) {
  const assignments =
    terminalAttachments.length === 0
      ? []
      : uses.map((use) =>
          portForEndpointUse(
            terminalAttachments[0] as SemanticAttachment,
            use,
            portById,
            nodeById,
          ),
        );
  const counts = new Map<string, number>();
  for (const port of assignments)
    counts.set(port.id, (counts.get(port.id) ?? 0) + 1);
  const fansOut = [...counts.values()].some((count) => count >= 2);
  const semanticDegree = uses.length + terminalAttachments.length;
  const passThrough = terminalPassThroughException(
    terminalAttachments,
    uses,
    assignments,
    nodeById,
  );
  return { passThrough, assignments, fansOut, semanticDegree };
}

export function connectTerminalAttachments(
  terminalAttachments: readonly SemanticAttachment[],
  portById: Map<string, PresentationPort>,
  boundaryEdges: MutablePresentationEdge[],
  terminal: TerminalId,
  netId: string,
) {
  const sourceAttachment = terminalAttachments[0] as SemanticAttachment;
  const targetAttachment = terminalAttachments[1] as SemanticAttachment;
  const sourcePort = attachmentPort(sourceAttachment, portById);
  const targetPort = attachmentPort(targetAttachment, portById);
  boundaryEdges.push({
    id: structuralTupleId(
      "boundary-segment",
      terminal.deviceUid,
      terminal.terminalKey,
      sourceAttachment.nodeId,
      targetAttachment.nodeId,
    ),
    parentId: "root",
    kind: "boundary-segment",
    sourcePortId: sourcePort.id,
    targetPortId: targetPort.id,
    netId,
    elementIds: [],
    endpoints: [cloneTerminal(terminal), cloneTerminal(terminal)],
    pathRank: 0,
  });
}

export function junctionTerminal(
  uses: EndpointUse[],
  terminalAttachments: readonly SemanticAttachment[],
) {
  const terminal = cloneTerminal(
    uses[0]?.terminal ??
      (terminalAttachments[0] as SemanticAttachment).terminal,
  );
  const netId =
    uses[0]?.edge.netId ?? (terminalAttachments[0] as SemanticAttachment).netId;
  if (
    uses.some(
      (use) =>
        !sameTerminal(use.terminal, terminal) || use.edge.netId !== netId,
    ) ||
    terminalAttachments.some(
      (attachment) =>
        !sameTerminal(attachment.terminal, terminal) ||
        attachment.netId !== netId,
    )
  ) {
    throw new Error("Terminal attachments cross compiler nets or terminals.");
  }
  return { terminal, netId };
}

export function terminalJunctionUses(
  attachments: ReadonlyMap<string, readonly SemanticAttachment[]>,
  key: string,
  conductors: BuiltConductors,
  context: PresentationContext,
) {
  const terminalAttachments = attachments.get(key) ?? [];
  const defaultOrderedUses = [...(conductors.endpointUses.get(key) ?? [])].sort(
    (left, right) =>
      context.order.compare(left.edge.id, right.edge.id) ||
      compareText(left.end, right.end),
  );
  const twoArmLoadsSource = isTwoArmLoadsSourceJunction(
    context,
    defaultOrderedUses,
    terminalAttachments,
  );
  const twoLanePnpTraceSignal = isTwoLanePnpTraceSignalJunction(
    context,
    defaultOrderedUses,
    terminalAttachments,
  );
  const uses = twoArmLoadsSource
    ? [...defaultOrderedUses].sort(
        (left, right) =>
          (context.directLoadPair
            ? compareDirectLoadsUses(context, left, right)
            : comparePresentationEdge(context, left.edge, right.edge)) ||
          compareText(left.end, right.end),
      )
    : twoLanePnpTraceSignal
      ? [...defaultOrderedUses].sort(
          (left, right) =>
            traceSignalStepRank(context, left.edge) -
              traceSignalStepRank(context, right.edge) ||
            compareText(left.end, right.end),
        )
      : defaultOrderedUses;
  return {
    uses,
    terminalAttachments,
    defaultOrderedUses,
    twoArmLoadsSource,
    twoLanePnpTraceSignal,
  };
}
