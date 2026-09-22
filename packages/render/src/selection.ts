import {
  compareConductiveElementId,
  type ConductiveElementId,
  type ElectricalIr,
  type FunctionId,
  type IrDevice,
  type IrDeviceType,
  type IrFunction,
  type IrPotential,
  type TerminalId,
} from "@thermite/compiler";
import type {
  ConductiveEdgeView,
  NetResult,
  ObjectSelector,
  QueryEngine,
  QueryError,
} from "@thermite/query";

import {
  incompleteConductorsPathError,
  incompleteControlPathError,
  incompleteLoadsPathError,
  incompletePowerPathError,
  incompleteTracePathError,
  InvalidSymbolMappingError,
  unsupportedSymbolMappingError,
  type IncompletePathError,
  type UnsupportedSymbolMappingError,
} from "./errors.js";
import {
  materializedTraceRootFunctions,
  traceRootRuleForType,
  validateTraceRootRules,
  type TraceRootPortRole,
  type TraceRootPortRule,
  type TraceRootRule,
} from "./intent-rules.js";
import {
  compareDeviceUid,
  compareFunctionId,
  compareStructuralFunctionId,
  compareTerminalId,
  compareText,
  functionIdKey,
  terminalIdKey,
} from "./ordering.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  projectDeviceTypeSymbolMappings,
  type AggregateSymbolRule,
  type BoundaryTerminalRule,
  type DeviceTypeSymbolMapping,
  type FunctionSymbolRule,
} from "./symbols/mappings.js";
import { SYMBOL_CATALOG } from "./symbols/catalog.js";
import {
  isFunctionTraversable,
  resolveSelectedSymbolRule,
  validateMaterializedFunctionFacts,
} from "./symbols/validate.js";
import type { SymbolDefinition } from "./symbols/types.js";
import type {
  NormalizedDeviceSchematicView,
  NormalizedIntentSchematicView,
  SelectedBoundary,
  SelectedConductorStep,
  SelectedFunctionStep,
  SelectedPath,
  SelectedSubgraph,
} from "./types.js";

interface ConductorSearchEdge {
  readonly kind: "conductor";
  readonly elementId: ConductiveElementId;
  readonly from: TerminalId;
  readonly to: TerminalId;
  readonly netId: string;
}

interface FunctionSearchEdge {
  readonly kind: "function";
  readonly functionId: FunctionId;
  readonly from: TerminalId;
  readonly to: TerminalId;
  readonly normalState?: "open" | "closed";
}

type SearchEdge = ConductorSearchEdge | FunctionSearchEdge;

interface Predecessor {
  readonly previous: TerminalId;
  readonly edge: SearchEdge;
}

interface BoundaryCandidate {
  readonly classRank: number;
  readonly distance: number;
  readonly displayName?: string;
  readonly potentialUid?: string;
  readonly boundary: SelectedBoundary;
  readonly functionIds: readonly FunctionId[];
}

type SearchSpec =
  | { readonly kind: "control-input"; readonly lane: "input" }
  | { readonly kind: "control-return"; readonly lane: "return" }
  | {
      readonly kind: "power-phase";
      readonly lane: string;
      readonly laneRank: number;
    }
  | { readonly kind: "power-pe"; readonly lane: string };

interface SearchSuccess {
  readonly candidate: BoundaryCandidate;
  readonly path: SelectedPath;
}

type SearchResult =
  | { readonly ok: true; readonly value?: SearchSuccess }
  | { readonly ok: false; readonly error: QueryError };

interface IrConductor {
  readonly id: ConductiveElementId;
  readonly endpoints: readonly [TerminalId, TerminalId];
}

interface SymbolMappingContext {
  readonly ir: Readonly<ElectricalIr>;
  readonly mappings: readonly DeviceTypeSymbolMapping[];
  readonly deviceByUid: ReadonlyMap<string, IrDevice>;
  readonly deviceTypeById: ReadonlyMap<string, IrDeviceType>;
  readonly mappingByTypeId: ReadonlyMap<string, DeviceTypeSymbolMapping>;
  readonly functionByKey: ReadonlyMap<string, IrFunction>;
}

interface SelectionContext extends SymbolMappingContext {
  readonly view: NormalizedDeviceSchematicView;
  readonly engine: QueryEngine;
  readonly terminalByKey: ReadonlyMap<
    string,
    ElectricalIr["terminals"][number]
  >;
  readonly functionAdjacency: ReadonlyMap<
    string,
    readonly FunctionSearchEdge[]
  >;
  readonly potentialAnchors: ReadonlyMap<string, readonly IrPotential[]>;
  readonly conductorByKey: ReadonlyMap<string, IrConductor>;
  readonly netCache: Map<string, NetResult>;
  readonly verifiedConductors: Set<string>;
}

export interface SelectSemanticSubgraphRequest {
  readonly ir: Readonly<ElectricalIr>;
  readonly view: NormalizedDeviceSchematicView;
  readonly engine: QueryEngine;
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
}

export type SelectSemanticSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        QueryError | IncompletePathError | UnsupportedSymbolMappingError;
    };

export interface SelectTraceSubgraphRequest extends SelectSemanticSubgraphRequest {
  readonly target: {
    readonly deviceUid: string;
    readonly designation: string;
  };
  readonly includePower: boolean;
}

export type IncompleteTraceSelectionError = Extract<
  IncompletePathError,
  { readonly intent: "trace" }
>;

export type SelectTraceSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteTraceSelectionError
        | UnsupportedSymbolMappingError;
    };

export interface SelectCableConductorsRequest {
  readonly ir: Readonly<ElectricalIr>;
  readonly root: ObjectSelector;
  readonly engine: QueryEngine;
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
}

export interface CableConductorSelection {
  readonly cableUid: string;
  readonly designation: string;
  readonly paths: readonly SelectedPath[];
  readonly deviceUids: readonly string[];
  readonly terminalIds: readonly TerminalId[];
  readonly functionIds: readonly FunctionId[];
  readonly conductiveElementIds: readonly ConductiveElementId[];
  readonly netIds: readonly string[];
}

export type IncompleteCableConductorSelectionError = Extract<
  IncompletePathError,
  { readonly intent: "conductors" }
>;

export type SelectCableConductorsResult =
  | { readonly ok: true; readonly value: CableConductorSelection }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteCableConductorSelectionError
        | UnsupportedSymbolMappingError;
    };

export interface SelectCableConductorSubgraphRequest extends SelectCableConductorsRequest {
  readonly view: Extract<
    NormalizedIntentSchematicView,
    { readonly intent: "conductors" }
  >;
}

export type SelectCableConductorSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteCableConductorSelectionError
        | UnsupportedSymbolMappingError;
    };

export interface SelectLoadsSubgraphRequest extends SelectSemanticSubgraphRequest {
  readonly catalog?: readonly SymbolDefinition[];
}

export type IncompleteLoadsSelectionError = Extract<
  IncompletePathError,
  { readonly intent: "loads" }
>;

export type SelectLoadsSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteLoadsSelectionError
        | UnsupportedSymbolMappingError;
    };

function cloneTerminal(id: TerminalId): TerminalId {
  return Object.freeze({
    deviceUid: id.deviceUid,
    terminalKey: id.terminalKey,
  });
}

function cloneFunction(id: FunctionId): FunctionId {
  return Object.freeze({
    deviceUid: id.deviceUid,
    functionKey: id.functionKey,
  });
}

function cloneConductor(id: ConductiveElementId): ConductiveElementId {
  return id.kind === "cable_conductor"
    ? Object.freeze({
        kind: id.kind,
        cableUid: id.cableUid,
        conductorId: id.conductorId,
      })
    : Object.freeze({ kind: id.kind, uid: id.uid });
}

function conductorKey(id: ConductiveElementId): string {
  return id.kind === "cable_conductor"
    ? JSON.stringify([id.kind, id.cableUid, id.conductorId])
    : JSON.stringify([id.kind, id.uid]);
}

function reconstructedElementId(edge: ConductiveEdgeView): ConductiveElementId {
  switch (edge.element.kind) {
    case "wire":
      return { kind: "wire", uid: edge.element.uid };
    case "jumper":
      return { kind: "jumper", uid: edge.element.uid };
    case "cable_conductor":
      return {
        kind: "cable_conductor",
        cableUid: edge.element.cableUid,
        conductorId: edge.element.conductorId,
      };
  }
}

function sameTerminal(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

function sameEndpointPair(
  left: readonly [TerminalId, TerminalId],
  right: readonly [TerminalId, TerminalId],
): boolean {
  return (
    (sameTerminal(left[0], right[0]) && sameTerminal(left[1], right[1])) ||
    (sameTerminal(left[0], right[1]) && sameTerminal(left[1], right[0]))
  );
}

function addUnique<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
  description: string,
): void {
  if (map.has(key)) throw new Error(`Duplicate ${description}.`);
  map.set(key, value);
}

function irConductors(ir: Readonly<ElectricalIr>): readonly IrConductor[] {
  return [
    ...ir.wires.map((wire) => ({
      id: { kind: "wire" as const, uid: wire.uid },
      endpoints: [
        wire.endpoints[0].terminal,
        wire.endpoints[1].terminal,
      ] as const,
    })),
    ...ir.jumpers.map((jumper) => ({
      id: { kind: "jumper" as const, uid: jumper.uid },
      endpoints: [
        jumper.endpoints[0].terminal,
        jumper.endpoints[1].terminal,
      ] as const,
    })),
    ...ir.cableConductors.map((conductor) => ({
      id: {
        kind: "cable_conductor" as const,
        cableUid: conductor.cableUid,
        conductorId: conductor.id.conductorId,
      },
      endpoints: [
        conductor.endpoints[0].terminal,
        conductor.endpoints[1].terminal,
      ] as const,
    })),
  ];
}

