import type {
  TraceSignalDagEdge,
  TraceSignalDag,
  TraceDagIndex,
  TraceOrigin,
  StructuralRole,
  PresentationContext,
  TraceSignalOrder,
} from "./model.js";

import { orderedSelectedPaths } from "./paths.js";
import type { SelectedPath, SelectedConductorStep } from "../types.js";
import { conductorKey } from "./util.js";
import { edgeIdFor } from "./conductors.js";
import { terminalIdKey } from "../ordering.js";

function compareTraceDagEdge(
  left: TraceSignalDagEdge,
  right: TraceSignalDagEdge,
): number {
  return left.stableRank - right.stableRank;
}

export function traceDagIndex(dag: TraceSignalDag): TraceDagIndex {
  const ids = new Set<string>();
  const ranks = new Set<number>();
  const incoming = new Map<string, TraceSignalDagEdge[]>();
  const outgoing = new Map<string, TraceSignalDagEdge[]>();
  for (const edge of dag.edges) {
    if (ids.has(edge.id)) {
      throw new Error(`Selected trace signal repeats conductor ${edge.id}.`);
    }
    if (
      !Number.isSafeInteger(edge.stableRank) ||
      edge.stableRank < 0 ||
      ranks.has(edge.stableRank)
    ) {
      throw new Error("Selected trace signal has invalid stable ranks.");
    }
    ids.add(edge.id);
    ranks.add(edge.stableRank);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  for (const edges of incoming.values()) edges.sort(compareTraceDagEdge);
  for (const edges of outgoing.values()) edges.sort(compareTraceDagEdge);
  return { incoming, outgoing };
}

export function incomingTraceEdges(
  index: TraceDagIndex,
  vertex: string,
): readonly TraceSignalDagEdge[] {
  return index.incoming.get(vertex) ?? [];
}

export function outgoingTraceEdges(
  index: TraceDagIndex,
  vertex: string,
): readonly TraceSignalDagEdge[] {
  return index.outgoing.get(vertex) ?? [];
}

function isTraceVia(index: TraceDagIndex, vertex: string): boolean {
  return (
    incomingTraceEdges(index, vertex).length === 1 &&
    outgoingTraceEdges(index, vertex).length === 1
  );
}

export function isTraceMerge(index: TraceDagIndex, vertex: string): boolean {
  const incoming = incomingTraceEdges(index, vertex).length;
  return (
    incoming >= 2 &&
    incoming <= 4 &&
    outgoingTraceEdges(index, vertex).length === 1
  );
}

export function traceOrigin(
  dag: TraceSignalDag,
  index: TraceDagIndex,
  input: TraceSignalDagEdge,
): TraceOrigin {
  let edge = input;
  let upstream = edge.from;
  const visited = new Set<string>();
  while (isTraceVia(index, upstream)) {
    if (visited.has(upstream)) {
      throw new Error("Selected trace signal contains a cycle.");
    }
    visited.add(upstream);
    edge = incomingTraceEdges(index, upstream)[0] as TraceSignalDagEdge;
    upstream = edge.from;
  }
  if (upstream === dag.root) {
    const role = rootLaneRole(index, dag.root, edge);
    return role === undefined
      ? { kind: "OTHER", rank: edge.stableRank }
      : { kind: "ROOT", role, rank: edge.stableRank };
  }
  if (isTraceMerge(index, upstream)) {
    return {
      kind: "CONTINUATION",
      rank: Math.min(
        ...incomingTraceEdges(index, upstream).map(
          ({ stableRank }) => stableRank,
        ),
      ),
    };
  }
  return { kind: "OTHER", rank: edge.stableRank };
}

export function traceContinuationCount(
  dag: TraceSignalDag,
  index: TraceDagIndex,
  merge: string,
): number {
  return incomingTraceEdges(index, merge).filter(
    (input) => traceOrigin(dag, index, input).kind === "CONTINUATION",
  ).length;
}

export function nextNonTraceVia(
  index: TraceDagIndex,
  output: TraceSignalDagEdge,
): string {
  let edge = output;
  let downstream = edge.to;
  const visited = new Set<string>();
  while (isTraceVia(index, downstream)) {
    if (visited.has(downstream)) {
      throw new Error("Selected trace signal contains a cycle.");
    }
    visited.add(downstream);
    edge = outgoingTraceEdges(index, downstream)[0] as TraceSignalDagEdge;
    downstream = edge.to;
  }
  return downstream;
}

function traceOriginKey(origin: TraceOrigin): readonly [number, number] {
  if (origin.kind === "CONTINUATION") return [0, origin.rank];
  if (origin.kind === "OTHER") return [6, origin.rank];
  const roleRank: Readonly<Record<StructuralRole, number>> = {
    Q: 1,
    P: 2,
    S: 3,
    R: 4,
  };
  return [roleRank[origin.role], origin.rank];
}

export function compareTraceOrigin(
  left: readonly [TraceOrigin, number],
  right: readonly [TraceOrigin, number],
): number {
  const leftKey = traceOriginKey(left[0]);
  const rightKey = traceOriginKey(right[0]);
  return (
    leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || left[1] - right[1]
  );
}

function reachableTraceVertices(
  first: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [first];
  while (pending.length > 0) {
    const current = pending.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return visited;
}

export function validateTraceSignalDag(dag: TraceSignalDag): void {
  if (dag.edges.length === 0) {
    throw new Error("Selected trace signal has no conductor use.");
  }
  if (dag.root === dag.sink) {
    throw new Error("Selected trace signal has identical source and sink.");
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const vertices = new Set([dag.root, dag.sink]);
  for (const edge of dag.edges) {
    vertices.add(edge.from);
    vertices.add(edge.to);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const fromRoot = reachableTraceVertices(dag.root, outgoing);
  const toSink = reachableTraceVertices(dag.sink, incoming);
  if (
    !fromRoot.has(dag.sink) ||
    dag.edges.some(({ from, to }) => !fromRoot.has(from) || !toSink.has(to))
  ) {
    throw new Error("Selected trace signal contains a dead conductor use.");
  }
  const degree = new Map([...vertices].map((vertex) => [vertex, 0]));
  for (const edge of dag.edges)
    degree.set(edge.to, (degree.get(edge.to) as number) + 1);
  const pending = [...vertices].filter((vertex) => degree.get(vertex) === 0);
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.shift() as string;
    visited += 1;
    for (const next of outgoing.get(current) ?? []) {
      const remaining = (degree.get(next) as number) - 1;
      degree.set(next, remaining);
      if (remaining === 0) pending.push(next);
    }
  }
  if (visited !== vertices.size) {
    throw new Error("Selected trace signal contains a cycle.");
  }
}

export function traceSignalOrder(
  context: PresentationContext,
): TraceSignalOrder | undefined {
  const view = context.selected.view;
  if (view.format !== "schematic-view/0.2" || view.intent !== "trace") {
    return undefined;
  }
  const signals = orderedSelectedPaths(context).filter(
    ({ lane }) => lane === "signal",
  );
  if (signals.length !== 1) {
    throw new Error("Selected trace must contain exactly one signal path.");
  }
  const path = signals[0] as SelectedPath;
  const conductorSteps = path.steps.filter(
    (step): step is SelectedConductorStep => step.kind === "conductor",
  );
  const conductorKeys = new Set<string>();
  const rankByEdgeId = new Map<string, number>();
  const edges = conductorSteps.map((step, stableRank): TraceSignalDagEdge => {
    const key = conductorKey(step.elementId);
    const id = edgeIdFor(step.elementId);
    if (conductorKeys.has(key) || rankByEdgeId.has(id)) {
      throw new Error(`Selected trace signal repeats conductor ${id}.`);
    }
    conductorKeys.add(key);
    rankByEdgeId.set(id, stableRank);
    return {
      id,
      from: terminalIdKey(step.from),
      to: terminalIdKey(step.to),
      stableRank,
    };
  });
  const dag = {
    root: terminalIdKey(path.start.terminal),
    sink: terminalIdKey(path.end.terminal),
    edges,
  };
  traceDagIndex(dag);
  validateTraceSignalDag(dag);
  return { path, dag, rankByEdgeId };
}

export function rootLaneRole(
  index: TraceDagIndex,
  root: string,
  edge: TraceSignalDagEdge,
): StructuralRole | undefined {
  const outputs = outgoingTraceEdges(index, root);
  const position = outputs.findIndex(({ id }) => id === edge.id);
  if (position < 0) return undefined;
  if (outputs.length === 2) return (["P", "Q"] as const)[position];
  if (outputs.length === 3) return (["P", "Q", "S"] as const)[position];
  if (outputs.length === 4) return (["P", "Q", "P", "S"] as const)[position];
  return undefined;
}
