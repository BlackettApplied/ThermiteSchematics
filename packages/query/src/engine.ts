import type {
  CableConductorId,
  ElectricalIr,
  InstanceRef,
  ProjectObjectRef,
  ProjectRelationEndpoints,
  TerminalId,
} from "@thermite/compiler";

import { InvalidElectricalIrError } from "./errors.js";
import {
  compareCableConductorId,
  compareCableConductorView,
  compareConductiveEdgeView,
  compareConductiveNeighbor,
  compareConductiveElementView,
  compareFunctionView,
  compareGangedGroupView,
  compareIncidentProjectRelationView,
  compareInternalRelationView,
  compareTerminalView,
  compareText,
  compareTraceComponent,
  compareTraceVisit,
} from "./ordering.js";
import type {
  CableConductorView,
  CableResult,
  ConductiveEdgeView,
  ConductiveElementView,
  ConductiveNeighbor,
  FunctionView,
  GangedGroupView,
  IncidentProjectRelationView,
  InspectedObject,
  InspectedTerminalView,
  InspectResult,
  InternalRelationView,
  NetSummaryView,
  NetResult,
  NeighborsResult,
  ObjectSelector,
  ProjectObjectKind,
  ProjectObjectView,
  QueryEngine,
  QueryResult,
  TerminalSelector,
  TerminalView,
  TraceComponent,
  TraceResult,
  TraceVisit,
} from "./types.js";
import { breadthFirstTraversal, type BreadthFirstStep } from "./traversal.js";
import {
  buildConductiveEdgeView,
  buildConductiveElementView,
  buildDeviceView,
  buildNetSummaryView,
  buildProjectObjectView,
  buildProjectRelationView,
  buildTerminalView,
  type IrProjectObject,
} from "./views.js";

type IrDevice = ElectricalIr["devices"][number];
type IrCable = ElectricalIr["cables"][number];
type IrTerminal = ElectricalIr["terminals"][number];
type IrFunction = ElectricalIr["functions"][number];
type IrInternalRelation = ElectricalIr["internalRelations"][number];
type IrCableConductor = ElectricalIr["cableConductors"][number];
type IrNet = ElectricalIr["nets"][number];
type ConductiveElementId =
  ElectricalIr["nets"][number]["conductiveElementIds"][number];

interface ProjectObjectEntry {
  readonly kind: ProjectObjectKind;
  readonly object: IrProjectObject;
}

interface ConductiveRecord {
  readonly id: ConductiveElementId;
  readonly endpoints: readonly [TerminalId, TerminalId];
}

interface HydratedIndexes {
  readonly terminalIdsByDeviceUid: ReadonlyMap<string, readonly TerminalId[]>;
  readonly conductiveElementIdsByTerminal: ReadonlyMap<
    string,
    readonly ConductiveElementId[]
  >;
  readonly terminalIdsByConductiveElement: ReadonlyMap<
    string,
    readonly TerminalId[]
  >;
  readonly conductorIdsByCableUid: ReadonlyMap<
    string,
    readonly CableConductorId[]
  >;
  readonly objectRefByUid: ReadonlyMap<string, ProjectObjectRef>;
  readonly objectRefByDesignation: ReadonlyMap<string, ProjectObjectRef>;
  readonly relationEndpointsByUid: ReadonlyMap<
    string,
    ProjectRelationEndpoints
  >;
  readonly instanceRefsByTypeId: ReadonlyMap<string, readonly InstanceRef[]>;
  readonly netIdByTerminal: ReadonlyMap<string, string>;
}

interface QueryContext {
  readonly ir: ElectricalIr;
  readonly indexes: HydratedIndexes;
  readonly primary: PrimaryTables;
  readonly deviceDesignations: readonly string[];
}

export function terminalIdKey(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
}

export function functionIdKey(id: IrFunction["id"]): string {
  return JSON.stringify([id.deviceUid, id.functionKey]);
}

export function cableConductorIdKey(id: CableConductorId): string {
  return JSON.stringify([id.cableUid, id.conductorId]);
}

export function conductiveElementIdKey(id: ConductiveElementId): string {
  return id.kind === "cable_conductor"
    ? JSON.stringify([id.kind, id.cableUid, id.conductorId])
    : JSON.stringify([id.kind, id.uid]);
}

function internalRelationKey(relation: IrInternalRelation): string {
  return JSON.stringify([
    relation.deviceUid,
    relation.verb,
    relation.from.deviceUid,
    relation.from.functionKey,
    relation.to.deviceUid,
    relation.to.functionKey,
  ]);
}

function invalid(detail: string): never {
  throw new InvalidElectricalIrError(`Invalid ElectricalIr: ${detail}`);
}

function assertInvariant(
  condition: unknown,
  detail: string,
): asserts condition {
  if (!condition) invalid(detail);
}

function uniquePrimaryMap<RecordValue>(
  records: readonly RecordValue[],
  keyOf: (record: RecordValue) => string,
  description: string,
): Map<string, RecordValue> {
  const result = new Map<string, RecordValue>();
  for (const record of records) {
    const key = keyOf(record);
    if (result.has(key)) {
      invalid(`duplicate ${description} ${key}.`);
    }
    result.set(key, record);
  }
  return result;
}

function cloneTerminalId(id: TerminalId): TerminalId {
  return { deviceUid: id.deviceUid, terminalKey: id.terminalKey };
}

function cloneCableConductorId(id: CableConductorId): CableConductorId {
  return { cableUid: id.cableUid, conductorId: id.conductorId };
}

function cloneConductiveElementId(
  id: ConductiveElementId,
): ConductiveElementId {
  return id.kind === "cable_conductor"
    ? {
        kind: "cable_conductor",
        cableUid: id.cableUid,
        conductorId: id.conductorId,
      }
    : { kind: id.kind, uid: id.uid };
}

function hydrateIndex<Key, Value>(
  entries: readonly { readonly key: Key; readonly value: Value }[],
  keyOf: (key: Key) => string,
  cloneValue: (value: Value) => Value,
  description: string,
): Map<string, Value> {
  const result = new Map<string, Value>();
  for (const entry of entries) {
    const key = keyOf(entry.key);
    if (result.has(key)) {
      invalid(`duplicate ${description} key ${key}.`);
    }
    result.set(key, cloneValue(entry.value));
  }
  return result;
}

function hydrateIndexes(ir: ElectricalIr): HydratedIndexes {
  return {
    terminalIdsByDeviceUid: hydrateIndex(
      ir.indexes.terminalIdsByDeviceUid,
      (key) => key,
      (value) => value.map(cloneTerminalId),
      "terminalIdsByDeviceUid",
    ),
    conductiveElementIdsByTerminal: hydrateIndex(
      ir.indexes.conductiveElementIdsByTerminal,
      terminalIdKey,
      (value) => value.map(cloneConductiveElementId),
      "conductiveElementIdsByTerminal",
    ),
    terminalIdsByConductiveElement: hydrateIndex(
      ir.indexes.terminalIdsByConductiveElement,
      conductiveElementIdKey,
      (value) => value.map(cloneTerminalId) as [TerminalId, TerminalId],
      "terminalIdsByConductiveElement",
    ),
    conductorIdsByCableUid: hydrateIndex(
      ir.indexes.conductorIdsByCableUid,
      (key) => key,
      (value) => value.map(cloneCableConductorId),
      "conductorIdsByCableUid",
    ),
    objectRefByUid: hydrateIndex(
      ir.indexes.objectRefByUid,
      (key) => key,
      (value) => ({ kind: value.kind, uid: value.uid }),
      "objectRefByUid",
    ),
    objectRefByDesignation: hydrateIndex(
      ir.indexes.objectRefByDesignation,
      (key) => key,
      (value) => ({ kind: value.kind, uid: value.uid }),
      "objectRefByDesignation",
    ),
    relationEndpointsByUid: hydrateIndex(
      ir.indexes.relationEndpointsByUid,
      (key) => key,
      (value) => ({
        fromDeviceUid: value.fromDeviceUid,
        toDeviceUid: value.toDeviceUid,
      }),
      "relationEndpointsByUid",
    ),
    instanceRefsByTypeId: hydrateIndex(
      ir.indexes.instanceRefsByTypeId,
      (key) => key,
      (value) => value.map((ref) => ({ kind: ref.kind, uid: ref.uid })),
      "instanceRefsByTypeId",
    ),
    netIdByTerminal: hydrateIndex(
      ir.indexes.netIdByTerminal,
      terminalIdKey,
      (value) => value,
      "netIdByTerminal",
    ),
  };
}

