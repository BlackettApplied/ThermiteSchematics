import { createHash } from "node:crypto";

import {
  appendJsonPointer,
  normalizeDiagnosticFile,
  type CableType,
  type Device,
  type DeviceFunction,
  type ValidatedDeviceType,
} from "@thermite/schema";

import type { LoadedDocument } from "./loader.js";
import type {
  InstanceTypeResolution,
  LibraryTypeCatalogEntry,
  ResolveLoadedProjectResult,
  SourceRef,
  TerminalId,
} from "./resolution.js";

export interface FunctionId {
  deviceUid: string;
  functionKey: string;
}

type TerminalDefinition = ValidatedDeviceType["terminals"][string];
type TerminalRating = NonNullable<TerminalDefinition["rating"]>;
type FunctionKind = DeviceFunction["kind"];
type PlainFunctionKind = Exclude<FunctionKind, "contact" | "channel">;
type InternalVerb = NonNullable<
  ValidatedDeviceType["internal_relations"]
>[number]["relation"];

export interface IrDeviceTypeTerminal {
  key: string;
  role?: string;
  required?: boolean;
  rating?: TerminalRating;
  connectionPolicy?: "exclusive" | "shared";
  description?: string;
  source: SourceRef;
}

interface IrFunctionDefinitionBase {
  key: string;
  terminalKeys: string[];
  source: SourceRef;
}

export type IrDeviceTypeFunction = IrFunctionDefinitionBase &
  (
    | { kind: "contact"; normal_state: "open" | "closed" }
    | { kind: "channel"; direction: "input" | "output" }
    | { kind: PlainFunctionKind }
  );

export interface IrDeviceTypeInternalRelation {
  verb: InternalVerb;
  fromFunctionKey: string;
  toFunctionKey: string;
  sourceOrigins: SourceRef[];
}

export interface IrDeviceType {
  circuitSymbols?: ValidatedDeviceType["circuitSymbols"];
  /** Exact authored mark locations, retained for diagnostics after IR serialization. */
  circuitSymbolSources?: Record<string, SourceRef>;
  connectionCoverage?: ValidatedDeviceType["connectionCoverage"];
  ports?: ValidatedDeviceType["ports"];
  connectorPorts?: ValidatedDeviceType["connectorPorts"];
  category?: ValidatedDeviceType["category"];
  terminalOrder?: string[];
  catalog?: ValidatedDeviceType["catalog"];
  kind: "device_type";
  id: string;
  libraryName: string;
  libraryVersion: string;
  description?: string;
  aliases: string[];
  terminals: IrDeviceTypeTerminal[];
  functions: IrDeviceTypeFunction[];
  internalRelations: IrDeviceTypeInternalRelation[];
  symbol?: string;
  source: SourceRef;
}

export interface IrCableTypeConductor {
  id: string;
  color: string;
  size?: string;
  source: SourceRef;
}

export interface IrCableType {
  kind: "cable_type";
  id: string;
  libraryName: string;
  libraryVersion: string;
  description?: string;
  aliases: string[];
  conductors: IrCableTypeConductor[];
  shield?: boolean;
  construction?: NonNullable<CableType["construction"]>;
  source: SourceRef;
}

export interface IrDevice {
  connectionReview?: Device["connectionReview"];
  io?: Device["io"];
  uid: string;
  designation: string;
  typeId: string;
  description?: string;
  aliases: string[];
  location?: string;
  source: SourceRef;
}

export interface IrCable {
  uid: string;
  designation: string;
  typeId: string;
  description?: string;
  aliases: string[];
  fromLocation?: string;
  toLocation?: string;
  /** Authored end A/B order, including physically unterminated spare cores. */
  assignments?: {
    id: string;
    usage?: "in-use" | "spare";
    endpoints: [
      { terminal: TerminalId; source: SourceRef } | null,
      { terminal: TerminalId; source: SourceRef } | null,
    ];
    source: SourceRef;
  }[];
  source: SourceRef;
}

export interface IrTerminal {
  id: TerminalId;
  role?: string;
  required?: boolean;
  rating?: TerminalRating;
  connectionPolicy?: "exclusive" | "shared";
  description?: string;
  source: SourceRef;
}

