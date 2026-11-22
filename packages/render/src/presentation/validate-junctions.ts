import type {
  PresentationGraph,
  PresentationNode,
  PresentationPort,
  JunctionPresentationNode,
  PresentationEdge,
  SymbolPresentationNode,
  RailPresentationNode,
} from "../types.js";
import type {
  ClosedTraceValidationIndex,
  ClosedTraceValidationRecord,
} from "./model.js";
import type { SemanticOrder } from "../semantic-order.js";
import { terminalIdKey, compareText, structuralTupleId } from "../ordering.js";
import { invariant, sameStringSet, required, sameTerminal } from "./util.js";
import { junctionLinkComponent } from "./validate-trace.js";
import { junctionParentId } from "./junction-incidence.js";
import { closedLinkPortId } from "./closed-trace.js";

export function validateJunctions(
  graph: Readonly<PresentationGraph>,
  ownerByPortId: Map<string, PresentationNode>,
  portById: Map<string, PresentationPort>,
  closedTraceRecords: ClosedTraceValidationIndex,
  order: SemanticOrder,
  nodeById: Map<string, PresentationNode>,
) {
  for (const junction of graph.nodes.filter(
    (node): node is JunctionPresentationNode => node.kind === "junction",
  )) {
    const { conductors, junctionPortIds, links, attachmentCount } =
      junctionIncidence(junction, graph, ownerByPortId);
    validateJunctionPortOrder(conductors, junctionPortIds, portById, junction);
    const closed = validateJunctionDegree(
      closedTraceRecords,
      junction,
      conductors,
      graph,
      links,
      attachmentCount,
    );

    validateJunctionComponent(
      junction,
      graph,
      ownerByPortId,
      order,
      closed,
      closedTraceRecords,
      nodeById,
    );
  }
}

function validateJunctionDegree(
  closedTraceRecords: ClosedTraceValidationIndex,
  junction: JunctionPresentationNode,
  conductors: PresentationEdge[],
  graph: Readonly<PresentationGraph>,
  links: PresentationEdge[],
  attachmentCount: number,
) {
  const signatureRecord = closedTraceRecords.byTerminalKey.get(
    terminalIdKey(junction.terminal),
  );
  const closed =
    closedTraceRecords.byNodeId.get(junction.id) ??
    (signatureRecord?.netId === junction.netId ? signatureRecord : undefined);
  if (closed !== undefined) {
    invariant(
      conductors.length >= 1 && junction.ports.length <= 4,
      `${junction.id} closed trace degree`,
    );
    invariant(
      sameStringSet(
        conductors.map(({ id }) => id),
        closed.conductorIds,
      ),
      `${junction.id} exact closed trace conductors`,
    );
    invariant(
      new Set(junction.ports.map(({ side }) => side)).size ===
        junction.ports.length,
      `${junction.id} closed trace distinct sides`,
    );
  } else if (
    "intent" in graph.view &&
    graph.view.intent === "loads" &&
    links.length > 0
  ) {
    invariant(
      conductors.length >= 1 &&
        junction.ports.length <= 4 &&
        new Set(junction.ports.map((p) => p.side)).size ===
          junction.ports.length,
      `${junction.id} load comb distinct arms`,
    );
  } else if (conductors.length === 0) {
    invariant(
      links.length === 0 && attachmentCount >= 3,
      `${junction.id} attachment-only incidence`,
    );
  } else {
    invariant(
      links.length === 0 && attachmentCount >= 1,
      `${junction.id} general semantic incidence`,
    );
  }
  return closed;
}

function validateJunctionPortOrder(
  conductors: PresentationEdge[],
  junctionPortIds: Set<string>,
  portById: Map<string, PresentationPort>,
  junction: JunctionPresentationNode,
) {
  const conductorOrders = conductors
    .map((edge) => {
      const portId = junctionPortIds.has(edge.sourcePortId)
        ? edge.sourcePortId
        : edge.targetPortId;
      return required(
        portById.get(portId),
        `Junction conductor port ${portId} is missing.`,
      ).order;
    })
    .sort((left, right) => left - right);
  const otherOrders = junction.ports
    .map(({ order }) => order)
    .filter((order) => !conductorOrders.includes(order))
    .sort((left, right) => left - right);
  invariant(
    conductorOrders.every((order, index) => order === index) &&
      otherOrders.every((order, index) => order === conductors.length + index),
    `${junction.id} conductor-then-structural order`,
  );
}