function assertSameMultiset<Value>(
  actual: readonly Value[],
  expected: readonly Value[],
  keyOf: (value: Value) => string,
  description: string,
): void {
  const counts = new Map<string, number>();
  for (const value of expected) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const value of actual) {
    const key = keyOf(value);
    const count = counts.get(key) ?? 0;
    if (count === 0) invalid(`${description} has unexpected member ${key}.`);
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  if (counts.size > 0) {
    invalid(`${description} is missing member ${counts.keys().next().value}.`);
  }
}

function assertExactArrayIndex<Value>(
  actual: ReadonlyMap<string, readonly Value[]>,
  expected: ReadonlyMap<string, readonly Value[]>,
  keyOf: (value: Value) => string,
  description: string,
): void {
  if (actual.size !== expected.size) {
    invalid(`${description} has an incorrect number of entries.`);
  }
  for (const [key, expectedValue] of expected) {
    const actualValue = actual.get(key);
    if (actualValue === undefined)
      invalid(`${description} is missing key ${key}.`);
    assertSameMultiset(
      actualValue,
      expectedValue,
      keyOf,
      `${description} entry ${key}`,
    );
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) invalid(`${description} has extra key ${key}.`);
  }
}

function assertExactScalarIndex<Value>(
  actual: ReadonlyMap<string, Value>,
  expected: ReadonlyMap<string, Value>,
  same: (left: Value, right: Value) => boolean,
  description: string,
): void {
  if (actual.size !== expected.size) {
    invalid(`${description} has an incorrect number of entries.`);
  }
  for (const [key, expectedValue] of expected) {
    const actualValue = actual.get(key);
    if (actualValue === undefined)
      invalid(`${description} is missing key ${key}.`);
    if (!same(actualValue, expectedValue)) {
      invalid(`${description} has an incorrect value for key ${key}.`);
    }
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) invalid(`${description} has extra key ${key}.`);
  }
}

interface PrimaryTables {
  readonly deviceTypesById: ReadonlyMap<
    string,
    ElectricalIr["deviceTypes"][number]
  >;
  readonly cableTypesById: ReadonlyMap<
    string,
    ElectricalIr["cableTypes"][number]
  >;
  readonly devicesByUid: ReadonlyMap<string, IrDevice>;
  readonly wiresByUid: ReadonlyMap<string, ElectricalIr["wires"][number]>;
  readonly jumpersByUid: ReadonlyMap<string, ElectricalIr["jumpers"][number]>;
  readonly cablesByUid: ReadonlyMap<string, ElectricalIr["cables"][number]>;
  readonly relationsByUid: ReadonlyMap<
    string,
    ElectricalIr["relations"][number]
  >;
  readonly terminalsById: ReadonlyMap<string, IrTerminal>;
  readonly functionsById: ReadonlyMap<string, IrFunction>;
  readonly internalRelationsById: ReadonlyMap<string, IrInternalRelation>;
  readonly gangedGroupsById: ReadonlyMap<
    string,
    ElectricalIr["gangedGroups"][number]
  >;
  readonly conductorsById: ReadonlyMap<string, IrCableConductor>;
  readonly netsById: ReadonlyMap<string, IrNet>;
  readonly potentialsByUid: ReadonlyMap<
    string,
    ElectricalIr["potentials"][number]
  >;
  readonly objectsByUid: ReadonlyMap<string, ProjectObjectEntry>;
  readonly objectsByDesignation: ReadonlyMap<string, ProjectObjectEntry>;
}

function hydratePrimaryTables(ir: ElectricalIr): PrimaryTables {
  const deviceTypesById = uniquePrimaryMap(
    ir.deviceTypes,
    (type) => type.id,
    "device type id",
  );
  const cableTypesById = uniquePrimaryMap(
    ir.cableTypes,
    (type) => type.id,
    "cable type id",
  );
  for (const id of deviceTypesById.keys()) {
    if (cableTypesById.has(id)) invalid(`cross-kind duplicate type id ${id}.`);
  }

  const devicesByUid = uniquePrimaryMap(
    ir.devices,
    (device) => device.uid,
    "device uid",
  );
  const wiresByUid = uniquePrimaryMap(ir.wires, (wire) => wire.uid, "wire uid");
  const jumpersByUid = uniquePrimaryMap(
    ir.jumpers,
    (jumper) => jumper.uid,
    "jumper uid",
  );
  const cablesByUid = uniquePrimaryMap(
    ir.cables,
    (cable) => cable.uid,
    "cable uid",
  );
  const relationsByUid = uniquePrimaryMap(
    ir.relations,
    (relation) => relation.uid,
    "relation uid",
  );
  const potentialsByUid = uniquePrimaryMap(
    ir.potentials,
    (potential) => potential.uid,
    "potential uid",
  );
  const terminalsById = uniquePrimaryMap(
    ir.terminals,
    (terminal) => terminalIdKey(terminal.id),
    "terminal id",
  );
  const functionsById = uniquePrimaryMap(
    ir.functions,
    (fn) => functionIdKey(fn.id),
    "function id",
  );
  const internalRelationsById = uniquePrimaryMap(
    ir.internalRelations,
    internalRelationKey,
    "internal relation tuple",
  );
  const gangedGroupsById = uniquePrimaryMap(
    ir.gangedGroups,
    (group) => group.id,
    "ganged group id",
  );
  const conductorsById = uniquePrimaryMap(
    ir.cableConductors,
    (conductor) => cableConductorIdKey(conductor.id),
    "cable conductor id",
  );
  const netsById = uniquePrimaryMap(ir.nets, (net) => net.id, "net id");

  const objectsByUid = new Map<string, ProjectObjectEntry>();
  const objectsByDesignation = new Map<string, ProjectObjectEntry>();
  const addObjects = (
    kind: ProjectObjectKind,
    objects: readonly IrProjectObject[],
  ): void => {
    for (const object of objects) {
      if (objectsByUid.has(object.uid)) {
        invalid(
          `cross-kind duplicate project-object uid ${JSON.stringify(object.uid)}.`,
        );
      }
      const entry = { kind, object };
      objectsByUid.set(object.uid, entry);

      if (object.designation !== undefined) {
        if (objectsByDesignation.has(object.designation)) {
          invalid(
            `duplicate project-object designation ${JSON.stringify(object.designation)}.`,
          );
        }
        objectsByDesignation.set(object.designation, entry);
      }
    }
  };
  addObjects("device", ir.devices);
  addObjects("wire", ir.wires);
  addObjects("jumper", ir.jumpers);
  addObjects("cable", ir.cables);
  addObjects("relation", ir.relations);
  addObjects("potential", ir.potentials);

  return {
    deviceTypesById,
    cableTypesById,
    devicesByUid,
    wiresByUid,
    jumpersByUid,
    cablesByUid,
    relationsByUid,
    terminalsById,
    functionsById,
    internalRelationsById,
    gangedGroupsById,
    conductorsById,
    netsById,
    potentialsByUid,
    objectsByUid,
    objectsByDesignation,
  };
}