interface IrFunctionBase {
  id: FunctionId;
  terminals: TerminalId[];
  source: SourceRef;
}

export type IrFunction = IrFunctionBase &
  (
    | { kind: "contact"; normal_state: "open" | "closed" }
    | { kind: "channel"; direction: "input" | "output" }
    | { kind: PlainFunctionKind }
  );

export interface IrInternalRelation {
  deviceUid: string;
  verb: InternalVerb;
  from: FunctionId;
  to: FunctionId;
  sourceOrigins: SourceRef[];
}

export interface IrGangedGroup {
  id: string;
  functionIds: FunctionId[];
}

export interface ExpansionResult {
  deviceTypes: IrDeviceType[];
  cableTypes: IrCableType[];
  devices: IrDevice[];
  cables: IrCable[];
  terminals: IrTerminal[];
  functions: IrFunction[];
  internalRelations: IrInternalRelation[];
  gangedGroups: IrGangedGroup[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTerminalId(left: TerminalId, right: TerminalId): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.terminalKey, right.terminalKey)
  );
}

function compareFunctionId(left: FunctionId, right: FunctionId): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.functionKey, right.functionKey)
  );
}

function compareSourceRef(left: SourceRef, right: SourceRef): number {
  return (
    compareText(left.file, right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.jsonPointer, right.jsonPointer)
  );
}

function sameSourceRef(left: SourceRef, right: SourceRef): boolean {
  return compareSourceRef(left, right) === 0;
}

function sourceRef(
  document: LoadedDocument<unknown>,
  jsonPointer: string,
): SourceRef {
  const location = document.nodes.get(jsonPointer)?.value;
  return {
    file: normalizeDiagnosticFile(document.file),
    line: location?.line ?? 1,
    column: location?.column ?? 1,
    jsonPointer,
  };
}

function typePointer(entry: LibraryTypeCatalogEntry): string {
  return appendJsonPointer("/types", entry.typeIndex);
}

function typeMemberPointer(
  entry: LibraryTypeCatalogEntry,
  collection: string,
  member: string | number,
): string {
  return appendJsonPointer(
    appendJsonPointer(typePointer(entry), collection),
    member,
  );
}

function copyRating(
  rating: TerminalRating | undefined,
): TerminalRating | undefined {
  return rating === undefined ? undefined : { ...rating };
}

function normalizeFunctionDefinition(
  key: string,
  definition: DeviceFunction,
  source: SourceRef,
): IrDeviceTypeFunction {
  const base: IrFunctionDefinitionBase = {
    key,
    terminalKeys: [...definition.terminals],
    source,
  };

  if (definition.kind === "contact") {
    return {
      ...base,
      kind: definition.kind,
      normal_state: definition.normal_state,
    };
  }

  if (definition.kind === "channel") {
    return {
      ...base,
      kind: definition.kind,
      direction: definition.direction,
    };
  }

  return { ...base, kind: definition.kind };
}

function canonicalFunctionKeys(
  verb: InternalVerb,
  fromFunctionKey: string,
  toFunctionKey: string,
): readonly [string, string] {
  if (
    verb === "ganged_with" &&
    compareText(fromFunctionKey, toFunctionKey) > 0
  ) {
    return [toFunctionKey, fromFunctionKey];
  }

  return [fromFunctionKey, toFunctionKey];
}

function normalizeTypeRelations(
  entry: LibraryTypeCatalogEntry & { type: ValidatedDeviceType },
): IrDeviceTypeInternalRelation[] {
  const records: IrDeviceTypeInternalRelation[] = [];

  for (const [relationIndex, relation] of (
    entry.type.internal_relations ?? []
  ).entries()) {
    const [fromFunctionKey, toFunctionKey] = canonicalFunctionKeys(
      relation.relation,
      relation.from,
      relation.to,
    );
    const origin = sourceRef(
      entry.document,
      typeMemberPointer(entry, "internal_relations", relationIndex),
    );
    const existing = records.find(
      (record) =>
        record.verb === relation.relation &&
        record.fromFunctionKey === fromFunctionKey &&
        record.toFunctionKey === toFunctionKey,
    );

    if (existing === undefined) {
      records.push({
        verb: relation.relation,
        fromFunctionKey,
        toFunctionKey,
        sourceOrigins: [origin],
      });
    } else if (
      !existing.sourceOrigins.some((source) => sameSourceRef(source, origin))
    ) {
      existing.sourceOrigins.push(origin);
    }
  }

  for (const record of records) {
    record.sourceOrigins.sort(compareSourceRef);
  }

  return records.sort(
    (left, right) =>
      compareText(left.verb, right.verb) ||
      compareText(left.fromFunctionKey, right.fromFunctionKey) ||
      compareText(left.toFunctionKey, right.toFunctionKey),
  );
}

