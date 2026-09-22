import {
  compareConductiveElementId,
  type ConductiveElementId,
  type ElectricalIr,
  type FunctionId,
  type IrDevice,
  type IrDeviceType,
  type IrFunction,
  type TerminalId,
} from "@thermite/compiler";

import {
  unsupportedSymbolMappingError,
  type UnsupportedSymbolMappingError,
} from "./errors.js";
import {
  PRESENTATION_CLASS_RANK,
  compareFunctionId,
  compareLocationIdentity,
  comparePresentationLabel,
  comparePresentationNode,
  comparePresentationPort,
  compareRenderTextSource,
  compareTerminalId,
  compareText,
  functionIdKey,
  structuralTupleId,
  terminalIdKey,
} from "./ordering.js";
import { SYMBOL_CATALOG } from "./symbols/catalog.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  projectDeviceTypeSymbolMappings,
  type AggregateSymbolRule,
  type DeviceTypeSymbolMapping,
  type FunctionSymbolRule,
} from "./symbols/mappings.js";
import type {
  SymbolDefinition,
  SymbolPortDefinition,
  SymbolSide,
} from "./symbols/types.js";
import {
  resolveSelectedSymbolRule,
  type ResolvedSymbolRule,
  validateSymbolCatalog,
} from "./symbols/validate.js";
import type {
  BoundaryConstraint,
  DeviceGroup,
  JunctionPresentationNode,
  LocationGroup,
  LocationIdentity,
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  PresentationLabelOwnerKind,
  PresentationLabelRole,
  PresentationNode,
  PresentationPort,
  RailPresentationNode,
  RenderSummary,
  RenderTextSource,
  SchematicFlow,
  SelectedBoundary,
  SelectedConductorStep,
  SelectedPath,
  SelectedSubgraph,
  SemanticAttachment,
  SemanticAttachmentKind,
  SymbolPresentationNode,
} from "./types.js";
import { svgSemanticId, type SvgSemanticIdPrefix } from "./svg/escape.js";

export interface BuildPresentationGraphRequest {
  readonly ir: Readonly<ElectricalIr>;
  readonly selected: Readonly<SelectedSubgraph>;
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
  readonly catalog?: readonly SymbolDefinition[];
}

export type BuildPresentationGraphResult =
  | {
      readonly ok: true;
      readonly value: Readonly<{
        graph: PresentationGraph;
        summary: RenderSummary;
      }>;
    }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError };

interface PresentationContext {
  readonly ir: Readonly<ElectricalIr>;
  readonly selected: Readonly<SelectedSubgraph>;
  readonly mappings: readonly DeviceTypeSymbolMapping[];
  readonly catalog: readonly SymbolDefinition[];
  readonly deviceByUid: ReadonlyMap<string, IrDevice>;
  readonly typeById: ReadonlyMap<string, IrDeviceType>;
  readonly mappingByTypeId: ReadonlyMap<string, DeviceTypeSymbolMapping>;
  readonly functionByKey: ReadonlyMap<string, IrFunction>;
  readonly netIdByTerminal: ReadonlyMap<string, string>;
  readonly symbolById: ReadonlyMap<SymbolDefinition["id"], SymbolDefinition>;
  readonly selectedNetIds: ReadonlySet<string>;
}

interface SymbolRepresentation {
  readonly id: string;
  readonly kind: "function" | "aggregate";
  readonly device: IrDevice;
  readonly deviceType: IrDeviceType;
  readonly rule: FunctionSymbolRule | AggregateSymbolRule;
  readonly functionIds: readonly FunctionId[];
}

interface MutablePresentationEdge {
  readonly id: string;
  readonly parentId: "root";
  readonly kind: "conductor" | "boundary-segment";
  sourcePortId: string;
  targetPortId: string;
  readonly netId: string;
  readonly elementIds: readonly ConductiveElementId[];
  readonly conductor?: NonNullable<PresentationEdge["conductor"]>;
  readonly endpoints: readonly [TerminalId, TerminalId];
  readonly pathRank: number;
  readonly label?: PresentationLabel;
  netLabel?: PresentationLabel;
}

interface EndpointUse {
  readonly edge: MutablePresentationEdge;
  readonly end: "source" | "target";
  readonly terminal: TerminalId;
}

function cloneTerminal(terminal: TerminalId): TerminalId {
  return { deviceUid: terminal.deviceUid, terminalKey: terminal.terminalKey };
}

function cloneFunction(functionId: FunctionId): FunctionId {
  return {
    deviceUid: functionId.deviceUid,
    functionKey: functionId.functionKey,
  };
}

function cloneElement(elementId: ConductiveElementId): ConductiveElementId {
  return elementId.kind === "cable_conductor"
    ? {
        kind: elementId.kind,
        cableUid: elementId.cableUid,
        conductorId: elementId.conductorId,
      }
    : { kind: elementId.kind, uid: elementId.uid };
}

function conductorKey(elementId: ConductiveElementId): string {
  return elementId.kind === "cable_conductor"
    ? structuralTupleId(
        elementId.kind,
        elementId.cableUid,
        elementId.conductorId,
      )
    : structuralTupleId(elementId.kind, elementId.uid);
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

function required<Value>(value: Value | undefined, message: string): Value {
  if (value === undefined) throw new Error(message);
  return value;
}

function orientationFor(
  selected: Readonly<SelectedSubgraph>,
): "left-to-right" | "top-to-bottom" {
  return selected.view.flow;
}

function orientedSide(
  side: SymbolSide,
  offset: number,
  orientation: "left-to-right" | "top-to-bottom",
): Readonly<{ side: SymbolSide; offset: number }> {
  if (orientation === "left-to-right") return { side, offset };
  switch (side) {
    case "west":
      return { side: "north", offset: 1 - offset };
    case "east":
      return { side: "south", offset: 1 - offset };
    case "north":
      return { side: "east", offset };
    case "south":
      return { side: "west", offset };
  }
}

function orientedSymbolSize(
  symbol: SymbolDefinition,
  orientation: "left-to-right" | "top-to-bottom",
): Readonly<{ width: number; height: number }> {
  return orientation === "left-to-right"
    ? { width: symbol.size.width, height: symbol.size.height }
    : { width: symbol.size.height, height: symbol.size.width };
}

function labelWidth(text: string): number {
  return Math.max(12, Number((6 + 6.2 * [...text].length).toFixed(3)));
}

function textSource(
  ownerKind: Extract<RenderTextSource["ownerKind"], SvgSemanticIdPrefix>,
  parts: readonly string[],
  field: RenderTextSource["field"],
  value: string,
): RenderTextSource {
  return {
    ownerKind,
    ownerId: svgSemanticId(ownerKind, parts),
    field,
    value,
  };
}

function presentationLabel(
  ownerKind: PresentationLabelOwnerKind,
  ownerId: string,
  role: PresentationLabelRole,
  text: string,
  textSources: readonly RenderTextSource[],
): PresentationLabel {
  const width = labelWidth(text);
  return {
    id: structuralTupleId("label", ownerKind, ownerId, role),
    ownerKind,
    ownerId,
    role,
    text,
    textSources: [...textSources].sort(compareRenderTextSource),
    width,
    height: 14,
    textLength: Number((width - 6).toFixed(3)),
  };
}

function createContext(
  request: BuildPresentationGraphRequest,
):
  | { readonly ok: true; readonly value: PresentationContext }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  const catalog = request.catalog ?? SYMBOL_CATALOG;
  validateSymbolCatalog(catalog);
  const deviceByUid = new Map<string, IrDevice>();
  const typeById = new Map<string, IrDeviceType>();
  const mappingByTypeId = new Map<string, DeviceTypeSymbolMapping>();
  const functionByKey = new Map<string, IrFunction>();
  const netIdByTerminal = new Map<string, string>();
  const symbolById = new Map<SymbolDefinition["id"], SymbolDefinition>();
  for (const device of request.ir.devices)
    addUnique(deviceByUid, device.uid, device, `device UID ${device.uid}`);
  for (const deviceType of request.ir.deviceTypes)
    addUnique(
      typeById,
      deviceType.id,
      deviceType,
      `device type ${deviceType.id}`,
    );
  for (const mapping of mappings)
    addUnique(
      mappingByTypeId,
      mapping.typeId,
      mapping,
      `mapping ${mapping.typeId}`,
    );
  for (const materialized of request.ir.functions)
    addUnique(
      functionByKey,
      functionIdKey(materialized.id),
      materialized,
      `function ${functionIdKey(materialized.id)}`,
    );
  for (const entry of request.ir.indexes.netIdByTerminal)
    addUnique(
      netIdByTerminal,
      terminalIdKey(entry.key),
      entry.value,
      `terminal net ${terminalIdKey(entry.key)}`,
    );
  for (const symbol of catalog)
    addUnique(symbolById, symbol.id, symbol, `symbol ${symbol.id}`);

  for (const deviceUid of request.selected.deviceUids) {
    const device = deviceByUid.get(deviceUid);
    const typeId = device?.typeId ?? "<missing>";
    if (
      device === undefined ||
      typeById.get(typeId) === undefined ||
      mappingByTypeId.get(typeId) === undefined
    ) {
      return {
        ok: false,
        error: unsupportedSymbolMappingError({
          family: request.selected.view.family,
          deviceUid,
          typeId,
          root: request.selected.view.root.designation,
        }),
      };
    }
  }

  return {
    ok: true,
    value: {
      ir: request.ir,
      selected: request.selected,
      mappings,
      catalog,
      deviceByUid,
      typeById,
      mappingByTypeId,
      functionByKey,
      netIdByTerminal,
      symbolById,
      selectedNetIds: new Set(request.selected.netIds),
    },
  };
}

function designationFor(
  context: PresentationContext,
  deviceUid: string,
): string {
  return context.deviceByUid.get(deviceUid)?.designation ?? "";
}