function validateTypeAndFunctionReferences(
  ir: ElectricalIr,
  primary: PrimaryTables,
): Map<string, TerminalId[]> {
  for (const device of ir.devices) {
    assertInvariant(
      primary.deviceTypesById.has(device.typeId),
      `device ${device.uid} references a missing or wrong-kind type.`,
    );
  }
  for (const cable of ir.cables) {
    assertInvariant(
      primary.cableTypesById.has(cable.typeId),
      `cable ${cable.uid} references a missing or wrong-kind type.`,
    );
  }

  const expectedTerminalsByDevice = new Map<string, TerminalId[]>(
    ir.devices.map((device) => [device.uid, []]),
  );
  for (const terminal of ir.terminals) {
    const device = primary.devicesByUid.get(terminal.id.deviceUid);
    assertInvariant(
      device !== undefined,
      `terminal ${terminalIdKey(terminal.id)} references a missing device.`,
    );
    expectedTerminalsByDevice.get(device.uid)!.push(terminal.id);
  }

  for (const fn of ir.functions) {
    assertInvariant(
      primary.devicesByUid.has(fn.id.deviceUid),
      `function ${functionIdKey(fn.id)} references a missing device.`,
    );
    for (const terminalId of fn.terminals) {
      const terminal = primary.terminalsById.get(terminalIdKey(terminalId));
      assertInvariant(
        terminal !== undefined && terminal.id.deviceUid === fn.id.deviceUid,
        `function ${functionIdKey(fn.id)} references a terminal outside its device.`,
      );
    }
  }

  for (const relation of ir.internalRelations) {
    assertInvariant(
      primary.devicesByUid.has(relation.deviceUid),
      `internal relation ${internalRelationKey(relation)} has a missing device.`,
    );
    assertInvariant(
      relation.from.deviceUid === relation.deviceUid &&
        relation.to.deviceUid === relation.deviceUid &&
        primary.functionsById.has(functionIdKey(relation.from)) &&
        primary.functionsById.has(functionIdKey(relation.to)),
      `internal relation ${internalRelationKey(relation)} has an invalid function endpoint.`,
    );
  }

  for (const group of ir.gangedGroups) {
    const memberKeys = new Set<string>();
    let ownerUid: string | undefined;
    for (const functionId of group.functionIds) {
      const key = functionIdKey(functionId);
      assertInvariant(
        !memberKeys.has(key),
        `ganged group ${group.id} has duplicate function membership.`,
      );
      memberKeys.add(key);
      assertInvariant(
        primary.functionsById.has(key),
        `ganged group ${group.id} references a missing function.`,
      );
      ownerUid ??= functionId.deviceUid;
      assertInvariant(
        ownerUid === functionId.deviceUid,
        `ganged group ${group.id} spans multiple devices.`,
      );
    }
  }

  return expectedTerminalsByDevice;
}

function validateConductiveRecords(
  ir: ElectricalIr,
  primary: PrimaryTables,
): Map<string, ConductiveRecord> {
  const records = new Map<string, ConductiveRecord>();
  const addRecord = (
    id: ConductiveElementId,
    endpoints: readonly { readonly terminal: TerminalId }[],
  ): void => {
    assertInvariant(
      endpoints.length === 2,
      `conductive element ${conductiveElementIdKey(id)} does not have two endpoints.`,
    );
    const pair = [
      cloneTerminalId(endpoints[0]!.terminal),
      cloneTerminalId(endpoints[1]!.terminal),
    ] as const;
    for (const terminal of pair) {
      assertInvariant(
        primary.terminalsById.has(terminalIdKey(terminal)),
        `conductive element ${conductiveElementIdKey(id)} references a missing terminal.`,
      );
    }
    const key = conductiveElementIdKey(id);
    if (records.has(key)) invalid(`duplicate conductive element id ${key}.`);
    records.set(key, { id: cloneConductiveElementId(id), endpoints: pair });
  };

  for (const wire of ir.wires) {
    addRecord({ kind: "wire", uid: wire.uid }, wire.endpoints);
  }
  for (const jumper of ir.jumpers) {
    addRecord({ kind: "jumper", uid: jumper.uid }, jumper.endpoints);
  }
  for (const conductor of ir.cableConductors) {
    assertInvariant(
      conductor.id.cableUid === conductor.cableUid,
      `cable conductor ${cableConductorIdKey(conductor.id)} has inconsistent cable identity.`,
    );
    const cable = primary.cablesByUid.get(conductor.cableUid);
    assertInvariant(
      cable !== undefined,
      `cable conductor ${cableConductorIdKey(conductor.id)} references a missing cable.`,
    );
    assertInvariant(
      conductor.typeId === cable.typeId &&
        primary.cableTypesById.has(conductor.typeId),
      `cable conductor ${cableConductorIdKey(conductor.id)} references a missing or wrong type.`,
    );
    assertInvariant(
      conductor.typeConductor !== null,
      `cable conductor ${cableConductorIdKey(conductor.id)} has no resolved type conductor.`,
    );
    addRecord(
      {
        kind: "cable_conductor",
        cableUid: conductor.id.cableUid,
        conductorId: conductor.id.conductorId,
      },
      conductor.endpoints,
    );
  }

  for (const relation of ir.relations) {
    assertInvariant(
      primary.devicesByUid.has(relation.fromDeviceUid) &&
        primary.devicesByUid.has(relation.toDeviceUid),
      `project relation ${relation.uid} references a missing device.`,
    );
  }
  return records;
}

function validateObjectIndexes(
  indexes: HydratedIndexes,
  primary: PrimaryTables,
): void {
  const expectedByUid = new Map<string, ProjectObjectRef>();
  for (const [uid, entry] of primary.objectsByUid) {
    expectedByUid.set(uid, { kind: entry.kind, uid });
  }
  const expectedByDesignation = new Map<string, ProjectObjectRef>();
  for (const [designation, entry] of primary.objectsByDesignation) {
    expectedByDesignation.set(designation, {
      kind: entry.kind,
      uid: entry.object.uid,
    });
  }
  const same = (left: ProjectObjectRef, right: ProjectObjectRef): boolean =>
    left.kind === right.kind && left.uid === right.uid;

  assertExactScalarIndex(
    indexes.objectRefByUid,
    expectedByUid,
    same,
    "objectRefByUid",
  );
  assertExactScalarIndex(
    indexes.objectRefByDesignation,
    expectedByDesignation,
    same,
    "objectRefByDesignation",
  );
}

function validateTerminalAndConductiveIndexes(
  indexes: HydratedIndexes,
  primary: PrimaryTables,
  conductiveRecords: ReadonlyMap<string, ConductiveRecord>,
  expectedTerminalsByDevice: ReadonlyMap<string, readonly TerminalId[]>,
): void {
  assertExactArrayIndex(
    indexes.terminalIdsByDeviceUid,
    expectedTerminalsByDevice,
    terminalIdKey,
    "terminalIdsByDeviceUid",
  );

  const expectedElementsByTerminal = new Map<string, ConductiveElementId[]>(
    [...primary.terminalsById.keys()].map((key) => [key, []]),
  );
  const expectedTerminalsByElement = new Map<string, TerminalId[]>();
  for (const [key, record] of conductiveRecords) {
    expectedTerminalsByElement.set(key, [...record.endpoints]);
    for (const terminal of record.endpoints) {
      expectedElementsByTerminal.get(terminalIdKey(terminal))!.push(record.id);
    }
  }

  assertExactArrayIndex(
    indexes.terminalIdsByConductiveElement,
    expectedTerminalsByElement,
    terminalIdKey,
    "terminalIdsByConductiveElement",
  );
  assertExactArrayIndex(
    indexes.conductiveElementIdsByTerminal,
    expectedElementsByTerminal,
    conductiveElementIdKey,
    "conductiveElementIdsByTerminal",
  );
}

