import {
  compareConductiveElementId,
  type TerminalId,
  type ConductiveElementId,
} from "@thermite/compiler";
import type {
  NetResult,
  QueryError,
  ConductiveEdgeView,
} from "@thermite/query";
import {
  conductorKey,
  sameEndpointPair,
  reconstructedElementId,
  sameTerminal,
  cloneConductor,
  cloneTerminal,
  cloneFunction,
} from "../internal.js";
import {
  compareStructuralFunctionId,
  terminalIdKey,
  functionIdKey,
} from "../ordering.js";
import type { SelectedConductorStep, SelectedFunctionStep } from "../types.js";
import { compareBoundaryCandidate } from "./boundaries.js";
import { compareCompleteTerminal } from "./context.js";
import type {
  RootedPathSearch,
  SelectionContext,
  SearchEdge,
  ConductorSearchEdge,
  Predecessor,
  SearchResult,
  BoundaryCandidate,
  ConductorSearchTreeResult,
} from "./contracts.js";

function compareSearchEdge(
  context: SelectionContext,
  left: SearchEdge,
  right: SearchEdge,
): number {
  const kindRank =
    (left.kind === "conductor" ? 0 : 1) - (right.kind === "conductor" ? 0 : 1);
  if (kindRank !== 0) return kindRank;
  const structural =
    left.kind === "conductor" && right.kind === "conductor"
      ? compareConductiveElementId(left.elementId, right.elementId)
      : left.kind === "function" && right.kind === "function"
        ? compareStructuralFunctionId(left.functionId, right.functionId)
        : 0;
  return structural || compareCompleteTerminal(context, left.to, right.to);
}

export function compareSelectedStep(
  context: SelectionContext,
  left: SelectedConductorStep | SelectedFunctionStep,
  right: SelectedConductorStep | SelectedFunctionStep,
): number {
  const kindRank =
    (left.kind === "conductor" ? 0 : 1) - (right.kind === "conductor" ? 0 : 1);
  if (kindRank !== 0) return kindRank;
  const structural =
    left.kind === "conductor" && right.kind === "conductor"
      ? compareConductiveElementId(left.elementId, right.elementId)
      : left.kind === "function" && right.kind === "function"
        ? compareStructuralFunctionId(left.functionId, right.functionId)
        : 0;
  return (
    structural ||
    compareCompleteTerminal(context, left.from, right.from) ||
    compareCompleteTerminal(context, left.to, right.to)
  );
}

export function netFor(
  context: SelectionContext,
  terminal: TerminalId,
):
  | { readonly ok: true; readonly value: NetResult }
  | { readonly ok: false; readonly error: QueryError } {
  const key = terminalIdKey(terminal);
  const cached = context.netCache.get(key);
  if (cached !== undefined) return { ok: true, value: cached };
  const result = context.engine.net({ by: "id", value: terminal });
  if (!result.ok) return result;
  context.netCache.set(key, result.value);
  return result;
}

function verifyQueryConductor(
  context: SelectionContext,
  edge: ConductiveEdgeView,
  id: ConductiveElementId,
): void {
  const key = conductorKey(id);
  if (context.verifiedConductors.has(key)) return;
  const authored = context.conductorByKey.get(key);
  if (authored === undefined) {
    throw new Error(`Query returned unknown conductive element ${key}.`);
  }
  const queryEndpoints: readonly [TerminalId, TerminalId] = [
    edge.endpoints[0].id,
    edge.endpoints[1].id,
  ];
  if (!sameEndpointPair(authored.endpoints, queryEndpoints)) {
    throw new Error(`Query endpoints disagree with ElectricalIr for ${key}.`);
  }
  context.verifiedConductors.add(key);
}

function conductorNeighbors(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
): readonly ConductorSearchEdge[] {
  const neighbors: ConductorSearchEdge[] = [];
  for (const queryEdge of net.net.elements) {
    const id = reconstructedElementId(queryEdge);
    verifyQueryConductor(context, queryEdge, id);
    const [first, second] = queryEdge.endpoints.map(
      ({ id: endpoint }) => endpoint,
    ) as [TerminalId, TerminalId];
    const other = sameTerminal(first, terminal)
      ? second
      : sameTerminal(second, terminal)
        ? first
        : undefined;
    if (other === undefined) continue;
    neighbors.push({
      kind: "conductor",
      elementId: id,
      from: terminal,
      to: other,
      netId: net.net.id,
    });
  }
  return neighbors;
}

