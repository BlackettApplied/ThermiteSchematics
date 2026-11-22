import type {
  TraceSignalDag,
  TraceDagIndex,
  ClosedTraceSignature,
  EndpointUse,
  TraceSignalOrder,
  ClosedTraceIncidence,
  JunctionInsertionResult,
  MutablePresentationEdge,
  ClosedComponentTemplate,
} from "./model.js";
import {
  incomingTraceEdges,
  outgoingTraceEdges,
  traceDagIndex,
} from "./trace-dag.js";
import type {
  SemanticAttachment,
  SchematicFlow,
  PresentationPort,
  JunctionPresentationNode,
} from "../types.js";
import { selectClosedTraceRoles } from "./trace-roles.js";
import { structuralTupleId, comparePresentationPort } from "../ordering.js";
import type { TerminalId } from "@thermite/compiler";
import type { SymbolSide } from "../symbols/types.js";
import { cloneTerminal, required } from "./util.js";

export function closedTraceSignature(
  dag: TraceSignalDag,
  index: TraceDagIndex,
  key: string,
  attachmentCount: number,
): ClosedTraceSignature | undefined {
  const incoming = incomingTraceEdges(index, key).length;
  const outgoing = outgoingTraceEdges(index, key).length;
  if (
    key === dag.root &&
    incoming === 0 &&
    outgoing >= 2 &&
    outgoing <= 4 &&
    attachmentCount === 1
  ) {
    return "root";
  }
  if (
    incoming >= 2 &&
    incoming <= 4 &&
    outgoing === 1 &&
    attachmentCount === 1
  ) {
    return "merge";
  }
  if (incoming === 1 && outgoing === 1 && attachmentCount === 0) {
    return "via";
  }
  return undefined;
}

export function closedTraceIncidence(
  key: string,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
  signal: TraceSignalOrder | undefined,
  flow: SchematicFlow,
): ClosedTraceIncidence | undefined {
  if (signal === undefined) return undefined;
  const index = traceDagIndex(signal.dag);
  const incoming = incomingTraceEdges(index, key);
  const outgoing = outgoingTraceEdges(index, key);
  if (
    closedTraceSignature(signal.dag, index, key, attachments.length) ===
    undefined
  ) {
    return undefined;
  }

  const expectedIds = new Set([...incoming, ...outgoing].map(({ id }) => id));
  if (
    expectedIds.size !== uses.length ||
    uses.some(({ edge }) => !expectedIds.has(edge.id))
  ) {
    return undefined;
  }
  const ranked = uses.map((use) => ({
    use,
    rank: signal.rankByEdgeId.get(use.edge.id),
  }));
  if (ranked.some(({ rank }) => rank === undefined)) return undefined;
  ranked.sort((left, right) => (left.rank as number) - (right.rank as number));
  if (new Set(ranked.map(({ rank }) => rank)).size !== ranked.length) {
    throw new Error(
      `Selected trace terminal ${key} has duplicate stable ranks.`,
    );
  }
  return {
    orderedUses: ranked.map(({ use }) => use),
    template: selectClosedTraceRoles(signal.dag, key, flow),
  };
}

export function closedLinkPortId(
  junctionId: string,
  role: "split" | "merge",
  linkIndex: number,
  end: "in" | "out",
): string {
  return structuralTupleId(
    "port",
    junctionId,
    "comb-link",
    role,
    String(linkIndex),
    end,
  );
}

function closedJunctionPort(
  id: string,
  symbolPortId: string,
  terminal: TerminalId,
  netId: string,
  side: SymbolSide,
  order: number,
): PresentationPort {
  return {
    id,
    symbolPortId,
    terminal: cloneTerminal(terminal),
    netId,
    side,
    offset: 0.5,
    order,
    label: "",
  };
}

export function emitClosedTraceJunction(
  designationForDevice: (deviceUid: string) => string,
  parentId: JunctionPresentationNode["parentId"],
  key: string,
  terminal: TerminalId,
  netId: string,
  terminalAttachments: readonly SemanticAttachment[],
  incidence: ClosedTraceIncidence,
  portById: ReadonlyMap<string, PresentationPort>,
): JunctionInsertionResult {
  const junctionId = structuralTupleId(
    "junction",
    netId,
    terminal.deviceUid,
    terminal.terminalKey,
  );
  const combRole = incidence.template.kind === "root" ? "split" : "merge";
  const conductorIndex = new Map(
    incidence.orderedUses.map(({ edge }, index) => [edge.id, index] as const),
  );
  const useByEdgeId = new Map(
    incidence.orderedUses.map((use) => [use.edge.id, use] as const),
  );
  const attachment = terminalAttachments[0];
  const junctions: JunctionPresentationNode[] = [];
  const boundaryEdges: MutablePresentationEdge[] = [];

  emitClosedJunctionNodes(
    incidence,
    junctionId,
    combRole,
    useByEdgeId,
    conductorIndex,
    terminal,
    netId,
    attachment,
    key,
    designationForDevice,
    junctions,
    parentId,
  );

  const linkPathRank =
    incidence.orderedUses.length === 0
      ? 0
      : Math.min(...incidence.orderedUses.map(({ edge }) => edge.pathRank));
  attachClosedJunctionOwner(
    attachment,
    portById,
    junctionId,
    incidence,
    boundaryEdges,
    netId,
    terminal,
    linkPathRank,
  );
  emitClosedJunctionLinks(
    incidence,
    boundaryEdges,
    junctionId,
    combRole,
    netId,
    terminal,
    linkPathRank,
  );
  return { junctions, boundaryEdges };
}

