import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type ElectricalIr,
  type TerminalId,
} from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createQueryEngine,
  InvalidElectricalIrError,
  serializeQueryResult,
  type QueryCommandResult,
  type QueryEngine,
  type QueryResult,
} from "../src/index.js";
import { createSelfLoopIr, createTerminalIr } from "./fixtures.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
let motorIr: ElectricalIr;

beforeAll(async () => {
  const result = await compileProject(
    join(repositoryRoot, "examples", "motor-starter"),
  );
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  motorIr = result.ir;
});

function expectInvalid(mutate: (ir: ElectricalIr) => void): void {
  const ir = structuredClone(motorIr);
  mutate(ir);
  expect(() => createQueryEngine(ir)).toThrow(InvalidElectricalIrError);
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Fixture value is missing.");
  return value;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const member of Object.values(value)) deepFreeze(member);
}

function successfulValue<Value>(result: QueryResult<Value>): Value {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function mutateEveryContainer(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const member of [...value]) mutateEveryContainer(member, seen);
    (value as unknown[]).push("__test_mutation__");
    return;
  }

  for (const member of Object.values(value)) {
    mutateEveryContainer(member, seen);
  }
  (value as Record<string, unknown>).__testMutation__ = true;
}

function createEmptyCompletenessIr(): ElectricalIr {
  const ir = structuredClone(motorIr);
  const deviceType = ir.deviceTypes[0]!;
  const cableType = ir.cableTypes[0]!;
  const deviceUid = "empty-device";
  const cableUid = "empty-cable";

  ir.devices.push({
    uid: deviceUid,
    designation: "EMPTY-DEVICE",
    typeId: deviceType.id,
    aliases: [],
    source: structuredClone(ir.devices[0]!.source),
  });
  ir.cables.push({
    uid: cableUid,
    designation: "EMPTY-CABLE",
    typeId: cableType.id,
    aliases: [],
    source: structuredClone(ir.cables[0]!.source),
  });
  ir.indexes.terminalIdsByDeviceUid.push({ key: deviceUid, value: [] });
  ir.indexes.conductorIdsByCableUid.push({ key: cableUid, value: [] });
  ir.indexes.objectRefByUid.push(
    { key: deviceUid, value: { kind: "device", uid: deviceUid } },
    { key: cableUid, value: { kind: "cable", uid: cableUid } },
  );
  ir.indexes.objectRefByDesignation.push(
    {
      key: "EMPTY-DEVICE",
      value: { kind: "device", uid: deviceUid },
    },
    { key: "EMPTY-CABLE", value: { kind: "cable", uid: cableUid } },
  );
  required(
    ir.indexes.instanceRefsByTypeId.find(({ key }) => key === deviceType.id),
  ).value.push({ kind: "device", uid: deviceUid });
  required(
    ir.indexes.instanceRefsByTypeId.find(({ key }) => key === cableType.id),
  ).value.push({ kind: "cable", uid: cableUid });
  return ir;
}