function neighbors(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  allowFunctions: boolean,
): readonly SearchEdge[] {
  return [
    ...conductorNeighbors(context, terminal, net),
    ...(allowFunctions
      ? (context.functionAdjacency.get(terminalIdKey(terminal)) ?? [])
      : []),
  ].sort((left, right) => compareSearchEdge(context, left, right));
}

function predecessorKey(predecessor: Predecessor): string {
  const edge = predecessor.edge;
  const structural =
    edge.kind === "conductor"
      ? conductorKey(edge.elementId)
      : functionIdKey(edge.functionId);
  return JSON.stringify([
    terminalIdKey(predecessor.previous),
    edge.kind,
    structural,
    terminalIdKey(edge.to),
  ]);
}

export function selectedSteps(
  context: SelectionContext,
  start: TerminalId,
  boundary: TerminalId,
  distances: ReadonlyMap<string, number>,
  predecessors: ReadonlyMap<string, readonly Predecessor[]>,
): readonly (SelectedConductorStep | SelectedFunctionStep)[] {
  const collected = new Map<
    string,
    { readonly layer: number; readonly edge: SearchEdge }
  >();
  const visit = (current: TerminalId): void => {
    const currentKey = terminalIdKey(current);
    if (currentKey === terminalIdKey(start)) return;
    for (const predecessor of predecessors.get(currentKey) ?? []) {
      const edge = predecessor.edge;
      const reversed: SearchEdge =
        edge.kind === "conductor"
          ? {
              kind: "conductor",
              elementId: edge.elementId,
              from: current,
              to: predecessor.previous,
              netId: edge.netId,
            }
          : {
              kind: "function",
              functionId: edge.functionId,
              from: current,
              to: predecessor.previous,
              ...(edge.normalState === undefined
                ? {}
                : { normalState: edge.normalState }),
            };
      const key = JSON.stringify([
        reversed.kind,
        reversed.kind === "conductor"
          ? conductorKey(reversed.elementId)
          : functionIdKey(reversed.functionId),
        terminalIdKey(reversed.from),
        terminalIdKey(reversed.to),
      ]);
      collected.set(key, {
        layer: distances.get(currentKey)!,
        edge: reversed,
      });
      visit(predecessor.previous);
    }
  };
  visit(boundary);
  return [...collected.values()]
    .sort(
      (left, right) =>
        right.layer - left.layer ||
        compareSearchEdge(context, left.edge, right.edge),
    )
    .map(({ edge }) =>
      edge.kind === "conductor"
        ? Object.freeze({
            kind: "conductor" as const,
            elementId: cloneConductor(edge.elementId),
            from: cloneTerminal(edge.from),
            to: cloneTerminal(edge.to),
            netId: edge.netId,
          })
        : Object.freeze({
            kind: "function" as const,
            functionId: cloneFunction(edge.functionId),
            from: cloneTerminal(edge.from),
            to: cloneTerminal(edge.to),
            ...(edge.normalState === undefined
              ? {}
              : { normalState: edge.normalState }),
          }),
    );
}

export function reverseSelectedSteps(
  steps: readonly (SelectedConductorStep | SelectedFunctionStep)[],
): readonly (SelectedConductorStep | SelectedFunctionStep)[] {
  return [...steps].reverse().map((step) =>
    step.kind === "conductor"
      ? Object.freeze({
          kind: "conductor" as const,
          elementId: cloneConductor(step.elementId),
          from: cloneTerminal(step.to),
          to: cloneTerminal(step.from),
          netId: step.netId,
        })
      : Object.freeze({
          kind: "function" as const,
          functionId: cloneFunction(step.functionId),
          from: cloneTerminal(step.to),
          to: cloneTerminal(step.from),
          ...(step.normalState === undefined
            ? {}
            : { normalState: step.normalState }),
        }),
  );
}

