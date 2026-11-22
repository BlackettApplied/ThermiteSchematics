import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type {
  SelectedSubgraph,
  PresentationGraph,
  SelectedPath,
  SelectedConductorStep,
  JunctionPresentationNode,
  PresentationNode,
} from "../types.js";
import type {
  ClosedTraceValidationIndex,
  ClosedTraceValidationRecord,
  TraceSignalDag,
  TraceDagIndex,
  ClosedComponentTemplate,
  TraceSignalDagEdge,
} from "./model.js";
import { invariant, required, sameTerminal } from "./util.js";
import {
  terminalIdKey,
  compareText,
  structuralTupleId,
  comparePresentationNode,
} from "../ordering.js";
import { closedTraceSignature } from "./closed-trace.js";
import { selectClosedTraceRoles } from "./trace-roles.js";
import { orderedPathSteps } from "./paths.js";
import { irSemanticOrder, type SemanticOrder } from "../semantic-order.js";
import { edgeIdFor } from "./conductors.js";
import { traceDagIndex, validateTraceSignalDag } from "./trace-dag.js";

export function closedTraceValidationRecords(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  graph: Readonly<PresentationGraph>,
): ClosedTraceValidationIndex {
  if (
    selected.view.format !== "schematic-view/0.2" ||
    selected.view.intent !== "trace"
  ) {
    return { byNodeId: new Map(), byTerminalKey: new Map() };
  }
  const signals = selected.paths.filter(({ lane }) => lane === "signal");
  invariant(signals.length === 1, "one selected trace signal path");
  const { index, dag, terminalByKey, netByKey } = closedTraceValidationDag(
    ir,
    signals,
  );
  const attachmentCount = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    for (const attachment of node.attachments) {
      const key = terminalIdKey(attachment.terminal);
      attachmentCount.set(key, (attachmentCount.get(key) ?? 0) + 1);
    }
  }

  const byNodeId = new Map<string, ClosedTraceValidationRecord>();
  const byTerminalKey = new Map<string, ClosedTraceValidationRecord>();
  const vertices = new Set([
    ...index.incoming.keys(),
    ...index.outgoing.keys(),
  ]);
  indexClosedTraceComponents(
    vertices,
    attachmentCount,
    dag,
    index,
    terminalByKey,
    netByKey,
    selected,
    byNodeId,
    byTerminalKey,
  );
  return { byNodeId, byTerminalKey };
}

function indexClosedTraceComponents(
  vertices: Set<string>,
  attachmentCount: Map<string, number>,
  dag: TraceSignalDag,
  index: TraceDagIndex,
  terminalByKey: Map<string, TerminalId>,
  netByKey: Map<string, string>,
  selected: Readonly<SelectedSubgraph>,
  byNodeId: Map<string, ClosedTraceValidationRecord>,
  byTerminalKey: Map<string, ClosedTraceValidationRecord>,
) {
  for (const key of [...vertices].sort(compareText)) {
    const attachments = attachmentCount.get(key) ?? 0;
    if (closedTraceSignature(dag, index, key, attachments) === undefined) {
      continue;
    }
    const terminal = required(
      terminalByKey.get(key),
      `Closed trace terminal ${key} is missing.`,
    );
    const netId = required(
      netByKey.get(key),
      `Closed trace net ${key} is missing.`,
    );
    const originalId = structuralTupleId(
      "junction",
      netId,
      terminal.deviceUid,
      terminal.terminalKey,
    );
    const template = selectClosedTraceRoles(dag, key, selected.view.flow);
    const role = template.kind === "root" ? "split" : "merge";
    const componentIds = template.components.map(({ index }) =>
      index === 0
        ? originalId
        : structuralTupleId("junction-comb", originalId, role, String(index)),
    );
    for (const [componentIndex, id] of componentIds.entries()) {
      const component = template.components[
        componentIndex
      ] as ClosedComponentTemplate;
      const record = {
        originalId,
        role,
        componentIndex,
        componentIds,
        conductorIds: component.assignments.flatMap(({ incidence }) =>
          incidence.kind === "edge" ? [incidence.edgeId] : [],
        ),
        terminalKey: key,
        netId,
      } satisfies ClosedTraceValidationRecord;
      byNodeId.set(id, record);
      if (componentIndex === 0) byTerminalKey.set(key, record);
    }
  }
}

function closedTraceValidationDag(
  ir: Readonly<ElectricalIr>,
  signals: SelectedPath[],
) {
  const signal = orderedPathSteps(
    { order: irSemanticOrder(ir) },
    signals[0] as SelectedPath,
  );
  const terminalByKey = new Map<string, TerminalId>();
  const netByKey = new Map<string, string>();
  const edges = signal.steps
    .filter((step): step is SelectedConductorStep => step.kind === "conductor")
    .map((step, stableRank): TraceSignalDagEdge => {
      const from = terminalIdKey(step.from);
      const to = terminalIdKey(step.to);
      terminalByKey.set(from, step.from);
      terminalByKey.set(to, step.to);
      for (const key of [from, to]) {
        const previous = netByKey.get(key);
        invariant(
          previous === undefined || previous === step.netId,
          `${key} one selected trace net`,
        );
        netByKey.set(key, step.netId);
      }
      return {
        id: edgeIdFor(step.elementId),
        from,
        to,
        stableRank,
      };
    });
  const dag: TraceSignalDag = {
    root: terminalIdKey(signal.start.terminal),
    sink: terminalIdKey(signal.end.terminal),
    edges,
  };
  const index = traceDagIndex(dag);
  validateTraceSignalDag(dag);
  return { index, dag, terminalByKey, netByKey };
}

export function junctionLinkComponent(
  start: JunctionPresentationNode,
  graph: Readonly<PresentationGraph>,
  ownerByPortId: ReadonlyMap<string, PresentationNode>,
  order: SemanticOrder,
): readonly JunctionPresentationNode[] {
  const visited = new Map<string, JunctionPresentationNode>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.shift() as JunctionPresentationNode;
    if (visited.has(current.id)) continue;
    visited.set(current.id, current);
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
        other.netId === current.netId &&
        sameTerminal(other.terminal, current.terminal)
      ) {
        pending.push(other);
      }
    }
  }
  return [...visited.values()].sort((a, b) =>
    comparePresentationNode(a, b, order.key),
  );
}