function functionMappingOrder(
  context: SymbolMappingContext,
  id: FunctionId,
): number {
  const device = context.deviceByUid.get(id.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (mapping === undefined) return Number.MAX_SAFE_INTEGER;
  const directIndex = mapping.functions.findIndex(
    ({ functionKey }) => functionKey === id.functionKey,
  );
  if (directIndex >= 0) return directIndex;
  for (
    let aggregateIndex = 0;
    aggregateIndex < mapping.aggregates.length;
    aggregateIndex++
  ) {
    const memberIndex = mapping.aggregates[
      aggregateIndex
    ]!.functionKeys.indexOf(id.functionKey);
    if (memberIndex >= 0) {
      return mapping.functions.length + aggregateIndex * 1_000 + memberIndex;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function designationFor(
  context: SymbolMappingContext,
  deviceUid: string,
): string {
  return context.deviceByUid.get(deviceUid)?.designation ?? "";
}

function compareCompleteTerminal(
  context: SymbolMappingContext,
  left: TerminalId,
  right: TerminalId,
): number {
  return compareTerminalId(left, right, (uid) => designationFor(context, uid));
}

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

function compareSelectedStep(
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

function compareControlSelection(
  context: SelectionContext,
  left: SearchSuccess,
  right: SearchSuccess,
): number {
  const ranked =
    left.candidate.classRank - right.candidate.classRank ||
    left.candidate.distance - right.candidate.distance;
  if (ranked !== 0) return ranked;
  const count = Math.min(left.path.steps.length, right.path.steps.length);
  for (let index = 0; index < count; index++) {
    const compared = compareSelectedStep(
      context,
      left.path.steps[index]!,
      right.path.steps[index]!,
    );
    if (compared !== 0) return compared;
  }
  return (
    left.path.steps.length - right.path.steps.length ||
    compareText(left.path.id, right.path.id)
  );
}

function buildFunctionAdjacency(
  ir: Readonly<ElectricalIr>,
  view: NormalizedDeviceSchematicView,
  mappingByTypeId: ReadonlyMap<string, DeviceTypeSymbolMapping>,
  deviceByUid: ReadonlyMap<string, IrDevice>,
):
  | {
      readonly ok: true;
      readonly value: ReadonlyMap<string, readonly FunctionSearchEdge[]>;
    }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const adjacency = new Map<string, FunctionSearchEdge[]>();
  const typeById = new Map(ir.deviceTypes.map((type) => [type.id, type]));
  for (const materialized of ir.functions) {
    const device = deviceByUid.get(materialized.id.deviceUid);
    const mapping =
      device === undefined ? undefined : mappingByTypeId.get(device.typeId);
    const rule = mapping?.functions.find(
      (candidate) =>
        candidate.functionKey === materialized.id.functionKey &&
        candidate.families.includes(view.family) &&
        isFunctionTraversable(view.family, candidate.traversalRole),
    );
    if (rule === undefined) continue;
    const deviceType =
      device === undefined ? undefined : typeById.get(device.typeId);
    try {
      if (deviceType === undefined || materialized.terminals.length !== 2) {
        throw new InvalidSymbolMappingError("Invalid traversal function.");
      }
      validateMaterializedFunctionFacts(deviceType, materialized);
    } catch (error) {
      if (!(error instanceof InvalidSymbolMappingError)) throw error;
      return {
        ok: false,
        error: unsupportedSymbolMappingError({
          family: view.family,
          deviceUid: materialized.id.deviceUid,
          typeId: device?.typeId ?? "<missing>",
          functionKey: materialized.id.functionKey,
          root: view.root.designation,
        }),
      };
    }
    const [first, second] = materialized.terminals;
    const state =
      materialized.kind === "contact"
        ? { normalState: materialized.normal_state }
        : {};
    const forward: FunctionSearchEdge = {
      kind: "function",
      functionId: materialized.id,
      from: first!,
      to: second!,
      ...state,
    };
    const reverse: FunctionSearchEdge = {
      kind: "function",
      functionId: materialized.id,
      from: second!,
      to: first!,
      ...state,
    };
    adjacency.set(terminalIdKey(first!), [
      ...(adjacency.get(terminalIdKey(first!)) ?? []),
      forward,
    ]);
    adjacency.set(terminalIdKey(second!), [
      ...(adjacency.get(terminalIdKey(second!)) ?? []),
      reverse,
    ]);
  }
  return {
    ok: true,
    value: new Map(
      [...adjacency].map(([key, edges]) => [key, Object.freeze(edges)]),
    ),
  };
}

function createSymbolMappingContext(
  ir: Readonly<ElectricalIr>,
  mappings: readonly DeviceTypeSymbolMapping[],
): SymbolMappingContext {
  const deviceTypeById = new Map<string, IrDeviceType>();
  for (const deviceType of ir.deviceTypes) {
    addUnique(
      deviceTypeById,
      deviceType.id,
      deviceType,
      `device type ${deviceType.id}`,
    );
  }
  const deviceByUid = new Map<string, IrDevice>();
  for (const device of ir.devices) {
    addUnique(deviceByUid, device.uid, device, `device UID ${device.uid}`);
  }
  const mappingByTypeId = new Map<string, DeviceTypeSymbolMapping>();
  for (const mapping of mappings) {
    addUnique(
      mappingByTypeId,
      mapping.typeId,
      mapping,
      `mapping type ${mapping.typeId}`,
    );
  }
  const functionByKey = new Map<string, IrFunction>();
  for (const materialized of ir.functions) {
    addUnique(
      functionByKey,
      functionIdKey(materialized.id),
      materialized,
      `function ${functionIdKey(materialized.id)}`,
    );
  }
  return {
    ir,
    mappings,
    deviceByUid,
    deviceTypeById,
    mappingByTypeId,
    functionByKey,
  };
}

function createSelectionContext(
  request: SelectSemanticSubgraphRequest,
  includeFunctionAdjacency = true,
):
  | { readonly ok: true; readonly value: SelectionContext }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  const mappingContext = createSymbolMappingContext(request.ir, mappings);
  const terminals = new Map<string, ElectricalIr["terminals"][number]>();
  for (const terminal of request.ir.terminals) {
    addUnique(
      terminals,
      terminalIdKey(terminal.id),
      terminal,
      `terminal ${terminalIdKey(terminal.id)}`,
    );
  }
  const potentialAnchors = new Map<string, IrPotential[]>();
  for (const potential of request.ir.potentials) {
    const key = terminalIdKey(potential.terminal);
    potentialAnchors.set(key, [
      ...(potentialAnchors.get(key) ?? []),
      potential,
    ]);
  }
  const conductorByKey = new Map<string, IrConductor>();
  for (const conductor of irConductors(request.ir)) {
    addUnique(
      conductorByKey,
      conductorKey(conductor.id),
      conductor,
      `conductive element ${conductorKey(conductor.id)}`,
    );
  }
  const adjacency = includeFunctionAdjacency
    ? buildFunctionAdjacency(
        request.ir,
        request.view,
        mappingContext.mappingByTypeId,
        mappingContext.deviceByUid,
      )
    : ({
        ok: true,
        value: new Map<string, readonly FunctionSearchEdge[]>(),
      } as const);
  if (!adjacency.ok) return adjacency;
  return {
    ok: true,
    value: {
      ir: request.ir,
      view: request.view,
      engine: request.engine,
      mappings,
      deviceByUid: mappingContext.deviceByUid,
      deviceTypeById: mappingContext.deviceTypeById,
      mappingByTypeId: mappingContext.mappingByTypeId,
      terminalByKey: terminals,
      functionByKey: mappingContext.functionByKey,
      functionAdjacency: adjacency.value,
      potentialAnchors: new Map(
        [...potentialAnchors].map(([key, values]) => [
          key,
          Object.freeze([...values]),
        ]),
      ),
      conductorByKey,
      netCache: new Map(),
      verifiedConductors: new Set(),
    },
  };
}

function netFor(
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

function uniqueNetPotentialName(net: NetResult): string | undefined {
  const names = [...new Set(net.net.potentials.map(({ name }) => name))].sort(
    compareText,
  );
  return names.length === 1 ? names[0] : undefined;
}

function mappedBoundaryFunctionIds(
  context: SelectionContext,
  device: IrDevice,
  mapping: DeviceTypeSymbolMapping,
  rule: BoundaryTerminalRule,
): readonly FunctionId[] {
  const direct = mapping.functions.filter(
    (candidate) =>
      candidate.functionKey === rule.functionKey &&
      candidate.families.includes(context.view.family) &&
      candidate.traversalRole === "source-boundary" &&
      candidate.bindings.some(
        ({ terminalKey }) => terminalKey === rule.terminalKey,
      ),
  );
  const aggregate = mapping.aggregates.filter(
    (candidate) =>
      candidate.functionKeys.includes(rule.functionKey) &&
      candidate.families.includes(context.view.family) &&
      candidate.traversalRole === "source-boundary" &&
      candidate.bindings.some(
        ({ terminalKey, memberFunctionKey }) =>
          terminalKey === rule.terminalKey &&
          memberFunctionKey === rule.functionKey,
      ),
  );
  if (direct.length + aggregate.length !== 1) return [];
  const keys =
    direct.length === 1 ? [direct[0]!.functionKey] : aggregate[0]!.functionKeys;
  const ids = keys
    .map((functionKey) => ({ deviceUid: device.uid, functionKey }))
    .filter((id) => context.functionByKey.has(functionIdKey(id)));
  return ids.length === keys.length ? ids : [];
}

function boundaryLabel(
  context: SelectionContext,
  terminal: TerminalId,
  displayName: string | undefined,
): string {
  if (displayName !== undefined) return displayName;
  const designation = designationFor(context, terminal.deviceUid);
  return `${designation}.${terminal.terminalKey}`;
}

function boundaryCandidate(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  classRank: number,
  kind: SelectedBoundary["kind"],
  functionIds: readonly FunctionId[],
  displayName?: string,
  potentialUid?: string,
): BoundaryCandidate {
  return {
    classRank,
    distance,
    ...(displayName === undefined ? {} : { displayName }),
    ...(potentialUid === undefined ? {} : { potentialUid }),
    boundary: Object.freeze({
      kind,
      terminal: cloneTerminal(terminal),
      netId: net.net.id,
      ...(potentialUid === undefined ? {} : { potentialUid }),
      label: boundaryLabel(context, terminal, displayName),
    }),
    functionIds: Object.freeze(functionIds.map(cloneFunction)),
  };
}

function exactPotentialCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  polarity: "positive" | "return" | "protective_earth",
  classRank: number,
): readonly BoundaryCandidate[] {
  return (context.potentialAnchors.get(terminalIdKey(terminal)) ?? [])
    .filter(({ electrical }) => electrical.polarity === polarity)
    .map((potential) =>
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        classRank,
        "potential",
        [],
        potential.name,
        potential.uid,
      ),
    );
}

function channelCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
): readonly BoundaryCandidate[] {
  const candidates: BoundaryCandidate[] = [];
  for (const materialized of context.functionByKey.values()) {
    if (
      materialized.kind !== "channel" ||
      materialized.direction !== "output" ||
      !materialized.terminals.some((candidate) =>
        sameTerminal(candidate, terminal),
      )
    ) {
      continue;
    }
    const device = context.deviceByUid.get(materialized.id.deviceUid);
    const mapping =
      device === undefined
        ? undefined
        : context.mappingByTypeId.get(device.typeId);
    const rules = mapping?.functions.filter(
      (rule) =>
        rule.functionKey === materialized.id.functionKey &&
        rule.families.includes("control") &&
        rule.traversalRole === "channel-boundary" &&
        rule.bindings.some(
          ({ terminalKey }) => terminalKey === terminal.terminalKey,
        ),
    );
    if (rules?.length !== 1) continue;
    candidates.push(
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        0,
        "channel",
        [materialized.id],
        uniqueNetPotentialName(net),
      ),
    );
  }
  return candidates;
}

function mappedBoundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  boundaryKind: BoundaryTerminalRule["boundaryKind"],
  classRank: number,
  powerLaneRank?: number,
): readonly BoundaryCandidate[] {
  const terminalFact = context.terminalByKey.get(terminalIdKey(terminal));
  const device = context.deviceByUid.get(terminal.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (
    terminalFact === undefined ||
    device === undefined ||
    mapping === undefined
  ) {
    return [];
  }
  const rules = mapping.boundaryTerminals.filter(
    (rule) =>
      rule.boundaryKind === boundaryKind &&
      rule.families.includes(context.view.family) &&
      rule.terminalKey === terminal.terminalKey &&
      terminalFact.role === rule.requiredRole,
  );
  const candidates: BoundaryCandidate[] = [];
  for (const rule of rules) {
    if (powerLaneRank !== undefined) {
      const phaseRules = mapping.boundaryTerminals.filter(
        (candidate) =>
          candidate.boundaryKind === "power-source" &&
          candidate.families.includes("power"),
      );
      if (phaseRules.indexOf(rule) !== powerLaneRank) continue;
    }
    const functionIds = mappedBoundaryFunctionIds(
      context,
      device,
      mapping,
      rule,
    );
    if (functionIds.length === 0) continue;
    candidates.push(
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        classRank,
        boundaryKind === "control-return" ? "return" : "source",
        functionIds,
        uniqueNetPotentialName(net),
      ),
    );
  }
  return candidates;
}

function boundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  spec: SearchSpec,
): readonly BoundaryCandidate[] {
  if (distance <= 0) return [];
  switch (spec.kind) {
    case "control-input":
      return [
        ...channelCandidates(context, terminal, net, distance),
        ...exactPotentialCandidates(
          context,
          terminal,
          net,
          distance,
          "positive",
          1,
        ),
        ...mappedBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          "control-source",
          2,
        ),
      ];
    case "control-return":
      return [
        ...exactPotentialCandidates(
          context,
          terminal,
          net,
          distance,
          "return",
          0,
        ),
        ...mappedBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          "control-return",
          1,
        ),
      ];
    case "power-phase":
      return mappedBoundaryCandidates(
        context,
        terminal,
        net,
        distance,
        "power-source",
        0,
        spec.laneRank,
      );
    case "power-pe":
      return [
        ...exactPotentialCandidates(
          context,
          terminal,
          net,
          distance,
          "protective_earth",
          0,
        ),
        ...mappedBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          "protective-earth-source",
          1,
        ),
      ];
  }
}