function validateCableRelationAndTypeIndexes(
  ir: ElectricalIr,
  indexes: HydratedIndexes,
): void {
  const expectedConductorsByCable = new Map<string, CableConductorId[]>(
    ir.cables.map((cable) => [cable.uid, []]),
  );
  for (const conductor of ir.cableConductors) {
    expectedConductorsByCable.get(conductor.cableUid)!.push(conductor.id);
  }
  assertExactArrayIndex(
    indexes.conductorIdsByCableUid,
    expectedConductorsByCable,
    cableConductorIdKey,
    "conductorIdsByCableUid",
  );

  const expectedRelationEndpoints = new Map<string, ProjectRelationEndpoints>();
  for (const relation of ir.relations) {
    expectedRelationEndpoints.set(relation.uid, {
      fromDeviceUid: relation.fromDeviceUid,
      toDeviceUid: relation.toDeviceUid,
    });
  }
  assertExactScalarIndex(
    indexes.relationEndpointsByUid,
    expectedRelationEndpoints,
    (left, right) =>
      left.fromDeviceUid === right.fromDeviceUid &&
      left.toDeviceUid === right.toDeviceUid,
    "relationEndpointsByUid",
  );

  const expectedInstancesByType = new Map<string, InstanceRef[]>([
    ...ir.deviceTypes.map((type) => [type.id, [] as InstanceRef[]] as const),
    ...ir.cableTypes.map((type) => [type.id, [] as InstanceRef[]] as const),
  ]);
  for (const device of ir.devices) {
    expectedInstancesByType
      .get(device.typeId)!
      .push({ kind: "device", uid: device.uid });
  }
  for (const cable of ir.cables) {
    expectedInstancesByType
      .get(cable.typeId)!
      .push({ kind: "cable", uid: cable.uid });
  }
  assertExactArrayIndex(
    indexes.instanceRefsByTypeId,
    expectedInstancesByType,
    (ref) => JSON.stringify([ref.kind, ref.uid]),
    "instanceRefsByTypeId",
  );
}

function validateNetsAndPotentials(
  ir: ElectricalIr,
  indexes: HydratedIndexes,
  primary: PrimaryTables,
  conductiveRecords: ReadonlyMap<string, ConductiveRecord>,
): void {
  const terminalNetByKey = new Map<string, string>();
  for (const net of ir.nets) {
    const netTerminalKeys = new Set<string>();
    for (const terminal of net.terminalIds) {
      const key = terminalIdKey(terminal);
      assertInvariant(
        primary.terminalsById.has(key),
        `net ${net.id} references a missing terminal ${key}.`,
      );
      assertInvariant(
        !netTerminalKeys.has(key),
        `net ${net.id} has duplicate terminal membership ${key}.`,
      );
      netTerminalKeys.add(key);
      assertInvariant(
        !terminalNetByKey.has(key),
        `terminal ${key} belongs to more than one net.`,
      );
      terminalNetByKey.set(key, net.id);
    }
  }
  for (const key of primary.terminalsById.keys()) {
    assertInvariant(
      terminalNetByKey.has(key),
      `terminal ${key} does not belong to a net.`,
    );
  }
  assertExactScalarIndex(
    indexes.netIdByTerminal,
    terminalNetByKey,
    (left, right) => left === right,
    "netIdByTerminal",
  );

  const expectedElementsByNet = new Map<string, ConductiveElementId[]>(
    ir.nets.map((net) => [net.id, []]),
  );
  for (const record of conductiveRecords.values()) {
    const firstNet = terminalNetByKey.get(terminalIdKey(record.endpoints[0]));
    const secondNet = terminalNetByKey.get(terminalIdKey(record.endpoints[1]));
    assertInvariant(
      firstNet !== undefined && firstNet === secondNet,
      `conductive element ${conductiveElementIdKey(record.id)} crosses derived nets.`,
    );
    expectedElementsByNet.get(firstNet)!.push(record.id);
  }
  for (const net of ir.nets) {
    const memberKeys = new Set<string>();
    for (const element of net.conductiveElementIds) {
      const key = conductiveElementIdKey(element);
      assertInvariant(
        conductiveRecords.has(key),
        `net ${net.id} references a missing conductive element ${key}.`,
      );
      assertInvariant(
        !memberKeys.has(key),
        `net ${net.id} has duplicate conductive-element membership ${key}.`,
      );
      memberKeys.add(key);
    }
    assertSameMultiset(
      net.conductiveElementIds,
      expectedElementsByNet.get(net.id)!,
      conductiveElementIdKey,
      `net ${net.id} conductive elements`,
    );
  }

  const expectedPotentialsByNet = new Map<string, string[]>(
    ir.nets.map((net) => [net.id, []]),
  );
  for (const potential of ir.potentials) {
    const terminalKey = terminalIdKey(potential.terminal);
    assertInvariant(
      primary.terminalsById.has(terminalKey) &&
        primary.netsById.has(potential.netId),
      `potential ${potential.uid} has a missing terminal or net.`,
    );
    assertInvariant(
      terminalNetByKey.get(terminalKey) === potential.netId,
      `potential ${potential.uid} names a net different from its terminal.`,
    );
    expectedPotentialsByNet.get(potential.netId)!.push(potential.uid);
  }
  for (const net of ir.nets) {
    const seen = new Set<string>();
    for (const uid of net.potentialUids) {
      const potential = primary.potentialsByUid.get(uid);
      assertInvariant(
        potential !== undefined && potential.netId === net.id,
        `net ${net.id} references a missing or nonreciprocal potential ${uid}.`,
      );
      assertInvariant(
        !seen.has(uid),
        `net ${net.id} has duplicate potential membership ${uid}.`,
      );
      seen.add(uid);
    }
    assertSameMultiset(
      net.potentialUids,
      expectedPotentialsByNet.get(net.id)!,
      (uid) => uid,
      `net ${net.id} potentials`,
    );
  }
}

function createContext(ir: ElectricalIr): QueryContext {
  assertInvariant(ir.format === "electrical-ir/0.1", "unsupported format.");
  const primary = hydratePrimaryTables(ir);
  const expectedTerminalsByDevice = validateTypeAndFunctionReferences(
    ir,
    primary,
  );
  const conductiveRecords = validateConductiveRecords(ir, primary);
  const indexes = hydrateIndexes(ir);

  validateObjectIndexes(indexes, primary);
  validateTerminalAndConductiveIndexes(
    indexes,
    primary,
    conductiveRecords,
    expectedTerminalsByDevice,
  );
  validateCableRelationAndTypeIndexes(ir, indexes);
  validateNetsAndPotentials(ir, indexes, primary, conductiveRecords);

  return {
    ir,
    indexes,
    primary,
    deviceDesignations: ir.devices
      .map((device) => device.designation)
      .sort(compareText),
  };
}

function terminalIdInput(id: TerminalId): string {
  return JSON.stringify({
    deviceUid: id.deviceUid,
    terminalKey: id.terminalKey,
  });
}

function terminalPartsInput(
  deviceDesignation: string,
  terminalKey: string,
): string {
  return JSON.stringify({ deviceDesignation, terminalKey });
}

function objectNotFound(
  selectorKind: "uid" | "designation",
  selectorValue: string,
  input: string,
): QueryResult<never> {
  return {
    ok: false,
    error: {
      code: "Q001",
      message: `No project object has ${selectorKind} ${JSON.stringify(selectorValue)}.`,
      input,
    },
  };
}

function wrongTerminalOwner(
  selectorRendering: string,
  input: string,
  actualKind: ProjectObjectKind,
): QueryResult<never> {
  return {
    ok: false,
    error: {
      code: "Q002",
      message: `Object ${selectorRendering} is a ${actualKind}; terminal resolution requires a device.`,
      input,
      expectedKind: "device",
      actualKind,
    },
  };
}

function wrongObjectKind(
  selector: ObjectSelector,
  actualKind: ProjectObjectKind,
  operation: "neighbors" | "trace" | "cable",
  expectedKind: "device" | "cable",
): QueryResult<never> {
  return {
    ok: false,
    error: {
      code: "Q002",
      message: `Object ${JSON.stringify(selector.value)} is a ${actualKind}; ${operation} requires a ${expectedKind}.`,
      input: selector.value,
      expectedKind,
      actualKind,
    },
  };
}

