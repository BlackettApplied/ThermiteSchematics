import type { SelectedFunctionStep } from "../types.js";
import type {
  PresentationContext,
  SelectedEndpointFacts,
  BoundaryRecord,
  EndpointUse,
} from "./model.js";
import type {
  BoundaryConstraint,
  SelectedPath,
  SelectedConductorStep,
  SelectedSubgraph,
} from "../types.js";
import {
  terminalIdKey,
  structuralTupleId,
  functionIdKey,
  compareText,
  compareTerminalId,
  compareLocationIdentity,
} from "../ordering.js";
import {
  sameTerminal,
  conductorKey,
  required,
  locationIdentity,
} from "./util.js";
import type { TerminalId, IrDevice } from "@thermite/compiler";
import { designationFor } from "./util.js";

export function selectedEndpointFacts(
  context: PresentationContext,
): SelectedEndpointFacts {
  const boundaries = new Map<string, BoundaryRecord>();
  const constraints = new Map<string, BoundaryConstraint>();
  for (const [pathRank, path] of orderedSelectedPaths(context).entries()) {
    for (const endpoint of [path.start, path.end] as const) {
      const key = terminalIdKey(endpoint.terminal);
      const existingConstraint = constraints.get(key);
      if (
        existingConstraint !== undefined &&
        endpoint.constraint !== undefined &&
        existingConstraint !== endpoint.constraint
      ) {
        throw new Error(
          `Endpoint ${key} has contradictory presentation constraints.`,
        );
      }
      if (endpoint.constraint !== undefined) {
        constraints.set(key, endpoint.constraint);
      }
      if (endpoint.boundary === undefined) continue;
      if (
        !sameTerminal(endpoint.terminal, endpoint.boundary.terminal) ||
        endpoint.constraint === undefined
      ) {
        throw new Error(`Boundary ${key} has an invalid endpoint record.`);
      }
      const existing = boundaries.get(key);
      if (existing !== undefined) {
        if (
          existing.constraint !== endpoint.constraint ||
          existing.boundary.netId !== endpoint.boundary.netId
        ) {
          throw new Error(
            `Boundary ${key} has contradictory presentation roles.`,
          );
        }
        continue;
      }
      boundaries.set(key, {
        boundary: endpoint.boundary,
        constraint: endpoint.constraint,
        pathRank,
      });
    }
  }
  return { boundaries, constraints };
}

function selectedStepKey(
  context: Pick<PresentationContext, "order">,
  step: SelectedPath["steps"][number],
): string {
  return context.order.key(structuralSelectedStepKey(step));
}

function structuralSelectedStepKey(
  step: SelectedPath["steps"][number],
): string {
  return step.kind === "conductor"
    ? structuralTupleId(
        "conductor",
        conductorKey(step.elementId),
        terminalIdKey(step.from),
        terminalIdKey(step.to),
        step.netId,
      )
    : structuralTupleId(
        "function",
        functionIdKey(step.functionId),
        terminalIdKey(step.from),
        terminalIdKey(step.to),
        step.normalState ?? "",
      );
}

function compareStructuralSteps(
  context: PresentationContext,
  left: SelectedPath,
  right: SelectedPath,
): number {
  const count = Math.min(left.steps.length, right.steps.length);
  for (let index = 0; index < count; index++) {
    const compared = compareText(
      selectedStepKey(
        context,
        left.steps[index] as SelectedConductorStep | SelectedFunctionStep,
      ),
      selectedStepKey(
        context,
        right.steps[index] as SelectedConductorStep | SelectedFunctionStep,
      ),
    );
    if (compared !== 0) return compared;
  }
  const endpointKey = (path: SelectedPath) =>
    JSON.stringify([
      path.lane,
      ...[path.start, path.end].map((e) => [
        context.order.key(terminalIdKey(e.terminal)),
        e.constraint ?? "",
        e.boundary?.kind ?? "",
        e.boundary?.label ?? "",
      ]),
    ]);
  return (
    left.steps.length - right.steps.length ||
    compareText(endpointKey(left), endpointKey(right))
  );
}

const POWER_LANE_RANK: Readonly<Record<string, number>> = Object.freeze({
  L1: 0,
  U: 0,
  L2: 1,
  V: 1,
  L3: 2,
  W: 2,
  PE: 3,
});