function emitClosedJunctionLinks(
  incidence: ClosedTraceIncidence,
  boundaryEdges: MutablePresentationEdge[],
  junctionId: string,
  combRole: "split" | "merge",
  netId: string,
  terminal: TerminalId,
  linkPathRank: number,
) {
  for (
    let linkIndex = 0;
    linkIndex < incidence.template.components.length - 1;
    linkIndex++
  ) {
    boundaryEdges.push({
      id: structuralTupleId(
        "boundary-segment",
        junctionId,
        "comb-link",
        combRole,
        String(linkIndex),
      ),
      parentId: "root",
      kind: "boundary-segment",
      sourcePortId: closedLinkPortId(junctionId, combRole, linkIndex, "out"),
      targetPortId: closedLinkPortId(junctionId, combRole, linkIndex, "in"),
      netId,
      elementIds: [],
      endpoints: [cloneTerminal(terminal), cloneTerminal(terminal)],
      pathRank: linkPathRank,
    });
  }
}

function attachClosedJunctionOwner(
  attachment: SemanticAttachment | undefined,
  portById: ReadonlyMap<string, PresentationPort>,
  junctionId: string,
  incidence: ClosedTraceIncidence,
  boundaryEdges: MutablePresentationEdge[],
  netId: string,
  terminal: TerminalId,
  linkPathRank: number,
) {
  if (attachment !== undefined) {
    const ownerPort = required(
      portById.get(attachment.portIds[0] as string),
      `Junction attachment ${attachment.nodeId} has no port.`,
    );
    const junctionPortId = structuralTupleId(
      "port",
      junctionId,
      "attachment",
      attachment.nodeId,
    );
    const hasOutgoing = incidence.orderedUses.some(
      ({ end }) => end === "source",
    );
    const hasIncoming = incidence.orderedUses.some(
      ({ end }) => end === "target",
    );
    const ownerToJunction = hasOutgoing && !hasIncoming;
    boundaryEdges.push({
      id: structuralTupleId("boundary-segment", junctionId, attachment.nodeId),
      parentId: "root",
      kind: "boundary-segment",
      sourcePortId: ownerToJunction ? ownerPort.id : junctionPortId,
      targetPortId: ownerToJunction ? junctionPortId : ownerPort.id,
      netId,
      elementIds: [],
      endpoints: [cloneTerminal(terminal), cloneTerminal(terminal)],
      pathRank: linkPathRank,
    });
  }
}

function emitClosedJunctionNodes(
  incidence: ClosedTraceIncidence,
  junctionId: string,
  combRole: "split" | "merge",
  useByEdgeId: Map<string, EndpointUse>,
  conductorIndex: Map<string, number>,
  terminal: TerminalId,
  netId: string,
  attachment: SemanticAttachment | undefined,
  key: string,
  designationForDevice: (deviceUid: string) => string,
  junctions: JunctionPresentationNode[],
  parentId: string,
) {
  for (const component of incidence.template.components) {
    const componentId =
      component.index === 0
        ? junctionId
        : structuralTupleId(
            "junction-comb",
            junctionId,
            combRole,
            String(component.index),
          );
    const ports = buildClosedJunctionPorts(
      component,
      useByEdgeId,
      conductorIndex,
      junctionId,
      terminal,
      netId,
      attachment,
      key,
      combRole,
    );
    ports.sort((left, right) =>
      comparePresentationPort(left, right, designationForDevice),
    );
    junctions.push({
      kind: "junction",
      id: componentId,
      parentId,
      classification: "junction",
      netId,
      terminal: cloneTerminal(terminal),
      ports,
    });
  }
}

function buildClosedJunctionPorts(
  component: ClosedComponentTemplate,
  useByEdgeId: Map<string, EndpointUse>,
  conductorIndex: Map<string, number>,
  junctionId: string,
  terminal: TerminalId,
  netId: string,
  attachment: SemanticAttachment | undefined,
  key: string,
  combRole: "split" | "merge",
) {
  return component.assignments.map((assignment) => {
    const selected = assignment.incidence;
    if (selected.kind === "edge") {
      const use = required(
        useByEdgeId.get(selected.edgeId),
        `Closed trace conductor ${selected.edgeId} is missing.`,
      );
      const index = required(
        conductorIndex.get(selected.edgeId),
        `Closed trace conductor ${selected.edgeId} has no stable local index.`,
      );
      const portId = structuralTupleId(
        "port",
        junctionId,
        "conductor",
        use.edge.id,
        use.end,
      );
      if (use.end === "source") use.edge.sourcePortId = portId;
      else use.edge.targetPortId = portId;
      return closedJunctionPort(
        portId,
        `conductor-${index}`,
        terminal,
        netId,
        assignment.side,
        assignment.order,
      );
    }
    if (selected.kind === "attachment") {
      const attached = required(
        attachment,
        `Closed trace attachment at ${key} is missing.`,
      );
      return closedJunctionPort(
        structuralTupleId("port", junctionId, "attachment", attached.nodeId),
        "attachment-0",
        terminal,
        netId,
        assignment.side,
        assignment.order,
      );
    }
    const end = selected.kind === "link-out" ? "out" : "in";
    return closedJunctionPort(
      closedLinkPortId(junctionId, combRole, selected.index, end),
      `comb-link-${combRole}-${selected.index}-${end}`,
      terminal,
      netId,
      assignment.side,
      assignment.order,
    );
  });
}