function mappingOrderForFunction(
  context: PresentationContext,
  functionId: FunctionId,
): number {
  const device = context.deviceByUid.get(functionId.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (mapping === undefined) return Number.MAX_SAFE_INTEGER;
  const functionIndex = mapping.functions.findIndex(
    ({ functionKey }) => functionKey === functionId.functionKey,
  );
  if (functionIndex >= 0) return functionIndex;
  for (const [aggregateIndex, aggregate] of mapping.aggregates.entries()) {
    const memberIndex = aggregate.functionKeys.indexOf(functionId.functionKey);
    if (memberIndex >= 0) {
      return mapping.functions.length + aggregateIndex * 1_000 + memberIndex;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function compareCompleteFunction(
  context: PresentationContext,
  left: FunctionId,
  right: FunctionId,
): number {
  return compareFunctionId(
    left,
    right,
    (deviceUid) => designationFor(context, deviceUid),
    (functionId) => mappingOrderForFunction(context, functionId),
  );
}

function compareCompleteTerminal(
  context: PresentationContext,
  left: TerminalId,
  right: TerminalId,
): number {
  return compareTerminalId(left, right, (deviceUid) =>
    designationFor(context, deviceUid),
  );
}

function resolvedRepresentation(
  context: PresentationContext,
  functionId: FunctionId,
):
  | { readonly ok: true; readonly value: SymbolRepresentation }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const device = required(
    context.deviceByUid.get(functionId.deviceUid),
    `Selected function ${functionIdKey(functionId)} has no device.`,
  );
  const deviceType = required(
    context.typeById.get(device.typeId),
    `Selected device ${device.uid} has no device type.`,
  );
  const resolved = resolveSelectedSymbolRule({
    deviceType,
    deviceUid: device.uid,
    materializedFunctions: context.ir.functions.filter(
      ({ id }) => id.deviceUid === device.uid,
    ),
    functionKey: functionId.functionKey,
    family: context.selected.view.family,
    root: context.selected.view.root.designation,
    mapping: required(
      context.mappingByTypeId.get(device.typeId),
      `Selected device ${device.uid} has no mapping.`,
    ),
    catalog: context.catalog,
  });
  if (!resolved.ok) return resolved;
  const value: ResolvedSymbolRule = resolved.value;
  if (value.kind === "function") {
    return {
      ok: true,
      value: {
        id: structuralTupleId("function", device.uid, value.rule.functionKey),
        kind: "function",
        device,
        deviceType,
        rule: value.rule,
        functionIds: [
          { deviceUid: device.uid, functionKey: value.rule.functionKey },
        ],
      },
    };
  }
  return {
    ok: true,
    value: {
      id: structuralTupleId("aggregate", device.uid, value.rule.key),
      kind: "aggregate",
      device,
      deviceType,
      rule: value.rule,
      functionIds: value.rule.functionKeys.map((functionKey) => ({
        deviceUid: device.uid,
        functionKey,
      })),
    },
  };
}

function selectedRepresentations(
  context: PresentationContext,
):
  | { readonly ok: true; readonly value: readonly SymbolRepresentation[] }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const representations = new Map<string, SymbolRepresentation>();
  for (const functionId of [...context.selected.functionIds].sort(
    (left, right) => compareCompleteFunction(context, left, right),
  )) {
    const resolved = resolvedRepresentation(context, functionId);
    if (!resolved.ok) return resolved;
    const existing = representations.get(resolved.value.id);
    if (existing !== undefined) {
      if (
        existing.kind !== "aggregate" ||
        resolved.value.kind !== "aggregate"
      ) {
        throw new Error(`Duplicate presentation symbol ${resolved.value.id}.`);
      }
      continue;
    }
    representations.set(resolved.value.id, resolved.value);
  }
  return {
    ok: true,
    value: [...representations.values()].sort((left, right) =>
      compareText(left.id, right.id),
    ),
  };
}

interface BoundaryRecord {
  readonly boundary: SelectedBoundary;
  readonly constraint: BoundaryConstraint;
  readonly pathRank: number;
}

interface SelectedEndpointFacts {
  readonly boundaries: ReadonlyMap<string, BoundaryRecord>;
  readonly constraints: ReadonlyMap<string, BoundaryConstraint>;
}

function selectedEndpointFacts(
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

function selectedStepKey(step: SelectedPath["steps"][number]): string {
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
  left: SelectedPath,
  right: SelectedPath,
): number {
  const count = Math.min(left.steps.length, right.steps.length);
  for (let index = 0; index < count; index++) {
    const compared = compareText(
      selectedStepKey(left.steps[index]!),
      selectedStepKey(right.steps[index]!),
    );
    if (compared !== 0) return compared;
  }
  return left.steps.length - right.steps.length;
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

function orderedSelectedPaths(
  context: PresentationContext,
): readonly SelectedPath[] {
  return [...context.selected.paths].sort((left, right) => {
    if (context.selected.view.family === "power") {
      return (
        (POWER_LANE_RANK[left.lane] ?? Number.MAX_SAFE_INTEGER) -
          (POWER_LANE_RANK[right.lane] ?? Number.MAX_SAFE_INTEGER) ||
        compareText(left.lane, right.lane) ||
        compareText(left.id, right.id)
      );
    }
    const leftBoundary = left.start.boundary ?? left.end.boundary;
    const rightBoundary = right.start.boundary ?? right.end.boundary;
    const boundaryRank =
      (leftBoundary?.kind === "channel" || leftBoundary?.kind === "potential"
        ? 0
        : 1) -
      (rightBoundary?.kind === "channel" || rightBoundary?.kind === "potential"
        ? 0
        : 1);
    return (
      boundaryRank ||
      left.steps.length - right.steps.length ||
      compareStructuralSteps(left, right) ||
      compareText(left.id, right.id)
    );
  });
}

function representationBindings(
  representation: SymbolRepresentation,
): readonly (FunctionSymbolRule["bindings"][number] & {
  readonly memberFunctionKey?: string;
})[] {
  return representation.rule.bindings;
}

function representationIsCompleteSourceBoundary(
  representation: SymbolRepresentation,
  boundaries: ReadonlyMap<string, BoundaryRecord>,
): boolean {
  if (representation.rule.traversalRole !== "source-boundary") return true;
  const keys = new Set(
    representationBindings(representation).map(({ terminalKey }) =>
      terminalIdKey({
        deviceUid: representation.device.uid,
        terminalKey,
      }),
    ),
  );
  const active = [...keys].map((key) => boundaries.get(key));
  return (
    active.every(
      (record): record is BoundaryRecord =>
        record !== undefined && record.constraint === "FIRST",
    ) && active.length === keys.size
  );
}

function addImplicitTerminalRepresentations(
  context: PresentationContext,
  representations: readonly SymbolRepresentation[],
  boundaries: ReadonlyMap<string, BoundaryRecord>,
):
  | { readonly ok: true; readonly value: readonly SymbolRepresentation[] }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const byId = new Map(representations.map((value) => [value.id, value]));
  const covered = new Set<string>();
  for (const representation of representations) {
    for (const binding of representationBindings(representation)) {
      covered.add(
        terminalIdKey({
          deviceUid: representation.device.uid,
          terminalKey: binding.terminalKey,
        }),
      );
    }
  }
  for (const terminal of context.selected.terminalIds) {
    const key = terminalIdKey(terminal);
    if (covered.has(key) || boundaries.has(key)) continue;
    const device = required(
      context.deviceByUid.get(terminal.deviceUid),
      `Selected terminal ${key} has no device.`,
    );
    const mapping = required(
      context.mappingByTypeId.get(device.typeId),
      `Selected terminal ${key} has no mapping.`,
    );
    const candidates = mapping.functions.filter(
      (rule) =>
        rule.families.includes(context.selected.view.family) &&
        rule.traversalRole === "terminal-display" &&
        rule.bindings.some(
          ({ terminalKey }) => terminalKey === terminal.terminalKey,
        ),
    );
    if (candidates.length === 0) continue;
    if (candidates.length !== 1) {
      throw new Error(`Terminal ${key} resolves to multiple terminal symbols.`);
    }
    const resolved = resolvedRepresentation(context, {
      deviceUid: device.uid,
      functionKey: candidates[0]!.functionKey,
    });
    if (!resolved.ok) return resolved;
    byId.set(resolved.value.id, resolved.value);
  }
  return {
    ok: true,
    value: [...byId.values()].sort((left, right) =>
      compareText(left.id, right.id),
    ),
  };
}

function locationIdentity(device: IrDevice): LocationIdentity {
  return device.location === undefined
    ? ["virtual", "UNSPECIFIED"]
    : ["authored", device.location];
}

function locationGroupId(identity: LocationIdentity): string {
  return structuralTupleId("location", identity[0], identity[1]);
}

function deviceGroupId(deviceUid: string): string {
  return structuralTupleId("device", deviceUid);
}

interface PresentationGroups {
  readonly locationGroups: readonly LocationGroup[];
  readonly deviceGroups: readonly DeviceGroup[];
  readonly locationByDeviceUid: ReadonlyMap<string, LocationGroup>;
  readonly deviceByUid: ReadonlyMap<string, DeviceGroup>;
}

function buildGroups(
  context: PresentationContext,
  representations: readonly SymbolRepresentation[],
): PresentationGroups {
  const devices = new Map<string, IrDevice>();
  for (const representation of representations)
    devices.set(representation.device.uid, representation.device);
  const devicesByLocation = new Map<string, IrDevice[]>();
  const identityById = new Map<string, LocationIdentity>();
  for (const device of devices.values()) {
    const identity = locationIdentity(device);
    const id = locationGroupId(identity);
    identityById.set(id, identity);
    devicesByLocation.set(id, [...(devicesByLocation.get(id) ?? []), device]);
  }
  const locationGroups = [...devicesByLocation].map(([id, locationDevices]) => {
    const identity = required(
      identityById.get(id),
      `Location identity ${id} is missing.`,
    );
    const sortedDevices = [...locationDevices].sort(
      (left, right) =>
        compareText(left.designation, right.designation) ||
        compareText(left.uid, right.uid),
    );
    const textSources =
      identity[0] === "virtual"
        ? []
        : [
            textSource(
              "device",
              [sortedDevices[0]!.uid],
              "device.location",
              identity[1],
            ),
          ];
    return {
      id,
      parentId: "root" as const,
      identity,
      label: presentationLabel(
        "location",
        id,
        "location",
        identity[1],
        textSources,
      ),
    };
  });
  locationGroups.sort((left, right) =>
    compareLocationIdentity(left.identity, right.identity),
  );
  const locationById = new Map(
    locationGroups.map((group) => [group.id, group]),
  );
  const locationByDeviceUid = new Map<string, LocationGroup>();
  for (const device of devices.values()) {
    locationByDeviceUid.set(
      device.uid,
      required(
        locationById.get(locationGroupId(locationIdentity(device))),
        `Location group for ${device.uid} is missing.`,
      ),
    );
  }
  const flowRankByDeviceUid = new Map<string, number>();
  for (const representation of representations) {
    const classRank =
      PRESENTATION_CLASS_RANK[representation.rule.classification];
    flowRankByDeviceUid.set(
      representation.device.uid,
      Math.min(
        flowRankByDeviceUid.get(representation.device.uid) ??
          Number.MAX_SAFE_INTEGER,
        classRank,
      ),
    );
  }
  const deviceGroups = [...devices.values()]
    .sort(
      (left, right) =>
        (flowRankByDeviceUid.get(left.uid) ?? Number.MAX_SAFE_INTEGER) -
          (flowRankByDeviceUid.get(right.uid) ?? Number.MAX_SAFE_INTEGER) ||
        compareText(left.designation, right.designation) ||
        compareText(left.uid, right.uid),
    )
    .map((device) => {
      const id = deviceGroupId(device.uid);
      const parent = required(
        locationByDeviceUid.get(device.uid),
        `Device ${device.uid} has no location group.`,
      );
      return {
        id,
        parentId: parent.id,
        deviceUid: device.uid,
        designation: device.designation,
        typeId: device.typeId,
        label: presentationLabel("device", id, "device", device.designation, [
          textSource(
            "device",
            [device.uid],
            "device.designation",
            device.designation,
          ),
        ]),
      };
    });
  return {
    locationGroups,
    deviceGroups,
    locationByDeviceUid,
    deviceByUid: new Map(deviceGroups.map((group) => [group.deviceUid, group])),
  };
}

function functionLabelText(materialized: IrFunction): string {
  if (materialized.kind === "contact") {
    return `${materialized.id.functionKey} ${materialized.normal_state === "open" ? "NO" : "NC"}`;
  }
  if (materialized.kind === "channel") {
    return `${materialized.id.functionKey} ${materialized.direction === "input" ? "DI" : "DO"}`;
  }
  if (
    materialized.kind === "coil" &&
    !materialized.id.functionKey.toLowerCase().includes("coil")
  ) {
    return `${materialized.id.functionKey} coil`;
  }
  return materialized.id.functionKey;
}

function netForTerminal(
  context: PresentationContext,
  terminal: TerminalId,
): string {
  const netId = required(
    context.netIdByTerminal.get(terminalIdKey(terminal)),
    `Presentation terminal ${terminalIdKey(terminal)} has no compiler net.`,
  );
  if (!context.selectedNetIds.has(netId)) {
    throw new Error(
      `Presentation terminal ${terminalIdKey(terminal)} is outside the selected query nets.`,
    );
  }
  return netId;
}

function leafGeometry(
  symbol: SymbolDefinition,
  orientation: "left-to-right" | "top-to-bottom",
  label: PresentationLabel,
): Readonly<{
  symbolSize: Readonly<{ width: number; height: number }>;
  width: number;
  height: number;
  primitiveOrigin: Readonly<{ x: number; y: number }>;
}> {
  const symbolSize = orientedSymbolSize(symbol, orientation);
  const vertical = orientation === "top-to-bottom";
  const width = vertical
    ? label.width + symbolSize.width + 24
    : Math.max(symbolSize.width + 16, label.width + 16);
  const height = 22 + symbolSize.height + 8;
  return {
    symbolSize,
    width,
    height,
    primitiveOrigin: {
      x: vertical
        ? label.width + 16
        : Number(((width - symbolSize.width) / 2).toFixed(3)),
      y: 22,
    },
  };
}

function representationBoundaryConstraint(
  representation: SymbolRepresentation,
  constraints: ReadonlyMap<string, BoundaryConstraint>,
): BoundaryConstraint | undefined {
  const bindingKeys = representationBindings(representation).map(
    ({ terminalKey }) =>
      terminalIdKey({
        deviceUid: representation.device.uid,
        terminalKey,
      }),
  );
  const active = bindingKeys
    .map((key) => constraints.get(key))
    .filter((value): value is BoundaryConstraint => value !== undefined);
  if (active.length > 0) {
    if (active.some((constraint) => constraint !== active[0])) {
      throw new Error(
        `Presentation symbol ${representation.id} has conflicting boundary constraints.`,
      );
    }
    return active[0];
  }
  return undefined;
}

function semanticAttachmentKind(
  context: PresentationContext,
  representation: SymbolRepresentation,
): SemanticAttachmentKind {
  if (representation.kind === "aggregate") return "aggregate";
  const materialized = required(
    context.functionByKey.get(functionIdKey(representation.functionIds[0]!)),
    `Presentation function ${representation.id} is missing.`,
  );
  return materialized.kind === "channel" ? "channel" : "function";
}

function connectedTerminalPortHasLabel(
  context: PresentationContext,
  symbol: SymbolDefinition,
  terminal: TerminalId,
  symbolPortId: string,
): boolean {
  if (symbol.id !== "ais:terminal") return true;
  return context.selected.paths.some((path) =>
    path.steps.some(
      (step) =>
        step.kind === "conductor" &&
        ((sameTerminal(step.from, terminal) && symbolPortId === "out") ||
          (sameTerminal(step.to, terminal) && symbolPortId === "in")),
    ),
  );
}

function buildSymbolNode(
  context: PresentationContext,
  representation: SymbolRepresentation,
  boundaries: ReadonlyMap<string, BoundaryRecord>,
  constraints: ReadonlyMap<string, BoundaryConstraint>,
  groups: PresentationGroups,
): SymbolPresentationNode {
  const symbol = required(
    context.symbolById.get(representation.rule.symbolId),
    `Presentation symbol ${representation.rule.symbolId} is missing.`,
  );
  const deviceGroup = required(
    groups.deviceByUid.get(representation.device.uid),
    `Presentation device group ${representation.device.uid} is missing.`,
  );
  const locationGroup = required(
    groups.locationByDeviceUid.get(representation.device.uid),
    `Presentation location group ${representation.device.uid} is missing.`,
  );
  const orientation = orientationFor(context.selected);
  const nodeLabel =
    representation.kind === "aggregate"
      ? presentationLabel(
          "symbol",
          representation.id,
          "aggregate",
          (representation.rule as AggregateSymbolRule).key,
          [
            textSource(
              "aggregate",
              [
                representation.device.uid,
                (representation.rule as AggregateSymbolRule).key,
              ],
              "aggregate.key",
              (representation.rule as AggregateSymbolRule).key,
            ),
          ],
        )
      : (() => {
          const materialized = required(
            context.functionByKey.get(
              functionIdKey(representation.functionIds[0]!),
            ),
            `Presentation function ${representation.id} is missing.`,
          );
          return presentationLabel(
            "symbol",
            representation.id,
            "function",
            functionLabelText(materialized),
            [
              textSource(
                "function",
                [
                  representation.device.uid,
                  representation.functionIds[0]!.functionKey,
                ],
                "function.key",
                representation.functionIds[0]!.functionKey,
              ),
            ],
          );
        })();
  const portDefinitionById = new Map(
    symbol.ports.map((definition) => [definition.id, definition]),
  );
  const labels: PresentationLabel[] = [nodeLabel];
  const ports = representationBindings(representation).map((binding) => {
    const definition: SymbolPortDefinition = required(
      portDefinitionById.get(binding.portId),
      `Presentation binding ${binding.portId} has no symbol port.`,
    );
    const terminal = {
      deviceUid: representation.device.uid,
      terminalKey: binding.terminalKey,
    };
    const memberFunctionId = {
      deviceUid: representation.device.uid,
      functionKey:
        representation.kind === "aggregate"
          ? (binding as AggregateSymbolRule["bindings"][number])
              .memberFunctionKey
          : representation.functionIds[0]!.functionKey,
    };
    const transformed = orientedSide(
      definition.side,
      definition.offset,
      orientation,
    );
    const id = structuralTupleId("port", representation.id, definition.id);
    const terminalLabel = presentationLabel(
      "port",
      id,
      "terminal",
      terminal.terminalKey,
      [
        textSource(
          "terminal",
          [terminal.deviceUid, terminal.terminalKey, definition.id],
          "terminal.key",
          terminal.terminalKey,
        ),
      ],
    );
    if (
      connectedTerminalPortHasLabel(context, symbol, terminal, definition.id)
    ) {
      labels.push(terminalLabel);
    }
    return {
      id,
      symbolPortId: definition.id,
      terminal,
      memberFunctionId,
      netId: netForTerminal(context, terminal),
      side: transformed.side,
      offset: transformed.offset,
      order: definition.order,
      label: terminal.terminalKey,
    };
  });
  ports.sort((left, right) =>
    comparePresentationPort(left, right, (deviceUid) =>
      designationFor(context, deviceUid),
    ),
  );
  const geometry = leafGeometry(symbol, orientation, nodeLabel);
  const attachmentKind = semanticAttachmentKind(context, representation);
  const portsByTerminal = new Map<string, PresentationPort[]>();
  for (const port of ports) {
    const key = terminalIdKey(port.terminal);
    portsByTerminal.set(key, [...(portsByTerminal.get(key) ?? []), port]);
  }
  const attachments = [...portsByTerminal.values()]
    .map((terminalPorts): SemanticAttachment => ({
      kind: attachmentKind,
      nodeId: representation.id,
      terminal: cloneTerminal(terminalPorts[0]!.terminal),
      netId: terminalPorts[0]!.netId,
      portIds: terminalPorts.map(({ id }) => id),
    }))
    .sort((left, right) =>
      compareCompleteTerminal(context, left.terminal, right.terminal),
    );
  const boundaryConstraint = representationBoundaryConstraint(
    representation,
    constraints,
  );
  return {
    kind: "symbol",
    representation: representation.kind,
    id: representation.id,
    deviceUid: representation.device.uid,
    designation: representation.device.designation,
    typeId: representation.device.typeId,
    functionIds: representation.functionIds.map(cloneFunction),
    symbolId: representation.rule.symbolId,
    classification: representation.rule.classification,
    parentId: deviceGroup.id,
    ...(boundaryConstraint === undefined ? {} : { boundaryConstraint }),
    locationGroupId: locationGroup.id,
    deviceGroupId: deviceGroup.id,
    orientation,
    symbolSize: geometry.symbolSize,
    width: geometry.width,
    height: geometry.height,
    primitiveOrigin: geometry.primitiveOrigin,
    ports,
    attachments,
    labels: labels.sort(comparePresentationLabel),
  };
}

function boundaryTextSources(
  context: PresentationContext,
  boundary: SelectedBoundary,
): readonly RenderTextSource[] {
  const anchored =
    boundary.potentialUid === undefined
      ? undefined
      : context.ir.potentials.find(({ uid }) => uid === boundary.potentialUid);
  if (anchored !== undefined) {
    return [
      textSource("potential", [anchored.uid], "potential.name", anchored.name),
    ];
  }
  const netPotentials = context.ir.potentials.filter(
    ({ netId }) => netId === boundary.netId,
  );
  if (netPotentials.length === 1 && netPotentials[0]!.name === boundary.label) {
    return [
      textSource(
        "potential",
        [netPotentials[0]!.uid],
        "potential.name",
        netPotentials[0]!.name,
      ),
    ];
  }
  return [
    textSource(
      "boundary",
      [
        boundary.terminal.deviceUid,
        boundary.terminal.terminalKey,
        boundary.kind,
      ],
      "boundary.label",
      boundary.label,
    ),
  ];
}

function collapsedFunctionIds(
  context: PresentationContext,
  terminal: TerminalId,
  representations: readonly SymbolRepresentation[],
): readonly FunctionId[] {
  const ids = new Map<string, FunctionId>();
  for (const representation of representations) {
    if (representation.device.uid !== terminal.deviceUid) continue;
    if (
      !representationBindings(representation).some(
        ({ terminalKey }) => terminalKey === terminal.terminalKey,
      )
    ) {
      continue;
    }
    for (const functionId of representation.functionIds) {
      ids.set(functionIdKey(functionId), cloneFunction(functionId));
    }
  }
  return [...ids.values()].sort((left, right) =>
    compareCompleteFunction(context, left, right),
  );
}

function buildRailNode(
  context: PresentationContext,
  record: BoundaryRecord,
  representations: readonly SymbolRepresentation[],
): RailPresentationNode {
  const boundary = record.boundary;
  const device = required(
    context.deviceByUid.get(boundary.terminal.deviceUid),
    `Boundary ${terminalIdKey(boundary.terminal)} has no device.`,
  );
  const symbolId =
    record.constraint === "FIRST"
      ? ("ais:rail-source" as const)
      : ("ais:rail-return" as const);
  const symbol = required(
    context.symbolById.get(symbolId),
    `Rail symbol ${symbolId} is missing.`,
  );
  const definition = required(
    symbol.ports[0],
    `Rail symbol ${symbolId} has no port.`,
  );
  const orientation = orientationFor(context.selected);
  const id = structuralTupleId(
    "rail",
    device.uid,
    boundary.terminal.terminalKey,
    boundary.kind,
  );
  const railLabel = presentationLabel(
    "rail",
    id,
    "rail",
    boundary.label,
    boundaryTextSources(context, boundary),
  );
  const transformed = orientedSide(
    definition.side,
    definition.offset,
    orientation,
  );
  const portId = structuralTupleId("port", id, definition.id);
  const terminalLabel = presentationLabel(
    "port",
    portId,
    "terminal",
    boundary.terminal.terminalKey,
    [
      textSource(
        "terminal",
        [device.uid, boundary.terminal.terminalKey, definition.id],
        "terminal.key",
        boundary.terminal.terminalKey,
      ),
    ],
  );
  const geometry = leafGeometry(symbol, orientation, railLabel);
  const port: PresentationPort = {
    id: portId,
    symbolPortId: definition.id,
    terminal: cloneTerminal(boundary.terminal),
    netId: boundary.netId,
    side: transformed.side,
    offset: transformed.offset,
    order: definition.order,
    label: boundary.terminal.terminalKey,
  };
  const attachment: SemanticAttachment = {
    kind: "collapsed-boundary",
    nodeId: id,
    terminal: cloneTerminal(boundary.terminal),
    netId: boundary.netId,
    portIds: [portId],
  };
  return {
    kind: "rail",
    id,
    parentId: "root",
    boundaryConstraint: record.constraint,
    deviceUid: device.uid,
    designation: device.designation,
    typeId: device.typeId,
    functionIds: collapsedFunctionIds(
      context,
      boundary.terminal,
      representations,
    ),
    symbolId,
    classification: "rail",
    orientation,
    symbolSize: geometry.symbolSize,
    width: geometry.width,
    height: geometry.height,
    primitiveOrigin: geometry.primitiveOrigin,
    boundary: {
      kind: boundary.kind,
      terminal: cloneTerminal(boundary.terminal),
      netId: boundary.netId,
      ...(boundary.potentialUid === undefined
        ? {}
        : { potentialUid: boundary.potentialUid }),
      label: boundary.label,
    },
    ports: [port],
    attachments: [attachment],
    labels: [railLabel, terminalLabel].sort(comparePresentationLabel),
  };
}

function attachmentsByTerminal(
  nodes: readonly (SymbolPresentationNode | RailPresentationNode)[],
): ReadonlyMap<string, readonly SemanticAttachment[]> {
  const byTerminal = new Map<string, SemanticAttachment[]>();
  for (const node of nodes) {
    for (const attachment of node.attachments) {
      const key = terminalIdKey(attachment.terminal);
      byTerminal.set(key, [...(byTerminal.get(key) ?? []), attachment]);
    }
  }
  for (const attachments of byTerminal.values()) {
    attachments.sort(
      (left, right) =>
        compareText(left.nodeId, right.nodeId) ||
        compareText(left.kind, right.kind),
    );
  }
  return byTerminal;
}

function buildSymbolAndRailNodes(
  context: PresentationContext,
  allRepresentations: readonly SymbolRepresentation[],
  endpoints: SelectedEndpointFacts,
):
  | {
      readonly ok: true;
      readonly value: Readonly<{
        groups: PresentationGroups;
        nodes: readonly (SymbolPresentationNode | RailPresentationNode)[];
      }>;
    }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const { boundaries, constraints } = endpoints;
  const renderableSelected = allRepresentations.filter((representation) =>
    representationIsCompleteSourceBoundary(representation, boundaries),
  );
  const withImplicit = addImplicitTerminalRepresentations(
    context,
    renderableSelected,
    boundaries,
  );
  if (!withImplicit.ok) return withImplicit;
  const representations = withImplicit.value;
  const groups = buildGroups(context, representations);
  const symbols = representations.map((representation) =>
    buildSymbolNode(context, representation, boundaries, constraints, groups),
  );
  const coveredBoundaryTerminals = new Set(
    symbols.flatMap((node) =>
      node.attachments.map(({ terminal }) => terminalIdKey(terminal)),
    ),
  );
  const rails = [...boundaries]
    .filter(([key]) => !coveredBoundaryTerminals.has(key))
    .map(([, record]) => buildRailNode(context, record, allRepresentations));
  return {
    ok: true,
    value: {
      groups,
      nodes: [...symbols, ...rails].sort(comparePresentationNode),
    },
  };
}

interface IrConductorRecord {
  readonly id: ConductiveElementId;
  readonly endpoints: readonly [TerminalId, TerminalId];
}

function canonicalConductorEndpoints(
  left: TerminalId,
  right: TerminalId,
): readonly [TerminalId, TerminalId] {
  return (compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.terminalKey, right.terminalKey)) <= 0
    ? [cloneTerminal(left), cloneTerminal(right)]
    : [cloneTerminal(right), cloneTerminal(left)];
}

function irConductorRecord(
  ir: Readonly<ElectricalIr>,
  elementId: ConductiveElementId,
): IrConductorRecord {
  switch (elementId.kind) {
    case "wire": {
      const wire = required(
        ir.wires.find(({ uid }) => uid === elementId.uid),
        `Selected wire ${elementId.uid} is missing.`,
      );
      return {
        id: cloneElement(elementId),
        endpoints: canonicalConductorEndpoints(
          wire.endpoints[0].terminal,
          wire.endpoints[1].terminal,
        ),
      };
    }
    case "jumper": {
      const jumper = required(
        ir.jumpers.find(({ uid }) => uid === elementId.uid),
        `Selected jumper ${elementId.uid} is missing.`,
      );
      return {
        id: cloneElement(elementId),
        endpoints: canonicalConductorEndpoints(
          jumper.endpoints[0].terminal,
          jumper.endpoints[1].terminal,
        ),
      };
    }
    case "cable_conductor": {
      const conductor = required(
        ir.cableConductors.find(
          ({ id }) =>
            id.cableUid === elementId.cableUid &&
            id.conductorId === elementId.conductorId,
        ),
        `Selected cable conductor ${conductorKey(elementId)} is missing.`,
      );
      return {
        id: cloneElement(elementId),
        endpoints: canonicalConductorEndpoints(
          conductor.endpoints[0].terminal,
          conductor.endpoints[1].terminal,
        ),
      };
    }
  }
}

function conductorLabel(
  context: PresentationContext,
  elementId: ConductiveElementId,
  edgeId: string,
): PresentationLabel {
  switch (elementId.kind) {
    case "wire": {
      const wire = required(
        context.ir.wires.find(({ uid }) => uid === elementId.uid),
        `Selected wire ${elementId.uid} is missing.`,
      );
      const propertiesLabel = wire.properties?.label;
      return presentationLabel(
        "edge",
        edgeId,
        "conductor",
        propertiesLabel ?? wire.designation,
        [
          textSource(
            "wire",
            [wire.uid],
            propertiesLabel === undefined
              ? "wire.designation"
              : "wire.properties.label",
            propertiesLabel ?? wire.designation,
          ),
        ],
      );
    }
    case "jumper": {
      const jumper = required(
        context.ir.jumpers.find(({ uid }) => uid === elementId.uid),
        `Selected jumper ${elementId.uid} is missing.`,
      );
      return presentationLabel(
        "edge",
        edgeId,
        "conductor",
        jumper.designation ?? `jumper:${jumper.uid}`,
        jumper.designation === undefined
          ? []
          : [
              textSource(
                "jumper",
                [jumper.uid],
                "jumper.designation",
                jumper.designation,
              ),
            ],
      );
    }
    case "cable_conductor": {
      const cable = required(
        context.ir.cables.find(({ uid }) => uid === elementId.cableUid),
        `Selected cable ${elementId.cableUid} is missing.`,
      );
      if (
        context.selected.view.format === "schematic-view/0.2" &&
        context.selected.view.intent === "conductors"
      ) {
        const conductor = required(
          context.ir.cableConductors.find(
            ({ id }) =>
              id.cableUid === elementId.cableUid &&
              id.conductorId === elementId.conductorId,
          ),
          `Selected cable conductor ${conductorKey(elementId)} is missing.`,
        );
        const metadata = required(
          conductor.typeConductor ?? undefined,
          `Selected cable conductor ${conductorKey(elementId)} has no authored type metadata.`,
        );
        const ownerParts = [elementId.cableUid, elementId.conductorId];
        const sizeSuffix =
          metadata.size === undefined ? "" : ` · ${metadata.size}`;
        return presentationLabel(
          "edge",
          edgeId,
          "conductor",
          `${cable.designation}.${elementId.conductorId} · ${metadata.color}${sizeSuffix}`,
          [
            textSource(
              "cable-conductor",
              ownerParts,
              "cable.designation",
              cable.designation,
            ),
            textSource(
              "cable-conductor",
              ownerParts,
              "cable.conductor.id",
              elementId.conductorId,
            ),
            textSource(
              "cable-conductor",
              ownerParts,
              "cable.conductor.color",
              metadata.color,
            ),
            ...(metadata.size === undefined
              ? []
              : [
                  textSource(
                    "cable-conductor",
                    ownerParts,
                    "cable.conductor.size",
                    metadata.size,
                  ),
                ]),
          ],
        );
      }
      return presentationLabel(
        "edge",
        edgeId,
        "conductor",
        `${cable.designation}.${elementId.conductorId}`,
        [
          textSource(
            "cable-conductor",
            [elementId.cableUid, elementId.conductorId],
            "cable.designation",
            cable.designation,
          ),
          textSource(
            "cable-conductor",
            [elementId.cableUid, elementId.conductorId],
            "cable.conductor.id",
            elementId.conductorId,
          ),
        ],
      );
    }
  }
}

function conductorMetadata(
  context: PresentationContext,
  elementId: ConductiveElementId,
): NonNullable<PresentationEdge["conductor"]> {
  switch (elementId.kind) {
    case "wire": {
      const wire = required(
        context.ir.wires.find(({ uid }) => uid === elementId.uid),
        `Selected wire ${elementId.uid} is missing.`,
      );
      return { kind: "wire", uid: wire.uid, designation: wire.designation };
    }
    case "jumper": {
      const jumper = required(
        context.ir.jumpers.find(({ uid }) => uid === elementId.uid),
        `Selected jumper ${elementId.uid} is missing.`,
      );
      return {
        kind: "jumper",
        uid: jumper.uid,
        designation: jumper.designation ?? `jumper:${jumper.uid}`,
      };
    }
    case "cable_conductor": {
      const cable = required(
        context.ir.cables.find(({ uid }) => uid === elementId.cableUid),
        `Selected cable ${elementId.cableUid} is missing.`,
      );
      return {
        kind: "cable-conductor",
        cableUid: elementId.cableUid,
        cableDesignation: cable.designation,
        conductorId: elementId.conductorId,
      };
    }
  }
}

function edgeIdFor(elementId: ConductiveElementId): string {
  return elementId.kind === "cable_conductor"
    ? structuralTupleId(
        "cable-conductor",
        elementId.cableUid,
        elementId.conductorId,
      )
    : structuralTupleId(elementId.kind, elementId.uid);
}

function orientedConductorSteps(
  context: PresentationContext,
  pathIndex: number,
): readonly SelectedConductorStep[] {
  const path = orderedSelectedPaths(context)[pathIndex]!;
  return path.steps.filter(
    (step): step is SelectedConductorStep => step.kind === "conductor",
  );
}

interface BuiltConductors {
  readonly edges: MutablePresentationEdge[];
  readonly endpointUses: ReadonlyMap<string, readonly EndpointUse[]>;
}

function buildConductorEdges(context: PresentationContext): BuiltConductors {
  const edgesByElement = new Map<string, MutablePresentationEdge>();
  const orientationByElement = new Map<
    string,
    readonly [TerminalId, TerminalId]
  >();
  const endpointUses = new Map<string, EndpointUse[]>();
  const paths = orderedSelectedPaths(context);
  for (const pathRank of paths.keys()) {
    for (const step of orientedConductorSteps(context, pathRank)) {
      const key = conductorKey(step.elementId);
      const record = irConductorRecord(context.ir, step.elementId);
      if (!sameEndpointPair(record.endpoints, [step.from, step.to])) {
        throw new Error(
          `Selected conductor ${key} disagrees with ElectricalIr.`,
        );
      }
      const fromNet = netForTerminal(context, step.from);
      const toNet = netForTerminal(context, step.to);
      if (fromNet !== step.netId || toNet !== step.netId) {
        throw new Error(
          `Selected conductor ${key} disagrees with its compiler net.`,
        );
      }
      const existingOrientation = orientationByElement.get(key);
      if (existingOrientation !== undefined) {
        if (
          !sameTerminal(existingOrientation[0], step.from) ||
          !sameTerminal(existingOrientation[1], step.to)
        ) {
          throw new Error(`Selected conductor ${key} has conflicting flow.`);
        }
        continue;
      }
      orientationByElement.set(key, [
        cloneTerminal(step.from),
        cloneTerminal(step.to),
      ]);
      const id = edgeIdFor(step.elementId);
      const edge: MutablePresentationEdge = {
        id,
        parentId: "root",
        kind: "conductor",
        sourcePortId: "",
        targetPortId: "",
        netId: step.netId,
        elementIds: [cloneElement(step.elementId)],
        conductor: conductorMetadata(context, step.elementId),
        endpoints: [
          cloneTerminal(record.endpoints[0]),
          cloneTerminal(record.endpoints[1]),
        ],
        pathRank,
        label: conductorLabel(context, step.elementId, id),
      };
      edgesByElement.set(key, edge);
      const sourceUse: EndpointUse = {
        edge,
        end: "source",
        terminal: cloneTerminal(step.from),
      };
      const targetUse: EndpointUse = {
        edge,
        end: "target",
        terminal: cloneTerminal(step.to),
      };
      const fromKey = terminalIdKey(step.from);
      const toKey = terminalIdKey(step.to);
      endpointUses.set(fromKey, [
        ...(endpointUses.get(fromKey) ?? []),
        sourceUse,
      ]);
      endpointUses.set(toKey, [...(endpointUses.get(toKey) ?? []), targetUse]);
    }
  }
  const selectedKeys = [...context.selected.conductiveElementIds]
    .map(conductorKey)
    .sort(compareText);
  const builtKeys = [...edgesByElement.keys()].sort(compareText);
  if (
    selectedKeys.length !== builtKeys.length ||
    selectedKeys.some((key, index) => key !== builtKeys[index])
  ) {
    throw new Error(
      "Selected conductor provenance is not a complete path union.",
    );
  }
  return { edges: [...edgesByElement.values()], endpointUses };
}

function uniquePotentialForNet(context: PresentationContext, netId: string) {
  const potentials = context.ir.potentials.filter(
    (potential) => potential.netId === netId,
  );
  return potentials.length === 1 ? potentials[0] : undefined;
}

function netSortKey(context: PresentationContext, netId: string): string {
  return uniquePotentialForNet(context, netId)?.name ?? netId;
}

function comparePresentationEdge(
  context: PresentationContext,
  left: MutablePresentationEdge,
  right: MutablePresentationEdge,
): number {
  const net =
    compareText(
      netSortKey(context, left.netId),
      netSortKey(context, right.netId),
    ) || compareText(left.netId, right.netId);
  if (net !== 0) return net;
  const path = left.pathRank - right.pathRank;
  if (path !== 0) return path;
  if (left.kind !== right.kind) return left.kind === "conductor" ? -1 : 1;
  if (left.kind === "conductor" && right.kind === "conductor") {
    const element = compareConductiveElementId(
      left.elementIds[0]!,
      right.elementIds[0]!,
    );
    if (element !== 0) return element;
  }
  return (
    compareText(left.sourcePortId, right.sourcePortId) ||
    compareText(left.targetPortId, right.targetPortId) ||
    compareText(left.id, right.id)
  );
}

function primarySide(
  context: PresentationContext,
  direction: "incoming" | "outgoing",
): SymbolSide {
  if (context.selected.view.flow === "left-to-right") {
    return direction === "incoming" ? "west" : "east";
  }
  return direction === "incoming" ? "north" : "south";
}

function counterClockwiseSide(side: SymbolSide): SymbolSide {
  switch (side) {
    case "east":
      return "north";
    case "north":
      return "west";
    case "west":
      return "south";
    case "south":
      return "east";
  }
}

function isTwoArmLoadsSourceJunction(
  context: PresentationContext,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
): boolean {
  const view = context.selected.view;
  if (
    view.format !== "schematic-view/0.2" ||
    view.intent !== "loads" ||
    view.root.kind !== "device" ||
    !("deviceUid" in view.root)
  ) {
    return false;
  }
  const rootDeviceUid = view.root.deviceUid;
  return (
    uses.length === 2 &&
    uses.every(
      ({ end, terminal }) =>
        end === "source" && terminal.deviceUid === rootDeviceUid,
    ) &&
    attachments.length === 1
  );
}

function traceSignalStepRank(
  context: PresentationContext,
  edge: MutablePresentationEdge,
): number {
  const signal = orderedSelectedPaths(context).find(
    ({ lane }) => lane === "signal",
  );
  if (signal === undefined || edge.elementIds.length !== 1) {
    return Number.MAX_SAFE_INTEGER;
  }
  const key = conductorKey(edge.elementIds[0]!);
  return signal.steps.findIndex(
    (step) => step.kind === "conductor" && conductorKey(step.elementId) === key,
  );
}

interface TraceSignalDagEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly stableRank: number;
}

