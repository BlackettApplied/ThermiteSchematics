import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompiledProjectPresentation,
  type ElectricalIr,
  type IrDeviceType,
  type IrFunction,
  type TerminalId,
} from "@thermite/compiler";

import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  type DeviceTypeSymbolMapping,
} from "../src/symbols/mappings.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import type {
  SchematicFlow,
  SchematicViewFamily,
  SelectedSubgraph,
} from "../src/types.js";
import { normalizeSchematicView } from "../src/view-spec.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");

export async function compileCoreFixture(): Promise<ElectricalIr> {
  return (await compileCoreProjectFixture()).ir;
}

export async function compileCoreProjectFixture(): Promise<{
  readonly ir: ElectricalIr;
  readonly presentation: CompiledProjectPresentation;
}> {
  const result = await compileProject(
    join(repositoryRoot, "examples", "motor-starter"),
  );
  if (!result.ok) {
    throw new Error(
      `Core fixture failed: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return { ir: result.ir, presentation: result.presentation };
}

export function required<Value>(value: Value | undefined): Value {
  if (value === undefined)
    throw new Error("Required fixture value is missing.");
  return value;
}

export function coreType(ir: ElectricalIr, typeId: string): IrDeviceType {
  return required(
    ir.deviceTypes.find((deviceType) => deviceType.id === typeId),
  );
}

export function coreMapping(typeId: string): DeviceTypeSymbolMapping {
  return required(
    CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.find(
      (mapping) => mapping.typeId === typeId,
    ),
  );
}

export function mutableCoreMappings(): DeviceTypeSymbolMapping[] {
  return structuredClone(CORE_DEVICE_TYPE_SYMBOL_MAPPINGS);
}

export function materializeTypeFunctions(
  deviceType: IrDeviceType,
  deviceUid: string,
): IrFunction[] {
  return deviceType.functions.map((definition) => {
    const base = {
      id: { deviceUid, functionKey: definition.key },
      terminals: definition.terminalKeys.map((terminalKey) => ({
        deviceUid,
        terminalKey,
      })),
      source: structuredClone(definition.source),
    };
    switch (definition.kind) {
      case "contact":
        return {
          ...base,
          kind: definition.kind,
          normal_state: definition.normal_state,
        };
      case "channel":
        return {
          ...base,
          kind: definition.kind,
          direction: definition.direction,
        };
      default:
        return { ...base, kind: definition.kind };
    }
  });
}

function sameTerminal(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

function fixtureDeviceUid(ir: ElectricalIr, designation: string): string {
  return required(
    ir.devices.find((device) => device.designation === designation),
  ).uid;
}

function fixtureNetId(ir: ElectricalIr, terminal: TerminalId): string {
  return required(
    ir.indexes.netIdByTerminal.find(({ key }) => sameTerminal(key, terminal)),
  ).value;
}

function replaceTerminalKey(
  ir: ElectricalIr,
  deviceUid: string,
  oldKey: string,
  newKey: string,
): void {
  const replace = (terminal: TerminalId): void => {
    if (terminal.deviceUid === deviceUid && terminal.terminalKey === oldKey) {
      terminal.terminalKey = newKey;
    }
  };
  for (const terminal of ir.terminals) replace(terminal.id);
  for (const wire of ir.wires)
    for (const endpoint of wire.endpoints) replace(endpoint.terminal);
  for (const jumper of ir.jumpers)
    for (const endpoint of jumper.endpoints) replace(endpoint.terminal);
  for (const conductor of ir.cableConductors)
    for (const endpoint of conductor.endpoints) replace(endpoint.terminal);
  for (const net of ir.nets)
    for (const terminal of net.terminalIds) replace(terminal);
  for (const entry of ir.indexes.terminalIdsByDeviceUid)
    for (const terminal of entry.value) replace(terminal);
  for (const entry of ir.indexes.conductiveElementIdsByTerminal)
    replace(entry.key);
  for (const entry of ir.indexes.terminalIdsByConductiveElement)
    for (const terminal of entry.value) replace(terminal);
  for (const entry of ir.indexes.netIdByTerminal) replace(entry.key);
}

function addPnpFixtureWire(
  ir: ElectricalIr,
  uid: string,
  designation: string,
  first: TerminalId,
  second: TerminalId,
): void {
  const netId = fixtureNetId(ir, first);
  if (fixtureNetId(ir, second) !== netId) {
    throw new Error("PNP fixture wire endpoints are not on one net.");
  }
  const template = required(ir.wires[0]);
  const id = { kind: "wire" as const, uid };
  ir.wires.push({
    uid,
    designation,
    aliases: [],
    endpoints: [
      {
        terminal: structuredClone(first),
        source: structuredClone(template.endpoints[0].source),
      },
      {
        terminal: structuredClone(second),
        source: structuredClone(template.endpoints[1].source),
      },
    ],
    source: structuredClone(template.source),
  });
  required(ir.nets.find(({ id }) => id === netId)).conductiveElementIds.push(
    id,
  );
  ir.indexes.terminalIdsByConductiveElement.push({
    key: structuredClone(id),
    value: [structuredClone(first), structuredClone(second)],
  });
  for (const terminal of [first, second]) {
    required(
      ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
        sameTerminal(key, terminal),
      ),
    ).value.push(structuredClone(id));
  }
  ir.indexes.objectRefByUid.push({
    key: uid,
    value: { kind: "wire", uid },
  });
  ir.indexes.objectRefByDesignation.push({
    key: designation,
    value: { kind: "wire", uid },
  });
}

function retargetPnpFixtureWire(
  ir: ElectricalIr,
  designation: string,
  previous: TerminalId,
  next: TerminalId,
): void {
  const wire = required(
    ir.wires.find((candidate) => candidate.designation === designation),
  );
  const element = { kind: "wire" as const, uid: wire.uid };
  required(
    wire.endpoints.find(({ terminal }) => sameTerminal(terminal, previous)),
  ).terminal = structuredClone(next);
  const reverse = required(
    ir.indexes.terminalIdsByConductiveElement.find(
      ({ key }) => key.kind === "wire" && key.uid === wire.uid,
    ),
  );
  reverse.value = reverse.value.map((terminal) =>
    sameTerminal(terminal, previous) ? structuredClone(next) : terminal,
  );
  const previousIndex = required(
    ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
      sameTerminal(key, previous),
    ),
  );
  previousIndex.value = previousIndex.value.filter(
    (candidate) => candidate.kind !== "wire" || candidate.uid !== wire.uid,
  );
  required(
    ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
      sameTerminal(key, next),
    ),
  ).value.push(element);
}

export function pnpTraceFixture(source: ElectricalIr): ElectricalIr {
  const ir = structuredClone(source);
  const ls1 = required(
    ir.devices.find(({ designation }) => designation === "LS1"),
  );
  const pnpType = required(
    ir.deviceTypes.find(({ id }) => id === "core:prox-pnp-3wire"),
  );
  const priorTypeId = ls1.typeId;
  replaceTerminalKey(ir, ls1.uid, "13", "1");
  replaceTerminalKey(ir, ls1.uid, "14", "4");
  ls1.typeId = pnpType.id;
  ls1.description = "Three-wire PNP field proximity sensor permissive";

  ir.terminals = ir.terminals.filter(({ id }) => id.deviceUid !== ls1.uid);
  ir.terminals.push(
    ...pnpType.terminals.map((definition) => ({
      id: { deviceUid: ls1.uid, terminalKey: definition.key },
      ...(definition.role === undefined ? {} : { role: definition.role }),
      ...(definition.rating === undefined
        ? {}
        : { rating: structuredClone(definition.rating) }),
      ...(definition.connectionPolicy === undefined
        ? {}
        : { connectionPolicy: definition.connectionPolicy }),
      ...(definition.description === undefined
        ? {}
        : { description: definition.description }),
      source: structuredClone(definition.source),
    })),
  );
  ir.functions = ir.functions.filter(({ id }) => id.deviceUid !== ls1.uid);
  ir.functions.push(...materializeTypeFunctions(pnpType, ls1.uid));
  ir.internalRelations = ir.internalRelations.filter(
    ({ deviceUid }) => deviceUid !== ls1.uid,
  );
  ir.internalRelations.push(
    ...pnpType.internalRelations.map((relation) => ({
      deviceUid: ls1.uid,
      verb: relation.verb,
      from: { deviceUid: ls1.uid, functionKey: relation.fromFunctionKey },
      to: { deviceUid: ls1.uid, functionKey: relation.toFunctionKey },
      sourceOrigins: structuredClone(relation.sourceOrigins),
    })),
  );

  required(
    ir.wires.find(({ designation }) => designation === "W-FLD-003"),
  ).properties!.label = "LS1-PNP-OUT-PLC1-DI0";
  const returnTerminal = { deviceUid: ls1.uid, terminalKey: "3" };
  const junctionReturn = {
    deviceUid: fixtureDeviceUid(ir, "JB1"),
    terminalKey: "X1.3",
  };
  const returnNetId = fixtureNetId(ir, junctionReturn);
  required(ir.nets.find(({ id }) => id === returnNetId)).terminalIds.push(
    structuredClone(returnTerminal),
  );
  required(
    ir.indexes.terminalIdsByDeviceUid.find(({ key }) => key === ls1.uid),
  ).value = pnpType.terminals.map(({ key }) => ({
    deviceUid: ls1.uid,
    terminalKey: key,
  }));
  ir.indexes.conductiveElementIdsByTerminal.push({
    key: structuredClone(returnTerminal),
    value: [],
  });
  ir.indexes.netIdByTerminal.push({
    key: structuredClone(returnTerminal),
    value: returnNetId,
  });
  addPnpFixtureWire(
    ir,
    "4afbc8b2-5bd7-4b92-8f9d-dcf124b85d01",
    "W-FLD-004",
    junctionReturn,
    returnTerminal,
  );
  required(
    ir.wires.find(({ designation }) => designation === "W-FLD-004"),
  ).properties = {
    label: "0V-JB1-LS1",
    size: "18AWG",
    color: "blue/white",
  };
  const previousInstances = required(
    ir.indexes.instanceRefsByTypeId.find(({ key }) => key === priorTypeId),
  );
  previousInstances.value = previousInstances.value.filter(
    ({ uid }) => uid !== ls1.uid,
  );
  required(
    ir.indexes.instanceRefsByTypeId.find(({ key }) => key === pnpType.id),
  ).value.push({ kind: "device", uid: ls1.uid });
  return ir;
}

export function pnpParallelTraceFixture(source: ElectricalIr): ElectricalIr {
  const ir = pnpTraceFixture(source);
  const root = {
    deviceUid: fixtureDeviceUid(ir, "LS1"),
    terminalKey: "4",
  };
  const merge = {
    deviceUid: fixtureDeviceUid(ir, "JB1"),
    terminalKey: "X1.2",
  };
  const signalNetId = fixtureNetId(ir, root);
  addPnpFixtureWire(
    ir,
    "f0000000-0000-4000-8000-000000000100",
    "EQ-1",
    root,
    merge,
  );
  if (fixtureNetId(ir, merge) !== signalNetId) {
    throw new Error("PNP parallel fixture merge left the signal net.");
  }
  return ir;
}

export function selectCoreSubgraph(
  ir: ElectricalIr,
  root: string,
  family: SchematicViewFamily,
  flow: SchematicFlow = "left-to-right",
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
): SelectedSubgraph {
  const normalized = normalizeSchematicView(
    ir,
    {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: root },
      family,
      flow,
    },
    { mappings },
  );
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.error));
  const selected = selectSemanticSubgraph({
    ir,
    view: normalized.value.view,
    engine: normalized.value.engine,
    mappings,
  });
  if (!selected.ok) throw new Error(JSON.stringify(selected.error));
  return selected.value;
}