function junctionIncidence(
  junction: JunctionPresentationNode,
  graph: Readonly<PresentationGraph>,
  ownerByPortId: Map<string, PresentationNode>,
) {
  const junctionPortIds = new Set(junction.ports.map(({ id }) => id));
  const incident = graph.edges.filter(
    (edge) =>
      junctionPortIds.has(edge.sourcePortId) ||
      junctionPortIds.has(edge.targetPortId),
  );
  invariant(
    incident.length === junction.ports.length,
    `${junction.id} one edge per port`,
  );
  invariant(
    incident.every(({ netId }) => netId === junction.netId),
    `${junction.id} one compiler net`,
  );
  invariant(
    junction.ports.every(
      (port) =>
        sameTerminal(port.terminal, junction.terminal) &&
        port.netId === junction.netId &&
        incident.filter(
          ({ sourcePortId, targetPortId }) =>
            sourcePortId === port.id || targetPortId === port.id,
        ).length === 1,
    ),
    `${junction.id} exact one-edge terminal/net ports`,
  );
  const conductors = incident.filter(({ kind }) => kind === "conductor");
  const boundary = incident.filter(({ kind }) => kind === "boundary-segment");
  const links = boundary.filter(({ sourcePortId, targetPortId }) => {
    const sourceOwner = ownerByPortId.get(sourcePortId);
    const targetOwner = ownerByPortId.get(targetPortId);
    return (
      sourceOwner?.kind === "junction" &&
      targetOwner?.kind === "junction" &&
      sourceOwner.netId === junction.netId &&
      targetOwner.netId === junction.netId &&
      sameTerminal(sourceOwner.terminal, junction.terminal) &&
      sameTerminal(targetOwner.terminal, junction.terminal)
    );
  });
  const attachmentCount = boundary.length - links.length;
  return { conductors, junctionPortIds, links, attachmentCount };
}

function validateJunctionComponent(
  junction: JunctionPresentationNode,
  graph: Readonly<PresentationGraph>,
  ownerByPortId: Map<string, PresentationNode>,
  order: SemanticOrder,
  closed: ClosedTraceValidationRecord | undefined,
  closedTraceRecords: ClosedTraceValidationIndex,
  nodeById: Map<string, PresentationNode>,
) {
  const component = junctionLinkComponent(
    junction,
    graph,
    ownerByPortId,
    order,
  );
  const componentIds = new Set(component.map(({ id }) => id));
  const componentPortIds = new Set(
    component.flatMap((node) => node.ports.map(({ id }) => id)),
  );
  validateLoadComb(closed, component, graph, componentPortIds, junction);
  validateClosedTraceComponent(
    closed,
    componentIds,
    junction,
    component,
    closedTraceRecords,
    graph,
    componentPortIds,
  );
  validateJunctionParent(
    graph,
    componentPortIds,
    ownerByPortId,
    componentIds,
    order,
    junction,
    nodeById,
  );
}

function validateJunctionParent(
  graph: Readonly<PresentationGraph>,
  componentPortIds: Set<string>,
  ownerByPortId: Map<string, PresentationNode>,
  componentIds: Set<string>,
  order: SemanticOrder,
  junction: JunctionPresentationNode,
  nodeById: Map<string, PresentationNode>,
) {
  const visibleNodeIds = new Set<string>();
  collectVisibleJunctionNodes(
    graph,
    componentPortIds,
    ownerByPortId,
    visibleNodeIds,
    componentIds,
    order,
  );
  invariant(
    junction.parentId ===
      junctionParentId(
        [...visibleNodeIds].sort(compareText),
        new Map(
          [...nodeById].filter(
            (
              entry,
            ): entry is [
              string,
              SymbolPresentationNode | RailPresentationNode,
            ] => entry[1].kind !== "junction",
          ),
        ),
      ),
    `${junction.id} visible-endpoint LCA parent`,
  );
}