function normalizeDeviceType(
  entry: LibraryTypeCatalogEntry & { type: ValidatedDeviceType },
): IrDeviceType {
  const type = entry.type;
  return {
    kind: type.kind,
    id: type.id,
    ...(type.connectionCoverage === undefined
      ? {}
      : { connectionCoverage: structuredClone(type.connectionCoverage) }),
    ...(type.category === undefined ? {} : { category: type.category }),
    ...(type.terminalOrder === undefined
      ? {}
      : { terminalOrder: [...type.terminalOrder] }),
    ...(type.ports === undefined ? {} : { ports: structuredClone(type.ports) }),
    ...(type.connectorPorts === undefined
      ? {}
      : { connectorPorts: structuredClone(type.connectorPorts) }),
    ...(type.catalog === undefined
      ? {}
      : { catalog: structuredClone(type.catalog) }),
    ...(type.circuitSymbols === undefined
      ? {}
      : {
          circuitSymbols: structuredClone(type.circuitSymbols),
          circuitSymbolSources: Object.fromEntries(
            Object.keys(type.circuitSymbols)
              .sort(compareText)
              .map((key) => [
                key,
                sourceRef(
                  entry.document,
                  typeMemberPointer(entry, "circuitSymbols", key),
                ),
              ]),
          ),
        }),
    libraryName: entry.library.dependency.name,
    libraryVersion: entry.library.dependency.version,
    ...(type.description === undefined
      ? {}
      : { description: type.description }),
    aliases: [...(type.aliases ?? [])],
    terminals: Object.entries(type.terminals)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, terminal]) => ({
        key,
        ...(terminal.role === undefined ? {} : { role: terminal.role }),
        ...(terminal.required === undefined
          ? {}
          : { required: terminal.required }),
        ...(terminal.rating === undefined
          ? {}
          : { rating: copyRating(terminal.rating)! }),
        ...(terminal.connection_policy === undefined
          ? {}
          : { connectionPolicy: terminal.connection_policy }),
        ...(terminal.description === undefined
          ? {}
          : { description: terminal.description }),
        source: sourceRef(
          entry.document,
          typeMemberPointer(entry, "terminals", key),
        ),
      })),
    functions: Object.entries(type.functions)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, definition]) =>
        normalizeFunctionDefinition(
          key,
          definition,
          sourceRef(entry.document, typeMemberPointer(entry, "functions", key)),
        ),
      ),
    internalRelations: normalizeTypeRelations(entry),
    ...(type.symbol === undefined ? {} : { symbol: type.symbol }),
    source: sourceRef(entry.document, typePointer(entry)),
  };
}

function normalizeCableType(
  entry: LibraryTypeCatalogEntry & { type: CableType },
): IrCableType {
  const type = entry.type;
  return {
    kind: type.kind,
    id: type.id,
    libraryName: entry.library.dependency.name,
    libraryVersion: entry.library.dependency.version,
    ...(type.description === undefined
      ? {}
      : { description: type.description }),
    aliases: [...(type.aliases ?? [])],
    conductors: type.conductors
      .map((conductor, conductorIndex) => ({
        id: conductor.id,
        color: conductor.color,
        ...(conductor.size === undefined ? {} : { size: conductor.size }),
        source: sourceRef(
          entry.document,
          typeMemberPointer(entry, "conductors", conductorIndex),
        ),
      }))
      .sort((left, right) => compareText(left.id, right.id)),
    ...(type.shield === undefined ? {} : { shield: type.shield }),
    ...(type.construction === undefined
      ? {}
      : { construction: { ...type.construction } }),
    source: sourceRef(entry.document, typePointer(entry)),
  };
}