describe("ElectricalIr hydration invariants", () => {
  it("accepts a fully populated compiler success IR", () => {
    expect(() => createQueryEngine(motorIr)).not.toThrow();
  });

  it.each([
    [
      "primary tables",
      (ir: ElectricalIr) => {
        ir.terminals.push(structuredClone(ir.terminals[0]!));
      },
    ],
    [
      "cross-kind object identity",
      (ir: ElectricalIr) => {
        ir.wires[0]!.uid = ir.devices[0]!.uid;
      },
    ],
    [
      "device terminal completeness",
      (ir: ElectricalIr) => {
        ir.indexes.terminalIdsByDeviceUid.pop();
      },
    ],
    [
      "conductive incidence reciprocity",
      (ir: ElectricalIr) => {
        ir.indexes.terminalIdsByConductiveElement[0]!.value.pop();
      },
    ],
    [
      "cable membership",
      (ir: ElectricalIr) => {
        ir.indexes.conductorIdsByCableUid[0]!.value.pop();
      },
    ],
    [
      "relation endpoints",
      (ir: ElectricalIr) => {
        ir.indexes.relationEndpointsByUid[0]!.value.fromDeviceUid =
          ir.devices[0]!.uid;
      },
    ],
    [
      "type instances",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.instanceRefsByTypeId.find(({ value }) =>
            value.some(({ kind }) => kind === "device"),
          ),
        );
        entry.value[0] = { kind: "cable", uid: entry.value[0]!.uid };
      },
    ],
    [
      "function and gang membership",
      (ir: ElectricalIr) => {
        ir.gangedGroups[0]!.functionIds.push(
          structuredClone(ir.gangedGroups[0]!.functionIds[0]!),
        );
      },
    ],
    [
      "net membership and index",
      (ir: ElectricalIr) => {
        ir.indexes.netIdByTerminal.pop();
      },
    ],
    [
      "potential and net reciprocity",
      (ir: ElectricalIr) => {
        const potential = ir.potentials[0]!;
        potential.netId = required(
          ir.nets.find(({ id }) => id !== potential.netId),
        ).id;
      },
    ],
  ] as const)("rejects a violation of the %s row", (_name, mutate) => {
    expectInvalid(mutate);
  });

  it("hydrates absent-policy and shared-policy self-loops with doubled incidence", () => {
    expect(() => createQueryEngine(createSelfLoopIr())).not.toThrow();
    expect(() => createQueryEngine(createSelfLoopIr("shared"))).not.toThrow();
  });

  it("rejects an unexplained third self-loop incidence occurrence", () => {
    const ir = createSelfLoopIr("shared");
    ir.indexes.conductiveElementIdsByTerminal[0]!.value.push({
      kind: "wire",
      uid: "wire-1",
    });
    expect(() => createQueryEngine(ir)).toThrow(InvalidElectricalIrError);
  });

  it("rejects duplicate, extra, dangling, and empty-completeness index corruption", () => {
    expectInvalid((ir) => {
      ir.indexes.objectRefByUid.push(
        structuredClone(ir.indexes.objectRefByUid[0]!),
      );
    });
    expectInvalid((ir) => {
      ir.indexes.relationEndpointsByUid.push({
        key: "extra",
        value: {
          fromDeviceUid: ir.devices[0]!.uid,
          toDeviceUid: ir.devices[0]!.uid,
        },
      });
    });
    expectInvalid((ir) => {
      ir.indexes.conductiveElementIdsByTerminal[0]!.value[0] = {
        kind: "wire",
        uid: "dangling",
      };
    });
    expectInvalid((ir) => {
      const emptyType = required(
        ir.indexes.instanceRefsByTypeId.find(({ value }) => value.length === 0),
      );
      ir.indexes.instanceRefsByTypeId.splice(
        ir.indexes.instanceRefsByTypeId.indexOf(emptyType),
        1,
      );
    });
  });

  it.each([
    ["deviceTypes", (ir: ElectricalIr) => ir.deviceTypes],
    ["cableTypes", (ir: ElectricalIr) => ir.cableTypes],
    ["devices", (ir: ElectricalIr) => ir.devices],
    ["terminals", (ir: ElectricalIr) => ir.terminals],
    ["functions", (ir: ElectricalIr) => ir.functions],
    ["internalRelations", (ir: ElectricalIr) => ir.internalRelations],
    ["gangedGroups", (ir: ElectricalIr) => ir.gangedGroups],
    ["wires", (ir: ElectricalIr) => ir.wires],
    ["jumpers", (ir: ElectricalIr) => ir.jumpers],
    ["cables", (ir: ElectricalIr) => ir.cables],
    ["cableConductors", (ir: ElectricalIr) => ir.cableConductors],
    ["relations", (ir: ElectricalIr) => ir.relations],
    ["potentials", (ir: ElectricalIr) => ir.potentials],
    ["nets", (ir: ElectricalIr) => ir.nets],
  ] as const)("rejects a duplicate primary key in %s", (_name, select) => {
    expectInvalid((ir) => {
      const table = select(ir) as unknown[];
      table.push(structuredClone(table[0]));
    });
  });

  it("rejects a cross-kind type id collision", () => {
    expectInvalid((ir) => {
      ir.cableTypes[0]!.id = ir.deviceTypes[0]!.id;
    });
  });

  it.each([
    [
      "UID",
      (ir: ElectricalIr) => {
        ir.wires[0]!.uid = ir.devices[0]!.uid;
      },
    ],
    [
      "designation",
      (ir: ElectricalIr) => {
        ir.wires[0]!.designation = ir.devices[0]!.designation;
      },
    ],
  ] as const)(
    "rejects a cross-kind project-object %s collision",
    (_name, mutate) => expectInvalid(mutate),
  );

  it.each([
    [
      "terminalIdsByDeviceUid",
      (ir: ElectricalIr) => ir.indexes.terminalIdsByDeviceUid.pop(),
    ],
    [
      "conductiveElementIdsByTerminal",
      (ir: ElectricalIr) => ir.indexes.conductiveElementIdsByTerminal.pop(),
    ],
    [
      "terminalIdsByConductiveElement",
      (ir: ElectricalIr) => ir.indexes.terminalIdsByConductiveElement.pop(),
    ],
    [
      "conductorIdsByCableUid",
      (ir: ElectricalIr) => ir.indexes.conductorIdsByCableUid.pop(),
    ],
    ["objectRefByUid", (ir: ElectricalIr) => ir.indexes.objectRefByUid.pop()],
    [
      "objectRefByDesignation",
      (ir: ElectricalIr) => ir.indexes.objectRefByDesignation.pop(),
    ],
    [
      "relationEndpointsByUid",
      (ir: ElectricalIr) => ir.indexes.relationEndpointsByUid.pop(),
    ],
    [
      "instanceRefsByTypeId",
      (ir: ElectricalIr) => ir.indexes.instanceRefsByTypeId.pop(),
    ],
    ["netIdByTerminal", (ir: ElectricalIr) => ir.indexes.netIdByTerminal.pop()],
  ] as const)("rejects a missing %s entry", (_name, mutate) => {
    expectInvalid(mutate);
  });

  it.each([
    [
      "terminalIdsByDeviceUid",
      (ir: ElectricalIr) =>
        ir.indexes.terminalIdsByDeviceUid.push({
          key: "extra-device",
          value: [],
        }),
    ],
    [
      "conductiveElementIdsByTerminal",
      (ir: ElectricalIr) =>
        ir.indexes.conductiveElementIdsByTerminal.push({
          key: { deviceUid: "extra-device", terminalKey: "extra-terminal" },
          value: [],
        }),
    ],
    [
      "terminalIdsByConductiveElement",
      (ir: ElectricalIr) =>
        ir.indexes.terminalIdsByConductiveElement.push({
          key: { kind: "wire", uid: "extra-wire" },
          value: [
            structuredClone(ir.terminals[0]!.id),
            structuredClone(ir.terminals[1]!.id),
          ],
        }),
    ],
    [
      "conductorIdsByCableUid",
      (ir: ElectricalIr) =>
        ir.indexes.conductorIdsByCableUid.push({
          key: "extra-cable",
          value: [],
        }),
    ],
    [
      "objectRefByUid",
      (ir: ElectricalIr) =>
        ir.indexes.objectRefByUid.push({
          key: "extra-object",
          value: { kind: "device", uid: ir.devices[0]!.uid },
        }),
    ],
    [
      "objectRefByDesignation",
      (ir: ElectricalIr) =>
        ir.indexes.objectRefByDesignation.push({
          key: "EXTRA-OBJECT",
          value: { kind: "device", uid: ir.devices[0]!.uid },
        }),
    ],
    [
      "relationEndpointsByUid",
      (ir: ElectricalIr) =>
        ir.indexes.relationEndpointsByUid.push({
          key: "extra-relation",
          value: {
            fromDeviceUid: ir.devices[0]!.uid,
            toDeviceUid: ir.devices[1]!.uid,
          },
        }),
    ],
    [
      "instanceRefsByTypeId",
      (ir: ElectricalIr) =>
        ir.indexes.instanceRefsByTypeId.push({
          key: "extra-type",
          value: [],
        }),
    ],
    [
      "netIdByTerminal",
      (ir: ElectricalIr) =>
        ir.indexes.netIdByTerminal.push({
          key: { deviceUid: "extra-device", terminalKey: "extra-terminal" },
          value: ir.nets[0]!.id,
        }),
    ],
  ] as const)("rejects an extra %s entry", (_name, mutate) => {
    expectInvalid(mutate);
  });

  it.each([
    [
      "terminalIdsByDeviceUid",
      (ir: ElectricalIr) =>
        ir.indexes.terminalIdsByDeviceUid.splice(
          ir.indexes.terminalIdsByDeviceUid.findIndex(
            ({ key }) => key === "empty-device",
          ),
          1,
        ),
    ],
    [
      "conductiveElementIdsByTerminal",
      (ir: ElectricalIr) => {
        const index = ir.indexes.conductiveElementIdsByTerminal.findIndex(
          ({ value }) => value.length === 0,
        );
        ir.indexes.conductiveElementIdsByTerminal.splice(index, 1);
      },
    ],
    [
      "conductorIdsByCableUid",
      (ir: ElectricalIr) =>
        ir.indexes.conductorIdsByCableUid.splice(
          ir.indexes.conductorIdsByCableUid.findIndex(
            ({ key }) => key === "empty-cable",
          ),
          1,
        ),
    ],
    [
      "instanceRefsByTypeId",
      (ir: ElectricalIr) => {
        const index = ir.indexes.instanceRefsByTypeId.findIndex(
          ({ value }) => value.length === 0,
        );
        ir.indexes.instanceRefsByTypeId.splice(index, 1);
      },
    ],
  ] as const)(
    "requires the empty completeness entry in %s",
    (_name, mutate) => {
      const ir = createEmptyCompletenessIr();
      expect(() => createQueryEngine(ir)).not.toThrow();
      mutate(ir);
      expect(() => createQueryEngine(ir)).toThrow(InvalidElectricalIrError);
    },
  );

  it.each([
    [
      "terminalIdsByDeviceUid",
      (ir: ElectricalIr) => {
        ir.indexes.terminalIdsByDeviceUid[0]!.value[0] = {
          deviceUid: "dangling-device",
          terminalKey: "dangling-terminal",
        };
      },
    ],
    [
      "conductiveElementIdsByTerminal",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.conductiveElementIdsByTerminal.find(
            ({ value }) => value.length > 0,
          ),
        );
        entry.value[0] = { kind: "wire", uid: "dangling-wire" };
      },
    ],
    [
      "terminalIdsByConductiveElement",
      (ir: ElectricalIr) => {
        ir.indexes.terminalIdsByConductiveElement[0]!.value[0] = {
          deviceUid: "dangling-device",
          terminalKey: "dangling-terminal",
        };
      },
    ],
    [
      "conductorIdsByCableUid",
      (ir: ElectricalIr) => {
        ir.indexes.conductorIdsByCableUid[0]!.value[0] = {
          cableUid: "dangling-cable",
          conductorId: "dangling-conductor",
        };
      },
    ],
    [
      "objectRefByUid",
      (ir: ElectricalIr) => {
        ir.indexes.objectRefByUid[0]!.value.uid = "dangling-object";
      },
    ],
    [
      "objectRefByDesignation",
      (ir: ElectricalIr) => {
        ir.indexes.objectRefByDesignation[0]!.value.uid = "dangling-object";
      },
    ],
    [
      "relationEndpointsByUid",
      (ir: ElectricalIr) => {
        ir.indexes.relationEndpointsByUid[0]!.value.fromDeviceUid =
          "dangling-device";
      },
    ],
    [
      "instanceRefsByTypeId",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.instanceRefsByTypeId.find(({ value }) => value.length > 0),
        );
        entry.value[0]!.uid = "dangling-instance";
      },
    ],
    [
      "netIdByTerminal",
      (ir: ElectricalIr) => {
        ir.indexes.netIdByTerminal[0]!.value = "dangling-net";
      },
    ],
  ] as const)("rejects a dangling %s value", (_name, mutate) => {
    expectInvalid(mutate);
  });

  it.each([
    [
      "device type",
      (ir: ElectricalIr) => {
        ir.devices[0]!.typeId = ir.cableTypes[0]!.id;
      },
    ],
    [
      "cable type",
      (ir: ElectricalIr) => {
        ir.cables[0]!.typeId = ir.deviceTypes[0]!.id;
      },
    ],
    [
      "terminal owner",
      (ir: ElectricalIr) => {
        ir.terminals[0]!.id.deviceUid = ir.wires[0]!.uid;
      },
    ],
    [
      "function owner",
      (ir: ElectricalIr) => {
        ir.functions[0]!.id.deviceUid = ir.cables[0]!.uid;
      },
    ],
    [
      "project-relation endpoint",
      (ir: ElectricalIr) => {
        ir.relations[0]!.fromDeviceUid = ir.wires[0]!.uid;
      },
    ],
    [
      "internal-relation function endpoint",
      (ir: ElectricalIr) => {
        const relation = ir.internalRelations[0]!;
        relation.from = structuredClone(
          required(
            ir.functions.find(({ id }) => id.deviceUid !== relation.deviceUid),
          ).id,
        );
      },
    ],
    [
      "cable-conductor type",
      (ir: ElectricalIr) => {
        ir.cableConductors[0]!.typeId = ir.deviceTypes[0]!.id;
      },
    ],
    [
      "objectRefByUid kind",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.objectRefByUid.find(
            ({ value }) => value.kind === "device",
          ),
        );
        entry.value.kind = "wire";
      },
    ],
    [
      "objectRefByDesignation kind",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.objectRefByDesignation.find(
            ({ value }) => value.kind === "device",
          ),
        );
        entry.value.kind = "wire";
      },
    ],
    [
      "instance kind",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.instanceRefsByTypeId.find(({ value }) =>
            value.some(({ kind }) => kind === "device"),
          ),
        );
        entry.value[0] = { kind: "cable", uid: entry.value[0]!.uid };
      },
    ],
  ] as const)("rejects a wrong-kind %s reference", (_name, mutate) => {
    expectInvalid(mutate);
  });

  it.each([
    [
      "terminal-to-device membership",
      (ir: ElectricalIr) =>
        required(
          ir.indexes.terminalIdsByDeviceUid.find(
            ({ value }) => value.length > 0,
          ),
        ).value.pop(),
    ],
    [
      "element-to-terminal incidence",
      (ir: ElectricalIr) =>
        ir.indexes.terminalIdsByConductiveElement[0]!.value.pop(),
    ],
    [
      "terminal-to-element incidence",
      (ir: ElectricalIr) =>
        required(
          ir.indexes.conductiveElementIdsByTerminal.find(
            ({ value }) => value.length > 0,
          ),
        ).value.pop(),
    ],
    [
      "cable-to-conductor membership",
      (ir: ElectricalIr) => ir.indexes.conductorIdsByCableUid[0]!.value.pop(),
    ],
    [
      "relation endpoint membership",
      (ir: ElectricalIr) => {
        const entry = ir.indexes.relationEndpointsByUid[0]!;
        entry.value.fromDeviceUid = required(
          ir.devices.find(({ uid }) => uid !== entry.value.fromDeviceUid),
        ).uid;
      },
    ],
    [
      "type-to-instance membership",
      (ir: ElectricalIr) =>
        required(
          ir.indexes.instanceRefsByTypeId.find(({ value }) => value.length > 0),
        ).value.pop(),
    ],
    [
      "terminal-to-net membership",
      (ir: ElectricalIr) => {
        const entry = ir.indexes.netIdByTerminal[0]!;
        entry.value = required(ir.nets.find(({ id }) => id !== entry.value)).id;
      },
    ],
    [
      "net-to-potential membership",
      (ir: ElectricalIr) =>
        required(
          ir.nets.find(({ potentialUids }) => potentialUids.length > 0),
        ).potentialUids.pop(),
    ],
    [
      "potential-to-net membership",
      (ir: ElectricalIr) => {
        const potential = ir.potentials[0]!;
        potential.netId = required(
          ir.nets.find(({ id }) => id !== potential.netId),
        ).id;
      },
    ],
    [
      "function-to-terminal membership",
      (ir: ElectricalIr) => {
        const fn = required(
          ir.functions.find(({ terminals }) => terminals.length > 0),
        );
        fn.terminals[0] = structuredClone(
          required(
            ir.terminals.find(({ id }) => id.deviceUid !== fn.id.deviceUid),
          ).id,
        );
      },
    ],
    [
      "ganged function membership",
      (ir: ElectricalIr) => {
        const group = ir.gangedGroups[0]!;
        const ownerUid = group.functionIds[0]!.deviceUid;
        group.functionIds[0] = structuredClone(
          required(ir.functions.find(({ id }) => id.deviceUid !== ownerUid)).id,
        );
      },
    ],
  ] as const)("rejects nonreciprocal %s", (_name, mutate) => {
    expectInvalid(mutate);
  });

  it.each([
    [
      "device terminal",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.terminalIdsByDeviceUid.find(
            ({ value }) => value.length > 0,
          ),
        );
        entry.value.push(structuredClone(entry.value[0]!));
      },
    ],
    [
      "conductive endpoint",
      (ir: ElectricalIr) => {
        const entry = ir.indexes.terminalIdsByConductiveElement[0]!;
        entry.value.push(structuredClone(entry.value[0]!));
      },
    ],
    [
      "terminal incidence",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.conductiveElementIdsByTerminal.find(
            ({ value }) => value.length > 0,
          ),
        );
        entry.value.push(structuredClone(entry.value[0]!));
      },
    ],
    [
      "cable conductor",
      (ir: ElectricalIr) => {
        const entry = ir.indexes.conductorIdsByCableUid[0]!;
        entry.value.push(structuredClone(entry.value[0]!));
      },
    ],
    [
      "type instance",
      (ir: ElectricalIr) => {
        const entry = required(
          ir.indexes.instanceRefsByTypeId.find(({ value }) => value.length > 0),
        );
        entry.value.push(structuredClone(entry.value[0]!));
      },
    ],
    [
      "ganged function",
      (ir: ElectricalIr) => {
        const group = ir.gangedGroups[0]!;
        group.functionIds.push(structuredClone(group.functionIds[0]!));
      },
    ],
    [
      "net terminal",
      (ir: ElectricalIr) => {
        const net = ir.nets[0]!;
        net.terminalIds.push(structuredClone(net.terminalIds[0]!));
      },
    ],
    [
      "net conductive element",
      (ir: ElectricalIr) => {
        const net = required(
          ir.nets.find(
            ({ conductiveElementIds }) => conductiveElementIds.length > 0,
          ),
        );
        net.conductiveElementIds.push(
          structuredClone(net.conductiveElementIds[0]!),
        );
      },
    ],
    [
      "net potential",
      (ir: ElectricalIr) => {
        const net = required(
          ir.nets.find(({ potentialUids }) => potentialUids.length > 0),
        );
        net.potentialUids.push(net.potentialUids[0]!);
      },
    ],
  ] as const)(
    "rejects beyond-multiplicity duplicate %s membership",
    (_name, mutate) => expectInvalid(mutate),
  );
});