function collectVisibleJunctionNodes(
  graph: Readonly<PresentationGraph>,
  componentPortIds: Set<string>,
  ownerByPortId: Map<string, PresentationNode>,
  visibleNodeIds: Set<string>,
  componentIds: Set<string>,
  order: SemanticOrder,
) {
  for (const edge of graph.edges) {
    const localSource = componentPortIds.has(edge.sourcePortId);
    const localTarget = componentPortIds.has(edge.targetPortId);
    if (localSource === localTarget) continue;
    const otherPortId = localSource ? edge.targetPortId : edge.sourcePortId;
    const owner = ownerByPortId.get(otherPortId);
    if (owner !== undefined && owner.kind !== "junction") {
      visibleNodeIds.add(owner.id);
    } else if (owner?.kind === "junction" && !componentIds.has(owner.id)) {
      const remote = junctionLinkComponent(owner, graph, ownerByPortId, order);
      const remoteIds = new Set(
        remote.flatMap((node) => node.ports.map(({ id }) => id)),
      );
      for (const remoteEdge of graph.edges) {
        if (remoteEdge.kind !== "boundary-segment") continue;
        const remoteSource = remoteIds.has(remoteEdge.sourcePortId);
        const remoteTarget = remoteIds.has(remoteEdge.targetPortId);
        if (remoteSource === remoteTarget) continue;
        const remoteOther = remoteSource
          ? remoteEdge.targetPortId
          : remoteEdge.sourcePortId;
        const remoteOwner = ownerByPortId.get(remoteOther);
        if (remoteOwner !== undefined && remoteOwner.kind !== "junction") {
          visibleNodeIds.add(remoteOwner.id);
        }
      }
    }
  }
}

function validateClosedTraceComponent(
  closed: ClosedTraceValidationRecord | undefined,
  componentIds: Set<string>,
  junction: JunctionPresentationNode,
  component: readonly JunctionPresentationNode[],
  closedTraceRecords: ClosedTraceValidationIndex,
  graph: Readonly<PresentationGraph>,
  componentPortIds: Set<string>,
) {
  if (closed !== undefined) {
    invariant(
      sameStringSet([...componentIds], closed.componentIds),
      `${junction.id} complete closed trace component`,
    );
    invariant(
      component.every(
        (node) =>
          closedTraceRecords.byNodeId.has(node.id) &&
          node.parentId === junction.parentId &&
          node.netId === junction.netId &&
          sameTerminal(node.terminal, junction.terminal),
      ),
      `${junction.id} closed trace component inheritance`,
    );
    const componentLinks = graph.edges.filter(
      ({ kind, sourcePortId, targetPortId }) =>
        kind === "boundary-segment" &&
        componentPortIds.has(sourcePortId) &&
        componentPortIds.has(targetPortId),
    );
    invariant(
      componentLinks.length === component.length - 1,
      `${junction.id} closed trace link chain`,
    );
    const external = graph.edges.filter(
      ({ sourcePortId, targetPortId }) =>
        componentPortIds.has(sourcePortId) !==
        componentPortIds.has(targetPortId),
    );
    const expectedPathRank =
      external.length === 0
        ? 0
        : Math.min(...external.map(({ pathRank }) => pathRank));
    for (let index = 0; index < component.length - 1; index++) {
      const link = componentLinks.find(
        ({ id }) =>
          id ===
          structuralTupleId(
            "boundary-segment",
            closed.originalId,
            "comb-link",
            closed.role,
            String(index),
          ),
      );
      invariant(
        link !== undefined &&
          link.sourcePortId ===
            closedLinkPortId(closed.originalId, closed.role, index, "out") &&
          link.targetPortId ===
            closedLinkPortId(closed.originalId, closed.role, index, "in") &&
          link.pathRank === expectedPathRank,
        `${junction.id} exact closed trace link`,
      );
    }
  }
}

function validateLoadComb(
  closed: ClosedTraceValidationRecord | undefined,
  component: readonly JunctionPresentationNode[],
  graph: Readonly<PresentationGraph>,
  componentPortIds: Set<string>,
  junction: JunctionPresentationNode,
) {
  if (closed === undefined && component.length > 1) {
    const internal = graph.edges.filter(
      (e) =>
        e.kind === "boundary-segment" &&
        componentPortIds.has(e.sourcePortId) &&
        componentPortIds.has(e.targetPortId),
    );
    const external = graph.edges.filter(
      (e) =>
        componentPortIds.has(e.sourcePortId) !==
        componentPortIds.has(e.targetPortId),
    );
    invariant(
      "intent" in graph.view &&
        graph.view.intent === "loads" &&
        internal.length === component.length - 1 &&
        external.filter((e) => e.kind === "boundary-segment").length === 1,
      `${junction.id} load comb chain and one attachment`,
    );
    invariant(
      component.every(
        (n) =>
          n.parentId === junction.parentId &&
          n.netId === junction.netId &&
          sameTerminal(n.terminal, junction.terminal),
      ),
      `${junction.id} load comb inheritance`,
    );
  }
}