function compareBoundaryCandidate(
  context: SelectionContext,
  left: BoundaryCandidate,
  right: BoundaryCandidate,
): number {
  const leftTerminal = left.boundary.terminal;
  const rightTerminal = right.boundary.terminal;
  return (
    left.classRank - right.classRank ||
    left.distance - right.distance ||
    (left.displayName === undefined ? 1 : 0) -
      (right.displayName === undefined ? 1 : 0) ||
    compareText(left.displayName ?? "", right.displayName ?? "") ||
    compareText(
      designationFor(context, leftTerminal.deviceUid),
      designationFor(context, rightTerminal.deviceUid),
    ) ||
    compareText(leftTerminal.terminalKey, rightTerminal.terminalKey) ||
    compareText(leftTerminal.deviceUid, rightTerminal.deviceUid) ||
    compareText(left.potentialUid ?? "", right.potentialUid ?? "")
  );
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

function selectedSteps(
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

function reverseSelectedSteps(
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

function searchPath(
  context: SelectionContext,
  start: TerminalId,
  spec: SearchSpec,
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
    const stops = boundaryCandidates(
      context,
      current,
      net.value,
      distance,
      spec,
    );
    if (stops.length > 0) {
      candidates.push(...stops);
      continue;
    }
    const allowFunctions = spec.kind !== "power-pe";
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
    return { ok: true };
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
  const boundaryAtEnd = spec.kind === "control-return";
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
        ...(spec.kind === "power-phase" || spec.kind === "power-pe"
          ? { constraint: "LAST" as const }
          : {}),
      });
  return {
    ok: true,
    value: {
      candidate,
      path: Object.freeze({
        id: `${context.view.family}:${spec.lane}`,
        lane: spec.lane,
        start: startEndpoint,
        steps: Object.freeze(orientedSteps),
        end: endEndpoint,
      }),
    },
  };
}

interface ResolvedTraceRoot {
  readonly rule: TraceRootRule;
  readonly functionIds: readonly FunctionId[];
  readonly portByRole: ReadonlyMap<TraceRootPortRole, TraceRootPortRule>;
  readonly terminalByRole: ReadonlyMap<TraceRootPortRole, TerminalId>;
}

interface TraceTargetChannel {
  readonly functionId: FunctionId;
  readonly terminal: TerminalId;
  readonly mappingOrder: number;
}

interface TraceTargetStop extends TraceTargetChannel {
  readonly distance: number;
  readonly net: NetResult;
}

interface ConductorSearchTree<Stop> {
  readonly stops: readonly Stop[];
  readonly distances: ReadonlyMap<string, number>;
  readonly predecessors: ReadonlyMap<string, readonly Predecessor[]>;
}

type ConductorSearchTreeResult<Stop> =
  | { readonly ok: true; readonly value: ConductorSearchTree<Stop> }
  | { readonly ok: false; readonly error: QueryError };

function invalidTraceMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid trace mapping: ${detail}`);
}

function deviceTypeFor(
  context: SymbolMappingContext,
  device: IrDevice,
): IrDeviceType {
  const deviceType = context.deviceTypeById.get(device.typeId);
  if (deviceType === undefined) {
    throw new Error(
      `Device type ${JSON.stringify(device.typeId)} is absent from ElectricalIr.`,
    );
  }
  return deviceType;
}

function resolveTraceRoot(
  context: SelectionContext,
  device: IrDevice,
): ResolvedTraceRoot | undefined {
  const rule = traceRootRuleForType(device.typeId);
  if (rule === undefined) return undefined;
  const materialized = materializedTraceRootFunctions(
    rule,
    device.uid,
    deviceTypeFor(context, device),
    context.ir.functions,
  );
  const portByRole = new Map<TraceRootPortRole, TraceRootPortRule>();
  const terminalByRole = new Map<TraceRootPortRole, TerminalId>();
  for (const port of rule.representation.ports) {
    const terminal = context.terminalByKey.get(
      terminalIdKey({
        deviceUid: device.uid,
        terminalKey: port.terminalKey,
      }),
    );
    if (terminal === undefined) {
      invalidTraceMapping(
        `${device.typeId} instance ${JSON.stringify(device.uid)} is missing terminal ${JSON.stringify(port.terminalKey)}.`,
      );
    }
    portByRole.set(port.role, port);
    terminalByRole.set(port.role, terminal.id);
  }
  return {
    rule,
    functionIds: Object.freeze(materialized.map(({ id }) => cloneFunction(id))),
    portByRole,
    terminalByRole,
  };
}

function targetInputChannels(
  context: SelectionContext,
  target: IrDevice,
): readonly TraceTargetChannel[] {
  const mapping = context.mappingByTypeId.get(target.typeId);
  if (mapping === undefined) return [];
  const deviceType = deviceTypeFor(context, target);
  const channels: TraceTargetChannel[] = [];
  for (const materialized of context.functionByKey.values()) {
    if (
      materialized.id.deviceUid !== target.uid ||
      materialized.kind !== "channel" ||
      materialized.direction !== "input"
    ) {
      continue;
    }
    validateMaterializedFunctionFacts(deviceType, materialized);
    const rules = mapping.functions.filter(
      (rule) =>
        rule.functionKey === materialized.id.functionKey &&
        rule.families.includes("control") &&
        rule.traversalRole === "channel-boundary",
    );
    if (rules.length === 0) continue;
    if (rules.length !== 1) {
      invalidTraceMapping(
        `${target.typeId}.${materialized.id.functionKey} has ambiguous input-channel mappings.`,
      );
    }
    const rule = rules[0]!;
    const bindings = rule.bindings.filter(({ terminalKey }) =>
      materialized.terminals.some(
        (terminal) => terminal.terminalKey === terminalKey,
      ),
    );
    if (bindings.length !== 1 || materialized.terminals.length !== 1) {
      invalidTraceMapping(
        `${target.typeId}.${materialized.id.functionKey} must map one input terminal.`,
      );
    }
    channels.push({
      functionId: cloneFunction(materialized.id),
      terminal: cloneTerminal(materialized.terminals[0]!),
      mappingOrder: mapping.functions.indexOf(rule),
    });
  }
  return Object.freeze(
    channels.sort(
      (left, right) =>
        left.mappingOrder - right.mappingOrder ||
        compareCompleteTerminal(context, left.terminal, right.terminal) ||
        compareStructuralFunctionId(left.functionId, right.functionId),
    ),
  );
}

function searchConductors<Stop>(
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

function mappedTraceBoundaryFunctionIds(
  context: SelectionContext,
  terminal: TerminalId,
  boundaryKind: "control-source" | "control-return",
): readonly FunctionId[] {
  const terminalFact = context.terminalByKey.get(terminalIdKey(terminal));
  const device = context.deviceByUid.get(terminal.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (
    terminalFact === undefined ||
    device === undefined ||
    mapping === undefined
  ) {
    return [];
  }
  const locationRules = mapping.boundaryTerminals.filter(
    (rule) =>
      rule.boundaryKind === boundaryKind &&
      rule.families.includes("control") &&
      rule.terminalKey === terminal.terminalKey,
  );
  if (locationRules.length === 0) return [];
  if (
    locationRules.length !== 1 ||
    locationRules[0]!.requiredRole !== terminalFact.role
  ) {
    invalidTraceMapping(
      `${device.typeId}.${terminal.terminalKey} has ambiguous or contradictory ${boundaryKind} metadata.`,
    );
  }
  const boundaryRule = locationRules[0]!;
  const direct = mapping.functions.filter(
    (rule) =>
      rule.functionKey === boundaryRule.functionKey &&
      rule.families.includes("control") &&
      rule.traversalRole === "source-boundary" &&
      rule.bindings.some(
        ({ terminalKey }) => terminalKey === terminal.terminalKey,
      ),
  );
  const aggregate = mapping.aggregates.filter(
    (rule) =>
      rule.functionKeys.includes(boundaryRule.functionKey) &&
      rule.families.includes("control") &&
      rule.traversalRole === "source-boundary" &&
      rule.bindings.some(
        ({ terminalKey, memberFunctionKey }) =>
          terminalKey === terminal.terminalKey &&
          memberFunctionKey === boundaryRule.functionKey,
      ),
  );
  if (direct.length + aggregate.length !== 1) {
    invalidTraceMapping(
      `${device.typeId}.${boundaryRule.functionKey} has ambiguous or contradictory source representation metadata.`,
    );
  }
  const keys =
    direct.length === 1 ? [direct[0]!.functionKey] : aggregate[0]!.functionKeys;
  const deviceType = deviceTypeFor(context, device);
  return Object.freeze(
    keys.map((functionKey) => {
      const materialized = context.functionByKey.get(
        functionIdKey({ deviceUid: device.uid, functionKey }),
      );
      if (materialized === undefined) {
        invalidTraceMapping(
          `${device.typeId}.${functionKey} is not materialized at its boundary.`,
        );
      }
      validateMaterializedFunctionFacts(deviceType, materialized);
      return cloneFunction(materialized.id);
    }),
  );
}

function tracePowerBoundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  role: "positive-supply" | "return-supply",
): readonly BoundaryCandidate[] {
  const polarity = role === "positive-supply" ? "positive" : "return";
  const boundaryKind =
    role === "positive-supply" ? "control-source" : "control-return";
  const functionIds = mappedTraceBoundaryFunctionIds(
    context,
    terminal,
    boundaryKind,
  );
  const potentials = (
    context.potentialAnchors.get(terminalIdKey(terminal)) ?? []
  )
    .filter(({ electrical }) => electrical.polarity === polarity)
    .map((potential) =>
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        0,
        "potential",
        functionIds,
        potential.name,
        potential.uid,
      ),
    );
  return [
    ...potentials,
    ...(functionIds.length === 0
      ? []
      : [
          boundaryCandidate(
            context,
            terminal,
            net,
            distance,
            1,
            role === "positive-supply" ? "source" : "return",
            functionIds,
            uniqueNetPotentialName(net),
          ),
        ]),
  ];
}

function compareTraceTargetStop(
  context: SelectionContext,
  left: TraceTargetStop,
  right: TraceTargetStop,
): number {
  return (
    left.distance - right.distance ||
    left.mappingOrder - right.mappingOrder ||
    compareCompleteTerminal(context, left.terminal, right.terminal) ||
    compareStructuralFunctionId(left.functionId, right.functionId)
  );
}

function selectTraceSignal(
  context: SelectionContext,
  start: TerminalId,
  channels: readonly TraceTargetChannel[],
): SearchResult {
  const channelByTerminal = new Map<string, TraceTargetChannel[]>();
  for (const channel of channels) {
    const key = terminalIdKey(channel.terminal);
    channelByTerminal.set(key, [
      ...(channelByTerminal.get(key) ?? []),
      channel,
    ]);
  }
  const searched = searchConductors(context, start, (terminal, net, distance) =>
    (channelByTerminal.get(terminalIdKey(terminal)) ?? []).map((channel) => ({
      ...channel,
      distance,
      net,
    })),
  );
  if (!searched.ok) return searched;
  if (searched.value.stops.length === 0) return { ok: true };
  const target = [...searched.value.stops].sort((left, right) =>
    compareTraceTargetStop(context, left, right),
  )[0]!;
  const boundary = boundaryCandidate(
    context,
    target.terminal,
    target.net,
    target.distance,
    0,
    "channel",
    [target.functionId],
    uniqueNetPotentialName(target.net),
  );
  const backward = selectedSteps(
    context,
    start,
    target.terminal,
    searched.value.distances,
    searched.value.predecessors,
  );
  return {
    ok: true,
    value: {
      candidate: boundary,
      path: Object.freeze({
        id: "trace:signal",
        lane: "signal",
        start: Object.freeze({ terminal: cloneTerminal(start) }),
        steps: Object.freeze(reverseSelectedSteps(backward)),
        end: Object.freeze({
          terminal: cloneTerminal(target.terminal),
          boundary: boundary.boundary,
          constraint: "LAST" as const,
        }),
      }),
    },
  };
}

function selectTracePowerArm(
  context: SelectionContext,
  start: TerminalId,
  role: "positive-supply" | "return-supply",
): SearchResult {
  const searched = searchConductors(context, start, (terminal, net, distance) =>
    tracePowerBoundaryCandidates(context, terminal, net, distance, role),
  );
  if (!searched.ok) return searched;
  if (searched.value.stops.length === 0) return { ok: true };
  const candidate = [...searched.value.stops].sort((left, right) =>
    compareBoundaryCandidate(context, left, right),
  )[0]!;
  return {
    ok: true,
    value: {
      candidate,
      path: Object.freeze({
        id: `trace:${role}`,
        lane: role,
        start: Object.freeze({
          terminal: cloneTerminal(candidate.boundary.terminal),
          boundary: candidate.boundary,
          constraint: "FIRST" as const,
        }),
        steps: Object.freeze(
          selectedSteps(
            context,
            start,
            candidate.boundary.terminal,
            searched.value.distances,
            searched.value.predecessors,
          ),
        ),
        end: Object.freeze({ terminal: cloneTerminal(start) }),
      }),
    },
  };
}

function incompleteTraceSelectionError(
  context: SelectionContext,
  targetDeviceUid: string,
  segment: IncompleteTraceSelectionError["segment"],
): IncompleteTraceSelectionError {
  return incompleteTracePathError(
    context.view.root.deviceUid,
    targetDeviceUid,
    segment,
    context.view.root.designation,
  ) as IncompleteTraceSelectionError;
}

function terminalDisplayFunctionId(
  context: SymbolMappingContext,
  terminal: TerminalId,
  invalidMapping: (detail: string) => never = invalidTraceMapping,
): FunctionId | undefined {
  const device = context.deviceByUid.get(terminal.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (device === undefined || mapping === undefined) return undefined;
  const rules = mapping.functions.filter(
    (rule) =>
      rule.families.includes("control") &&
      rule.traversalRole === "terminal-display" &&
      rule.bindings.some(
        ({ terminalKey }) => terminalKey === terminal.terminalKey,
      ),
  );
  if (rules.length === 0) return undefined;
  if (rules.length !== 1) {
    invalidMapping(
      `${device.typeId}.${terminal.terminalKey} has ambiguous terminal-display mappings.`,
    );
  }
  const rule = rules[0]!;
  const materialized = context.functionByKey.get(
    functionIdKey({ deviceUid: device.uid, functionKey: rule.functionKey }),
  );
  if (
    materialized === undefined ||
    materialized.terminals.length !== 1 ||
    !sameTerminal(materialized.terminals[0]!, terminal)
  ) {
    invalidMapping(
      `${device.typeId}.${rule.functionKey} is not an exact one-terminal display function.`,
    );
  }
  validateMaterializedFunctionFacts(
    deviceTypeFor(context, device),
    materialized,
  );
  return cloneFunction(materialized.id);
}

function pathTerminalDisplayFunctionIds(
  context: SelectionContext,
  selections: readonly SearchSuccess[],
  invalidMapping: (detail: string) => never,
):
  | { readonly ok: true; readonly value: readonly FunctionId[] }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const endpoints = new Set<string>();
  const touched = new Map<string, TerminalId>();
  for (const { path } of selections) {
    endpoints.add(terminalIdKey(path.start.terminal));
    endpoints.add(terminalIdKey(path.end.terminal));
    for (const step of path.steps) {
      touched.set(terminalIdKey(step.from), step.from);
      touched.set(terminalIdKey(step.to), step.to);
    }
  }
  const ids: FunctionId[] = [];
  for (const terminal of [...touched.values()].sort((left, right) =>
    compareCompleteTerminal(context, left, right),
  )) {
    if (endpoints.has(terminalIdKey(terminal))) continue;
    const functionId = terminalDisplayFunctionId(
      context,
      terminal,
      invalidMapping,
    );
    if (functionId === undefined) {
      const device = context.deviceByUid.get(terminal.deviceUid);
      if (device === undefined) {
        throw new Error(
          "Selected path terminal device is absent from ElectricalIr.",
        );
      }
      return unsupportedRoot(context, device);
    }
    ids.push(functionId);
  }
  return { ok: true, value: Object.freeze(ids) };
}

interface LoadSourceOutput {
  readonly portId: string;
  readonly terminal: TerminalId;
  readonly boundaryKind: "control-source" | "control-return";
}

interface ResolvedLoadSource {
  readonly functionId: FunctionId;
  readonly outputs: readonly LoadSourceOutput[];
}

interface LoadSourceOutputWithNet extends LoadSourceOutput {
  readonly net: NetResult;
}

interface CompleteLoadRepresentation {
  readonly key: string;
  readonly kind: "function" | "aggregate";
  readonly device: IrDevice;
  readonly rule: FunctionSymbolRule | AggregateSymbolRule;
  readonly functionIds: readonly FunctionId[];
  readonly loadTerminals: readonly TerminalId[];
}

interface LoadRepresentationAccumulator {
  readonly key: string;
  readonly kind: "function" | "aggregate";
  readonly device: IrDevice;
  readonly rule: FunctionSymbolRule | AggregateSymbolRule;
  readonly functionIds: readonly FunctionId[];
  readonly loadTerminals: Map<string, TerminalId>;
}

function invalidLoadsMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid loads mapping: ${detail}`);
}