describe("object and terminal resolution", () => {
  it("resolves canonical UID/designation selectors and never aliases aliases", () => {
    const engine = createQueryEngine(motorIr);
    const device = required(
      motorIr.devices.find(({ designation }) => designation === "K1"),
    );
    expect(engine.resolveObject({ by: "uid", value: device.uid })).toEqual(
      engine.resolveObject({ by: "designation", value: "K1" }),
    );
    expect(
      engine.resolveObject({
        by: "designation",
        value: device.aliases[0] ?? "alias",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: `No project object has designation ${JSON.stringify(device.aliases[0] ?? "alias")}.`,
        input: device.aliases[0] ?? "alias",
      },
    });
  });

  it("returns exact object and structural terminal Q001 errors", () => {
    const engine = createQueryEngine(motorIr);
    expect(engine.resolveObject({ by: "uid", value: "missing" })).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: 'No project object has uid "missing".',
        input: "missing",
      },
    });
    expect(
      engine.resolveTerminal({
        by: "id",
        value: { deviceUid: "missing", terminalKey: "A1" },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: 'No project object has uid "missing".',
        input: '{"deviceUid":"missing","terminalKey":"A1"}',
      },
    });
    expect(
      engine.resolveTerminal({
        by: "parts",
        deviceDesignation: "missing",
        terminalKey: "A1",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: 'No project object has designation "missing".',
        input: '{"deviceDesignation":"missing","terminalKey":"A1"}',
      },
    });
  });

  it("returns exact structural Q002 and Q004 errors with closed optional fields", () => {
    const engine = createQueryEngine(motorIr);
    const wire = motorIr.wires[0]!;
    const cable = motorIr.cables[0]!;
    const device = motorIr.devices[0]!;
    const idInput = `{"deviceUid":"${wire.uid}","terminalKey":"A1"}`;
    expect(
      engine.resolveTerminal({
        by: "id",
        value: { deviceUid: wire.uid, terminalKey: "A1" },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q002",
        message: `Object ${idInput} is a wire; terminal resolution requires a device.`,
        input: idInput,
        expectedKind: "device",
        actualKind: "wire",
      },
    });
    const partsInput = `{"deviceDesignation":"${cable.designation}","terminalKey":"1"}`;
    expect(
      engine.resolveTerminal({
        by: "parts",
        deviceDesignation: cable.designation,
        terminalKey: "1",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q002",
        message: `Object ${partsInput} is a cable; terminal resolution requires a device.`,
        input: partsInput,
        expectedKind: "device",
        actualKind: "cable",
      },
    });
    expect(
      engine.resolveTerminal({
        by: "id",
        value: { deviceUid: device.uid, terminalKey: "missing" },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q004",
        message: `Device ${JSON.stringify(device.designation)} has no terminal "missing".`,
        input: "missing",
        deviceDesignation: device.designation,
        terminalKey: "missing",
      },
    });
  });
});