function terminalNotFound(
  input: string,
  deviceDesignation: string,
  terminalKey: string,
): QueryResult<never> {
  return {
    ok: false,
    error: {
      code: "Q004",
      message: `Device ${JSON.stringify(deviceDesignation)} has no terminal ${JSON.stringify(terminalKey)}.`,
      input,
      deviceDesignation,
      terminalKey,
    },
  };
}

function dottedParseError(input: string): QueryResult<never> {
  return {
    ok: false,
    error: {
      code: "Q003",
      message: `Cannot parse terminal reference ${JSON.stringify(input)}; use a dotted device-and-terminal reference or --device/--terminal.`,
      input,
    },
  };
}

function requiredDevice(context: QueryContext, uid: string): IrDevice {
  const device = context.primary.devicesByUid.get(uid);
  assertInvariant(
    device !== undefined,
    `hydrated device reference ${uid} became inconsistent.`,
  );
  return device;
}

function terminalViewForId(
  context: QueryContext,
  id: TerminalId,
): TerminalView {
  const terminal = context.primary.terminalsById.get(terminalIdKey(id));
  assertInvariant(
    terminal !== undefined,
    `hydrated terminal reference ${terminalIdKey(id)} became inconsistent.`,
  );
  return buildTerminalView(
    terminal,
    requiredDevice(context, terminal.id.deviceUid),
  );
}

function netSummaryForId(context: QueryContext, netId: string): NetSummaryView {
  const net = context.primary.netsById.get(netId);
  assertInvariant(
    net !== undefined,
    `hydrated net reference ${netId} became inconsistent.`,
  );
  const potentials = net.potentialUids.map((uid) => {
    const potential = context.primary.potentialsByUid.get(uid);
    assertInvariant(
      potential !== undefined,
      `hydrated potential reference ${uid} became inconsistent.`,
    );
    return potential;
  });
  return buildNetSummaryView(net, potentials);
}

function netSummaryForTerminal(
  context: QueryContext,
  id: TerminalId,
): NetSummaryView {
  const netId = context.indexes.netIdByTerminal.get(terminalIdKey(id));
  assertInvariant(
    netId !== undefined,
    `hydrated terminal net ${terminalIdKey(id)} became inconsistent.`,
  );
  return netSummaryForId(context, netId);
}

function conductiveElementViewForId(
  context: QueryContext,
  id: ConductiveElementId,
): ConductiveElementView {
  if (id.kind === "wire") {
    const wire = context.primary.wiresByUid.get(id.uid);
    assertInvariant(
      wire !== undefined,
      `hydrated wire reference ${id.uid} became inconsistent.`,
    );
    return buildConductiveElementView({ kind: "wire", element: wire });
  }
  if (id.kind === "jumper") {
    const jumper = context.primary.jumpersByUid.get(id.uid);
    assertInvariant(
      jumper !== undefined,
      `hydrated jumper reference ${id.uid} became inconsistent.`,
    );
    return buildConductiveElementView({ kind: "jumper", element: jumper });
  }
  const conductor = context.primary.conductorsById.get(cableConductorIdKey(id));
  const cable = context.primary.cablesByUid.get(id.cableUid);
  assertInvariant(
    conductor !== undefined && cable !== undefined,
    `hydrated cable-conductor reference ${conductiveElementIdKey(id)} became inconsistent.`,
  );
  return buildConductiveElementView({
    kind: "cable_conductor",
    element: conductor,
    cable,
  });
}

function endpointViewsForElement(
  context: QueryContext,
  id: ConductiveElementId,
): [TerminalView, TerminalView] {
  const endpointIds = context.indexes.terminalIdsByConductiveElement.get(
    conductiveElementIdKey(id),
  );
  assertInvariant(
    endpointIds !== undefined && endpointIds.length === 2,
    `hydrated conductive endpoints ${conductiveElementIdKey(id)} became inconsistent.`,
  );
  return endpointIds
    .map((endpoint) => terminalViewForId(context, endpoint))
    .sort(compareTerminalView) as [TerminalView, TerminalView];
}

function projectRelationViewForRecord(
  context: QueryContext,
  relation: ElectricalIr["relations"][number],
) {
  const endpoints = context.indexes.relationEndpointsByUid.get(relation.uid);
  assertInvariant(
    endpoints !== undefined,
    `hydrated relation endpoints ${relation.uid} became inconsistent.`,
  );
  return buildProjectRelationView(
    relation,
    requiredDevice(context, endpoints.fromDeviceUid),
    requiredDevice(context, endpoints.toDeviceUid),
  );
}

function inspectedTerminalView(
  context: QueryContext,
  terminalId: TerminalId,
): InspectedTerminalView {
  const terminal = terminalViewForId(context, terminalId);
  const incidence = context.indexes.conductiveElementIdsByTerminal.get(
    terminalIdKey(terminalId),
  );
  assertInvariant(
    incidence !== undefined,
    `hydrated terminal incidence ${terminalIdKey(terminalId)} became inconsistent.`,
  );

  const seen = new Set<string>();
  const elements: ConductiveElementView[] = [];
  for (const elementId of incidence) {
    const key = conductiveElementIdKey(elementId);
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push(conductiveElementViewForId(context, elementId));
  }
  elements.sort(compareConductiveElementView);

  return {
    ...terminal,
    net: netSummaryForTerminal(context, terminalId),
    elements,
  };
}

function functionViewsForDevice(
  context: QueryContext,
  deviceUid: string,
): FunctionView[] {
  const functions: FunctionView[] = [];
  for (const fn of context.primary.functionsById.values()) {
    if (fn.id.deviceUid !== deviceUid) continue;
    functions.push({
      key: fn.id.functionKey,
      kind: fn.kind,
      ...(fn.kind === "contact" ? { normalState: fn.normal_state } : {}),
      ...(fn.kind === "channel" ? { direction: fn.direction } : {}),
      terminals: fn.terminals
        .map((terminal) => terminalViewForId(context, terminal))
        .sort(compareTerminalView),
    });
  }
  return functions.sort(compareFunctionView);
}

function gangedGroupViewsForDevice(
  context: QueryContext,
  deviceUid: string,
): GangedGroupView[] {
  const groups: GangedGroupView[] = [];
  for (const group of context.primary.gangedGroupsById.values()) {
    if (group.functionIds[0]?.deviceUid !== deviceUid) continue;
    groups.push({
      id: group.id,
      functionKeys: group.functionIds
        .map(({ functionKey }) => functionKey)
        .sort(compareText),
    });
  }
  return groups.sort(compareGangedGroupView);
}

function internalRelationViewsForDevice(
  context: QueryContext,
  deviceUid: string,
): InternalRelationView[] {
  const relations: InternalRelationView[] = [];
  for (const relation of context.primary.internalRelationsById.values()) {
    if (relation.deviceUid !== deviceUid) continue;
    relations.push({
      verb: relation.verb,
      fromFunctionKey: relation.from.functionKey,
      toFunctionKey: relation.to.functionKey,
    });
  }
  return relations.sort(compareInternalRelationView);
}

function incidentProjectRelationViewsForDevice(
  context: QueryContext,
  deviceUid: string,
): IncidentProjectRelationView[] {
  const relations: IncidentProjectRelationView[] = [];
  for (const relation of context.primary.relationsByUid.values()) {
    const endpoints = context.indexes.relationEndpointsByUid.get(relation.uid);
    assertInvariant(
      endpoints !== undefined,
      `hydrated relation endpoints ${relation.uid} became inconsistent.`,
    );
    const fromSubject = endpoints.fromDeviceUid === deviceUid;
    const toSubject = endpoints.toDeviceUid === deviceUid;
    if (!fromSubject && !toSubject) continue;

    const direction =
      fromSubject && toSubject ? "self" : fromSubject ? "outgoing" : "incoming";
    const otherUid =
      direction === "incoming"
        ? endpoints.fromDeviceUid
        : direction === "outgoing"
          ? endpoints.toDeviceUid
          : deviceUid;
    relations.push({
      relation: projectRelationViewForRecord(context, relation),
      direction,
      otherDevice: buildDeviceView(requiredDevice(context, otherUid)),
    });
  }
  return relations.sort(compareIncidentProjectRelationView);
}

