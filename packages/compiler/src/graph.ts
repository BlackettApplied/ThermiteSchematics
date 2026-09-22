import {
  appendJsonPointer,
  normalizeDiagnosticFile,
  type Potential,
  type ProjectObject,
  type Relation,
  type Wire,
} from "@thermite/schema";

import type { ExpansionResult, IrCableTypeConductor } from "./expansion.js";
import type { LoadedDocument } from "./loader.js";
import type {
  ProjectObjectCatalogEntry,
  ResolveLoadedProjectResult,
  ResolvedDeviceReference,
  ResolvedTerminalReference,
  SourceRef,
  TerminalId,
} from "./resolution.js";

export interface CableConductorId {
  cableUid: string;
  conductorId: string;
}

export type ConductiveElementId =
  | { kind: "wire"; uid: string }
  | { kind: "jumper"; uid: string }
  | {
      kind: "cable_conductor";
      cableUid: string;
      conductorId: string;
    };

export interface ResolvedEndpoint {
  terminal: TerminalId;
  source: SourceRef;
}

type WireProperties = NonNullable<Wire["properties"]>;
type ElectricalIntent = Potential["electrical"];
type ProjectRelationVerb = Relation["relation"];

export interface IrWire {
  uid: string;
  designation: string;
  description?: string;
  aliases: string[];
  endpoints: [ResolvedEndpoint, ResolvedEndpoint];
  properties?: WireProperties;
  source: SourceRef;
}

export interface IrJumper {
  uid: string;
  designation?: string;
  description?: string;
  aliases: string[];
  endpoints: [ResolvedEndpoint, ResolvedEndpoint];
  source: SourceRef;
}

export interface IrCableConductorTypeMetadata {
  color: string;
  size?: string;
  source: SourceRef;
}

export interface IrCableConductor {
  id: CableConductorId;
  cableUid: string;
  typeId: string;
  endpoints: [ResolvedEndpoint, ResolvedEndpoint];
  typeConductor: IrCableConductorTypeMetadata | null;
  source: SourceRef;
}

export interface IrProjectRelation {
  connection?: import("@thermite/schema").Relation["connection"];
  assembly?: import("@thermite/schema").Relation["assembly"];
  uid: string;
  verb: ProjectRelationVerb;
  fromDeviceUid: string;
  toDeviceUid: string;
  designation?: string;
  description?: string;
  aliases: string[];
  fromSource: SourceRef;
  toSource: SourceRef;
  source: SourceRef;
}

export interface IrPotentialDeclaration {
  uid: string;
  name: string;
  electrical: ElectricalIntent;
  designation?: string;
  description?: string;
  aliases: string[];
  terminal: TerminalId;
  terminalSource: SourceRef;
  source: SourceRef;
}

export interface IrPotential extends IrPotentialDeclaration {
  netId: string;
}

export interface ProjectObjectRef {
  kind: ProjectObject["kind"];
  uid: string;
}

export type InstanceRef =
  { kind: "device"; uid: string } | { kind: "cable"; uid: string };

export interface ProjectRelationEndpoints {
  fromDeviceUid: string;
  toDeviceUid: string;
}

export interface IrIndexEntry<Key, Value> {
  key: Key;
  value: Value;
}

/** D10 indexes that are complete before Task 8 derives nets. */
export interface IrGraphIndexes {
  terminalIdsByDeviceUid: IrIndexEntry<string, TerminalId[]>[];
  conductiveElementIdsByTerminal: IrIndexEntry<
    TerminalId,
    ConductiveElementId[]
  >[];
  terminalIdsByConductiveElement: IrIndexEntry<
    ConductiveElementId,
    [TerminalId, TerminalId]
  >[];
  conductorIdsByCableUid: IrIndexEntry<string, CableConductorId[]>[];
  objectRefByUid: IrIndexEntry<string, ProjectObjectRef>[];
  objectRefByDesignation: IrIndexEntry<string, ProjectObjectRef>[];
  relationEndpointsByUid: IrIndexEntry<string, ProjectRelationEndpoints>[];
  instanceRefsByTypeId: IrIndexEntry<string, InstanceRef[]>[];
}

/** Complete D10 index surface; Task 8 supplies the net-dependent entries. */
export interface IrIndexes extends IrGraphIndexes {
  netIdByTerminal: IrIndexEntry<TerminalId, string>[];
}