interface TraceSignalDag {
  readonly root: string;
  readonly sink: string;
  readonly edges: readonly TraceSignalDagEdge[];
}

interface TraceSignalOrder {
  readonly path: SelectedPath;
  readonly dag: TraceSignalDag;
  readonly rankByEdgeId: ReadonlyMap<string, number>;
}

type StructuralRole = "P" | "Q" | "R" | "S";

interface ClosedRoleAssignment {
  readonly incidence:
    | { readonly kind: "edge"; readonly edgeId: string }
    | { readonly kind: "attachment" }
    | { readonly kind: "link-in"; readonly index: number }
    | { readonly kind: "link-out"; readonly index: number };
  readonly role: StructuralRole;
  readonly side: SymbolSide;
  readonly order: number;
}

interface ClosedComponentTemplate {
  readonly index: number;
  readonly assignments: readonly ClosedRoleAssignment[];
}

interface ClosedRoleTemplate {
  readonly kind: "root" | "via" | "merge";
  readonly components: readonly ClosedComponentTemplate[];
}

interface TraceDagIndex {
  readonly incoming: ReadonlyMap<string, readonly TraceSignalDagEdge[]>;
  readonly outgoing: ReadonlyMap<string, readonly TraceSignalDagEdge[]>;
}

type TraceOrigin =
  | {
      readonly kind: "ROOT";
      readonly role: StructuralRole;
      readonly rank: number;
    }
  | { readonly kind: "CONTINUATION"; readonly rank: number }
  | { readonly kind: "OTHER"; readonly rank: number };