function conductiveNeighborViewsForDevice(
  context: QueryContext,
  deviceUid: string,
): ConductiveNeighbor[] {
  const terminalIds = context.indexes.terminalIdsByDeviceUid.get(deviceUid);
  assertInvariant(
    terminalIds !== undefined,
    `hydrated device terminals ${deviceUid} became inconsistent.`,
  );

  const neighbors: ConductiveNeighbor[] = [];
  for (const terminalId of terminalIds) {
    const localKey = terminalIdKey(terminalId);
    const incidence =
      context.indexes.conductiveElementIdsByTerminal.get(localKey);
    assertInvariant(
      incidence !== undefined,
      `hydrated terminal incidence ${localKey} became inconsistent.`,
    );

    const emittedElements = new Set<string>();
    for (const elementId of incidence) {
      const elementKey = conductiveElementIdKey(elementId);
      if (emittedElements.has(elementKey)) continue;
      emittedElements.add(elementKey);

      const endpoints =
        context.indexes.terminalIdsByConductiveElement.get(elementKey);
      assertInvariant(
        endpoints !== undefined && endpoints.length === 2,
        `hydrated conductive endpoints ${elementKey} became inconsistent.`,
      );
      const firstIsLocal = terminalIdKey(endpoints[0]!) === localKey;
      const secondIsLocal = terminalIdKey(endpoints[1]!) === localKey;
      assertInvariant(
        firstIsLocal || secondIsLocal,
        `hydrated terminal incidence ${localKey} is nonreciprocal.`,
      );
      const otherId = firstIsLocal ? endpoints[1]! : endpoints[0]!;

      neighbors.push({
        terminal: terminalViewForId(context, terminalId),
        element: conductiveElementViewForId(context, elementId),
        otherTerminal: terminalViewForId(context, otherId),
        otherDevice: buildDeviceView(
          requiredDevice(context, otherId.deviceUid),
        ),
      });
    }
  }
  return neighbors.sort(compareConductiveNeighbor);
}

interface ConductiveTraversalStep extends BreadthFirstStep<
  TerminalId,
  ConductiveElementId
> {}

function conductiveTraversalSteps(
  context: QueryContext,
  terminalId: TerminalId,
): ConductiveTraversalStep[] {
  const localKey = terminalIdKey(terminalId);
  const incidence =
    context.indexes.conductiveElementIdsByTerminal.get(localKey);
  assertInvariant(
    incidence !== undefined,
    `hydrated terminal incidence ${localKey} became inconsistent.`,
  );

  const steps: ConductiveTraversalStep[] = [];
  const emittedElements = new Set<string>();
  for (const elementId of incidence) {
    const elementKey = conductiveElementIdKey(elementId);
    if (emittedElements.has(elementKey)) continue;
    emittedElements.add(elementKey);

    const endpoints =
      context.indexes.terminalIdsByConductiveElement.get(elementKey);
    assertInvariant(
      endpoints !== undefined && endpoints.length === 2,
      `hydrated conductive endpoints ${elementKey} became inconsistent.`,
    );
    const firstIsLocal = terminalIdKey(endpoints[0]!) === localKey;
    const secondIsLocal = terminalIdKey(endpoints[1]!) === localKey;
    assertInvariant(
      firstIsLocal || secondIsLocal,
      `hydrated terminal incidence ${localKey} is nonreciprocal.`,
    );
    const other = firstIsLocal ? endpoints[1]! : endpoints[0]!;
    steps.push({
      node: cloneTerminalId(other),
      edge: cloneConductiveElementId(elementId),
    });
  }

  return steps.sort(
    (left, right) =>
      compareConductiveElementView(
        conductiveElementViewForId(context, left.edge),
        conductiveElementViewForId(context, right.edge),
      ) ||
      compareTerminalView(
        terminalViewForId(context, left.node),
        terminalViewForId(context, right.node),
      ),
  );
}

function traceComponentForRoots(
  context: QueryContext,
  netId: string,
  rootIds: readonly TerminalId[],
): TraceComponent {
  const net = context.primary.netsById.get(netId);
  assertInvariant(
    net !== undefined,
    `hydrated net reference ${netId} became inconsistent.`,
  );
  const orderedRoots = rootIds
    .map((root) => terminalViewForId(context, root))
    .sort(compareTerminalView);
  const orderedRootIds = orderedRoots.map(({ id }) => cloneTerminalId(id));

  const visits: TraceVisit[] = breadthFirstTraversal(
    orderedRootIds,
    terminalIdKey,
    (terminal) => conductiveTraversalSteps(context, terminal),
  )
    .map((visit): TraceVisit => ({
      terminal: terminalViewForId(context, visit.node),
      hops: visit.hops,
      ...(visit.via === undefined
        ? {}
        : {
            via: {
              from: terminalViewForId(context, visit.via.from),
              element: conductiveElementViewForId(context, visit.via.edge),
            },
          }),
    }))
    .sort(compareTraceVisit);

  const elements: ConductiveEdgeView[] = net.conductiveElementIds
    .map((elementId) =>
      buildConductiveEdgeView(
        conductiveElementViewForId(context, elementId),
        endpointViewsForElement(context, elementId),
      ),
    )
    .sort(compareConductiveEdgeView);

  return {
    net: netSummaryForId(context, netId),
    roots: orderedRoots,
    visits,
    elements,
  };
}

function followConductiveFromValidatedStarts(
  context: QueryContext,
  starts: readonly TerminalId[],
): TraceComponent[] {
  const unique = new Map<string, TerminalId>();
  for (const start of starts) {
    const key = terminalIdKey(start);
    if (!unique.has(key)) unique.set(key, cloneTerminalId(start));
  }
  const ordered = [...unique.values()].sort((left, right) =>
    compareTerminalView(
      terminalViewForId(context, left),
      terminalViewForId(context, right),
    ),
  );

  const rootsByNet = new Map<string, TerminalId[]>();
  for (const root of ordered) {
    const netId = context.indexes.netIdByTerminal.get(terminalIdKey(root));
    assertInvariant(
      netId !== undefined,
      `hydrated terminal net ${terminalIdKey(root)} became inconsistent.`,
    );
    const roots = rootsByNet.get(netId) ?? [];
    roots.push(root);
    rootsByNet.set(netId, roots);
  }

  return [...rootsByNet]
    .map(([netId, roots]) => traceComponentForRoots(context, netId, roots))
    .sort(compareTraceComponent);
}

function completeNetViewForTerminal(
  context: QueryContext,
  selectedTerminal: TerminalView,
): NetResult["net"] {
  const netId = context.indexes.netIdByTerminal.get(
    terminalIdKey(selectedTerminal.id),
  );
  assertInvariant(
    netId !== undefined,
    `hydrated terminal net ${terminalIdKey(selectedTerminal.id)} became inconsistent.`,
  );
  const net = context.primary.netsById.get(netId);
  assertInvariant(
    net !== undefined,
    `hydrated net reference ${netId} became inconsistent.`,
  );

  return {
    ...netSummaryForId(context, netId),
    terminals: net.terminalIds
      .map((terminalId) => terminalViewForId(context, terminalId))
      .sort(compareTerminalView),
    elements: net.conductiveElementIds
      .map((elementId) =>
        buildConductiveEdgeView(
          conductiveElementViewForId(context, elementId),
          endpointViewsForElement(context, elementId),
        ),
      )
      .sort(compareConductiveEdgeView),
  };
}