export interface GraphNormalizationResult {
  wires: IrWire[];
  jumpers: IrJumper[];
  cableConductors: IrCableConductor[];
  relations: IrProjectRelation[];
  potentials: IrPotentialDeclaration[];
  indexes: IrGraphIndexes;
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

function compareCableConductorId(
  left: CableConductorId,
  right: CableConductorId,
): number {
  return (
    compareText(left.cableUid, right.cableUid) ||
    compareText(left.conductorId, right.conductorId)
  );
}

const conductiveKindOrder: Record<ConductiveElementId["kind"], number> = {
  wire: 0,
  jumper: 1,
  cable_conductor: 2,
};

function compareConductiveElementId(
  left: ConductiveElementId,
  right: ConductiveElementId,
): number {
  const kindOrder =
    conductiveKindOrder[left.kind] - conductiveKindOrder[right.kind];

  if (kindOrder !== 0) {
    return kindOrder;
  }

  if (left.kind === "cable_conductor") {
    const rightConductor = right as Extract<
      ConductiveElementId,
      { kind: "cable_conductor" }
    >;
    return (
      compareText(left.cableUid, rightConductor.cableUid) ||
      compareText(left.conductorId, rightConductor.conductorId)
    );
  }

  return compareText(
    left.uid,
    (right as Extract<ConductiveElementId, { kind: typeof left.kind }>).uid,
  );
}

function compareInstanceRef(left: InstanceRef, right: InstanceRef): number {
  const kindOrder =
    (left.kind === "device" ? 0 : 1) - (right.kind === "device" ? 0 : 1);
  return kindOrder || compareText(left.uid, right.uid);
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

function objectPointer(entry: ProjectObjectCatalogEntry): string {
  return appendJsonPointer("/objects", entry.objectIndex);
}

function referenceKey(ownerUid: string, jsonPointer: string): string {
  return `${ownerUid}\0${jsonPointer}`;
}

function terminalReferenceMap(
  references: readonly ResolvedTerminalReference[],
): ReadonlyMap<string, ResolvedTerminalReference> {
  return new Map(
    references.map((reference) => [
      referenceKey(reference.ownerUid, reference.source.jsonPointer),
      reference,
    ]),
  );
}

function deviceReferenceMap(
  references: readonly ResolvedDeviceReference[],
): ReadonlyMap<string, ResolvedDeviceReference> {
  return new Map(
    references.map((reference) => [
      referenceKey(reference.ownerUid, reference.source.jsonPointer),
      reference,
    ]),
  );
}

function resolvedEndpoint(
  reference: ResolvedTerminalReference,
): ResolvedEndpoint {
  return {
    terminal: { ...reference.terminal },
    source: { ...reference.source },
  };
}

function canonicalEndpoints(
  first: ResolvedTerminalReference,
  second: ResolvedTerminalReference,
): [ResolvedEndpoint, ResolvedEndpoint] {
  const endpoints: [ResolvedEndpoint, ResolvedEndpoint] = [
    resolvedEndpoint(first),
    resolvedEndpoint(second),
  ];
  endpoints.sort((left, right) =>
    compareTerminalId(left.terminal, right.terminal),
  );
  return endpoints;
}

function normalizeWireProperties(
  properties: Wire["properties"],
): WireProperties | undefined {
  if (properties === undefined) {
    return undefined;
  }

  return {
    ...(properties.label === undefined ? {} : { label: properties.label }),
    ...(properties.size === undefined ? {} : { size: properties.size }),
    ...(properties.color === undefined ? {} : { color: properties.color }),
  };
}

function normalizeElectricalIntent(
  electrical: ElectricalIntent,
): ElectricalIntent {
  return {
    ...(electrical.nominal_voltage === undefined
      ? {}
      : { nominal_voltage: electrical.nominal_voltage }),
    ...(electrical.voltage_type === undefined
      ? {}
      : { voltage_type: electrical.voltage_type }),
    ...(electrical.polarity === undefined
      ? {}
      : { polarity: electrical.polarity }),
    ...(electrical.current === undefined
      ? {}
      : { current: electrical.current }),
    ...(electrical.power === undefined ? {} : { power: electrical.power }),
    ...(electrical.frequency === undefined
      ? {}
      : { frequency: electrical.frequency }),
  };
}

function typeConductorMetadata(
  conductor: IrCableTypeConductor | undefined,
): IrCableConductorTypeMetadata | null {
  return conductor === undefined
    ? null
    : {
        color: conductor.color,
        ...(conductor.size === undefined ? {} : { size: conductor.size }),
        source: { ...conductor.source },
      };
}

function terminalReferenceAt(
  references: ReadonlyMap<string, ResolvedTerminalReference>,
  ownerUid: string,
  pointer: string,
): ResolvedTerminalReference | undefined {
  return references.get(referenceKey(ownerUid, pointer));
}

function deviceReferenceAt(
  references: ReadonlyMap<string, ResolvedDeviceReference>,
  ownerUid: string,
  pointer: string,
): ResolvedDeviceReference | undefined {
  return references.get(referenceKey(ownerUid, pointer));
}

function normalizeGraphRecords(
  expansion: ExpansionResult,
  resolution: ResolveLoadedProjectResult,
): Omit<GraphNormalizationResult, "indexes"> {
  const terminalReferences = terminalReferenceMap(
    resolution.terminalReferences,
  );
  const deviceReferences = deviceReferenceMap(resolution.deviceReferences);
  const cablesByUid = new Map(
    expansion.cables.map((cable) => [cable.uid, cable]),
  );
  const cableTypesById = new Map(
    expansion.cableTypes.map((type) => [type.id, type]),
  );
  const wires: IrWire[] = [];
  const jumpers: IrJumper[] = [];
  const cableConductors: IrCableConductor[] = [];
  const relations: IrProjectRelation[] = [];
  const potentials: IrPotentialDeclaration[] = [];

  for (const entry of resolution.catalogs.projectObjectsByUid.values()) {
    const object = entry.object;
    const pointer = objectPointer(entry);

    if (object.kind === "wire" || object.kind === "jumper") {
      const endpointPointer = appendJsonPointer(pointer, "endpoints");
      const first = terminalReferenceAt(
        terminalReferences,
        object.uid,
        appendJsonPointer(endpointPointer, 0),
      );
      const second = terminalReferenceAt(
        terminalReferences,
        object.uid,
        appendJsonPointer(endpointPointer, 1),
      );

      if (first === undefined || second === undefined) {
        continue;
      }

      if (object.kind === "wire") {
        const properties = normalizeWireProperties(object.properties);
        wires.push({
          uid: object.uid,
          designation: object.designation,
          ...(object.description === undefined
            ? {}
            : { description: object.description }),
          aliases: [...(object.aliases ?? [])],
          endpoints: canonicalEndpoints(first, second),
          ...(properties === undefined ? {} : { properties }),
          source: { ...entry.source },
        });
      } else {
        jumpers.push({
          uid: object.uid,
          ...(object.designation === undefined
            ? {}
            : { designation: object.designation }),
          ...(object.description === undefined
            ? {}
            : { description: object.description }),
          aliases: [...(object.aliases ?? [])],
          endpoints: canonicalEndpoints(first, second),
          source: { ...entry.source },
        });
      }
      continue;
    }

    if (object.kind === "cable") {
      const cable = cablesByUid.get(object.uid);

      if (cable === undefined) {
        continue;
      }

      const typeConductors = new Map(
        (cableTypesById.get(cable.typeId)?.conductors ?? []).map(
          (conductor) => [conductor.id, conductor],
        ),
      );
      const conductorsPointer = appendJsonPointer(pointer, "conductors");
      const hasAssignments =
        object.fromLocation !== undefined ||
        object.toLocation !== undefined ||
        object.conductors.some((conductor) => conductor.usage !== undefined);
      if (hasAssignments) cable.assignments = [];

      for (const [conductorIndex, conductor] of object.conductors.entries()) {
        const conductorPointer = appendJsonPointer(
          conductorsPointer,
          conductorIndex,
        );
        const endpointsPointer = appendJsonPointer(
          conductorPointer,
          "endpoints",
        );
        const first = terminalReferenceAt(
          terminalReferences,
          object.uid,
          appendJsonPointer(endpointsPointer, 0),
        );
        const second = terminalReferenceAt(
          terminalReferences,
          object.uid,
          appendJsonPointer(endpointsPointer, 1),
        );

        if (hasAssignments) {
          cable.assignments!.push({
            id: conductor.id,
            ...(conductor.usage === undefined
              ? {}
              : { usage: conductor.usage }),
            endpoints: [
              first === undefined ? null : resolvedEndpoint(first),
              second === undefined ? null : resolvedEndpoint(second),
            ],
            source: sourceRef(entry.document, conductorPointer),
          });
        }

        if (first === undefined || second === undefined) {
          continue;
        }

        cableConductors.push({
          id: { cableUid: object.uid, conductorId: conductor.id },
          cableUid: object.uid,
          typeId: cable.typeId,
          endpoints: canonicalEndpoints(first, second),
          typeConductor: typeConductorMetadata(
            typeConductors.get(conductor.id),
          ),
          source: sourceRef(entry.document, conductorPointer),
        });
      }
      continue;
    }

    if (object.kind === "relation") {
      const fromPointer = appendJsonPointer(pointer, "from");
      const toPointer = appendJsonPointer(pointer, "to");
      const from = deviceReferenceAt(deviceReferences, object.uid, fromPointer);
      const to = deviceReferenceAt(deviceReferences, object.uid, toPointer);

      if (from === undefined || to === undefined) {
        continue;
      }

      relations.push({
        uid: object.uid,
        verb: object.relation,
        ...(object.connection === undefined
          ? {}
          : { connection: structuredClone(object.connection) }),
        ...(object.assembly === undefined
          ? {}
          : { assembly: structuredClone(object.assembly) }),
        fromDeviceUid: from.deviceUid,
        toDeviceUid: to.deviceUid,
        ...(object.designation === undefined
          ? {}
          : { designation: object.designation }),
        ...(object.description === undefined
          ? {}
          : { description: object.description }),
        aliases: [...(object.aliases ?? [])],
        fromSource: { ...from.source },
        toSource: { ...to.source },
        source: { ...entry.source },
      });
      continue;
    }

    if (object.kind === "potential") {
      const atPointer = appendJsonPointer(pointer, "at");
      const at = terminalReferenceAt(terminalReferences, object.uid, atPointer);

      if (at === undefined) {
        continue;
      }

      potentials.push({
        uid: object.uid,
        name: object.name,
        electrical: normalizeElectricalIntent(object.electrical),
        ...(object.designation === undefined
          ? {}
          : { designation: object.designation }),
        ...(object.description === undefined
          ? {}
          : { description: object.description }),
        aliases: [...(object.aliases ?? [])],
        terminal: { ...at.terminal },
        terminalSource: { ...at.source },
        source: { ...entry.source },
      });
    }
  }

  wires.sort((left, right) => compareText(left.uid, right.uid));
  jumpers.sort((left, right) => compareText(left.uid, right.uid));
  cableConductors.sort((left, right) =>
    compareCableConductorId(left.id, right.id),
  );
  relations.sort((left, right) => compareText(left.uid, right.uid));
  potentials.sort((left, right) => compareText(left.uid, right.uid));

  return { wires, jumpers, cableConductors, relations, potentials };
}

function terminalKey(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
}

function buildIndexes(
  expansion: ExpansionResult,
  resolution: ResolveLoadedProjectResult,
  records: Omit<GraphNormalizationResult, "indexes">,
): IrGraphIndexes {
  const terminalIdsByDevice = new Map<string, TerminalId[]>();

  for (const device of expansion.devices) {
    terminalIdsByDevice.set(device.uid, []);
  }

  const conductiveIdsByTerminal = new Map<string, ConductiveElementId[]>();
  const terminalsByKey = new Map<string, TerminalId>();

  for (const terminal of expansion.terminals) {
    const id = { ...terminal.id };
    terminalIdsByDevice.get(id.deviceUid)?.push(id);
    terminalsByKey.set(terminalKey(id), id);
    conductiveIdsByTerminal.set(terminalKey(id), []);
  }

  const conductiveRecords: {
    id: ConductiveElementId;
    endpoints: [ResolvedEndpoint, ResolvedEndpoint];
  }[] = [
    ...records.wires.map((wire) => ({
      id: { kind: "wire" as const, uid: wire.uid },
      endpoints: wire.endpoints,
    })),
    ...records.jumpers.map((jumper) => ({
      id: { kind: "jumper" as const, uid: jumper.uid },
      endpoints: jumper.endpoints,
    })),
    ...records.cableConductors.map((conductor) => ({
      id: { kind: "cable_conductor" as const, ...conductor.id },
      endpoints: conductor.endpoints,
    })),
  ].sort((left, right) => compareConductiveElementId(left.id, right.id));

  for (const record of conductiveRecords) {
    for (const endpoint of record.endpoints) {
      conductiveIdsByTerminal
        .get(terminalKey(endpoint.terminal))
        ?.push({ ...record.id });
    }
  }

  const conductorIdsByCable = new Map<string, CableConductorId[]>();

  for (const cable of expansion.cables) {
    conductorIdsByCable.set(cable.uid, []);
  }

  for (const conductor of records.cableConductors) {
    conductorIdsByCable.get(conductor.cableUid)?.push({ ...conductor.id });
  }

  const objectRefByUid: IrGraphIndexes["objectRefByUid"] = [];
  const objectRefByDesignation: IrGraphIndexes["objectRefByDesignation"] = [];

  for (const entry of resolution.catalogs.projectObjectsByUid.values()) {
    const ref: ProjectObjectRef = {
      kind: entry.object.kind,
      uid: entry.object.uid,
    };
    objectRefByUid.push({ key: entry.object.uid, value: ref });
  }

  for (const [designation, entries] of resolution.catalogs
    .projectObjectsByDesignation) {
    if (entries.length !== 1) {
      continue;
    }

    const object = entries[0]!.object;
    objectRefByDesignation.push({
      key: designation,
      value: { kind: object.kind, uid: object.uid },
    });
  }

  const instanceRefsByType = new Map<string, InstanceRef[]>();

  for (const type of [...expansion.deviceTypes, ...expansion.cableTypes]) {
    instanceRefsByType.set(type.id, []);
  }

  for (const device of expansion.devices) {
    instanceRefsByType
      .get(device.typeId)
      ?.push({ kind: "device", uid: device.uid });
  }

  for (const cable of expansion.cables) {
    instanceRefsByType
      .get(cable.typeId)
      ?.push({ kind: "cable", uid: cable.uid });
  }

  return {
    terminalIdsByDeviceUid: [...terminalIdsByDevice]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => ({
        key,
        value: value.sort(compareTerminalId),
      })),
    conductiveElementIdsByTerminal: [...conductiveIdsByTerminal]
      .map(([key, value]) => ({
        key: terminalsByKey.get(key)!,
        value: value.sort(compareConductiveElementId),
      }))
      .sort((left, right) => compareTerminalId(left.key, right.key)),
    terminalIdsByConductiveElement: conductiveRecords.map((record) => ({
      key: { ...record.id },
      value: [
        { ...record.endpoints[0].terminal },
        { ...record.endpoints[1].terminal },
      ],
    })),
    conductorIdsByCableUid: [...conductorIdsByCable]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => ({
        key,
        value: value.sort(compareCableConductorId),
      })),
    objectRefByUid: objectRefByUid.sort((left, right) =>
      compareText(left.key, right.key),
    ),
    objectRefByDesignation: objectRefByDesignation.sort((left, right) =>
      compareText(left.key, right.key),
    ),
    relationEndpointsByUid: records.relations.map((relation) => ({
      key: relation.uid,
      value: {
        fromDeviceUid: relation.fromDeviceUid,
        toDeviceUid: relation.toDeviceUid,
      },
    })),
    instanceRefsByTypeId: [...instanceRefsByType]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => ({
        key,
        value: value.sort(compareInstanceRef),
      })),
  };
}

/**
 * Normalizes the resolved authored graph after type/instance expansion.
 * Compilation only calls this stage after resolution succeeds; unresolved records
 * are ignored here rather than becoming dangling graph entries.
 */
export function normalizeProjectGraph(
  expansion: ExpansionResult,
  resolution: ResolveLoadedProjectResult,
): GraphNormalizationResult {
  const records = normalizeGraphRecords(expansion, resolution);
  return {
    ...records,
    indexes: buildIndexes(expansion, resolution, records),
  };
}