function resolveLoadSource(
  context: SelectionContext,
  catalog: readonly SymbolDefinition[],
):
  | { readonly ok: true; readonly value?: ResolvedLoadSource }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const device = rootDevice(context);
  const mapping = context.mappingByTypeId.get(device.typeId);
  const sourceRules = mapping?.functions.filter(
    (rule) =>
      rule.families.includes("control") &&
      rule.classification === "source" &&
      rule.traversalRole === "source-boundary",
  );
  if (mapping === undefined || sourceRules?.length !== 1) {
    return { ok: true };
  }
  const rule = sourceRules[0]!;
  const materialized = context.functionByKey.get(
    functionIdKey({ deviceUid: device.uid, functionKey: rule.functionKey }),
  );
  if (materialized === undefined) return { ok: true };
  const resolved = resolveSelectedSymbolRule({
    deviceType: deviceTypeFor(context, device),
    deviceUid: device.uid,
    materializedFunctions: context.ir.functions.filter(
      ({ id }) => id.deviceUid === device.uid,
    ),
    functionKey: rule.functionKey,
    family: "control",
    root: context.view.root.designation,
    mapping,
    catalog,
  });
  if (!resolved.ok) return resolved;
  if (
    resolved.value.kind !== "function" ||
    resolved.value.rule.functionKey !== rule.functionKey
  ) {
    return { ok: true };
  }

  const boundaryRules = mapping.boundaryTerminals.filter(
    (candidate) =>
      candidate.functionKey === rule.functionKey &&
      candidate.families.includes("control") &&
      (candidate.boundaryKind === "control-source" ||
        candidate.boundaryKind === "control-return"),
  );
  const positive = boundaryRules.filter(
    ({ boundaryKind }) => boundaryKind === "control-source",
  );
  const returning = boundaryRules.filter(
    ({ boundaryKind }) => boundaryKind === "control-return",
  );
  if (
    boundaryRules.length !== 2 ||
    positive.length !== 1 ||
    returning.length !== 1 ||
    rule.bindings.length !== 2 ||
    new Set(rule.bindings.map(({ terminalKey }) => terminalKey)).size !== 2
  ) {
    return { ok: true };
  }

  const outputs: LoadSourceOutput[] = [];
  for (const binding of rule.bindings) {
    const boundary = boundaryRules.find(
      ({ terminalKey }) => terminalKey === binding.terminalKey,
    );
    const terminal = context.terminalByKey.get(
      terminalIdKey({
        deviceUid: device.uid,
        terminalKey: binding.terminalKey,
      }),
    );
    if (
      boundary === undefined ||
      terminal === undefined ||
      terminal.role !== boundary.requiredRole
    ) {
      return { ok: true };
    }
    outputs.push({
      portId: binding.portId,
      terminal: cloneTerminal(terminal.id),
      boundaryKind: boundary.boundaryKind as
        "control-source" | "control-return",
    });
  }
  return {
    ok: true,
    value: {
      functionId: cloneFunction(materialized.id),
      outputs: Object.freeze(outputs),
    },
  };
}

function compareCompleteLoadRepresentation(
  context: SelectionContext,
  left: CompleteLoadRepresentation,
  right: CompleteLoadRepresentation,
): number {
  return (
    compareDeviceUid(left.device.uid, right.device.uid, (uid) =>
      designationFor(context, uid),
    ) || compareText(left.key, right.key)
  );
}

function selectLoadArm(
  context: SelectionContext,
  source: LoadSourceOutputWithNet,
  load: CompleteLoadRepresentation,
  portId: string,
  terminal: TerminalId,
  sourceFunctionId: FunctionId,
): SearchResult {
  const searched = searchConductors(
    context,
    terminal,
    (candidate, net, distance) =>
      sameTerminal(candidate, source.terminal)
        ? [
            boundaryCandidate(
              context,
              candidate,
              net,
              distance,
              0,
              source.boundaryKind === "control-source" ? "source" : "return",
              [sourceFunctionId],
              uniqueNetPotentialName(net),
            ),
          ]
        : [],
  );
  if (!searched.ok) return searched;
  if (searched.value.stops.length === 0) return { ok: true };
  const candidate = [...searched.value.stops].sort((left, right) =>
    compareBoundaryCandidate(context, left, right),
  )[0]!;
  return {
    ok: true,
    value: {
      candidate,
      path: Object.freeze({
        id: `loads:${load.device.uid}:${load.key}:${portId}`,
        lane: `${load.device.designation}.${load.key}.${portId}`,
        start: Object.freeze({
          terminal: cloneTerminal(source.terminal),
          boundary: candidate.boundary,
          constraint: "FIRST" as const,
        }),
        steps: Object.freeze(
          selectedSteps(
            context,
            terminal,
            source.terminal,
            searched.value.distances,
            searched.value.predecessors,
          ),
        ),
        end: Object.freeze({
          terminal: cloneTerminal(terminal),
          constraint: "LAST" as const,
        }),
      }),
    },
  };
}

function incompleteLoadsSelectionError(
  context: SelectionContext,
): IncompleteLoadsSelectionError {
  return incompleteLoadsPathError(
    context.view.root.deviceUid,
    context.view.root.designation,
  ) as IncompleteLoadsSelectionError;
}

interface RootLane {
  readonly lane: string;
  readonly terminal: TerminalId;
  readonly protectiveEarth: boolean;
}

function rootDevice(context: SelectionContext): IrDevice {
  const device = context.deviceByUid.get(context.view.root.deviceUid);
  if (device === undefined) {
    throw new Error(
      `Normalized root ${JSON.stringify(context.view.root.deviceUid)} is absent from ElectricalIr.`,
    );
  }
  return device;
}

function unsupportedRoot(
  context: SelectionContext,
  device: IrDevice,
  functionKey?: string,
): { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  return {
    ok: false,
    error: unsupportedSymbolMappingError({
      family: context.view.family,
      deviceUid: device.uid,
      typeId: device.typeId,
      ...(functionKey === undefined ? {} : { functionKey }),
      root: context.view.root.designation,
    }),
  };
}