function cableConductorViewForRecord(
  context: QueryContext,
  cable: IrCable,
  conductor: IrCableConductor,
): CableConductorView {
  const metadata = conductor.typeConductor;
  assertInvariant(
    metadata !== null,
    `hydrated cable conductor ${cableConductorIdKey(conductor.id)} lost its type metadata.`,
  );
  const elementId = {
    kind: "cable_conductor" as const,
    cableUid: conductor.id.cableUid,
    conductorId: conductor.id.conductorId,
  };
  const endpoints = endpointViewsForElement(context, elementId);
  const firstNetId = context.indexes.netIdByTerminal.get(
    terminalIdKey(endpoints[0].id),
  );
  const secondNetId = context.indexes.netIdByTerminal.get(
    terminalIdKey(endpoints[1].id),
  );
  assertInvariant(
    firstNetId !== undefined && firstNetId === secondNetId,
    `cable conductor ${cableConductorIdKey(conductor.id)} endpoints do not share one derived net.`,
  );

  return {
    id: cloneCableConductorId(conductor.id),
    display: `${cable.designation}.${conductor.id.conductorId}`,
    color: metadata.color,
    ...(metadata.size === undefined ? {} : { size: metadata.size }),
    endpoints,
    net: netSummaryForId(context, firstNetId),
  };
}

import { buildCableSchedule } from "./cable-schedule.js";

function cableResultForRecord(
  context: QueryContext,
  cable: IrCable,
): CableResult {
  const cableType = context.primary.cableTypesById.get(cable.typeId);
  const conductorIds = context.indexes.conductorIdsByCableUid.get(cable.uid);
  assertInvariant(
    cableType !== undefined && conductorIds !== undefined,
    `hydrated cable context ${cable.uid} became inconsistent.`,
  );

  const conductors = conductorIds.map((id) => {
    const conductor = context.primary.conductorsById.get(
      cableConductorIdKey(id),
    );
    assertInvariant(
      conductor !== undefined,
      `hydrated cable conductor ${cableConductorIdKey(id)} became inconsistent.`,
    );
    return cableConductorViewForRecord(context, cable, conductor);
  });

  return {
    command: "cable",
    cable: {
      ...buildProjectObjectView("cable", cable),
      kind: "cable",
      designation: cable.designation,
      typeId: cable.typeId,
    },
    cableType: {
      id: cableType.id,
      ...(cableType.shield === undefined ? {} : { shield: cableType.shield }),
      ...(cableType.construction === undefined
        ? {}
        : { construction: structuredClone(cableType.construction) }),
    },
    conductors: conductors.sort(compareCableConductorView),
    ...(cable.assignments === undefined
      ? {}
      : { schedule: buildCableSchedule(context.ir, cable.uid) }),
  };
}

function inspectDevice(
  context: QueryContext,
  device: IrDevice,
): InspectedObject {
  const terminalIds = context.indexes.terminalIdsByDeviceUid.get(device.uid);
  assertInvariant(
    terminalIds !== undefined,
    `hydrated device terminals ${device.uid} became inconsistent.`,
  );
  return {
    ...buildDeviceView(device),
    ...(context.primary.deviceTypesById.get(device.typeId)!
      .connectionCoverage === undefined
      ? {}
      : {
          connectionCoverage: structuredClone(
            context.primary.deviceTypesById.get(device.typeId)!
              .connectionCoverage,
          ),
        }),
    ...(context.primary.deviceTypesById.get(device.typeId)!.ports === undefined
      ? {}
      : {
          ports: structuredClone(
            context.primary.deviceTypesById.get(device.typeId)!.ports,
          ),
        }),
    ...(context.primary.deviceTypesById.get(device.typeId)!.connectorPorts ===
    undefined
      ? {}
      : {
          connectorPorts: structuredClone(
            context.primary.deviceTypesById.get(device.typeId)!.connectorPorts,
          ),
        }),
    terminals: terminalIds
      .map((terminal) => inspectedTerminalView(context, terminal))
      .sort(compareTerminalView),
    functions: functionViewsForDevice(context, device.uid),
    gangedGroups: gangedGroupViewsForDevice(context, device.uid),
    internalRelations: internalRelationViewsForDevice(context, device.uid),
    projectRelations: incidentProjectRelationViewsForDevice(
      context,
      device.uid,
    ),
  };
}

function inspectObjectEntry(
  context: QueryContext,
  entry: ProjectObjectEntry,
): InspectedObject {
  if (entry.kind === "device") {
    return inspectDevice(context, entry.object as IrDevice);
  }

  const common = buildProjectObjectView(entry.kind, entry.object);
  if (entry.kind === "wire") {
    const wire = entry.object as ElectricalIr["wires"][number];
    const id = { kind: "wire" as const, uid: wire.uid };
    const endpoints = endpointViewsForElement(context, id);
    return {
      ...common,
      kind: "wire",
      designation: wire.designation,
      ...(wire.properties === undefined
        ? {}
        : { properties: structuredClone(wire.properties) }),
      endpoints,
      net: netSummaryForTerminal(context, endpoints[0].id),
    };
  }
  if (entry.kind === "jumper") {
    const jumper = entry.object as ElectricalIr["jumpers"][number];
    const endpoints = endpointViewsForElement(context, {
      kind: "jumper",
      uid: jumper.uid,
    });
    return {
      ...common,
      kind: "jumper",
      endpoints,
      net: netSummaryForTerminal(context, endpoints[0].id),
    };
  }
  if (entry.kind === "cable") {
    const cable = entry.object as ElectricalIr["cables"][number];
    const cableType = context.primary.cableTypesById.get(cable.typeId);
    const conductorIds = context.indexes.conductorIdsByCableUid.get(cable.uid);
    assertInvariant(
      cableType !== undefined && conductorIds !== undefined,
      `hydrated cable context ${cable.uid} became inconsistent.`,
    );
    const copiedConductorIds = conductorIds
      .map(cloneCableConductorId)
      .sort(compareCableConductorId);
    return {
      ...common,
      kind: "cable",
      designation: cable.designation,
      typeId: cable.typeId,
      cableType: {
        id: cableType.id,
        ...(cableType.shield === undefined ? {} : { shield: cableType.shield }),
        ...(cableType.construction === undefined
          ? {}
          : { construction: structuredClone(cableType.construction) }),
      },
      conductorCount: copiedConductorIds.length,
      conductorIds: copiedConductorIds,
    };
  }
  if (entry.kind === "relation") {
    const relation = entry.object as ElectricalIr["relations"][number];
    const view = projectRelationViewForRecord(context, relation);
    return {
      ...common,
      kind: "relation",
      ...(relation.connection === undefined
        ? {}
        : { connection: structuredClone(relation.connection) }),
      ...(relation.assembly === undefined
        ? {}
        : { assembly: structuredClone(relation.assembly) }),
      verb: relation.verb,
      from: view.from,
      to: view.to,
    };
  }

  const potential = entry.object as ElectricalIr["potentials"][number];
  return {
    ...common,
    kind: "potential",
    name: potential.name,
    electrical: structuredClone(potential.electrical),
    terminal: terminalViewForId(context, potential.terminal),
    net: netSummaryForId(context, potential.netId),
  };
}

class QueryEngineImplementation implements QueryEngine {
  readonly #context: QueryContext;

  constructor(context: QueryContext) {
    this.#context = context;
  }

  resolveObject(selector: ObjectSelector): QueryResult<ProjectObjectView> {
    const ref =
      selector.by === "uid"
        ? this.#context.indexes.objectRefByUid.get(selector.value)
        : this.#context.indexes.objectRefByDesignation.get(selector.value);
    if (ref === undefined) {
      return objectNotFound(selector.by, selector.value, selector.value);
    }

    const entry = this.#context.primary.objectsByUid.get(ref.uid);
    assertInvariant(
      entry !== undefined && entry.kind === ref.kind,
      `hydrated object reference ${ref.uid} became inconsistent.`,
    );
    return {
      ok: true,
      value: buildProjectObjectView(entry.kind, entry.object),
    };
  }

