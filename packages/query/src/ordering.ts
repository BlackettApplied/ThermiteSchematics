import type { CableConductorId } from "@thermite/compiler";

import type {
  ConductiveEdgeView,
  ConductiveElementView,
  DeviceView,
  NetSummaryView,
  PotentialView,
  ProjectObjectKind,
  ProjectObjectView,
  ProjectRelationView,
  TerminalView,
} from "./types.js";

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSequence<Value>(
  left: readonly Value[],
  right: readonly Value[],
  compare: (left: Value, right: Value) => number,
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const order = compare(left[index]!, right[index]!);
    if (order !== 0) return order;
  }
  return compareNumber(left.length, right.length);
}

function compareOptional<Value>(
  left: Value | undefined,
  right: Value | undefined,
  compare: (left: Value, right: Value) => number,
): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compare(left, right);
}

export const compareAlias = compareText;

const PROJECT_OBJECT_KIND_ORDER: Readonly<Record<ProjectObjectKind, number>> = {
  device: 0,
  wire: 1,
  jumper: 2,
  cable: 3,
  relation: 4,
  potential: 5,
};

export function objectDisplay(object: ProjectObjectView): string {
  return object.designation ?? `${object.kind}:${object.uid}`;
}

export function compareProjectObjectView(
  left: ProjectObjectView,
  right: ProjectObjectView,
): number {
  return (
    compareText(objectDisplay(left), objectDisplay(right)) ||
    PROJECT_OBJECT_KIND_ORDER[left.kind] -
      PROJECT_OBJECT_KIND_ORDER[right.kind] ||
    compareText(left.uid, right.uid)
  );
}

export function compareTerminalView(
  left: TerminalView,
  right: TerminalView,
): number {
  return (
    compareText(left.deviceDesignation, right.deviceDesignation) ||
    compareText(left.id.terminalKey, right.id.terminalKey) ||
    compareText(left.id.deviceUid, right.id.deviceUid)
  );
}

export function comparePotentialView(
  left: PotentialView,
  right: PotentialView,
): number {
  return compareText(left.name, right.name) || compareText(left.uid, right.uid);
}

const CONDUCTIVE_KIND_ORDER: Readonly<
  Record<ConductiveElementView["kind"], number>
> = { wire: 0, jumper: 1, cable_conductor: 2 };

export function compareConductiveElementView(
  left: ConductiveElementView,
  right: ConductiveElementView,
): number {
  const kindOrder =
    CONDUCTIVE_KIND_ORDER[left.kind] - CONDUCTIVE_KIND_ORDER[right.kind];
  if (kindOrder !== 0) return kindOrder;
  const displayOrder = compareText(left.display, right.display);
  if (displayOrder !== 0) return displayOrder;

  if (left.kind === "cable_conductor") {
    const other = right as Extract<
      ConductiveElementView,
      { readonly kind: "cable_conductor" }
    >;
    return (
      compareText(left.cableUid, other.cableUid) ||
      compareText(left.conductorId, other.conductorId)
    );
  }
  return compareText(
    left.uid,
    (
      right as Extract<
        ConductiveElementView,
        { readonly kind: typeof left.kind }
      >
    ).uid,
  );
}

export function compareConductiveEdgeView(
  left: ConductiveEdgeView,
  right: ConductiveEdgeView,
): number {
  return (
    compareConductiveElementView(left.element, right.element) ||
    compareTerminalView(left.endpoints[0], right.endpoints[0]) ||
    compareTerminalView(left.endpoints[1], right.endpoints[1])
  );
}

export interface ComparableFunctionView {
  readonly key: string;
  readonly kind: string;
  readonly normalState?: "open" | "closed";
  readonly direction?: "input" | "output";
  readonly terminals: readonly TerminalView[];
}

export function compareFunctionView(
  left: ComparableFunctionView,
  right: ComparableFunctionView,
): number {
  return (
    compareText(left.key, right.key) ||
    compareText(left.kind, right.kind) ||
    compareOptional(left.normalState, right.normalState, compareText) ||
    compareOptional(left.direction, right.direction, compareText) ||
    compareSequence(left.terminals, right.terminals, compareTerminalView)
  );
}

export interface ComparableGangedGroupView {
  readonly id: string;
  readonly functionKeys: readonly string[];
}

export function compareGangedGroupView(
  left: ComparableGangedGroupView,
  right: ComparableGangedGroupView,
): number {
  return (
    compareText(left.id, right.id) ||
    compareSequence(left.functionKeys, right.functionKeys, compareText)
  );
}