function materializeFunction(
  deviceUid: string,
  functionKey: string,
  definition: DeviceFunction,
  source: SourceRef,
): IrFunction {
  const base: IrFunctionBase = {
    id: { deviceUid, functionKey },
    terminals: definition.terminals.map((terminalKey) => ({
      deviceUid,
      terminalKey,
    })),
    source,
  };

  if (definition.kind === "contact") {
    return {
      ...base,
      kind: definition.kind,
      normal_state: definition.normal_state,
    };
  }

  if (definition.kind === "channel") {
    return {
      ...base,
      kind: definition.kind,
      direction: definition.direction,
    };
  }

  return { ...base, kind: definition.kind };
}

function materializeDevice(
  resolution: Extract<InstanceTypeResolution, { instance: { kind: "device" } }>,
  devices: IrDevice[],
  terminals: IrTerminal[],
  functions: IrFunction[],
  internalRelations: IrInternalRelation[],
  objectSource: SourceRef,
): void {
  const instance = resolution.instance;
  const typeEntry = resolution.typeEntry;
  const type = typeEntry.type;

  devices.push({
    uid: instance.uid,
    designation: instance.designation,
    typeId: type.id,
    ...(instance.connectionReview === undefined
      ? {}
      : { connectionReview: structuredClone(instance.connectionReview) }),
    ...(instance.io === undefined ? {} : { io: structuredClone(instance.io) }),
    ...(instance.description === undefined
      ? {}
      : { description: instance.description }),
    aliases: [...(instance.aliases ?? [])],
    ...(instance.location === undefined ? {} : { location: instance.location }),
    source: objectSource,
  });

  for (const [terminalKey, terminal] of Object.entries(type.terminals)) {
    terminals.push({
      id: { deviceUid: instance.uid, terminalKey },
      ...(terminal.role === undefined ? {} : { role: terminal.role }),
      ...(terminal.required === undefined
        ? {}
        : { required: terminal.required }),
      ...(terminal.rating === undefined
        ? {}
        : { rating: copyRating(terminal.rating)! }),
      ...(terminal.connection_policy === undefined
        ? {}
        : { connectionPolicy: terminal.connection_policy }),
      ...(terminal.description === undefined
        ? {}
        : { description: terminal.description }),
      source: sourceRef(
        typeEntry.document,
        typeMemberPointer(typeEntry, "terminals", terminalKey),
      ),
    });
  }

  for (const [functionKey, definition] of Object.entries(type.functions)) {
    functions.push(
      materializeFunction(
        instance.uid,
        functionKey,
        definition,
        sourceRef(
          typeEntry.document,
          typeMemberPointer(typeEntry, "functions", functionKey),
        ),
      ),
    );
  }

  for (const typeRelation of normalizeTypeRelations(typeEntry)) {
    internalRelations.push({
      deviceUid: instance.uid,
      verb: typeRelation.verb,
      from: {
        deviceUid: instance.uid,
        functionKey: typeRelation.fromFunctionKey,
      },
      to: {
        deviceUid: instance.uid,
        functionKey: typeRelation.toFunctionKey,
      },
      sourceOrigins: [...typeRelation.sourceOrigins],
    });
  }
}

function materializeCable(
  resolution: Extract<InstanceTypeResolution, { instance: { kind: "cable" } }>,
  source: SourceRef,
): IrCable {
  const instance = resolution.instance;
  return {
    uid: instance.uid,
    designation: instance.designation,
    typeId: resolution.typeEntry.type.id,
    ...(instance.description === undefined
      ? {}
      : { description: instance.description }),
    aliases: [...(instance.aliases ?? [])],
    ...(instance.fromLocation === undefined
      ? {}
      : { fromLocation: instance.fromLocation }),
    ...(instance.toLocation === undefined
      ? {}
      : { toLocation: instance.toLocation }),
    source,
  };
}

function gangGroupId(functionIds: readonly FunctionId[]): string {
  const tuples = functionIds.map(
    ({ deviceUid, functionKey }) => [deviceUid, functionKey] as const,
  );
  const digest = createHash("sha256")
    .update(JSON.stringify(tuples), "utf8")
    .digest("hex");
  return `gang:sha256:${digest}`;
}