/** Selection may enumerate equal-distance branches by structural identity.
 * Order those steps by directed distance, then authored semantic identity here;
 * preserve the selected path and every conductor's orientation and membership. */
export function orderedPathSteps(
  context: Pick<PresentationContext, "order">,
  path: SelectedPath,
): SelectedPath {
  const distance = new Map([[terminalIdKey(path.start.terminal), 0]]);
  const pending = [path.start.terminal];
  while (pending.length) {
    const from = pending.shift() as TerminalId,
      rank = distance.get(terminalIdKey(from)) as number;
    for (const step of path.steps) {
      if (
        !sameTerminal(step.from, from) ||
        distance.has(terminalIdKey(step.to))
      )
        continue;
      distance.set(terminalIdKey(step.to), rank + 1);
      pending.push(step.to);
    }
  }
  return {
    ...path,
    steps: [...path.steps].sort(
      (a, b) =>
        (distance.get(terminalIdKey(a.from)) ?? Number.MAX_SAFE_INTEGER) -
          (distance.get(terminalIdKey(b.from)) ?? Number.MAX_SAFE_INTEGER) ||
        compareText(selectedStepKey(context, a), selectedStepKey(context, b)),
    ),
  };
}

export function orderedSelectedPaths(
  context: PresentationContext,
): readonly SelectedPath[] {
  const cached = context.orderedPaths;
  if (cached) return cached;
  const ordered = context.selected.paths
    .map((p) => orderedPathSteps(context, p))
    .sort((left, right) => {
      if (context.directLoadPair) {
        return (
          compareTerminalId(left.start.terminal, right.start.terminal, (uid) =>
            designationFor(context, uid),
          ) ||
          compareTerminalId(left.end.terminal, right.end.terminal, (uid) =>
            designationFor(context, uid),
          ) ||
          compareStructuralSteps(context, left, right)
        );
      }
      if (context.selected.view.family === "power") {
        return (
          (POWER_LANE_RANK[left.lane] ?? Number.MAX_SAFE_INTEGER) -
            (POWER_LANE_RANK[right.lane] ?? Number.MAX_SAFE_INTEGER) ||
          compareText(left.lane, right.lane) ||
          compareStructuralSteps(context, left, right)
        );
      }
      const leftBoundary = left.start.boundary ?? left.end.boundary;
      const rightBoundary = right.start.boundary ?? right.end.boundary;
      const boundaryRank =
        (leftBoundary?.kind === "channel" || leftBoundary?.kind === "potential"
          ? 0
          : 1) -
        (rightBoundary?.kind === "channel" ||
        rightBoundary?.kind === "potential"
          ? 0
          : 1);
      return (
        boundaryRank ||
        left.steps.length - right.steps.length ||
        compareStructuralSteps(context, left, right)
      );
    });
  context.orderedPaths = ordered;
  return ordered;
}

export function hasDirectLoadPairPaths(
  selected: Readonly<SelectedSubgraph>,
): boolean {
  const view = selected.view;
  return (
    "intent" in view &&
    view.intent === "loads" &&
    selected.paths.length === 4 &&
    new Set(selected.paths.map((path) => path.end.terminal.deviceUid)).size ===
      2 &&
    selected.paths.every(
      (path) => path.steps.length === 1 && path.steps[0]?.kind === "conductor",
    )
  );
}

/** Keep an external load straight ahead of the source's location group. The
 * local branch must turn outwards before ELK routes it back into that group. */
export function compareDirectLoadsUses(
  context: PresentationContext,
  left: EndpointUse,
  right: EndpointUse,
): number {
  const target = (use: EndpointUse) =>
    required(
      use.edge.endpoints.find((t) => !sameTerminal(t, use.terminal)),
      "Direct load target",
    );
  const leftTarget = target(left),
    rightTarget = target(right);
  const sourceLocation = locationIdentity(
    context.deviceByUid.get(left.terminal.deviceUid) as IrDevice,
  );
  const sameLocation = (t: TerminalId) =>
    compareLocationIdentity(
      sourceLocation,
      locationIdentity(context.deviceByUid.get(t.deviceUid) as IrDevice),
    ) === 0;
  return (
    Number(sameLocation(leftTarget)) - Number(sameLocation(rightTarget)) ||
    -compareTerminalId(leftTarget, rightTarget, (uid) =>
      designationFor(context, uid),
    )
  );
}
