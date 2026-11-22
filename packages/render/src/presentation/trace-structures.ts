import type {
  SelectedSubgraph,
  PresentationGraph,
  PresentationNode,
  JunctionPresentationNode,
  SemanticAttachment,
  SelectedPath,
  SelectedConductorStep,
} from "../types.js";
import {
  required,
  cloneTerminal,
  sameTerminal,
  immutableEdge,
  conductorKey,
} from "./util.js";
import type {
  MutablePresentationEdge,
  ClosedTraceIncidence,
  EndpointUse,
  TraceSignalDag,
  TraceSignalOrder,
} from "./model.js";
import {
  compareText,
  terminalIdKey,
  comparePresentationNode,
} from "../ordering.js";
import {
  closedTraceIncidence,
  emitClosedTraceJunction,
} from "./closed-trace.js";
import { graphSemanticOrder } from "../semantic-order.js";
import type { TerminalId, ConductiveElementId } from "@thermite/compiler";
import { traceDagIndex, validateTraceSignalDag } from "./trace-dag.js";

/**
 * M6_PLAN v23's Closed-Trace Grammar Verification Boundary.
 *
 * This is a stable, normative renderer-internal verification API, not a
 * disposable test leak. It applies the production closed-trace grammar to the
 * plan's frozen minimal structural models; compilation, selection, grouping,
 * and full production presentation remain outside this boundary.
 */
export function emitClosedTraceStructuresForTest(
  selected: Readonly<SelectedSubgraph>,
  source: Readonly<PresentationGraph>,
): PresentationGraph {
  const signalPath = required(
    selected.paths.find(({ lane }) => lane === "signal"),
    "Closed trace test fixture has no signal path.",
  );
  let nodes = structuredClone(source.nodes) as PresentationNode[];
  let edges = structuredClone(source.edges) as MutablePresentationEdge[];
  const { index, conductorSteps, signal } = testTraceSignalDag(
    signalPath,
    edges,
  );
  const vertices = new Set([
    ...index.incoming.keys(),
    ...index.outgoing.keys(),
  ]);
  for (const key of [...vertices].sort(compareText)) {
    const terminal = cloneTerminal(
      required(
        conductorSteps
          .flatMap(({ from, to }) => [from, to])
          .find((candidate) => terminalIdKey(candidate) === key),
        `Closed trace test terminal ${key} is missing.`,
      ),
    );
    const candidate = nodes.find((node) => {
      if (node.kind !== "junction" || !sameTerminal(node.terminal, terminal)) {
        return false;
      }
      const portIds = new Set(node.ports.map(({ id }) => id));
      return edges.some(
        ({ kind, sourcePortId, targetPortId }) =>
          kind === "conductor" &&
          (portIds.has(sourcePortId) || portIds.has(targetPortId)),
      );
    });
    if (candidate?.kind !== "junction") continue;
    const { uses, terminalAttachments, attachmentEdges } =
      testTraceCandidateIncidence(candidate, edges, terminal, nodes);
    const incidence = closedTraceIncidence(
      key,
      uses,
      terminalAttachments,
      signal,
      selected.view.flow,
    );
    if (incidence === undefined) continue;
    ({ nodes, edges } = replaceTestTraceJunction(
      nodes,
      candidate,
      key,
      terminal,
      terminalAttachments,
      incidence,
      attachmentEdges,
      edges,
    ));
  }
  const order = graphSemanticOrder(source);
  return {
    ...structuredClone(source),
    nodes: nodes.sort((a, b) => comparePresentationNode(a, b, order.key)),
    edges: edges.map(immutableEdge),
  };
}

function replaceTestTraceJunction(
  nodes: PresentationNode[],
  candidate: JunctionPresentationNode,
  key: string,
  terminal: TerminalId,
  terminalAttachments: SemanticAttachment[],
  incidence: ClosedTraceIncidence,
  attachmentEdges: MutablePresentationEdge[],
  edges: MutablePresentationEdge[],
) {
  const portById = new Map(
    nodes.flatMap((node) => node.ports.map((port) => [port.id, port] as const)),
  );
  const emitted = emitClosedTraceJunction(
    (deviceUid) => deviceUid,
    candidate.parentId,
    key,
    terminal,
    candidate.netId,
    terminalAttachments,
    incidence,
    portById,
  );
  nodes = nodes.filter(({ id }) => id !== candidate.id);
  nodes.push(...emitted.junctions);
  const replacedBoundaryIds = new Set(attachmentEdges.map(({ id }) => id));
  edges = edges.filter(({ id }) => !replacedBoundaryIds.has(id));
  edges.push(...emitted.boundaryEdges);
  return { nodes, edges };
}

function testTraceCandidateIncidence(
  candidate: JunctionPresentationNode,
  edges: MutablePresentationEdge[],
  terminal: TerminalId,
  nodes: PresentationNode[],
) {
  const candidatePortIds = new Set(candidate.ports.map(({ id }) => id));
  const uses = edges
    .filter(
      ({ kind, sourcePortId, targetPortId }) =>
        kind === "conductor" &&
        (candidatePortIds.has(sourcePortId) ||
          candidatePortIds.has(targetPortId)),
    )
    .map((edge): EndpointUse => {
      const end = candidatePortIds.has(edge.sourcePortId) ? "source" : "target";
      return { edge, end, terminal };
    });
  const ownerByPortId = new Map(
    nodes.flatMap((node) => node.ports.map((port) => [port.id, node] as const)),
  );
  const attachmentEdges = edges.filter(
    ({ kind, sourcePortId, targetPortId }) =>
      kind === "boundary-segment" &&
      candidatePortIds.has(sourcePortId) !== candidatePortIds.has(targetPortId),
  );
  const terminalAttachments = attachmentEdges.map(
    (edge): SemanticAttachment => {
      const ownerPortId = candidatePortIds.has(edge.sourcePortId)
        ? edge.targetPortId
        : edge.sourcePortId;
      const owner = required(
        ownerByPortId.get(ownerPortId),
        `Closed trace test attachment ${ownerPortId} is missing.`,
      );
      return {
        kind: "function",
        nodeId: owner.id,
        terminal,
        netId: candidate.netId,
        portIds: [ownerPortId],
      };
    },
  );
  return { uses, terminalAttachments, attachmentEdges };
}

function testTraceSignalDag(
  signalPath: SelectedPath,
  edges: MutablePresentationEdge[],
) {
  const conductorSteps = signalPath.steps.filter(
    (step): step is SelectedConductorStep => step.kind === "conductor",
  );
  const dagEdges = conductorSteps.map((step, stableRank) => {
    const key = conductorKey(step.elementId);
    const edge = required(
      edges.find(
        (candidate) =>
          candidate.kind === "conductor" &&
          candidate.elementIds.length === 1 &&
          conductorKey(candidate.elementIds[0] as ConductiveElementId) === key,
      ),
      `Closed trace test conductor ${key} is missing.`,
    );
    return {
      id: edge.id,
      from: terminalIdKey(step.from),
      to: terminalIdKey(step.to),
      stableRank,
    };
  });
  const dag: TraceSignalDag = {
    root: terminalIdKey(signalPath.start.terminal),
    sink: terminalIdKey(signalPath.end.terminal),
    edges: dagEdges,
  };
  const rankByEdgeId = new Map(
    dagEdges.map(({ id, stableRank }) => [id, stableRank] as const),
  );
  const signal: TraceSignalOrder = {
    path: signalPath,
    dag,
    rankByEdgeId,
  };
  const index = traceDagIndex(dag);
  validateTraceSignalDag(dag);
  return { index, conductorSteps, signal };
}