function buildGangedGroups(
  internalRelations: readonly IrInternalRelation[],
): IrGangedGroup[] {
  const functionIds: FunctionId[] = [];
  const indexesByDevice = new Map<string, Map<string, number>>();
  const parents: number[] = [];

  function indexOf(id: FunctionId): number {
    let indexesByFunction = indexesByDevice.get(id.deviceUid);

    if (indexesByFunction === undefined) {
      indexesByFunction = new Map<string, number>();
      indexesByDevice.set(id.deviceUid, indexesByFunction);
    }

    const existing = indexesByFunction.get(id.functionKey);

    if (existing !== undefined) {
      return existing;
    }

    const index = functionIds.length;
    indexesByFunction.set(id.functionKey, index);
    functionIds.push({ ...id });
    parents.push(index);
    return index;
  }

  function find(index: number): number {
    let root = index;

    while (parents[root] !== root) {
      root = parents[root]!;
    }

    while (parents[index] !== index) {
      const parent = parents[index]!;
      parents[index] = root;
      index = parent;
    }

    return root;
  }

  function union(left: number, right: number): void {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      parents[rightRoot] = leftRoot;
    }
  }

  for (const relation of internalRelations) {
    if (relation.verb === "ganged_with") {
      union(indexOf(relation.from), indexOf(relation.to));
    }
  }

  const components = new Map<number, FunctionId[]>();

  for (const [index, functionId] of functionIds.entries()) {
    const root = find(index);
    const component = components.get(root);

    if (component === undefined) {
      components.set(root, [{ ...functionId }]);
    } else {
      component.push({ ...functionId });
    }
  }

  return [...components.values()]
    .filter((component) => component.length > 1)
    .map((component) => {
      component.sort(compareFunctionId);
      return { id: gangGroupId(component), functionIds: component };
    })
    .sort((left, right) => compareText(left.id, right.id));
}

function compareInternalRelation(
  left: IrInternalRelation,
  right: IrInternalRelation,
): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.verb, right.verb) ||
    compareFunctionId(left.from, right.from) ||
    compareFunctionId(left.to, right.to)
  );
}

export function expandResolvedProject(
  resolution: ResolveLoadedProjectResult,
): ExpansionResult {
  const deviceTypes: IrDeviceType[] = [];
  const cableTypes: IrCableType[] = [];
  const devices: IrDevice[] = [];
  const cables: IrCable[] = [];
  const terminals: IrTerminal[] = [];
  const functions: IrFunction[] = [];
  const internalRelations: IrInternalRelation[] = [];

  for (const entry of resolution.catalogs.libraryTypesById.values()) {
    if (entry.type.kind === "device_type") {
      deviceTypes.push(
        normalizeDeviceType(
          entry as LibraryTypeCatalogEntry & { type: ValidatedDeviceType },
        ),
      );
    } else {
      cableTypes.push(
        normalizeCableType(
          entry as LibraryTypeCatalogEntry & { type: CableType },
        ),
      );
    }
  }

  for (const [uid, instanceResolution] of resolution.instanceTypesByUid) {
    const objectSource =
      resolution.catalogs.projectObjectsByUid.get(uid)?.source;

    if (objectSource === undefined) {
      continue;
    }

    if (instanceResolution.instance.kind === "device") {
      materializeDevice(
        instanceResolution as Extract<
          InstanceTypeResolution,
          { instance: { kind: "device" } }
        >,
        devices,
        terminals,
        functions,
        internalRelations,
        objectSource,
      );
    } else {
      cables.push(
        materializeCable(
          instanceResolution as Extract<
            InstanceTypeResolution,
            { instance: { kind: "cable" } }
          >,
          objectSource,
        ),
      );
    }
  }

  deviceTypes.sort((left, right) => compareText(left.id, right.id));
  cableTypes.sort((left, right) => compareText(left.id, right.id));
  devices.sort((left, right) => compareText(left.uid, right.uid));
  cables.sort((left, right) => compareText(left.uid, right.uid));
  terminals.sort((left, right) => compareTerminalId(left.id, right.id));
  functions.sort((left, right) => compareFunctionId(left.id, right.id));
  internalRelations.sort(compareInternalRelation);

  return {
    deviceTypes,
    cableTypes,
    devices,
    cables,
    terminals,
    functions,
    internalRelations,
    gangedGroups: buildGangedGroups(internalRelations),
  };
}