function compareTraceDagEdge(
  left: TraceSignalDagEdge,
  right: TraceSignalDagEdge,
): number {
  return left.stableRank - right.stableRank || compareText(left.id, right.id);
}

function traceDagIndex(dag: TraceSignalDag): TraceDagIndex {
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

function incomingTraceEdges(
  index: TraceDagIndex,
  vertex: string,
): readonly TraceSignalDagEdge[] {
  return index.incoming.get(vertex) ?? [];
}

function outgoingTraceEdges(
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

function isTraceMerge(index: TraceDagIndex, vertex: string): boolean {
  const incoming = incomingTraceEdges(index, vertex).length;
  return (
    incoming >= 2 &&
    incoming <= 4 &&
    outgoingTraceEdges(index, vertex).length === 1
  );
}

function structuralSide(flow: SchematicFlow, role: StructuralRole): SymbolSide {
  const right: Readonly<Record<StructuralRole, SymbolSide>> = {
    P: "east",
    Q: "north",
    R: "west",
    S: "south",
  };
  const down: Readonly<Record<StructuralRole, SymbolSide>> = {
    P: "south",
    Q: "east",
    R: "north",
    S: "west",
  };
  return (flow === "left-to-right" ? right : down)[role];
}

function closedAssignment(
  flow: SchematicFlow,
  incidence: ClosedRoleAssignment["incidence"],
  role: StructuralRole,
  order: number,
): ClosedRoleAssignment {
  return { incidence, role, side: structuralSide(flow, role), order };
}

function rootLaneRole(
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

function traceOrigin(
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
    edge = incomingTraceEdges(index, upstream)[0]!;
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

function traceContinuationCount(
  dag: TraceSignalDag,
  index: TraceDagIndex,
  merge: string,
): number {
  return incomingTraceEdges(index, merge).filter(
    (input) => traceOrigin(dag, index, input).kind === "CONTINUATION",
  ).length;
}

function nextNonTraceVia(
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
    edge = outgoingTraceEdges(index, downstream)[0]!;
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

function compareTraceOrigin(
  left: readonly [TraceOrigin, number],
  right: readonly [TraceOrigin, number],
): number {
  const leftKey = traceOriginKey(left[0]);
  const rightKey = traceOriginKey(right[0]);
  return (
    leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || left[1] - right[1]
  );
}

function rootClosedTemplate(
  flow: SchematicFlow,
  outputs: readonly TraceSignalDagEdge[],
): ClosedRoleTemplate {
  if (outputs.length === 2 || outputs.length === 3) {
    const roles =
      outputs.length === 2 ? (["P", "Q"] as const) : (["P", "Q", "S"] as const);
    return {
      kind: "root",
      components: [
        {
          index: 0,
          assignments: [
            ...outputs.map((edge, order) =>
              closedAssignment(
                flow,
                { kind: "edge", edgeId: edge.id },
                roles[order]!,
                order,
              ),
            ),
            closedAssignment(flow, { kind: "attachment" }, "R", outputs.length),
          ],
        },
      ],
    };
  }
  if (outputs.length === 4) {
    return {
      kind: "root",
      components: [
        {
          index: 0,
          assignments: [
            closedAssignment(
              flow,
              { kind: "edge", edgeId: outputs[0]!.id },
              "P",
              0,
            ),
            closedAssignment(
              flow,
              { kind: "edge", edgeId: outputs[1]!.id },
              "Q",
              1,
            ),
            closedAssignment(flow, { kind: "attachment" }, "R", 2),
            closedAssignment(flow, { kind: "link-out", index: 0 }, "S", 3),
          ],
        },
        {
          index: 1,
          assignments: [
            closedAssignment(
              flow,
              { kind: "edge", edgeId: outputs[2]!.id },
              "P",
              0,
            ),
            closedAssignment(
              flow,
              { kind: "edge", edgeId: outputs[3]!.id },
              "S",
              1,
            ),
            closedAssignment(flow, { kind: "link-in", index: 0 }, "Q", 2),
          ],
        },
      ],
    };
  }
  throw new Error(`Closed root degree ${outputs.length} is outside 2..4.`);
}

function mergeCombClosedTemplate(
  flow: SchematicFlow,
  inputs: readonly TraceSignalDagEdge[],
  output: TraceSignalDagEdge,
): ClosedRoleTemplate {
  const components: ClosedComponentTemplate[] = [
    {
      index: 0,
      assignments: [
        closedAssignment(flow, { kind: "edge", edgeId: inputs[0]!.id }, "S", 0),
        closedAssignment(flow, { kind: "edge", edgeId: inputs[1]!.id }, "R", 1),
        closedAssignment(flow, { kind: "attachment" }, "Q", 2),
        closedAssignment(flow, { kind: "link-out", index: 0 }, "P", 3),
      ],
    },
  ];
  for (
    let componentIndex = 1;
    componentIndex <= inputs.length - 2;
    componentIndex++
  ) {
    const last = componentIndex === inputs.length - 2;
    components.push({
      index: componentIndex,
      assignments: last
        ? [
            closedAssignment(
              flow,
              { kind: "edge", edgeId: inputs[inputs.length - 1]!.id },
              "S",
              0,
            ),
            closedAssignment(flow, { kind: "edge", edgeId: output.id }, "P", 1),
            closedAssignment(
              flow,
              { kind: "link-in", index: componentIndex - 1 },
              "R",
              2,
            ),
          ]
        : [
            closedAssignment(
              flow,
              { kind: "edge", edgeId: inputs[componentIndex + 1]!.id },
              "S",
              0,
            ),
            closedAssignment(
              flow,
              { kind: "link-in", index: componentIndex - 1 },
              "R",
              1,
            ),
            closedAssignment(
              flow,
              { kind: "link-out", index: componentIndex },
              "P",
              2,
            ),
          ],
    });
  }
  return { kind: "merge", components };
}

function twoInputMergeClosedTemplate(
  dag: TraceSignalDag,
  index: TraceDagIndex,
  flow: SchematicFlow,
  inputs: readonly TraceSignalDagEdge[],
  output: TraceSignalDagEdge,
): ClosedRoleTemplate {
  const origins = inputs.map((input) => traceOrigin(dag, index, input));
  const continuationIndexes = origins
    .map((origin, localIndex) => ({ origin, localIndex }))
    .filter(({ origin }) => origin.kind === "CONTINUATION")
    .map(({ localIndex }) => localIndex);
  const continuationCount = continuationIndexes.length;
  const next = nextNonTraceVia(index, output);
  let straightIndex: number;
  if (continuationCount === 1) {
    if (
      outgoingTraceEdges(index, dag.root).length === 3 &&
      !isTraceMerge(index, next)
    ) {
      straightIndex = continuationIndexes[0] === 0 ? 1 : 0;
    } else {
      straightIndex = continuationIndexes[0]!;
    }
  } else {
    straightIndex = origins
      .map((origin, localIndex) => [origin, localIndex] as const)
      .sort(compareTraceOrigin)[0]![1];
  }

  let outputRole: StructuralRole;
  if (outgoingTraceEdges(index, dag.root).length === 3) {
    outputRole = "Q";
  } else if (!isTraceMerge(index, next)) {
    outputRole = continuationCount > 0 ? "Q" : "P";
  } else {
    outputRole = traceContinuationCount(dag, index, next) >= 2 ? "Q" : "P";
  }
  return {
    kind: "merge",
    components: [
      {
        index: 0,
        assignments: [
          ...inputs.map((input, localIndex) =>
            closedAssignment(
              flow,
              { kind: "edge", edgeId: input.id },
              localIndex === straightIndex ? "R" : "S",
              localIndex,
            ),
          ),
          closedAssignment(
            flow,
            { kind: "edge", edgeId: output.id },
            outputRole,
            2,
          ),
          closedAssignment(
            flow,
            { kind: "attachment" },
            outputRole === "P" ? "Q" : "P",
            3,
          ),
        ],
      },
    ],
  };
}

export function selectClosedTraceRoles(
  dag: TraceSignalDag,
  currentVertex: string,
  flow: SchematicFlow,
): ClosedRoleTemplate {
  const index = traceDagIndex(dag);
  const inputs = incomingTraceEdges(index, currentVertex);
  const outputs = outgoingTraceEdges(index, currentVertex);
  if (
    currentVertex === dag.root &&
    inputs.length === 0 &&
    outputs.length >= 2 &&
    outputs.length <= 4
  ) {
    return rootClosedTemplate(flow, outputs);
  }
  if (inputs.length === 1 && outputs.length === 1) {
    return {
      kind: "via",
      components: [
        {
          index: 0,
          assignments: [
            closedAssignment(
              flow,
              { kind: "edge", edgeId: inputs[0]!.id },
              "R",
              0,
            ),
            closedAssignment(
              flow,
              { kind: "edge", edgeId: outputs[0]!.id },
              "P",
              1,
            ),
          ],
        },
      ],
    };
  }
  if (inputs.length === 2 && outputs.length === 1) {
    return twoInputMergeClosedTemplate(dag, index, flow, inputs, outputs[0]!);
  }
  if ((inputs.length === 3 || inputs.length === 4) && outputs.length === 1) {
    return mergeCombClosedTemplate(flow, inputs, outputs[0]!);
  }
  throw new Error(
    `Closed role selector does not cover (${inputs.length},${outputs.length}) at ${currentVertex}.`,
  );
}

function reachableTraceVertices(
  first: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [first];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return visited;
}

function validateTraceSignalDag(dag: TraceSignalDag): void {
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
  for (const edge of dag.edges) degree.set(edge.to, degree.get(edge.to)! + 1);
  const pending = [...vertices].filter((vertex) => degree.get(vertex) === 0);
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.shift()!;
    visited += 1;
    for (const next of outgoing.get(current) ?? []) {
      const remaining = degree.get(next)! - 1;
      degree.set(next, remaining);
      if (remaining === 0) pending.push(next);
    }
  }
  if (visited !== vertices.size) {
    throw new Error("Selected trace signal contains a cycle.");
  }
}

function traceSignalOrder(
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
  const path = signals[0]!;
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

function isTwoLanePnpTraceSignalJunction(
  context: PresentationContext,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
): boolean {
  const view = context.selected.view;
  if (
    view.format !== "schematic-view/0.2" ||
    view.intent !== "trace" ||
    view.root.kind !== "device" ||
    !("deviceUid" in view.root) ||
    context.deviceByUid.get(view.root.deviceUid)?.typeId !==
      "core:prox-pnp-3wire" ||
    uses.length !== 2 ||
    attachments.length !== 1 ||
    uses[0]!.end !== uses[1]!.end
  ) {
    return false;
  }
  const ranks = uses.map(({ edge }) => traceSignalStepRank(context, edge));
  return (
    ranks.every((rank) => rank >= 0) && new Set(ranks).size === ranks.length
  );
}

function portForEndpointUse(
  attachment: SemanticAttachment,
  use: EndpointUse,
  portById: ReadonlyMap<string, PresentationPort>,
  nodeById: ReadonlyMap<string, SymbolPresentationNode | RailPresentationNode>,
): PresentationPort {
  const node = required(
    nodeById.get(attachment.nodeId),
    `Attachment owner ${attachment.nodeId} is missing.`,
  );
  if (node.kind === "symbol" && node.symbolId === "ais:terminal") {
    const wanted = use.end === "target" ? "in" : "out";
    const terminalPort = attachment.portIds
      .map((portId) => portById.get(portId))
      .find((port) => port?.symbolPortId === wanted);
    if (terminalPort !== undefined) return terminalPort;
  }
  return required(
    portById.get(attachment.portIds[0]!),
    `Attachment ${attachment.nodeId} has no visual port.`,
  );
}

function terminalPassThroughException(
  attachments: readonly SemanticAttachment[],
  uses: readonly EndpointUse[],
  assignments: readonly PresentationPort[],
  nodeById: ReadonlyMap<string, SymbolPresentationNode | RailPresentationNode>,
): boolean {
  if (attachments.length !== 1 || uses.length > 2) return false;
  const node = nodeById.get(attachments[0]!.nodeId);
  if (node?.kind !== "symbol" || node.symbolId !== "ais:terminal") {
    return false;
  }
  const counts = new Map<string, number>();
  for (const port of assignments)
    counts.set(port.id, (counts.get(port.id) ?? 0) + 1);
  return [...counts.values()].every((count) => count <= 1);
}

function incidentVisibleNodeIds(
  terminalKey: string,
  uses: readonly EndpointUse[],
  attachments: ReadonlyMap<string, readonly SemanticAttachment[]>,
  endpointUses: ReadonlyMap<string, readonly EndpointUse[]>,
): readonly string[] {
  const ids = new Set(
    (attachments.get(terminalKey) ?? []).map(({ nodeId }) => nodeId),
  );
  for (const use of uses) {
    for (const [otherKey, otherUses] of endpointUses) {
      if (otherKey === terminalKey) continue;
      if (otherUses.some(({ edge }) => edge.id === use.edge.id)) {
        for (const attachment of attachments.get(otherKey) ?? [])
          ids.add(attachment.nodeId);
      }
    }
  }
  return [...ids].sort(compareText);
}

function junctionParentId(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, SymbolPresentationNode | RailPresentationNode>,
): JunctionPresentationNode["parentId"] {
  if (nodeIds.length === 0) {
    throw new Error("A junction has no incident visible endpoint node.");
  }
  const chains = nodeIds.map((nodeId) => {
    const node = required(
      nodeById.get(nodeId),
      `Junction endpoint node ${nodeId} is missing.`,
    );
    return node.kind === "rail"
      ? (["root"] as const)
      : (["root", node.locationGroupId, node.deviceGroupId] as const);
  });
  let parent: JunctionPresentationNode["parentId"] = "root";
  const limit = Math.min(...chains.map(({ length }) => length));
  for (let index = 1; index < limit; index++) {
    const candidate = chains[0]![index];
    if (
      candidate !== undefined &&
      chains.every((chain) => chain[index] === candidate)
    ) {
      parent = candidate;
    } else {
      break;
    }
  }
  return parent;
}

interface JunctionInsertionResult {
  readonly junctions: readonly JunctionPresentationNode[];
  readonly boundaryEdges: readonly MutablePresentationEdge[];
}

function attachmentPort(
  attachment: SemanticAttachment,
  portById: ReadonlyMap<string, PresentationPort>,
): PresentationPort {
  return required(
    portById.get(attachment.portIds[0]!),
    "Boundary attachment has no visual port.",
  );
}

interface ClosedTraceIncidence {
  readonly orderedUses: readonly EndpointUse[];
  readonly template: ClosedRoleTemplate;
}

type ClosedTraceSignature = "root" | "merge" | "via";

function closedTraceSignature(
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

function closedTraceIncidence(
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
  ranked.sort((left, right) => left.rank! - right.rank!);
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

function closedLinkPortId(
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

function emitClosedTraceJunction(
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
    const ports = component.assignments.map((assignment) => {
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

  const linkPathRank =
    incidence.orderedUses.length === 0
      ? 0
      : Math.min(...incidence.orderedUses.map(({ edge }) => edge.pathRank));
  if (attachment !== undefined) {
    const ownerPort = required(
      portById.get(attachment.portIds[0]!),
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
  return { junctions, boundaryEdges };
}

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
          conductorKey(candidate.elementIds[0]!) === key,
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
    const candidatePortIds = new Set(candidate.ports.map(({ id }) => id));
    const uses = edges
      .filter(
        ({ kind, sourcePortId, targetPortId }) =>
          kind === "conductor" &&
          (candidatePortIds.has(sourcePortId) ||
            candidatePortIds.has(targetPortId)),
      )
      .map((edge): EndpointUse => {
        const end = candidatePortIds.has(edge.sourcePortId)
          ? "source"
          : "target";
        return { edge, end, terminal };
      });
    const ownerByPortId = new Map(
      nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, node] as const),
      ),
    );
    const attachmentEdges = edges.filter(
      ({ kind, sourcePortId, targetPortId }) =>
        kind === "boundary-segment" &&
        candidatePortIds.has(sourcePortId) !==
          candidatePortIds.has(targetPortId),
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
    const incidence = closedTraceIncidence(
      key,
      uses,
      terminalAttachments,
      signal,
      selected.view.flow,
    );
    if (incidence === undefined) continue;
    const portById = new Map(
      nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, port] as const),
      ),
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
  }
  return {
    ...structuredClone(source),
    nodes: nodes.sort(comparePresentationNode),
    edges: edges.map(immutableEdge),
  };
}

function insertSemanticJunctions(
  context: PresentationContext,
  visibleNodes: readonly (SymbolPresentationNode | RailPresentationNode)[],
  conductors: BuiltConductors,
): JunctionInsertionResult {
  const attachments = attachmentsByTerminal(visibleNodes);
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
  for (const key of [...terminalKeys].sort(compareText)) {
    const terminalAttachments = attachments.get(key) ?? [];
    const defaultOrderedUses = [
      ...(conductors.endpointUses.get(key) ?? []),
    ].sort(
      (left, right) =>
        compareText(left.edge.id, right.edge.id) ||
        compareText(left.end, right.end),
    );
    const twoArmLoadsSource = isTwoArmLoadsSourceJunction(
      context,
      defaultOrderedUses,
      terminalAttachments,
    );
    const twoLanePnpTraceSignal = isTwoLanePnpTraceSignalJunction(
      context,
      defaultOrderedUses,
      terminalAttachments,
    );
    const uses = twoArmLoadsSource
      ? [...defaultOrderedUses].sort(
          (left, right) =>
            comparePresentationEdge(context, left.edge, right.edge) ||
            compareText(left.end, right.end),
        )
      : twoLanePnpTraceSignal
        ? [...defaultOrderedUses].sort(
            (left, right) =>
              traceSignalStepRank(context, left.edge) -
                traceSignalStepRank(context, right.edge) ||
              compareText(left.end, right.end),
          )
        : defaultOrderedUses;
    if (uses.length === 0 && terminalAttachments.length < 2) continue;
    const terminal = cloneTerminal(
      uses[0]?.terminal ?? terminalAttachments[0]!.terminal,
    );
    const netId = uses[0]?.edge.netId ?? terminalAttachments[0]!.netId;
    if (
      uses.some(
        (use) =>
          !sameTerminal(use.terminal, terminal) || use.edge.netId !== netId,
      ) ||
      terminalAttachments.some(
        (attachment) =>
          !sameTerminal(attachment.terminal, terminal) ||
          attachment.netId !== netId,
      )
    ) {
      throw new Error("Terminal attachments cross compiler nets or terminals.");
    }
    if (uses.length === 0 && terminalAttachments.length === 2) {
      const sourceAttachment = terminalAttachments[0]!;
      const targetAttachment = terminalAttachments[1]!;
      const sourcePort = attachmentPort(sourceAttachment, portById);
      const targetPort = attachmentPort(targetAttachment, portById);
      boundaryEdges.push({
        id: structuralTupleId(
          "boundary-segment",
          terminal.deviceUid,
          terminal.terminalKey,
          sourceAttachment.nodeId,
          targetAttachment.nodeId,
        ),
        parentId: "root",
        kind: "boundary-segment",
        sourcePortId: sourcePort.id,
        targetPortId: targetPort.id,
        netId,
        elementIds: [],
        endpoints: [cloneTerminal(terminal), cloneTerminal(terminal)],
        pathRank: 0,
      });
      continue;
    }
    const assignments =
      terminalAttachments.length === 0
        ? []
        : uses.map((use) =>
            portForEndpointUse(
              terminalAttachments[0]!,
              use,
              portById,
              nodeById,
            ),
          );
    const counts = new Map<string, number>();
    for (const port of assignments)
      counts.set(port.id, (counts.get(port.id) ?? 0) + 1);
    const fansOut = [...counts.values()].some((count) => count >= 2);
    const semanticDegree = uses.length + terminalAttachments.length;
    const passThrough = terminalPassThroughException(
      terminalAttachments,
      uses,
      assignments,
      nodeById,
    );
    if (passThrough) {
      for (const [index, use] of uses.entries()) {
        const portId = assignments[index]!.id;
        if (use.end === "source") use.edge.sourcePortId = portId;
        else use.edge.targetPortId = portId;
      }
      continue;
    }
    const closed = closedTraceIncidence(
      key,
      defaultOrderedUses,
      terminalAttachments,
      signalOrder,
      context.selected.view.flow,
    );
    if (closed !== undefined) {
      const emitted = emitClosedTraceJunction(
        (deviceUid) => designationFor(context, deviceUid),
        junctionParentId(
          incidentVisibleNodeIds(
            key,
            closed.orderedUses,
            attachments,
            conductors.endpointUses,
          ),
          nodeById,
        ),
        key,
        terminal,
        netId,
        terminalAttachments,
        closed,
        portById,
      );
      junctions.push(...emitted.junctions);
      boundaryEdges.push(...emitted.boundaryEdges);
      continue;
    }
    if (terminalAttachments.length === 0) {
      throw new Error(
        `Selected conductor endpoint ${key} has no visible owner.`,
      );
    }
    const needsJunction = fansOut || semanticDegree >= 3;
    if (!needsJunction) {
      for (const [index, use] of uses.entries()) {
        const portId = assignments[index]!.id;
        if (use.end === "source") use.edge.sourcePortId = portId;
        else use.edge.targetPortId = portId;
      }
      continue;
    }

    const junctionId = structuralTupleId(
      "junction",
      netId,
      terminal.deviceUid,
      terminal.terminalKey,
    );
    const junctionPorts: PresentationPort[] = [];
    for (const [index, use] of uses.entries()) {
      const portId = structuralTupleId(
        "port",
        junctionId,
        "conductor",
        use.edge.id,
        use.end,
      );
      const port: PresentationPort = {
        id: portId,
        symbolPortId: `conductor-${index}`,
        terminal: cloneTerminal(terminal),
        netId,
        side:
          (twoArmLoadsSource || twoLanePnpTraceSignal) && index === 1
            ? counterClockwiseSide(primarySide(context, "outgoing"))
            : primarySide(
                context,
                use.end === "target" ? "incoming" : "outgoing",
              ),
        offset: 0.5,
        order: index,
        label: "",
      };
      junctionPorts.push(port);
      if (use.end === "source") use.edge.sourcePortId = portId;
      else use.edge.targetPortId = portId;
    }
    for (const [attachmentIndex, attachment] of terminalAttachments.entries()) {
      const attachmentPort = required(
        portById.get(attachment.portIds[0]!),
        `Junction attachment ${attachment.nodeId} has no port.`,
      );
      const hasOutgoing = uses.some(({ end }) => end === "source");
      const hasIncoming = uses.some(({ end }) => end === "target");
      const ownerToJunction = hasOutgoing && !hasIncoming;
      const junctionPortId = structuralTupleId(
        "port",
        junctionId,
        "attachment",
        attachment.nodeId,
      );
      const junctionPort: PresentationPort = {
        id: junctionPortId,
        symbolPortId: `attachment-${attachmentIndex}`,
        terminal: cloneTerminal(terminal),
        netId,
        side: primarySide(context, ownerToJunction ? "incoming" : "outgoing"),
        offset: 0.5,
        order: uses.length + attachmentIndex,
        label: "",
      };
      junctionPorts.push(junctionPort);
      boundaryEdges.push({
        id: structuralTupleId(
          "boundary-segment",
          junctionId,
          attachment.nodeId,
        ),
        parentId: "root",
        kind: "boundary-segment",
        sourcePortId: ownerToJunction ? attachmentPort.id : junctionPortId,
        targetPortId: ownerToJunction ? junctionPortId : attachmentPort.id,
        netId,
        elementIds: [],
        endpoints: [cloneTerminal(terminal), cloneTerminal(terminal)],
        pathRank:
          uses.length === 0
            ? 0
            : Math.min(...uses.map(({ edge }) => edge.pathRank)),
      });
    }
    junctionPorts.sort((left, right) =>
      comparePresentationPort(left, right, (deviceUid) =>
        designationFor(context, deviceUid),
      ),
    );
    const visibleEndpointIds = incidentVisibleNodeIds(
      key,
      uses,
      attachments,
      conductors.endpointUses,
    );
    junctions.push({
      kind: "junction",
      id: junctionId,
      parentId: junctionParentId(visibleEndpointIds, nodeById),
      classification: "junction",
      netId,
      terminal,
      ports: junctionPorts,
    });
  }
  return {
    junctions: junctions.sort(comparePresentationNode),
    boundaryEdges,
  };
}

function attachNetLabels(
  context: PresentationContext,
  edges: MutablePresentationEdge[],
): void {
  edges.sort((left, right) => comparePresentationEdge(context, left, right));
  const labeledNets = new Set<string>();
  for (const edge of edges) {
    if (labeledNets.has(edge.netId)) continue;
    labeledNets.add(edge.netId);
    const potential = uniquePotentialForNet(context, edge.netId);
    if (potential === undefined) continue;
    edge.netLabel = presentationLabel("edge", edge.id, "net", potential.name, [
      textSource(
        "potential",
        [potential.uid],
        "potential.name",
        potential.name,
      ),
    ]);
  }
}

function metadataTextSources(
  context: PresentationContext,
  nodes: readonly (SymbolPresentationNode | RailPresentationNode)[],
  edges: readonly MutablePresentationEdge[],
): readonly RenderTextSource[] {
  const sources = context.selected.deviceUids.map((deviceUid) => {
    const device = required(
      context.deviceByUid.get(deviceUid),
      `Selected device ${deviceUid} is missing.`,
    );
    return textSource("device", [device.uid], "device.type", device.typeId);
  });
  if (
    context.selected.view.format === "schematic-view/0.2" &&
    context.selected.view.intent === "conductors"
  ) {
    sources.push(
      textSource(
        "cable",
        [context.selected.view.root.cableUid],
        "cable.designation",
        context.selected.view.root.designation,
      ),
    );
  }
  for (const node of nodes) {
    if (node.kind === "rail") {
      sources.push(
        textSource(
          "device",
          [node.deviceUid],
          "device.designation",
          node.designation,
        ),
      );
    } else if (node.representation === "aggregate") {
      for (const functionId of node.functionIds) {
        sources.push(
          textSource(
            "function",
            [functionId.deviceUid, functionId.functionKey],
            "function.key",
            functionId.functionKey,
          ),
        );
      }
    }
  }
  for (const edge of edges) {
    const conductor = edge.conductor;
    if (conductor?.kind !== "wire") continue;
    const wire = required(
      context.ir.wires.find(({ uid }) => uid === conductor.uid),
      `Selected wire ${conductor.uid} is missing.`,
    );
    if (wire.properties?.label === undefined) continue;
    sources.push(
      textSource("wire", [wire.uid], "wire.designation", wire.designation),
    );
  }
  return uniqueByKey(sources, (source) =>
    structuralTupleId(source.ownerKind, source.ownerId, source.field),
  ).sort(compareRenderTextSource);
}

function uniqueByKey<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyFor(value), value);
  return [...byKey.values()];
}

export function summarizePresentationGraph(
  ir: Readonly<ElectricalIr>,
  graph: Readonly<PresentationGraph>,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
): RenderSummary {
  const designationByUid = new Map(
    ir.devices.map(({ uid, designation }) => [uid, designation]),
  );
  const functionOrderByKey = new Map<string, number>();
  const typeIdByDeviceUid = new Map(
    ir.devices.map(({ uid, typeId }) => [uid, typeId]),
  );
  for (const mapping of mappings) {
    mapping.functions.forEach(({ functionKey }, index) =>
      functionOrderByKey.set(
        structuralTupleId(mapping.typeId, functionKey),
        index,
      ),
    );
    mapping.aggregates.forEach((aggregate, aggregateIndex) =>
      aggregate.functionKeys.forEach((functionKey, memberIndex) =>
        functionOrderByKey.set(
          structuralTupleId(mapping.typeId, functionKey),
          mapping.functions.length + aggregateIndex * 1_000 + memberIndex,
        ),
      ),
    );
  }
  const deviceUids = uniqueByKey(
    graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : [node.deviceUid],
    ),
    (value) => value,
  ).sort(
    (left, right) =>
      compareText(
        designationByUid.get(left) ?? "",
        designationByUid.get(right) ?? "",
      ) || compareText(left, right),
  );
  const terminalIds = uniqueByKey(
    graph.nodes.flatMap((node) =>
      node.ports.map(({ terminal }) => cloneTerminal(terminal)),
    ),
    terminalIdKey,
  ).sort((left, right) =>
    compareTerminalId(
      left,
      right,
      (deviceUid) => designationByUid.get(deviceUid) ?? "",
    ),
  );
  const functionIds = uniqueByKey(
    graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : node.functionIds.map(cloneFunction),
    ),
    functionIdKey,
  ).sort((left, right) =>
    compareFunctionId(
      left,
      right,
      (deviceUid) => designationByUid.get(deviceUid) ?? "",
      (functionId) =>
        functionOrderByKey.get(
          structuralTupleId(
            typeIdByDeviceUid.get(functionId.deviceUid) ?? "",
            functionId.functionKey,
          ),
        ) ?? Number.MAX_SAFE_INTEGER,
    ),
  );
  const conductiveElementIds = uniqueByKey(
    graph.edges.flatMap(({ elementIds }) => elementIds.map(cloneElement)),
    conductorKey,
  ).sort(compareConductiveElementId);
  const netIds = uniqueByKey(
    [
      ...graph.edges.map(({ netId }) => netId),
      ...graph.nodes.flatMap((node) => node.ports.map(({ netId }) => netId)),
    ],
    (value) => value,
  ).sort(compareText);
  return {
    deviceUids,
    terminalIds,
    functionIds,
    conductiveElementIds,
    netIds,
    presentationNodeIds: graph.nodes.map(({ id }) => id),
  };
}

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

function immutableEdge(edge: MutablePresentationEdge): PresentationEdge {
  if (edge.sourcePortId === "" || edge.targetPortId === "") {
    throw new Error(`Presentation edge ${edge.id} has an unbound endpoint.`);
  }
  return {
    id: edge.id,
    parentId: "root",
    kind: edge.kind,
    sourcePortId: edge.sourcePortId,
    targetPortId: edge.targetPortId,
    netId: edge.netId,
    elementIds: edge.elementIds.map(cloneElement),
    ...(edge.conductor === undefined
      ? {}
      : { conductor: structuredClone(edge.conductor) }),
    endpoints: [
      cloneTerminal(edge.endpoints[0]),
      cloneTerminal(edge.endpoints[1]),
    ],
    pathRank: edge.pathRank,
    ...(edge.label === undefined ? {} : { label: edge.label }),
    ...(edge.netLabel === undefined ? {} : { netLabel: edge.netLabel }),
  };
}

function cloneView(selected: Readonly<SelectedSubgraph>) {
  if (selected.view.format === "schematic-view/0.1") {
    return {
      format: "schematic-view/0.1" as const,
      family: selected.view.family,
      root: {
        deviceUid: selected.view.root.deviceUid,
        designation: selected.view.root.designation,
      },
      flow: selected.view.flow,
    };
  }
  if (selected.view.intent === "trace") {
    return {
      format: "schematic-view/0.2" as const,
      family: "control" as const,
      intent: "trace" as const,
      root: { ...selected.view.root },
      target: { ...selected.view.target },
      includePower: selected.view.includePower,
      flow: selected.view.flow,
    };
  }
  if (selected.view.intent === "conductors") {
    return {
      format: "schematic-view/0.2" as const,
      family: "control" as const,
      intent: "conductors" as const,
      root: { ...selected.view.root },
      flow: selected.view.flow,
    };
  }
  return {
    format: "schematic-view/0.2" as const,
    family: "control" as const,
    intent: "loads" as const,
    root: { ...selected.view.root },
    flow: selected.view.flow,
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
  const graph: PresentationGraph = {
    format: "schematic-presentation/0.1",
    view: cloneView(context.selected),
    locationGroups: [...visible.value.groups.locationGroups],
    deviceGroups: [...visible.value.groups.deviceGroups],
    nodes: [...visible.value.nodes, ...inserted.junctions].sort(
      comparePresentationNode,
    ),
    edges: mutableEdges
      .sort((left, right) => comparePresentationEdge(context, left, right))
      .map(immutableEdge),
    metadataTextSources: metadataTextSources(
      context,
      visible.value.nodes,
      mutableEdges,
    ),
  };
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

function canonicalSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSerializable);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareText)
      .map((key) => [key, canonicalSerializable(record[key])]),
  );
}