  inspect(selector: ObjectSelector): QueryResult<InspectResult> {
    const ref =
      selector.by === "uid"
        ? this.#context.indexes.objectRefByUid.get(selector.value)
        : this.#context.indexes.objectRefByDesignation.get(selector.value);
    if (ref === undefined) {
      return objectNotFound(selector.by, selector.value, selector.value);
    }

    const entry = this.#context.primary.objectsByUid.get(ref.uid);
    assertInvariant(
      entry !== undefined && entry.kind === ref.kind,
      `hydrated object reference ${ref.uid} became inconsistent.`,
    );
    return {
      ok: true,
      value: {
        command: "inspect",
        object: inspectObjectEntry(this.#context, entry),
      },
    };
  }

  neighbors(selector: ObjectSelector): QueryResult<NeighborsResult> {
    const ref =
      selector.by === "uid"
        ? this.#context.indexes.objectRefByUid.get(selector.value)
        : this.#context.indexes.objectRefByDesignation.get(selector.value);
    if (ref === undefined) {
      return objectNotFound(selector.by, selector.value, selector.value);
    }
    if (ref.kind !== "device") {
      return wrongObjectKind(selector, ref.kind, "neighbors", "device");
    }

    const device = requiredDevice(this.#context, ref.uid);
    return {
      ok: true,
      value: {
        command: "neighbors",
        device: buildDeviceView(device),
        conductive: conductiveNeighborViewsForDevice(this.#context, device.uid),
        relations: incidentProjectRelationViewsForDevice(
          this.#context,
          device.uid,
        ),
      },
    };
  }

  trace(selector: ObjectSelector): QueryResult<TraceResult> {
    const ref =
      selector.by === "uid"
        ? this.#context.indexes.objectRefByUid.get(selector.value)
        : this.#context.indexes.objectRefByDesignation.get(selector.value);
    if (ref === undefined) {
      return objectNotFound(selector.by, selector.value, selector.value);
    }
    if (ref.kind !== "device") {
      return wrongObjectKind(selector, ref.kind, "trace", "device");
    }

    const device = requiredDevice(this.#context, ref.uid);
    const terminalIds = this.#context.indexes.terminalIdsByDeviceUid.get(
      device.uid,
    );
    assertInvariant(
      terminalIds !== undefined,
      `hydrated device terminals ${device.uid} became inconsistent.`,
    );
    return {
      ok: true,
      value: {
        command: "trace",
        device: buildDeviceView(device),
        components: followConductiveFromValidatedStarts(
          this.#context,
          terminalIds,
        ),
      },
    };
  }

  followConductive(
    starts: readonly TerminalId[],
  ): QueryResult<readonly TraceComponent[]> {
    const validated: TerminalId[] = [];
    for (const start of starts) {
      const resolved = this.#resolveTerminalById(start);
      if (!resolved.ok) return resolved;
      validated.push(cloneTerminalId(resolved.value.id));
    }
    return {
      ok: true,
      value: followConductiveFromValidatedStarts(this.#context, validated),
    };
  }

  net(selector: TerminalSelector): QueryResult<NetResult> {
    const resolved = this.resolveTerminal(selector);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      value: {
        command: "net",
        selectedTerminal: resolved.value,
        net: completeNetViewForTerminal(this.#context, resolved.value),
      },
    };
  }

  cable(selector: ObjectSelector): QueryResult<CableResult> {
    const ref =
      selector.by === "uid"
        ? this.#context.indexes.objectRefByUid.get(selector.value)
        : this.#context.indexes.objectRefByDesignation.get(selector.value);
    if (ref === undefined) {
      return objectNotFound(selector.by, selector.value, selector.value);
    }
    if (ref.kind !== "cable") {
      return wrongObjectKind(selector, ref.kind, "cable", "cable");
    }
    const cable = this.#context.primary.cablesByUid.get(ref.uid);
    assertInvariant(
      cable !== undefined,
      `hydrated cable reference ${ref.uid} became inconsistent.`,
    );
    return { ok: true, value: cableResultForRecord(this.#context, cable) };
  }

  resolveTerminal(selector: TerminalSelector): QueryResult<TerminalView> {
    if (selector.by === "id") {
      return this.#resolveTerminalById(selector.value);
    }
    if (selector.by === "parts") {
      return this.#resolveTerminalByParts(
        selector.deviceDesignation,
        selector.terminalKey,
      );
    }
    return this.#resolveTerminalByDisplay(selector.value);
  }

  #resolveTerminalById(id: TerminalId): QueryResult<TerminalView> {
    const input = terminalIdInput(id);
    const ref = this.#context.indexes.objectRefByUid.get(id.deviceUid);
    if (ref === undefined) {
      return objectNotFound("uid", id.deviceUid, input);
    }
    if (ref.kind !== "device") {
      return wrongTerminalOwner(input, input, ref.kind);
    }
    const device = this.#context.primary.devicesByUid.get(ref.uid);
    assertInvariant(
      device !== undefined,
      `hydrated device reference ${ref.uid} became inconsistent.`,
    );
    return this.#resolveOnDevice(device, id.terminalKey);
  }

  #resolveTerminalByParts(
    deviceDesignation: string,
    terminalKey: string,
  ): QueryResult<TerminalView> {
    const input = terminalPartsInput(deviceDesignation, terminalKey);
    const ref =
      this.#context.indexes.objectRefByDesignation.get(deviceDesignation);
    if (ref === undefined) {
      return objectNotFound("designation", deviceDesignation, input);
    }
    if (ref.kind !== "device") {
      return wrongTerminalOwner(input, input, ref.kind);
    }
    const device = this.#context.primary.devicesByUid.get(ref.uid);
    assertInvariant(
      device !== undefined,
      `hydrated device reference ${ref.uid} became inconsistent.`,
    );
    return this.#resolveOnDevice(device, terminalKey);
  }

  #resolveTerminalByDisplay(input: string): QueryResult<TerminalView> {
    let selected: string | undefined;
    for (const designation of this.#context.deviceDesignations) {
      const prefix = `${designation}.`;
      if (
        input.startsWith(prefix) &&
        input.length > prefix.length &&
        (selected === undefined || designation.length > selected.length)
      ) {
        selected = designation;
      }
    }
    if (selected === undefined) return dottedParseError(input);

    const ref = this.#context.indexes.objectRefByDesignation.get(selected);
    assertInvariant(
      ref !== undefined && ref.kind === "device",
      `hydrated device designation ${selected} became inconsistent.`,
    );
    const device = this.#context.primary.devicesByUid.get(ref.uid);
    assertInvariant(
      device !== undefined,
      `hydrated device reference ${ref.uid} became inconsistent.`,
    );
    return this.#resolveOnDevice(device, input.slice(selected.length + 1));
  }

  #resolveOnDevice(
    device: IrDevice,
    terminalKey: string,
  ): QueryResult<TerminalView> {
    const terminal = this.#context.primary.terminalsById.get(
      terminalIdKey({ deviceUid: device.uid, terminalKey }),
    );
    if (terminal === undefined) {
      return terminalNotFound(terminalKey, device.designation, terminalKey);
    }
    return { ok: true, value: buildTerminalView(terminal, device) };
  }
}

export function createQueryEngine(ir: Readonly<ElectricalIr>): QueryEngine {
  try {
    const snapshot = structuredClone(ir) as ElectricalIr;
    return new QueryEngineImplementation(createContext(snapshot));
  } catch (error) {
    if (error instanceof InvalidElectricalIrError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new InvalidElectricalIrError(
      `Invalid ElectricalIr: hydration failed (${detail}).`,
    );
  }
}