function controlRoot(
  context: SelectionContext,
  device: IrDevice,
):
  | {
      readonly functionId: FunctionId;
      readonly input: TerminalId;
      readonly return: TerminalId;
    }
  | undefined {
  const mapping = context.mappingByTypeId.get(device.typeId);
  const rules = mapping?.functions.filter(
    (rule) =>
      rule.families.includes("control") && rule.traversalRole === "coil-root",
  );
  if (rules?.length !== 1) return undefined;
  const rule = rules[0]!;
  const materialized = context.functionByKey.get(
    functionIdKey({ deviceUid: device.uid, functionKey: rule.functionKey }),
  );
  const inputBinding = rule.bindings.find(({ portId }) => portId === "A1");
  const returnBinding = rule.bindings.find(({ portId }) => portId === "A2");
  if (
    materialized === undefined ||
    inputBinding === undefined ||
    returnBinding === undefined ||
    materialized.terminals.length !== 2
  ) {
    return undefined;
  }
  const input = materialized.terminals.find(
    ({ terminalKey }) => terminalKey === inputBinding.terminalKey,
  );
  const returnTerminal = materialized.terminals.find(
    ({ terminalKey }) => terminalKey === returnBinding.terminalKey,
  );
  if (input === undefined || returnTerminal === undefined) return undefined;
  return {
    functionId: materialized.id,
    input,
    return: returnTerminal,
  };
}

function protectiveEarthRoles(
  mappings: readonly DeviceTypeSymbolMapping[],
): ReadonlySet<string> {
  return new Set(
    mappings.flatMap((mapping) =>
      mapping.boundaryTerminals
        .filter(
          ({ boundaryKind }) => boundaryKind === "protective-earth-source",
        )
        .map(({ requiredRole }) => requiredRole),
    ),
  );
}

function powerRoot(
  context: SelectionContext,
  device: IrDevice,
):
  | {
      readonly lanes: readonly RootLane[];
      readonly functionIds: readonly FunctionId[];
    }
  | undefined {
  const mapping = context.mappingByTypeId.get(device.typeId);
  if (mapping === undefined) return undefined;
  const roles = protectiveEarthRoles(context.mappings);
  const lanes: Omit<RootLane, "rank">[] = [];
  const functionIds = new Map<string, FunctionId>();
  for (const aggregate of mapping.aggregates) {
    if (
      !aggregate.families.includes("power") ||
      aggregate.traversalRole !== "load-boundary"
    ) {
      continue;
    }
    for (const functionKey of aggregate.functionKeys) {
      const id = { deviceUid: device.uid, functionKey };
      if (!context.functionByKey.has(functionIdKey(id))) return undefined;
      functionIds.set(functionIdKey(id), id);
    }
    for (const binding of aggregate.bindings) {
      const terminal = context.terminalByKey.get(
        terminalIdKey({
          deviceUid: device.uid,
          terminalKey: binding.terminalKey,
        }),
      );
      if (terminal === undefined) return undefined;
      lanes.push({
        lane: binding.portId,
        terminal: terminal.id,
        protectiveEarth:
          terminal.role !== undefined && roles.has(terminal.role),
      });
    }
  }
  for (const rule of mapping.functions) {
    if (
      !rule.families.includes("power") ||
      rule.traversalRole !== "load-boundary"
    ) {
      continue;
    }
    const id = { deviceUid: device.uid, functionKey: rule.functionKey };
    if (!context.functionByKey.has(functionIdKey(id))) return undefined;
    functionIds.set(functionIdKey(id), id);
    for (const binding of rule.bindings) {
      const terminal = context.terminalByKey.get(
        terminalIdKey({
          deviceUid: device.uid,
          terminalKey: binding.terminalKey,
        }),
      );
      if (terminal === undefined) return undefined;
      lanes.push({
        lane: binding.portId,
        terminal: terminal.id,
        protectiveEarth:
          terminal.role !== undefined && roles.has(terminal.role),
      });
    }
  }
  if (lanes.length === 0) return undefined;
  const ordered: readonly RootLane[] = [
    ...lanes.filter(({ protectiveEarth }) => !protectiveEarth),
    ...lanes.filter(({ protectiveEarth }) => protectiveEarth),
  ];
  return {
    lanes: Object.freeze(ordered),
    functionIds: Object.freeze([...functionIds.values()]),
  };
}

function selectControlPaths(context: SelectionContext):
  | {
      readonly ok: true;
      readonly paths: readonly SearchSuccess[];
      readonly rootFunctionIds: readonly FunctionId[];
    }
  | {
      readonly ok: false;
      readonly error:
        QueryError | IncompletePathError | UnsupportedSymbolMappingError;
    } {
  const device = rootDevice(context);
  const root = controlRoot(context, device);
  if (root === undefined) return unsupportedRoot(context, device);
  const searches = [
    {
      start: root.input,
      spec: { kind: "control-input", lane: "input" } as const,
    },
    {
      start: root.return,
      spec: { kind: "control-return", lane: "return" } as const,
    },
  ];
  const paths: SearchSuccess[] = [];
  for (const search of searches) {
    const result = searchPath(context, search.start, search.spec);
    if (!result.ok) return result;
    if (result.value === undefined) {
      return {
        ok: false,
        error: incompleteControlPathError(
          device.uid,
          search.spec.lane,
          context.view.root.designation,
        ),
      };
    }
    paths.push(result.value);
  }
  return {
    ok: true,
    paths: Object.freeze(
      paths.sort((left, right) =>
        compareControlSelection(context, left, right),
      ),
    ),
    rootFunctionIds: Object.freeze([cloneFunction(root.functionId)]),
  };
}

function selectPowerPaths(context: SelectionContext):
  | {
      readonly ok: true;
      readonly paths: readonly SearchSuccess[];
      readonly rootFunctionIds: readonly FunctionId[];
    }
  | {
      readonly ok: false;
      readonly error:
        QueryError | IncompletePathError | UnsupportedSymbolMappingError;
    } {
  const device = rootDevice(context);
  const root = powerRoot(context, device);
  if (root === undefined) return unsupportedRoot(context, device);
  const paths: SearchSuccess[] = [];
  let phaseRank = 0;
  for (const lane of root.lanes) {
    const spec: SearchSpec = lane.protectiveEarth
      ? { kind: "power-pe", lane: lane.lane }
      : {
          kind: "power-phase",
          lane: lane.lane,
          laneRank: phaseRank++,
        };
    const result = searchPath(context, lane.terminal, spec);
    if (!result.ok) return result;
    if (result.value === undefined) {
      return {
        ok: false,
        error: incompletePowerPathError(
          device.uid,
          lane.lane,
          context.view.root.designation,
        ),
      };
    }
    paths.push(result.value);
  }
  return {
    ok: true,
    paths: Object.freeze(paths),
    rootFunctionIds: Object.freeze(root.functionIds.map(cloneFunction)),
  };
}

function addTerminal(
  terminals: Map<string, TerminalId>,
  terminal: TerminalId,
): void {
  terminals.set(terminalIdKey(terminal), cloneTerminal(terminal));
}

function buildSelectedSubgraph(
  context: SelectionContext,
  selections: readonly SearchSuccess[],
  rootFunctionIds: readonly FunctionId[],
  provenanceNetIds: readonly string[] = [],
): SelectedSubgraph {
  const terminalIds = new Map<string, TerminalId>();
  const functionIds = new Map<string, FunctionId>();
  const conductiveIds = new Map<string, ConductiveElementId>();
  const netIds = new Set<string>(provenanceNetIds);

  for (const id of rootFunctionIds) {
    functionIds.set(functionIdKey(id), cloneFunction(id));
  }
  for (const selection of selections) {
    addTerminal(terminalIds, selection.path.start.terminal);
    addTerminal(terminalIds, selection.path.end.terminal);
    if (selection.path.start.boundary !== undefined) {
      netIds.add(selection.path.start.boundary.netId);
    }
    if (selection.path.end.boundary !== undefined) {
      netIds.add(selection.path.end.boundary.netId);
    }
    for (const id of selection.candidate.functionIds) {
      functionIds.set(functionIdKey(id), cloneFunction(id));
    }
    for (const step of selection.path.steps) {
      addTerminal(terminalIds, step.from);
      addTerminal(terminalIds, step.to);
      if (step.kind === "conductor") {
        conductiveIds.set(
          conductorKey(step.elementId),
          cloneConductor(step.elementId),
        );
        netIds.add(step.netId);
      } else {
        functionIds.set(
          functionIdKey(step.functionId),
          cloneFunction(step.functionId),
        );
      }
    }
  }
  for (const id of functionIds.values()) {
    const materialized = context.functionByKey.get(functionIdKey(id));
    if (materialized === undefined) {
      throw new Error(
        `Selected function ${functionIdKey(id)} is absent from ElectricalIr.`,
      );
    }
    for (const terminal of materialized.terminals) {
      addTerminal(terminalIds, terminal);
    }
  }

  const deviceUids = new Set<string>([context.view.root.deviceUid]);
  for (const terminal of terminalIds.values()) {
    deviceUids.add(terminal.deviceUid);
  }
  for (const id of functionIds.values()) deviceUids.add(id.deviceUid);

  const sortedDevices = [...deviceUids].sort((left, right) =>
    compareDeviceUid(left, right, (uid) => designationFor(context, uid)),
  );
  const sortedTerminals = [...terminalIds.values()].sort((left, right) =>
    compareCompleteTerminal(context, left, right),
  );
  const sortedFunctions = [...functionIds.values()].sort((left, right) =>
    compareFunctionId(
      left,
      right,
      (uid) => designationFor(context, uid),
      (id) => functionMappingOrder(context, id),
    ),
  );
  const sortedConductors = [...conductiveIds.values()].sort(
    compareConductiveElementId,
  );
  const sortedNets = [...netIds].sort(compareText);

  return Object.freeze({
    view: context.view,
    paths: Object.freeze(selections.map(({ path }) => path)),
    deviceUids: Object.freeze(sortedDevices),
    terminalIds: Object.freeze(sortedTerminals.map(cloneTerminal)),
    functionIds: Object.freeze(sortedFunctions.map(cloneFunction)),
    conductiveElementIds: Object.freeze(sortedConductors.map(cloneConductor)),
    netIds: Object.freeze(sortedNets),
  });
}

function invalidCableMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid cable mapping: ${detail}`);
}

function incompleteCableConductorSelectionError(
  cableUid: string,
  designation: string,
): IncompleteCableConductorSelectionError {
  return incompleteConductorsPathError(
    cableUid,
    designation,
  ) as IncompleteCableConductorSelectionError;
}

function unsupportedCableEndpoint(
  context: SymbolMappingContext,
  device: IrDevice,
  root: string,
): { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  return Object.freeze({
    ok: false,
    error: unsupportedSymbolMappingError({
      family: "control",
      deviceUid: device.uid,
      typeId: device.typeId,
      root,
    }),
  });
}

export function selectCableConductors(
  request: SelectCableConductorsRequest,
): SelectCableConductorsResult {
  const queried = request.engine.cable(request.root);
  if (!queried.ok) return queried;
  const { cable, conductors } = queried.value;
  const authoredCable = request.ir.cables.find(({ uid }) => uid === cable.uid);
  if (
    authoredCable === undefined ||
    authoredCable.designation !== cable.designation ||
    authoredCable.typeId !== cable.typeId
  ) {
    throw new Error("Query cable identity disagrees with ElectricalIr.");
  }
  if (conductors.length === 0) {
    return Object.freeze({
      ok: false,
      error: incompleteCableConductorSelectionError(
        cable.uid,
        cable.designation,
      ),
    });
  }

  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  const context = createSymbolMappingContext(request.ir, mappings);
  const orderedConductors = [...conductors].sort((left, right) =>
    compareText(left.id.conductorId, right.id.conductorId),
  );
  const paths: SelectedPath[] = [];
  const terminalIds = new Map<string, TerminalId>();
  const functionIds = new Map<string, FunctionId>();
  const conductiveElementIds = new Map<string, ConductiveElementId>();
  const netIds = new Set<string>();
  const seenConductorIds = new Set<string>();

  for (const conductor of orderedConductors) {
    if (
      conductor.id.cableUid !== cable.uid ||
      seenConductorIds.has(conductor.id.conductorId)
    ) {
      throw new Error("Query cable conductor identity is inconsistent.");
    }
    seenConductorIds.add(conductor.id.conductorId);
    const elementId: ConductiveElementId = {
      kind: "cable_conductor",
      cableUid: cable.uid,
      conductorId: conductor.id.conductorId,
    };
    const authoredConductor = request.ir.cableConductors.find(
      ({ id }) =>
        id.cableUid === cable.uid &&
        id.conductorId === conductor.id.conductorId,
    );
    const queryEndpoints = conductor.endpoints.map(({ id }) => id) as [
      TerminalId,
      TerminalId,
    ];
    if (
      authoredConductor === undefined ||
      !sameEndpointPair(
        [
          authoredConductor.endpoints[0].terminal,
          authoredConductor.endpoints[1].terminal,
        ],
        queryEndpoints,
      )
    ) {
      throw new Error(
        `Query cable endpoints disagree with ElectricalIr for ${conductorKey(elementId)}.`,
      );
    }
    const [start, end] = [...queryEndpoints].sort((left, right) =>
      compareCompleteTerminal(context, left, right),
    ) as [TerminalId, TerminalId];

    for (const terminal of [start, end]) {
      addTerminal(terminalIds, terminal);
      const device = context.deviceByUid.get(terminal.deviceUid);
      if (device === undefined) {
        throw new Error(
          "Cable endpoint terminal device is absent from ElectricalIr.",
        );
      }
      const functionId = terminalDisplayFunctionId(
        context,
        terminal,
        invalidCableMapping,
      );
      if (functionId === undefined) {
        return unsupportedCableEndpoint(context, device, cable.designation);
      }
      functionIds.set(functionIdKey(functionId), functionId);
    }

    const clonedElementId = cloneConductor(elementId);
    conductiveElementIds.set(conductorKey(elementId), clonedElementId);
    netIds.add(conductor.net.id);
    paths.push(
      Object.freeze({
        id: `cable:${conductor.id.conductorId}`,
        lane: conductor.id.conductorId,
        start: Object.freeze({ terminal: cloneTerminal(start) }),
        steps: Object.freeze([
          Object.freeze({
            kind: "conductor",
            elementId: clonedElementId,
            from: cloneTerminal(start),
            to: cloneTerminal(end),
            netId: conductor.net.id,
          }),
        ]),
        end: Object.freeze({ terminal: cloneTerminal(end) }),
      }),
    );
  }

  const devices = new Set(
    [...terminalIds.values()].map(({ deviceUid }) => deviceUid),
  );
  const sortedDevices = [...devices].sort((left, right) =>
    compareDeviceUid(left, right, (uid) => designationFor(context, uid)),
  );
  const sortedTerminals = [...terminalIds.values()].sort((left, right) =>
    compareCompleteTerminal(context, left, right),
  );
  const sortedFunctions = [...functionIds.values()].sort((left, right) =>
    compareFunctionId(
      left,
      right,
      (uid) => designationFor(context, uid),
      (id) => functionMappingOrder(context, id),
    ),
  );
  const sortedElements = [...conductiveElementIds.values()].sort(
    compareConductiveElementId,
  );

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cableUid: cable.uid,
      designation: cable.designation,
      paths: Object.freeze(paths),
      deviceUids: Object.freeze(sortedDevices),
      terminalIds: Object.freeze(sortedTerminals.map(cloneTerminal)),
      functionIds: Object.freeze(sortedFunctions.map(cloneFunction)),
      conductiveElementIds: Object.freeze(sortedElements.map(cloneConductor)),
      netIds: Object.freeze([...netIds].sort(compareText)),
    }),
  });
}

export function selectCableConductorSubgraph(
  request: SelectCableConductorSubgraphRequest,
): SelectCableConductorSubgraphResult {
  const selected = selectCableConductors(request);
  if (!selected.ok) return selected;
  if (
    selected.value.cableUid !== request.view.root.cableUid ||
    selected.value.designation !== request.view.root.designation
  ) {
    throw new Error("Normalized cable root identity is inconsistent.");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      view: request.view,
      paths: selected.value.paths,
      deviceUids: selected.value.deviceUids,
      terminalIds: selected.value.terminalIds,
      functionIds: selected.value.functionIds,
      conductiveElementIds: selected.value.conductiveElementIds,
      netIds: selected.value.netIds,
    }),
  });
}

export function selectTraceSubgraph(
  request: SelectTraceSubgraphRequest,
): SelectTraceSubgraphResult {
  if (request.view.family !== "control") {
    throw new Error("Internal trace selection requires the control family.");
  }
  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  validateTraceRootRules(request.ir.deviceTypes, mappings);
  const created = createSelectionContext(request, false);
  if (!created.ok) return created;
  const context = created.value;
  const root = rootDevice(context);
  const targetDevice = context.deviceByUid.get(request.target.deviceUid);
  if (targetDevice === undefined) {
    throw new Error(
      `Normalized trace target ${JSON.stringify(request.target.deviceUid)} is absent from ElectricalIr.`,
    );
  }
  if (
    root.uid === targetDevice.uid ||
    root.designation !== context.view.root.designation ||
    targetDevice.designation !== request.target.designation
  ) {
    throw new Error("Normalized trace root/target identity is inconsistent.");
  }

  const traceRoot = resolveTraceRoot(context, root);
  if (traceRoot === undefined) return unsupportedRoot(context, root);
  const channels = targetInputChannels(context, targetDevice);
  if (channels.length === 0) return unsupportedRoot(context, targetDevice);

  const signalTerminal = traceRoot.terminalByRole.get("signal");
  if (signalTerminal === undefined) {
    invalidTraceMapping(`${traceRoot.rule.typeId} has no signal terminal.`);
  }
  const signal = selectTraceSignal(context, signalTerminal, channels);
  if (!signal.ok) return signal;
  if (signal.value === undefined) {
    return {
      ok: false,
      error: incompleteTraceSelectionError(context, targetDevice.uid, "signal"),
    };
  }

  const selections: SearchSuccess[] = [signal.value];
  const selectedRoles = new Set<TraceRootPortRole>(["signal"]);
  if (request.includePower) {
    for (const role of [
      "positive-supply",
      "return-supply",
    ] as const satisfies readonly TraceRootPortRole[]) {
      if (!traceRoot.portByRole.has(role)) continue;
      const terminal = traceRoot.terminalByRole.get(role);
      if (terminal === undefined) {
        invalidTraceMapping(
          `${traceRoot.rule.typeId} has no ${role} terminal.`,
        );
      }
      const arm = selectTracePowerArm(context, terminal, role);
      if (!arm.ok) return arm;
      if (arm.value === undefined) {
        return {
          ok: false,
          error: incompleteTraceSelectionError(context, targetDevice.uid, role),
        };
      }
      selections.push(arm.value);
      selectedRoles.add(role);
    }
  }

  const provenanceNetIds: string[] = [];
  for (const port of traceRoot.rule.representation.ports) {
    if (selectedRoles.has(port.role)) continue;
    const terminal = traceRoot.terminalByRole.get(port.role);
    if (terminal === undefined) {
      invalidTraceMapping(
        `${traceRoot.rule.typeId} has no materialized ${port.role} terminal.`,
      );
    }
    const net = netFor(context, terminal);
    if (!net.ok) return net;
    provenanceNetIds.push(net.value.net.id);
  }

  const displayFunctions = pathTerminalDisplayFunctionIds(
    context,
    selections,
    invalidTraceMapping,
  );
  if (!displayFunctions.ok) return displayFunctions;
  return Object.freeze({
    ok: true,
    value: buildSelectedSubgraph(
      context,
      Object.freeze(selections),
      Object.freeze([...traceRoot.functionIds, ...displayFunctions.value]),
      Object.freeze(provenanceNetIds),
    ),
  });
}

export function selectLoadsSubgraph(
  request: SelectLoadsSubgraphRequest,
): SelectLoadsSubgraphResult {
  if (request.view.family !== "control") {
    throw new Error("Internal loads selection requires the control family.");
  }
  const catalog = request.catalog ?? SYMBOL_CATALOG;
  const created = createSelectionContext(request, false);
  if (!created.ok) return created;
  const context = created.value;
  const root = rootDevice(context);
  const resolvedSource = resolveLoadSource(context, catalog);
  if (!resolvedSource.ok) return resolvedSource;
  if (resolvedSource.value === undefined) return unsupportedRoot(context, root);

  const sourceOutputs: LoadSourceOutputWithNet[] = [];
  for (const output of resolvedSource.value.outputs) {
    const net = netFor(context, output.terminal);
    if (!net.ok) return net;
    sourceOutputs.push({ ...output, net: net.value });
  }
  const sourceNetIds = new Set(sourceOutputs.map(({ net }) => net.net.id));
  const accumulators = new Map<string, LoadRepresentationAccumulator>();
  const materializedLoads = [...context.functionByKey.values()]
    .filter(
      (materialized) =>
        materialized.kind === "load" && materialized.id.deviceUid !== root.uid,
    )
    .sort((left, right) =>
      compareFunctionId(
        left.id,
        right.id,
        (uid) => designationFor(context, uid),
        (id) => functionMappingOrder(context, id),
      ),
    );

  for (const materialized of materializedLoads) {
    const terminalNets = new Map<string, NetResult>();
    for (const terminal of materialized.terminals) {
      const net = netFor(context, terminal);
      if (!net.ok) return net;
      terminalNets.set(terminalIdKey(terminal), net.value);
    }
    const representedNetIds = new Set(
      [...terminalNets.values()].map(({ net }) => net.id),
    );
    if (
      representedNetIds.size < 2 ||
      [...representedNetIds].some((netId) => !sourceNetIds.has(netId))
    ) {
      continue;
    }

    const device = context.deviceByUid.get(materialized.id.deviceUid);
    if (device === undefined) {
      throw new Error("Materialized load device is absent from ElectricalIr.");
    }
    const mapping = context.mappingByTypeId.get(device.typeId);
    const resolved = resolveSelectedSymbolRule({
      deviceType: deviceTypeFor(context, device),
      deviceUid: device.uid,
      materializedFunctions: context.ir.functions.filter(
        ({ id }) => id.deviceUid === device.uid,
      ),
      functionKey: materialized.id.functionKey,
      family: "control",
      root: context.view.root.designation,
      ...(mapping === undefined ? {} : { mapping }),
      catalog,
    });
    if (!resolved.ok) return resolved;
    const representationKey =
      resolved.value.kind === "function"
        ? resolved.value.rule.functionKey
        : resolved.value.rule.key;
    const structuralKey = JSON.stringify([
      device.uid,
      resolved.value.kind,
      representationKey,
    ]);
    let accumulator = accumulators.get(structuralKey);
    if (accumulator === undefined) {
      const functionKeys =
        resolved.value.kind === "function"
          ? [resolved.value.rule.functionKey]
          : resolved.value.rule.functionKeys;
      accumulator = {
        key: representationKey,
        kind: resolved.value.kind,
        device,
        rule: resolved.value.rule,
        functionIds: Object.freeze(
          functionKeys.map((functionKey) => {
            const functionId = { deviceUid: device.uid, functionKey };
            if (!context.functionByKey.has(functionIdKey(functionId))) {
              invalidLoadsMapping(
                `${device.typeId}.${functionKey} is not materialized for its selected representation.`,
              );
            }
            return cloneFunction(functionId);
          }),
        ),
        loadTerminals: new Map(),
      };
      accumulators.set(structuralKey, accumulator);
    }
    for (const terminal of materialized.terminals) {
      accumulator.loadTerminals.set(
        terminalIdKey(terminal),
        cloneTerminal(terminal),
      );
    }
  }

  const loads: CompleteLoadRepresentation[] = [...accumulators.values()]
    .map((value) => ({
      key: value.key,
      kind: value.kind,
      device: value.device,
      rule: value.rule,
      functionIds: value.functionIds,
      loadTerminals: Object.freeze(
        [...value.loadTerminals.values()].sort((left, right) =>
          compareCompleteTerminal(context, left, right),
        ),
      ),
    }))
    .sort((left, right) =>
      compareCompleteLoadRepresentation(context, left, right),
    );

  const selections: SearchSuccess[] = [];
  const selectedLoads: CompleteLoadRepresentation[] = [];
  const provenanceNetIds = new Set<string>();
  for (const load of loads) {
    const loadTerminalKeys = new Set(
      load.loadTerminals.map((terminal) => terminalIdKey(terminal)),
    );
    const armBindings = load.rule.bindings
      .filter(({ terminalKey }) =>
        loadTerminalKeys.has(
          terminalIdKey({
            deviceUid: load.device.uid,
            terminalKey,
          }),
        ),
      )
      .map((binding) => {
        const terminal = context.terminalByKey.get(
          terminalIdKey({
            deviceUid: load.device.uid,
            terminalKey: binding.terminalKey,
          }),
        );
        if (terminal === undefined) {
          invalidLoadsMapping(
            `${load.device.typeId}.${load.key} is missing terminal ${JSON.stringify(binding.terminalKey)}.`,
          );
        }
        const net = netFor(context, terminal.id);
        if (!net.ok) return net;
        const matchingOutputs = sourceOutputs.filter(
          (output) => output.net.net.id === net.value.net.id,
        );
        if (matchingOutputs.length !== 1) {
          invalidLoadsMapping(
            `${load.device.typeId}.${load.key} terminal ${JSON.stringify(binding.terminalKey)} does not resolve to one mapped source output.`,
          );
        }
        return {
          ok: true as const,
          binding,
          terminal: terminal.id,
          source: matchingOutputs[0]!,
          sourceRank: sourceOutputs.indexOf(matchingOutputs[0]!),
        };
      });
    const failedBinding = armBindings.find((binding) => !binding.ok);
    if (failedBinding !== undefined && !failedBinding.ok) return failedBinding;
    const orderedBindings = armBindings
      .filter(
        (
          binding,
        ): binding is Extract<(typeof armBindings)[number], { ok: true }> =>
          binding.ok,
      )
      .sort(
        (left, right) =>
          left.sourceRank - right.sourceRank ||
          compareText(left.binding.portId, right.binding.portId),
      );
    if (orderedBindings.length !== load.loadTerminals.length) {
      invalidLoadsMapping(
        `${load.device.typeId}.${load.key} does not bind every qualifying load terminal.`,
      );
    }

    const loadSelections: SearchSuccess[] = [];
    let complete = true;
    for (const { binding, terminal, source } of orderedBindings) {
      const arm = selectLoadArm(
        context,
        source,
        load,
        binding.portId,
        terminal,
        resolvedSource.value.functionId,
      );
      if (!arm.ok) return arm;
      if (arm.value === undefined) {
        complete = false;
        break;
      }
      loadSelections.push(arm.value);
    }
    if (!complete) continue;

    if (load.kind === "aggregate") {
      for (const binding of load.rule.bindings) {
        const terminalKey = terminalIdKey({
          deviceUid: load.device.uid,
          terminalKey: binding.terminalKey,
        });
        if (loadTerminalKeys.has(terminalKey)) continue;
        const terminal = context.terminalByKey.get(terminalKey);
        if (terminal === undefined) {
          invalidLoadsMapping(
            `${load.device.typeId}.${load.key} is missing aggregate terminal ${JSON.stringify(binding.terminalKey)}.`,
          );
        }
        const net = netFor(context, terminal.id);
        if (!net.ok) return net;
        provenanceNetIds.add(net.value.net.id);
      }
    }
    selections.push(...loadSelections);
    selectedLoads.push(load);
  }

  if (selectedLoads.length === 0) {
    return Object.freeze({
      ok: false,
      error: incompleteLoadsSelectionError(context),
    });
  }
  const displayFunctions = pathTerminalDisplayFunctionIds(
    context,
    selections,
    invalidLoadsMapping,
  );
  if (!displayFunctions.ok) return displayFunctions;
  return Object.freeze({
    ok: true,
    value: buildSelectedSubgraph(
      context,
      Object.freeze(selections),
      Object.freeze([
        resolvedSource.value.functionId,
        ...selectedLoads.flatMap(({ functionIds }) => functionIds),
        ...displayFunctions.value,
      ]),
      Object.freeze([...provenanceNetIds]),
    ),
  });
}

export function selectSemanticSubgraph(
  request: SelectSemanticSubgraphRequest,
): SelectSemanticSubgraphResult {
  const created = createSelectionContext(request);
  if (!created.ok) return created;
  const context = created.value;
  const selected =
    context.view.family === "control"
      ? selectControlPaths(context)
      : selectPowerPaths(context);
  if (!selected.ok) return selected;
  return Object.freeze({
    ok: true,
    value: buildSelectedSubgraph(
      context,
      selected.paths,
      selected.rootFunctionIds,
    ),
  });
}