export function searchPath(
  context: SelectionContext,
  start: TerminalId,
  policy: RootedPathSearch,
): SearchResult {
  const component = context.engine.followConductive([start]);
  if (!component.ok) return component;
  if (
    !component.value.some((entry) =>
      entry.visits.some(({ terminal }) => sameTerminal(terminal.id, start)),
    )
  ) {
    throw new Error("Query conductive component omitted its search root.");
  }

  const startKey = terminalIdKey(start);
  const distances = new Map<string, number>([[startKey, 0]]);
  const predecessors = new Map<string, Predecessor[]>();
  const queue: TerminalId[] = [start];
  const candidates: BoundaryCandidate[] = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    const currentKey = terminalIdKey(current);
    const distance = distances.get(currentKey)!;
    const net = netFor(context, current);
    if (!net.ok) return net;
    const stops = policy.boundaries(context, current, net.value, distance);
    if (stops.length > 0) {
      candidates.push(...stops);
      continue;
    }
    const allowFunctions = policy.allowFunctions;
    for (const edge of neighbors(context, current, net.value, allowFunctions)) {
      const next = edge.to;
      const nextKey = terminalIdKey(next);
      const nextDistance = distance + 1;
      const knownDistance = distances.get(nextKey);
      const predecessor: Predecessor = { previous: current, edge };
      if (knownDistance === undefined) {
        distances.set(nextKey, nextDistance);
        predecessors.set(nextKey, [predecessor]);
        queue.push(next);
      } else if (knownDistance === nextDistance) {
        const existing = predecessors.get(nextKey) ?? [];
        if (
          !existing.some(
            (candidate) =>
              predecessorKey(candidate) === predecessorKey(predecessor),
          )
        ) {
          predecessors.set(nextKey, [...existing, predecessor]);
        }
      }
    }
  }
  if (candidates.length === 0) {
    const furthest = Math.max(...distances.values());
    const ends = queue.filter(
      (t) => distances.get(terminalIdKey(t)) === furthest,
    );
    return { ok: true, stoppedAt: ends.length ? ends : [start] };
  }
  candidates.sort((left, right) =>
    compareBoundaryCandidate(context, left, right),
  );
  const candidate = candidates[0]!;
  const steps = selectedSteps(
    context,
    start,
    candidate.boundary.terminal,
    distances,
    predecessors,
  );
  const boundaryAtEnd = policy.boundaryAtEnd;
  const orientedSteps = boundaryAtEnd ? reverseSelectedSteps(steps) : steps;
  const startEndpoint = boundaryAtEnd
    ? Object.freeze({ terminal: cloneTerminal(start) })
    : Object.freeze({
        terminal: cloneTerminal(candidate.boundary.terminal),
        boundary: candidate.boundary,
        constraint: "FIRST" as const,
      });
  const endEndpoint = boundaryAtEnd
    ? Object.freeze({
        terminal: cloneTerminal(candidate.boundary.terminal),
        boundary: candidate.boundary,
        constraint: "LAST" as const,
      })
    : Object.freeze({
        terminal: cloneTerminal(start),
        ...(policy.constrainRoot ? { constraint: "LAST" as const } : {}),
      });
  return {
    ok: true,
    value: {
      candidate,
      path: Object.freeze({
        id: `${context.view.family}:${policy.lane}`,
        lane: policy.lane,
        start: startEndpoint,
        steps: Object.freeze(orientedSteps),
        end: endEndpoint,
      }),
    },
  };
}

export function searchConductors<Stop>(
  context: SelectionContext,
  start: TerminalId,
  stopsAt: (
    terminal: TerminalId,
    net: NetResult,
    distance: number,
  ) => readonly Stop[],
): ConductorSearchTreeResult<Stop> {
  const component = context.engine.followConductive([start]);
  if (!component.ok) return component;
  if (
    !component.value.some((entry) =>
      entry.visits.some(({ terminal }) => sameTerminal(terminal.id, start)),
    )
  ) {
    throw new Error(
      "Query conductive component omitted its trace search root.",
    );
  }

  const distances = new Map<string, number>([[terminalIdKey(start), 0]]);
  const predecessors = new Map<string, Predecessor[]>();
  const queue: TerminalId[] = [start];
  const stops: Stop[] = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    const currentKey = terminalIdKey(current);
    const distance = distances.get(currentKey)!;
    const net = netFor(context, current);
    if (!net.ok) return net;
    const accepted = distance > 0 ? stopsAt(current, net.value, distance) : [];
    if (accepted.length > 0) {
      stops.push(...accepted);
      continue;
    }
    const edges = [...conductorNeighbors(context, current, net.value)].sort(
      (left, right) => compareSearchEdge(context, left, right),
    );
    for (const edge of edges) {
      const next = edge.to;
      const nextKey = terminalIdKey(next);
      const nextDistance = distance + 1;
      const knownDistance = distances.get(nextKey);
      const predecessor: Predecessor = { previous: current, edge };
      if (knownDistance === undefined) {
        distances.set(nextKey, nextDistance);
        predecessors.set(nextKey, [predecessor]);
        queue.push(next);
      } else if (knownDistance === nextDistance) {
        const existing = predecessors.get(nextKey) ?? [];
        if (
          !existing.some(
            (candidate) =>
              predecessorKey(candidate) === predecessorKey(predecessor),
          )
        ) {
          predecessors.set(nextKey, [...existing, predecessor]);
        }
      }
    }
  }
  return {
    ok: true,
    value: {
      stops: Object.freeze(stops),
      distances,
      predecessors,
    },
  };
}