export function serializePresentationGraphForTest(
  graph: Readonly<PresentationGraph>,
): string {
  return JSON.stringify(canonicalSerializable(graph));
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Presentation invariant: ${message}`);
}

interface ClosedTraceValidationRecord {
  readonly originalId: string;
  readonly role: "split" | "merge";
  readonly componentIndex: number;
  readonly componentIds: readonly string[];
  readonly conductorIds: readonly string[];
  readonly terminalKey: string;
  readonly netId: string;
}

interface ClosedTraceValidationIndex {
  readonly byNodeId: ReadonlyMap<string, ClosedTraceValidationRecord>;
  readonly byTerminalKey: ReadonlyMap<string, ClosedTraceValidationRecord>;
}

function closedTraceValidationRecords(
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
  const signal = signals[0]!;
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
      const component = template.components[componentIndex]!;
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
  return { byNodeId, byTerminalKey };
}

function junctionLinkComponent(
  start: JunctionPresentationNode,
  graph: Readonly<PresentationGraph>,
  ownerByPortId: ReadonlyMap<string, PresentationNode>,
): readonly JunctionPresentationNode[] {
  const visited = new Map<string, JunctionPresentationNode>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.shift()!;
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
  return [...visited.values()].sort(comparePresentationNode);
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    new Set(left).size === new Set(right).size &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

function validateLabel(label: PresentationLabel): void {
  invariant(label.width === labelWidth(label.text), `${label.id} width`);
  invariant(label.height === 14, `${label.id} height`);
  invariant(
    label.textLength === Number((label.width - 6).toFixed(3)),
    `${label.id} text length`,
  );
  invariant(
    label.id ===
      structuralTupleId("label", label.ownerKind, label.ownerId, label.role),
    `${label.id} identity`,
  );
  const sortedSources = [...label.textSources].sort(compareRenderTextSource);
  invariant(
    JSON.stringify(label.textSources) === JSON.stringify(sortedSources),
    `${label.id} text source order`,
  );
}

function exactTerminalTuple(
  left: readonly [TerminalId, TerminalId],
  right: readonly [TerminalId, TerminalId],
): boolean {
  return sameTerminal(left[0], right[0]) && sameTerminal(left[1], right[1]);
}

function collectPresentationLabels(
  graph: Readonly<PresentationGraph>,
): readonly PresentationLabel[] {
  return [
    ...graph.locationGroups.map(({ label }) => label),
    ...graph.deviceGroups.map(({ label }) => label),
    ...graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : node.labels,
    ),
    ...graph.edges.flatMap((edge) => [
      ...(edge.label === undefined ? [] : [edge.label]),
      ...(edge.netLabel === undefined ? [] : [edge.netLabel]),
    ]),
  ];
}

function validateSymbolTruth(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  node: Readonly<SymbolPresentationNode>,
  mappings: readonly DeviceTypeSymbolMapping[],
): void {
  const device = ir.devices.find(({ uid }) => uid === node.deviceUid);
  invariant(device !== undefined, `${node.id} device exists`);
  invariant(device.designation === node.designation, `${node.id} designation`);
  invariant(device.typeId === node.typeId, `${node.id} type`);
  const deviceType = ir.deviceTypes.find(({ id }) => id === device.typeId);
  invariant(deviceType !== undefined, `${node.id} device type exists`);
  const mapping = mappings.find(({ typeId }) => typeId === device.typeId);
  invariant(mapping !== undefined, `${node.id} mapping exists`);
  const portBySymbolId = new Map(
    node.ports.map((port) => [port.symbolPortId, port]),
  );
  if (node.representation === "function") {
    invariant(node.functionIds.length === 1, `${node.id} one function`);
    const functionId = node.functionIds[0]!;
    invariant(
      functionId.deviceUid === node.deviceUid,
      `${node.id} function owner`,
    );
    const rule = mapping.functions.find(
      ({ functionKey, families }) =>
        functionKey === functionId.functionKey &&
        families.includes(selected.view.family),
    );
    invariant(rule !== undefined, `${node.id} function mapping`);
    invariant(rule.symbolId === node.symbolId, `${node.id} symbol mapping`);
    invariant(
      rule.classification === node.classification,
      `${node.id} classification`,
    );
    const materialized = ir.functions.find(
      ({ id }) => functionIdKey(id) === functionIdKey(functionId),
    );
    invariant(materialized !== undefined, `${node.id} function exists`);
    invariant(
      sameStringSet(
        node.ports.map(({ terminal }) => terminal.terminalKey),
        materialized.terminals.map(({ terminalKey }) => terminalKey),
      ),
      `${node.id} required function terminal coverage`,
    );
    for (const binding of rule.bindings) {
      const port = portBySymbolId.get(binding.portId);
      invariant(
        port !== undefined,
        `${node.id} port binding ${binding.portId}`,
      );
      invariant(
        port.terminal.terminalKey === binding.terminalKey,
        `${node.id} binding terminal`,
      );
      invariant(
        port.memberFunctionId !== undefined &&
          functionIdKey(port.memberFunctionId) === functionIdKey(functionId),
        `${node.id} member function`,
      );
    }
  } else {
    const rules = mapping.aggregates.filter(
      (rule) =>
        rule.families.includes(selected.view.family) &&
        rule.symbolId === node.symbolId &&
        rule.classification === node.classification &&
        sameStringSet(
          rule.functionKeys,
          node.functionIds.map(({ functionKey }) => functionKey),
        ),
    );
    invariant(rules.length === 1, `${node.id} aggregate mapping`);
    const rule = rules[0]!;
    const coveredByMember = new Map<string, string[]>();
    for (const binding of rule.bindings) {
      const port = portBySymbolId.get(binding.portId);
      invariant(
        port !== undefined,
        `${node.id} aggregate port ${binding.portId}`,
      );
      invariant(
        port.terminal.terminalKey === binding.terminalKey,
        `${node.id} aggregate terminal`,
      );
      invariant(
        port.memberFunctionId !== undefined &&
          port.memberFunctionId.deviceUid === node.deviceUid &&
          port.memberFunctionId.functionKey === binding.memberFunctionKey,
        `${node.id} aggregate member provenance`,
      );
      coveredByMember.set(binding.memberFunctionKey, [
        ...(coveredByMember.get(binding.memberFunctionKey) ?? []),
        binding.terminalKey,
      ]);
    }
    for (const functionKey of rule.functionKeys) {
      const materialized = ir.functions.find(
        ({ id }) =>
          id.deviceUid === node.deviceUid && id.functionKey === functionKey,
      );
      invariant(
        materialized !== undefined,
        `${node.id} aggregate member ${functionKey}`,
      );
      invariant(
        sameStringSet(
          coveredByMember.get(functionKey) ?? [],
          materialized.terminals.map(({ terminalKey }) => terminalKey),
        ),
        `${node.id} aggregate member terminal coverage ${functionKey}`,
      );
    }
  }
}

export function validatePresentationGraph(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  graph: Readonly<PresentationGraph>,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
): void {
  invariant(graph.format === "schematic-presentation/0.1", "graph format");
  invariant(
    JSON.stringify(graph.view) === JSON.stringify(selected.view),
    "normalized view identity",
  );
  const deviceByUid = new Map(ir.devices.map((device) => [device.uid, device]));
  const terminalByKey = new Map(
    ir.terminals.map((terminal) => [terminalIdKey(terminal.id), terminal]),
  );
  const netByTerminal = new Map(
    ir.indexes.netIdByTerminal.map(({ key, value }) => [
      terminalIdKey(key),
      value,
    ]),
  );
  const locationById = new Map<string, LocationGroup>();
  for (const group of graph.locationGroups) {
    invariant(!locationById.has(group.id), `${group.id} unique location`);
    locationById.set(group.id, group);
    invariant(group.parentId === "root", `${group.id} root parent`);
    invariant(group.label.role === "location", `${group.id} location label`);
    invariant(
      group.id === locationGroupId(group.identity),
      `${group.id} tagged location identity`,
    );
  }
  const sortedLocations = [...graph.locationGroups].sort((left, right) =>
    compareLocationIdentity(left.identity, right.identity),
  );
  invariant(
    JSON.stringify(graph.locationGroups) === JSON.stringify(sortedLocations),
    "location order",
  );
  const deviceGroupByUid = new Map<string, DeviceGroup>();
  const deviceGroupById = new Map<string, DeviceGroup>();
  for (const group of graph.deviceGroups) {
    invariant(
      !deviceGroupById.has(group.id),
      `${group.id} unique device group`,
    );
    deviceGroupById.set(group.id, group);
    deviceGroupByUid.set(group.deviceUid, group);
    const device = deviceByUid.get(group.deviceUid);
    invariant(device !== undefined, `${group.id} exact device`);
    invariant(
      group.id === deviceGroupId(device.uid),
      `${group.id} tagged device ID`,
    );
    invariant(
      group.designation === device.designation,
      `${group.id} designation`,
    );
    invariant(group.typeId === device.typeId, `${group.id} type`);
    invariant(group.label.role === "device", `${group.id} device label`);
    const parent = locationById.get(group.parentId);
    invariant(parent !== undefined, `${group.id} location parent`);
    invariant(
      JSON.stringify(parent.identity) ===
        JSON.stringify(locationIdentity(device)),
      `${group.id} exact authored/virtual location`,
    );
  }

  const nodeById = new Map<string, PresentationNode>();
  const portById = new Map<string, PresentationPort>();
  const ownerByPortId = new Map<string, PresentationNode>();
  for (const node of graph.nodes) {
    invariant(!nodeById.has(node.id), `${node.id} unique node`);
    nodeById.set(node.id, node);
    for (const port of node.ports) {
      invariant(!portById.has(port.id), `${port.id} unique port`);
      portById.set(port.id, port);
      ownerByPortId.set(port.id, node);
      const terminal = terminalByKey.get(terminalIdKey(port.terminal));
      invariant(terminal !== undefined, `${port.id} terminal exists`);
      invariant(
        netByTerminal.get(terminalIdKey(port.terminal)) === port.netId,
        `${port.id} query-owned compiler net`,
      );
      if (node.kind === "symbol") {
        invariant(
          port.terminal.deviceUid === node.deviceUid,
          `${port.id} same-device terminal`,
        );
        invariant(
          port.memberFunctionId !== undefined,
          `${port.id} required member function`,
        );
        invariant(
          port.label === port.terminal.terminalKey,
          `${port.id} exact terminal label`,
        );
      } else if (node.kind === "rail") {
        invariant(
          port.memberFunctionId === undefined,
          `${port.id} no rail member function`,
        );
        invariant(
          port.label === port.terminal.terminalKey,
          `${port.id} exact rail terminal label`,
        );
      } else {
        invariant(
          port.memberFunctionId === undefined,
          `${port.id} no junction member function`,
        );
        invariant(port.label === "", `${port.id} no junction label`);
      }
    }
    const sortedPorts = [...node.ports].sort((left, right) =>
      comparePresentationPort(
        left,
        right,
        (deviceUid) => deviceByUid.get(deviceUid)?.designation ?? "",
      ),
    );
    invariant(
      JSON.stringify(node.ports) === JSON.stringify(sortedPorts),
      `${node.id} port order`,
    );
    if (node.kind === "junction") {
      invariant(
        node.ports.every(({ order }, index) => order === index),
        `${node.id} dense junction port order`,
      );
    }
    if (node.kind === "symbol") {
      const group = deviceGroupById.get(node.parentId);
      invariant(group !== undefined, `${node.id} device parent`);
      invariant(
        group.deviceUid === node.deviceUid,
        `${node.id} exact device parent`,
      );
      invariant(
        node.deviceGroupId === group.id,
        `${node.id} tagged device parent`,
      );
      invariant(
        node.locationGroupId === group.parentId,
        `${node.id} location parent`,
      );
      validateSymbolTruth(ir, selected, node, mappings);
    } else if (node.kind === "rail") {
      invariant(node.parentId === "root", `${node.id} rail root parent`);
      invariant(
        node.classification === "rail",
        `${node.id} rail classification`,
      );
      invariant(node.ports.length === 1, `${node.id} one rail port`);
      invariant(
        sameTerminal(node.ports[0].terminal, node.boundary.terminal) &&
          node.ports[0].netId === node.boundary.netId,
        `${node.id} rail terminal/net provenance`,
      );
      if (node.boundary.potentialUid !== undefined) {
        const potential = ir.potentials.find(
          ({ uid }) => uid === node.boundary.potentialUid,
        );
        invariant(potential !== undefined, `${node.id} potential exists`);
        invariant(
          sameTerminal(potential.terminal, node.boundary.terminal) &&
            potential.netId === node.boundary.netId,
          `${node.id} exact authored potential anchor`,
        );
      }
    }
  }
  invariant(
    JSON.stringify(graph.nodes) ===
      JSON.stringify([...graph.nodes].sort(comparePresentationNode)),
    "presentation node order",
  );

  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const expectedKind: SemanticAttachmentKind =
      node.kind === "rail"
        ? "collapsed-boundary"
        : node.representation === "aggregate"
          ? "aggregate"
          : ir.functions.find(
                ({ id }) =>
                  functionIdKey(id) === functionIdKey(node.functionIds[0]!),
              )?.kind === "channel"
            ? "channel"
            : "function";
    const uniqueOwnerTerminals = new Set<string>();
    for (const attachment of node.attachments) {
      invariant(attachment.nodeId === node.id, `${node.id} attachment owner`);
      invariant(
        attachment.kind === expectedKind,
        `${node.id} exclusive attachment kind`,
      );
      const key = terminalIdKey(attachment.terminal);
      invariant(
        !uniqueOwnerTerminals.has(key),
        `${node.id} one incidence per terminal`,
      );
      uniqueOwnerTerminals.add(key);
      invariant(
        attachment.netId === netByTerminal.get(key),
        `${node.id} attachment net`,
      );
      invariant(
        attachment.portIds.length > 0 &&
          attachment.portIds.every(
            (portId) =>
              ownerByPortId.get(portId)?.id === node.id &&
              sameTerminal(portById.get(portId)!.terminal, attachment.terminal),
          ),
        `${node.id} attachment visual ports`,
      );
    }
    invariant(
      uniqueOwnerTerminals.size ===
        new Set(node.ports.map(({ terminal }) => terminalIdKey(terminal))).size,
      `${node.id} complete attachment incidence`,
    );
  }

  const conductorCountByPort = new Map<string, number>();
  for (const edge of graph.edges) {
    invariant(edge.parentId === "root", `${edge.id} root edge parent`);
    const source = portById.get(edge.sourcePortId);
    const target = portById.get(edge.targetPortId);
    invariant(
      source !== undefined && target !== undefined,
      `${edge.id} ports exist`,
    );
    invariant(
      source.netId === edge.netId && target.netId === edge.netId,
      `${edge.id} port nets`,
    );
    if (edge.kind === "conductor") {
      invariant(
        edge.elementIds.length === 1,
        `${edge.id} one physical element`,
      );
      const record = irConductorRecord(ir, edge.elementIds[0]!);
      invariant(
        exactTerminalTuple(edge.endpoints, record.endpoints),
        `${edge.id} canonical endpoints`,
      );
      invariant(
        sameEndpointPair([source.terminal, target.terminal], record.endpoints),
        `${edge.id} visual endpoints preserve electrical truth`,
      );
      conductorCountByPort.set(
        source.id,
        (conductorCountByPort.get(source.id) ?? 0) + 1,
      );
      conductorCountByPort.set(
        target.id,
        (conductorCountByPort.get(target.id) ?? 0) + 1,
      );
    } else {
      invariant(
        edge.elementIds.length === 0,
        `${edge.id} no fabricated wire UID`,
      );
      invariant(
        sameTerminal(edge.endpoints[0], edge.endpoints[1]) &&
          sameTerminal(source.terminal, edge.endpoints[0]) &&
          sameTerminal(target.terminal, edge.endpoints[0]),
        `${edge.id} one presentation terminal`,
      );
    }
  }
  for (const [portId, count] of conductorCountByPort) {
    const owner = ownerByPortId.get(portId);
    if (owner?.kind !== "junction") {
      invariant(count <= 1, `${portId} non-junction fanout`);
    }
  }

  const closedTraceRecords = closedTraceValidationRecords(selected, graph);
  for (const junction of graph.nodes.filter(
    (node): node is JunctionPresentationNode => node.kind === "junction",
  )) {
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
        otherOrders.every(
          (order, index) => order === conductors.length + index,
        ),
      `${junction.id} conductor-then-structural order`,
    );
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

    const component = junctionLinkComponent(junction, graph, ownerByPortId);
    const componentIds = new Set(component.map(({ id }) => id));
    const componentPortIds = new Set(
      component.flatMap((node) => node.ports.map(({ id }) => id)),
    );
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
    const visibleNodeIds = new Set<string>();
    for (const edge of graph.edges) {
      const localSource = componentPortIds.has(edge.sourcePortId);
      const localTarget = componentPortIds.has(edge.targetPortId);
      if (localSource === localTarget) continue;
      const otherPortId = localSource ? edge.targetPortId : edge.sourcePortId;
      const owner = ownerByPortId.get(otherPortId);
      if (owner !== undefined && owner.kind !== "junction") {
        visibleNodeIds.add(owner.id);
      } else if (owner?.kind === "junction" && !componentIds.has(owner.id)) {
        const remote = junctionLinkComponent(owner, graph, ownerByPortId);
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

  const labels = collectPresentationLabels(graph);
  const labelIds = new Set<string>();
  for (const label of labels) {
    invariant(!labelIds.has(label.id), `${label.id} unique label`);
    labelIds.add(label.id);
    validateLabel(label);
  }
  const sortedMetadata = [...graph.metadataTextSources].sort(
    compareRenderTextSource,
  );
  invariant(
    JSON.stringify(graph.metadataTextSources) ===
      JSON.stringify(sortedMetadata),
    "metadata text source order",
  );
  const typeSources = graph.metadataTextSources.filter(
    ({ ownerKind, field }) => ownerKind === "device" && field === "device.type",
  );
  invariant(
    typeSources.length === selected.deviceUids.length,
    "one device.type source per selected device",
  );
  for (const deviceUid of selected.deviceUids) {
    const device = deviceByUid.get(deviceUid);
    invariant(device !== undefined, `${deviceUid} selected device exists`);
    const matches = typeSources.filter(
      ({ ownerId, value }) =>
        ownerId === svgSemanticId("device", [deviceUid]) &&
        value === device.typeId,
    );
    invariant(
      matches.length === 1,
      `${deviceUid} safe UID-owned device.type source`,
    );
  }
  const graphSummary = summarizePresentationGraph(ir, graph, mappings);
  invariant(
    sameStringSet(graphSummary.deviceUids, selected.deviceUids),
    "selected device provenance union",
  );
  invariant(
    sameStringSet(graphSummary.netIds, selected.netIds),
    "selected net provenance union",
  );
  invariant(
    sameStringSet(
      graphSummary.conductiveElementIds.map(conductorKey),
      selected.conductiveElementIds.map(conductorKey),
    ),
    "selected conductor provenance union",
  );
}
