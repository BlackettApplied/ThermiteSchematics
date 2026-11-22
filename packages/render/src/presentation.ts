import type {
  PresentationContext,
  BuiltConductors,
  JunctionInsertionResult,
  MutablePresentationEdge,
  BuildPresentationGraphRequest,
  BuildPresentationGraphResult,
} from "./presentation/model.js";
import type {
  SymbolPresentationNode,
  RailPresentationNode,
  JunctionPresentationNode,
  PresentationPort,
  PresentationGraph,
} from "./types.js";
import {
  attachmentsByTerminal,
  buildSymbolAndRailNodes,
} from "./presentation/nodes.js";
import { traceSignalOrder } from "./presentation/trace-dag.js";
import {
  terminalJunctionUses,
  junctionTerminal,
  connectTerminalAttachments,
  junctionAssignments,
  connectPassThroughUses,
  terminalClosedIncidence,
  insertClosedJunction,
  insertOpenJunction,
} from "./presentation/junctions.js";
import { comparePresentationNode } from "./ordering.js";
import {
  createContext,
  selectedRepresentations,
} from "./presentation/context.js";
import { selectedEndpointFacts } from "./presentation/paths.js";
import {
  buildConductorEdges,
  attachNetLabels,
  comparePresentationEdge,
} from "./presentation/conductors.js";
import { labelTerminalContextReferences } from "./terminal-context-reference.js";
import { cloneView, immutableEdge } from "./presentation/util.js";
import { deepFreeze } from "./internal.js";
import {
  metadataTextSources,
  summarizePresentationGraph,
} from "./presentation/summary.js";
import { validatePresentationGraph } from "./presentation/validate.js";
import { addOffViewCards } from "./off-view/presentation.js";

function insertSemanticJunctions(
  context: PresentationContext,
  visibleNodes: readonly (SymbolPresentationNode | RailPresentationNode)[],
  conductors: BuiltConductors,
): JunctionInsertionResult {
  const attachments = attachmentsByTerminal(context.order, visibleNodes);
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const portById = new Map(
    visibleNodes.flatMap((node) =>
      node.ports.map((port) => [port.id, port] as const),
    ),
  );
  const terminalKeys = new Set([
    ...conductors.endpointUses.keys(),
    ...attachments.keys(),
  ]);
  const junctions: JunctionPresentationNode[] = [];
  const boundaryEdges: MutablePresentationEdge[] = [];
  const signalOrder = traceSignalOrder(context);
  for (const key of [...terminalKeys].sort(context.order.compare)) {
    const {
      uses,
      terminalAttachments,
      defaultOrderedUses,
      twoArmLoadsSource,
      twoLanePnpTraceSignal,
    } = terminalJunctionUses(attachments, key, conductors, context);
    if (uses.length === 0 && terminalAttachments.length < 2) continue;
    const { terminal, netId } = junctionTerminal(uses, terminalAttachments);
    if (uses.length === 0 && terminalAttachments.length === 2) {
      connectTerminalAttachments(
        terminalAttachments,
        portById,
        boundaryEdges,
        terminal,
        netId,
      );
      continue;
    }
    const { passThrough, assignments, fansOut, semanticDegree } =
      junctionAssignments(terminalAttachments, uses, portById, nodeById);
    if (passThrough) {
      connectPassThroughUses(uses, assignments);
      continue;
    }
    const closed = terminalClosedIncidence(
      context,
      defaultOrderedUses,
      terminalAttachments,
      portById,
      key,
      signalOrder,
    );
    if (closed !== undefined) {
      insertClosedJunction(
        context,
        key,
        closed,
        attachments,
        conductors,
        nodeById,
        terminal,
        netId,
        terminalAttachments,
        portById,
        junctions,
        boundaryEdges,
      );
      continue;
    }
    if (terminalAttachments.length === 0) {
      throw new Error(
        `Selected conductor endpoint ${key} has no visible owner.`,
      );
    }
    if (!fansOut && semanticDegree < 3) {
      for (const [index, use] of uses.entries()) {
        const portId = (assignments[index] as PresentationPort).id;
        if (use.end === "source") use.edge.sourcePortId = portId;
        else use.edge.targetPortId = portId;
      }
      continue;
    }

    insertOpenJunction(
      netId,
      terminal,
      uses,
      context,
      terminalAttachments,
      portById,
      twoArmLoadsSource,
      twoLanePnpTraceSignal,
      boundaryEdges,
      key,
      attachments,
      conductors,
      junctions,
      nodeById,
    );
  }
  return {
    junctions: junctions.sort((a, b) =>
      comparePresentationNode(a, b, context.order.key),
    ),
    boundaryEdges,
  };
}

export function buildPresentationGraph(
  request: BuildPresentationGraphRequest,
): BuildPresentationGraphResult {
  const created = createContext(request);
  if (!created.ok) return created;
  const context = created.value;
  const selected = selectedRepresentations(context);
  if (!selected.ok) return selected;
  const endpoints = selectedEndpointFacts(context);
  const visible = buildSymbolAndRailNodes(context, selected.value, endpoints);
  if (!visible.ok) return visible;
  const conductors = buildConductorEdges(context);
  const inserted = insertSemanticJunctions(
    context,
    visible.value.nodes,
    conductors,
  );
  const mutableEdges = [...conductors.edges, ...inserted.boundaryEdges];
  attachNetLabels(context, mutableEdges);
  const original: PresentationGraph = labelTerminalContextReferences({
    format: "schematic-presentation/0.1",
    directLoadPair: context.directLoadPair,
    view: cloneView(context.selected),
    locationGroups: [...visible.value.groups.locationGroups],
    deviceGroups: [...visible.value.groups.deviceGroups],
    nodes: [...visible.value.nodes, ...inserted.junctions].sort((a, b) =>
      comparePresentationNode(a, b, context.order.key),
    ),
    edges: mutableEdges
      .sort((left, right) => comparePresentationEdge(context, left, right))
      .map(immutableEdge),
    metadataTextSources: metadataTextSources(
      context,
      visible.value.nodes,
      mutableEdges,
    ),
  });
  const annotated = addOffViewCards(
    request.ir,
    original,
    request.offViewPlacements,
  );
  if (!annotated.ok) return annotated;
  const graph = annotated.value;
  validatePresentationGraph(
    request.ir,
    request.selected,
    graph,
    context.mappings,
  );
  const summary = summarizePresentationGraph(
    request.ir,
    graph,
    context.mappings,
  );
  return deepFreeze({ ok: true, value: { graph, summary } });
}

export { type BuildPresentationGraphRequest } from "./presentation/model.js";
export { type BuildPresentationGraphResult } from "./presentation/model.js";
export { selectClosedTraceRoles } from "./presentation/trace-roles.js";
export { emitClosedTraceStructuresForTest } from "./presentation/trace-structures.js";
export { summarizePresentationGraph } from "./presentation/summary.js";
export { serializePresentationGraphForTest } from "./presentation/util.js";
export { validatePresentationGraph } from "./presentation/validate.js";