export interface ComparableInternalRelationView {
  readonly verb: string;
  readonly fromFunctionKey: string;
  readonly toFunctionKey: string;
}

export function compareInternalRelationView(
  left: ComparableInternalRelationView,
  right: ComparableInternalRelationView,
): number {
  return (
    compareText(left.verb, right.verb) ||
    compareText(left.fromFunctionKey, right.fromFunctionKey) ||
    compareText(left.toFunctionKey, right.toFunctionKey)
  );
}

export function compareProjectRelationView(
  left: ProjectRelationView,
  right: ProjectRelationView,
): number {
  return (
    compareText(left.verb, right.verb) ||
    compareText(left.from.designation, right.from.designation) ||
    compareText(left.to.designation, right.to.designation) ||
    compareText(left.uid, right.uid)
  );
}

export type RelationDirection = "incoming" | "outgoing" | "self";
export interface ComparableRelationNeighbor {
  readonly relation: ProjectRelationView;
  readonly direction: RelationDirection;
  readonly otherDevice: DeviceView;
}

const RELATION_DIRECTION_ORDER: Readonly<Record<RelationDirection, number>> = {
  incoming: 0,
  outgoing: 1,
  self: 2,
};

export function compareRelationNeighbor(
  left: ComparableRelationNeighbor,
  right: ComparableRelationNeighbor,
): number {
  return (
    compareProjectRelationView(left.relation, right.relation) ||
    RELATION_DIRECTION_ORDER[left.direction] -
      RELATION_DIRECTION_ORDER[right.direction] ||
    compareText(left.otherDevice.designation, right.otherDevice.designation) ||
    compareText(left.otherDevice.uid, right.otherDevice.uid)
  );
}

export const compareIncidentProjectRelationView = compareRelationNeighbor;

export interface ComparableConductiveNeighbor {
  readonly terminal: TerminalView;
  readonly element: ConductiveElementView;
  readonly otherTerminal: TerminalView;
  readonly otherDevice: DeviceView;
}

export function compareConductiveNeighbor(
  left: ComparableConductiveNeighbor,
  right: ComparableConductiveNeighbor,
): number {
  return (
    compareTerminalView(left.terminal, right.terminal) ||
    compareConductiveElementView(left.element, right.element) ||
    compareTerminalView(left.otherTerminal, right.otherTerminal) ||
    compareText(left.otherDevice.designation, right.otherDevice.designation) ||
    compareText(left.otherDevice.uid, right.otherDevice.uid)
  );
}

export interface ComparableTraceVisit {
  readonly terminal: TerminalView;
  readonly hops: number;
  readonly via?: {
    readonly from: TerminalView;
    readonly element: ConductiveElementView;
  };
}

function compareTraceVia(
  left: NonNullable<ComparableTraceVisit["via"]>,
  right: NonNullable<ComparableTraceVisit["via"]>,
): number {
  return (
    compareTerminalView(left.from, right.from) ||
    compareConductiveElementView(left.element, right.element)
  );
}

export function compareTraceVisit(
  left: ComparableTraceVisit,
  right: ComparableTraceVisit,
): number {
  return (
    compareNumber(left.hops, right.hops) ||
    compareTerminalView(left.terminal, right.terminal) ||
    compareOptional(left.via, right.via, compareTraceVia)
  );
}

export interface ComparableTraceComponent {
  readonly net: NetSummaryView;
  readonly roots: readonly TerminalView[];
}

export function compareTraceComponent(
  left: ComparableTraceComponent,
  right: ComparableTraceComponent,
): number {
  return (
    compareOptional(left.roots[0], right.roots[0], compareTerminalView) ||
    compareText(left.net.id, right.net.id) ||
    compareSequence(
      left.roots.slice(1),
      right.roots.slice(1),
      compareTerminalView,
    )
  );
}

export function compareCableConductorId(
  left: CableConductorId,
  right: CableConductorId,
): number {
  return (
    compareText(left.cableUid, right.cableUid) ||
    compareText(left.conductorId, right.conductorId)
  );
}

export interface ComparableCableConductorView {
  readonly id: CableConductorId;
  readonly display: string;
  readonly endpoints: readonly [TerminalView, TerminalView];
}

export function compareCableConductorView(
  left: ComparableCableConductorView,
  right: ComparableCableConductorView,
): number {
  return (
    compareText(left.id.conductorId, right.id.conductorId) ||
    compareText(left.id.cableUid, right.id.cableUid) ||
    compareText(left.display, right.display) ||
    compareTerminalView(left.endpoints[0], right.endpoints[0]) ||
    compareTerminalView(left.endpoints[1], right.endpoints[1])
  );
}