describe("dotted terminal parsing", () => {
  function resolveDisplay(
    definitions: Parameters<typeof createTerminalIr>[0],
    value: string,
  ) {
    return createQueryEngine(createTerminalIr(definitions)).resolveTerminal({
      by: "display",
      value,
    });
  }

  it.each([
    [
      [{ uid: "plc", designation: "PLC1", terminalKeys: ["X1.0"] }],
      "PLC1.X1.0",
      "plc",
      "X1.0",
    ],
    [
      [{ uid: "iec", designation: "=F1+P1-K1", terminalKeys: ["A1"] }],
      "=F1+P1-K1.A1",
      "iec",
      "A1",
    ],
    [
      [
        { uid: "a", designation: "A", terminalKeys: ["B.C"] },
        { uid: "ab", designation: "A.B", terminalKeys: ["C"] },
      ],
      "A.B.C",
      "ab",
      "C",
    ],
    [
      [{ uid: "slash", designation: "K1", terminalKeys: ["13/NO"] }],
      "K1.13/NO",
      "slash",
      "13/NO",
    ],
    [
      [{ uid: "space", designation: "Panel A", terminalKeys: ["13 NO"] }],
      "Panel A.13 NO",
      "space",
      "13 NO",
    ],
    [
      [{ uid: "hyphen", designation: "-K1", terminalKeys: ["A1"] }],
      "-K1.A1",
      "hyphen",
      "A1",
    ],
  ] as const)(
    "resolves %s using compiled-prefix precedence",
    (definitions, input, deviceUid, terminalKey) => {
      const result = resolveDisplay(definitions, input);
      expect(result).toMatchObject({
        ok: true,
        value: { id: { deviceUid, terminalKey }, display: input },
      });
    },
  );

  it("does not backtrack after selecting the longest designation", () => {
    const result = resolveDisplay(
      [
        { uid: "a", designation: "A", terminalKeys: ["B.C.D"] },
        { uid: "ab", designation: "A.B", terminalKeys: ["X"] },
      ],
      "A.B.C.D",
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "Q004",
        message: 'Device "A.B" has no terminal "C.D".',
        input: "C.D",
        deviceDesignation: "A.B",
        terminalKey: "C.D",
      },
    });
  });

  it("uses parts as the lossless collision escape hatch", () => {
    const engine = createQueryEngine(
      createTerminalIr([
        { uid: "a", designation: "A", terminalKeys: ["B.C"] },
        { uid: "ab", designation: "A.B", terminalKeys: ["C"] },
      ]),
    );
    expect(
      engine.resolveTerminal({
        by: "parts",
        deviceDesignation: "A",
        terminalKey: "B.C",
      }),
    ).toMatchObject({
      ok: true,
      value: { id: { deviceUid: "a", terminalKey: "B.C" } },
    });
    expect(
      engine.resolveTerminal({
        by: "parts",
        deviceDesignation: "A",
        terminalKey: "missing",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q004",
        message: 'Device "A" has no terminal "missing".',
        input: "missing",
        deviceDesignation: "A",
        terminalKey: "missing",
      },
    });
  });

  it("excludes a whole-input device while allowing a shorter prefix", () => {
    expect(
      resolveDisplay(
        [
          { uid: "a", designation: "A", terminalKeys: ["B"] },
          { uid: "ab", designation: "A.B", terminalKeys: [] },
        ],
        "A.B",
      ),
    ).toMatchObject({
      ok: true,
      value: { id: { deviceUid: "a", terminalKey: "B" } },
    });
    expect(
      resolveDisplay(
        [{ uid: "ab", designation: "A.B", terminalKeys: ["C"] }],
        "A.B",
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "Q003",
        message:
          'Cannot parse terminal reference "A.B"; use a dotted device-and-terminal reference or --device/--terminal.',
        input: "A.B",
      },
    });
  });

  it("handles doubled dots structurally", () => {
    expect(
      resolveDisplay(
        [{ uid: "dot-device", designation: "A.", terminalKeys: ["C"] }],
        "A..C",
      ),
    ).toMatchObject({
      ok: true,
      value: { id: { deviceUid: "dot-device", terminalKey: "C" } },
    });
    expect(
      resolveDisplay(
        [{ uid: "dot-terminal", designation: "A", terminalKeys: [".C"] }],
        "A..C",
      ),
    ).toMatchObject({
      ok: true,
      value: { id: { deviceUid: "dot-terminal", terminalKey: ".C" } },
    });
  });

  it.each(["NO_DOT", ".A1", "A."])(
    "returns exact Q003 for malformed display %s",
    (input) => {
      expect(
        resolveDisplay(
          [{ uid: "a", designation: "A", terminalKeys: ["A1"] }],
          input,
        ),
      ).toEqual({
        ok: false,
        error: {
          code: "Q003",
          message: `Cannot parse terminal reference ${JSON.stringify(input)}; use a dotted device-and-terminal reference or --device/--terminal.`,
          input,
        },
      });
    },
  );
});

