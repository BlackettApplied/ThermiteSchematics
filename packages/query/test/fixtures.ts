import type { ElectricalIr, SourceRef } from "@thermite/compiler";

function source(jsonPointer = ""): SourceRef {
  return {
    file: "query-fixture.json",
    line: 1,
    column: 1,
    jsonPointer,
  };
}

export function createSelfLoopIr(
  connectionPolicy?: "exclusive" | "shared",
): ElectricalIr {
  const terminalId = { deviceUid: "device-1", terminalKey: "T.1" };
  const wireId = { kind: "wire" as const, uid: "wire-1" };
  return {
    format: "electrical-ir/0.1",
    project: { name: "self-loop", source: source("/project") },
    libraries: [],
    deviceTypes: [
      {
        kind: "device_type",
        id: "type:device",
        libraryName: "fixture",
        libraryVersion: "1.0.0",
        aliases: [],
        terminals: [
          {
            key: "T.1",
            role: "loop",
            rating: { voltage_type: "DC", nominal_voltage: 24 },
            ...(connectionPolicy === undefined ? {} : { connectionPolicy }),
            source: source("/type/terminal"),
          },
        ],
        functions: [],
        internalRelations: [],
        source: source("/type"),
      },
    ],
    cableTypes: [],
    devices: [
      {
        uid: "device-1",
        designation: "DEV.1",
        typeId: "type:device",
        description: "Loop device",
        aliases: ["z", "a"],
        source: source("/device"),
      },
    ],
    terminals: [
      {
        id: { ...terminalId },
        role: "loop",
        rating: { voltage_type: "DC", nominal_voltage: 24 },
        ...(connectionPolicy === undefined ? {} : { connectionPolicy }),
        source: source("/terminal"),
      },
    ],
    functions: [],
    internalRelations: [],
    gangedGroups: [],
    wires: [
      {
        uid: "wire-1",
        designation: "W.1",
        aliases: [],
        endpoints: [
          { terminal: { ...terminalId }, source: source("/wire/0") },
          { terminal: { ...terminalId }, source: source("/wire/1") },
        ],
        source: source("/wire"),
      },
    ],
    jumpers: [],
    cables: [],
    cableConductors: [],
    relations: [],
    potentials: [],
    nets: [
      {
        id: "net:self-loop",
        terminalIds: [{ ...terminalId }],
        conductiveElementIds: [{ ...wireId }],
        potentialUids: [],
      },
    ],
    indexes: {
      terminalIdsByDeviceUid: [{ key: "device-1", value: [{ ...terminalId }] }],
      conductiveElementIdsByTerminal: [
        {
          key: { ...terminalId },
          value: [{ ...wireId }, { ...wireId }],
        },
      ],
      terminalIdsByConductiveElement: [
        {
          key: { ...wireId },
          value: [{ ...terminalId }, { ...terminalId }],
        },
      ],
      conductorIdsByCableUid: [],
      objectRefByUid: [
        {
          key: "device-1",
          value: { kind: "device", uid: "device-1" },
        },
        { key: "wire-1", value: { kind: "wire", uid: "wire-1" } },
      ],
      objectRefByDesignation: [
        {
          key: "DEV.1",
          value: { kind: "device", uid: "device-1" },
        },
        { key: "W.1", value: { kind: "wire", uid: "wire-1" } },
      ],
      relationEndpointsByUid: [],
      instanceRefsByTypeId: [
        {
          key: "type:device",
          value: [{ kind: "device", uid: "device-1" }],
        },
      ],
      netIdByTerminal: [{ key: { ...terminalId }, value: "net:self-loop" }],
    },
  };
}

export function createTerminalIr(
  definitions: readonly {
    readonly uid: string;
    readonly designation: string;
    readonly terminalKeys: readonly string[];
  }[],
): ElectricalIr {
  const ir = createSelfLoopIr();
  ir.devices = [];
  ir.terminals = [];
  ir.wires = [];
  ir.nets = [];
  ir.indexes.terminalIdsByDeviceUid = [];
  ir.indexes.conductiveElementIdsByTerminal = [];
  ir.indexes.terminalIdsByConductiveElement = [];
  ir.indexes.objectRefByUid = [];
  ir.indexes.objectRefByDesignation = [];
  ir.indexes.instanceRefsByTypeId[0]!.value = [];
  ir.indexes.netIdByTerminal = [];

  for (const definition of definitions) {
    ir.devices.push({
      uid: definition.uid,
      designation: definition.designation,
      typeId: "type:device",
      aliases: [],
      source: source(`/devices/${definition.uid}`),
    });
    ir.indexes.objectRefByUid.push({
      key: definition.uid,
      value: { kind: "device", uid: definition.uid },
    });
    ir.indexes.objectRefByDesignation.push({
      key: definition.designation,
      value: { kind: "device", uid: definition.uid },
    });
    ir.indexes.instanceRefsByTypeId[0]!.value.push({
      kind: "device",
      uid: definition.uid,
    });

    const ids = definition.terminalKeys.map((terminalKey) => ({
      deviceUid: definition.uid,
      terminalKey,
    }));
    ir.indexes.terminalIdsByDeviceUid.push({
      key: definition.uid,
      value: ids.map((id) => ({ ...id })),
    });
    for (const id of ids) {
      const netId = `net:${id.deviceUid}:${id.terminalKey}`;
      ir.terminals.push({ id: { ...id }, source: source("/terminal") });
      ir.nets.push({
        id: netId,
        terminalIds: [{ ...id }],
        conductiveElementIds: [],
        potentialUids: [],
      });
      ir.indexes.conductiveElementIdsByTerminal.push({
        key: { ...id },
        value: [],
      });
      ir.indexes.netIdByTerminal.push({ key: { ...id }, value: netId });
    }
  }
  return ir;
}