describe("mutation isolation and shuffled inputs", () => {
  const primitiveCases: readonly {
    readonly name: string;
    readonly run: (engine: QueryEngine) => QueryResult<unknown>;
  }[] = [
    {
      name: "resolveObject",
      run: (engine) => engine.resolveObject({ by: "designation", value: "K1" }),
    },
    {
      name: "resolveTerminal",
      run: (engine) =>
        engine.resolveTerminal({ by: "display", value: "PLC1.X1.0" }),
    },
    {
      name: "inspect",
      run: (engine) => engine.inspect({ by: "designation", value: "K1" }),
    },
    {
      name: "neighbors",
      run: (engine) => engine.neighbors({ by: "designation", value: "K1" }),
    },
    {
      name: "trace",
      run: (engine) => engine.trace({ by: "designation", value: "LS1" }),
    },
    {
      name: "net",
      run: (engine) => engine.net({ by: "display", value: "PLC1.X1.0" }),
    },
    {
      name: "cable",
      run: (engine) => engine.cable({ by: "designation", value: "CBL1" }),
    },
    {
      name: "followConductive",
      run: (engine) => {
        const device = required(
          motorIr.devices.find(({ designation }) => designation === "PLC1"),
        );
        return engine.followConductive([
          { deviceUid: device.uid, terminalKey: "X1.0" },
        ]);
      },
    },
  ];

  it.each(primitiveCases)(
    "$name deep-freezes input and isolates result and later input mutations",
    ({ run }) => {
      const frozenIr = structuredClone(motorIr);
      const frozenSnapshot = structuredClone(frozenIr);
      deepFreeze(frozenIr);
      const frozenEngine = createQueryEngine(frozenIr);
      const frozenFirst = successfulValue(run(frozenEngine));
      const frozenSecond = successfulValue(run(frozenEngine));
      expect(frozenFirst).toEqual(frozenSecond);
      expect(frozenIr).toEqual(frozenSnapshot);

      const aliasIr = structuredClone(motorIr);
      const aliasSnapshot = structuredClone(aliasIr);
      const aliasEngine = createQueryEngine(aliasIr);
      const aliasFirst = successfulValue(run(aliasEngine));
      const aliasFirstSnapshot = structuredClone(aliasFirst);
      const aliasSecond = successfulValue(run(aliasEngine));
      const aliasSecondSnapshot = structuredClone(aliasSecond);
      mutateEveryContainer(aliasFirst);
      expect(aliasFirst).not.toEqual(aliasFirstSnapshot);
      expect(aliasSecond).toEqual(aliasSecondSnapshot);
      expect(successfulValue(run(aliasEngine))).toEqual(aliasSecondSnapshot);
      expect(aliasIr).toEqual(aliasSnapshot);

      const mutableIr = structuredClone(motorIr);
      const mutableEngine = createQueryEngine(mutableIr);
      const stableResult = successfulValue(run(mutableEngine));
      const stableSnapshot = structuredClone(stableResult);
      const stableBytes = JSON.stringify(stableResult);
      mutateEveryContainer(mutableIr);
      expect(stableResult).toEqual(stableSnapshot);
      expect(JSON.stringify(stableResult)).toBe(stableBytes);
    },
  );

  it("does not mutate a deeply frozen IR or alias results in either direction", () => {
    const ir = createSelfLoopIr("shared");
    const snapshot = structuredClone(ir);
    deepFreeze(ir);
    const engine = createQueryEngine(ir);
    const first = engine.resolveTerminal({
      by: "parts",
      deviceDesignation: "DEV.1",
      terminalKey: "T.1",
    });
    const second = engine.resolveTerminal({
      by: "display",
      value: "DEV.1.T.1",
    });
    expect(ir).toEqual(snapshot);
    expect(first).toEqual(second);
    if (!first.ok || !second.ok) throw new Error("Expected terminal results.");

    (first.value.id as { deviceUid: string }).deviceUid = "mutated";
    (first.value.rating as unknown as Record<string, unknown>).nominal_voltage =
      999;
    expect(second.value.id.deviceUid).toBe("device-1");
    expect(second.value.rating).toEqual({
      voltage_type: "DC",
      nominal_voltage: 24,
    });
    expect(ir).toEqual(snapshot);
  });

  it("keeps an existing DTO and its bytes stable after mutable input changes", () => {
    const ir = createSelfLoopIr();
    const engine = createQueryEngine(ir);
    const result = engine.resolveTerminal({
      by: "display",
      value: "DEV.1.T.1",
    });
    if (!result.ok) throw new Error("Expected a terminal result.");
    const before = structuredClone(result.value);
    const bytes = serializeQueryResult(result.value);

    ir.devices[0]!.designation = "CHANGED";
    ir.terminals[0]!.id.terminalKey = "CHANGED";
    (
      ir.terminals[0]!.rating as unknown as Record<string, unknown>
    ).nominal_voltage = 999;
    expect(result.value).toEqual(before);
    expect(serializeQueryResult(result.value)).toBe(bytes);
  });

  it("accepts shuffled primary, nested, endpoint, net, and index collections", () => {
    const baselineEngine = createQueryEngine(motorIr);
    const shuffled = structuredClone(motorIr);
    for (const value of Object.values(shuffled.indexes)) value.reverse();
    shuffled.libraries.reverse();
    shuffled.deviceTypes.reverse();
    shuffled.cableTypes.reverse();
    shuffled.devices.reverse();
    shuffled.terminals.reverse();
    shuffled.functions.reverse();
    shuffled.internalRelations.reverse();
    shuffled.gangedGroups.reverse();
    shuffled.wires.reverse();
    shuffled.jumpers.reverse();
    shuffled.cables.reverse();
    shuffled.cableConductors.reverse();
    shuffled.relations.reverse();
    shuffled.potentials.reverse();
    shuffled.nets.reverse();
    for (const type of shuffled.deviceTypes) {
      type.aliases.reverse();
      type.terminals.reverse();
      type.functions.reverse();
      type.internalRelations.reverse();
    }
    for (const type of shuffled.cableTypes) {
      type.aliases.reverse();
      type.conductors.reverse();
    }
    for (const fn of shuffled.functions) fn.terminals.reverse();
    for (const group of shuffled.gangedGroups) group.functionIds.reverse();
    for (const edge of [...shuffled.wires, ...shuffled.jumpers]) {
      edge.endpoints.reverse();
      edge.aliases.reverse();
    }
    for (const conductor of shuffled.cableConductors) {
      conductor.endpoints.reverse();
    }
    for (const net of shuffled.nets) {
      net.terminalIds.reverse();
      net.conductiveElementIds.reverse();
      net.potentialUids.reverse();
    }
    for (const entry of shuffled.indexes.terminalIdsByDeviceUid) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.conductiveElementIdsByTerminal) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.terminalIdsByConductiveElement) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.conductorIdsByCableUid) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.instanceRefsByTypeId) {
      entry.value.reverse();
    }
    const rated = shuffled.terminals.find(({ rating }) => rating !== undefined);
    if (rated?.rating !== undefined) {
      rated.rating = Object.fromEntries(
        Object.entries(rated.rating).reverse(),
      ) as typeof rated.rating;
    }

    const shuffledEngine = createQueryEngine(shuffled);
    const baseline = {
      object: baselineEngine.resolveObject({
        by: "designation",
        value: "K1",
      }),
      terminal: baselineEngine.resolveTerminal({
        by: "display",
        value: "PLC1.X1.0",
      }),
    };
    const reordered = {
      object: shuffledEngine.resolveObject({
        by: "designation",
        value: "K1",
      }),
      terminal: shuffledEngine.resolveTerminal({
        by: "display",
        value: "PLC1.X1.0",
      }),
    };
    expect(reordered).toEqual(baseline);
    expect(serializeQueryResult(reordered)).toBe(
      serializeQueryResult(baseline),
    );
  });

  it.each([
    [
      "inspect",
      (engine: QueryEngine) =>
        engine.inspect({ by: "designation", value: "K1" }),
    ],
    [
      "neighbors",
      (engine: QueryEngine) =>
        engine.neighbors({ by: "designation", value: "K1" }),
    ],
    [
      "trace",
      (engine: QueryEngine) =>
        engine.trace({ by: "designation", value: "LS1" }),
    ],
    [
      "net",
      (engine: QueryEngine) =>
        engine.net({ by: "display", value: "PLC1.X1.0" }),
    ],
    [
      "cable",
      (engine: QueryEngine) =>
        engine.cable({ by: "designation", value: "CBL1" }),
    ],
  ] as const)(
    "serializes a frozen full %s QueryCommandResult without mutation",
    (_name, run) => {
      const result = successfulValue(run(createQueryEngine(motorIr)));
      const snapshot = structuredClone(result);
      deepFreeze(result);
      const first = serializeQueryResult(result as QueryCommandResult);
      expect(first.endsWith("\n")).toBe(true);
      expect(serializeQueryResult(result as QueryCommandResult)).toBe(first);
      expect(result).toEqual(snapshot);
    },
  );
});
