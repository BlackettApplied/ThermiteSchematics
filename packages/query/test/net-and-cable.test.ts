import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type ConductiveElementId,
  type ElectricalIr,
  type SourceRef,
  type TerminalId,
} from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createQueryEngine,
  InvalidElectricalIrError,
  serializeQueryResult,
  type CableResult,
  type NetResult,
} from "../src/index.js";
import { createSelfLoopIr, createTerminalIr } from "./fixtures.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
const fixtureSource: SourceRef = {
  file: "net-cable-fixture.json",
  line: 1,
  column: 1,
  jsonPointer: "",
};

let motorIr: ElectricalIr;

beforeAll(async () => {
  const result = await compileProject(
    join(repositoryRoot, "examples", "motor-starter"),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  motorIr = result.ir;
});

function terminal(deviceUid: string, terminalKey: string): TerminalId {
  return { deviceUid, terminalKey };
}

function key(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
}

function createBranchedParallelIr(): ElectricalIr {
  const a = terminal("a", "R");
  const b = terminal("b", "X");
  const c = terminal("c", "Y");
  const ir = createTerminalIr([
    { uid: "a", designation: "A", terminalKeys: ["R"] },
    { uid: "b", designation: "B", terminalKeys: ["X"] },
    { uid: "c", designation: "C", terminalKeys: ["Y"] },
  ]);
  const definitions = [
    { uid: "wire-3", designation: "W-A-C", endpoints: [a, c] as const },
    {
      uid: "wire-2",
      designation: "W-A-B-2",
      endpoints: [a, b] as const,
    },
    {
      uid: "wire-1",
      designation: "W-A-B-1",
      endpoints: [b, a] as const,
    },
  ];
  ir.wires = definitions.map((wire) => ({
    uid: wire.uid,
    designation: wire.designation,
    aliases: [],
    endpoints: wire.endpoints.map((id) => ({
      terminal: { ...id },
      source: fixtureSource,
    })) as ElectricalIr["wires"][number]["endpoints"],
    source: fixtureSource,
  }));

  const incidence = new Map<string, ConductiveElementId[]>([
    [key(a), []],
    [key(b), []],
    [key(c), []],
  ]);
  ir.indexes.terminalIdsByConductiveElement = definitions.map((wire) => {
    const element = { kind: "wire" as const, uid: wire.uid };
    for (const endpoint of wire.endpoints) {
      incidence.get(key(endpoint))!.push({ ...element });
    }
    return {
      key: element,
      value: wire.endpoints.map((id) => ({ ...id })) as [
        TerminalId,
        TerminalId,
      ],
    };
  });
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value = incidence.get(key(entry.key))!;
  }
  for (const wire of definitions) {
    ir.indexes.objectRefByUid.push({
      key: wire.uid,
      value: { kind: "wire", uid: wire.uid },
    });
    ir.indexes.objectRefByDesignation.push({
      key: wire.designation,
      value: { kind: "wire", uid: wire.uid },
    });
  }

  ir.potentials = [
    {
      uid: "potential-z",
      name: "Z",
      aliases: [],
      electrical: { voltage_type: "DC" },
      terminal: { ...a },
      netId: "net:branch",
      terminalSource: fixtureSource,
      source: fixtureSource,
    },
    {
      uid: "potential-a",
      name: "A",
      aliases: [],
      electrical: { nominal_voltage: 24 },
      terminal: { ...b },
      netId: "net:branch",
      terminalSource: fixtureSource,
      source: fixtureSource,
    },
  ];
  for (const potential of ir.potentials) {
    ir.indexes.objectRefByUid.push({
      key: potential.uid,
      value: { kind: "potential", uid: potential.uid },
    });
  }
  ir.nets = [
    {
      id: "net:branch",
      terminalIds: [c, a, b],
      conductiveElementIds: definitions.map(({ uid }) => ({
        kind: "wire" as const,
        uid,
      })),
      potentialUids: ["potential-z", "potential-a"],
    },
  ];
  ir.indexes.netIdByTerminal = [a, b, c].map((id) => ({
    key: { ...id },
    value: "net:branch",
  }));
  return ir;
}

function net(ir: ElectricalIr, id: TerminalId): NetResult {
  const result = createQueryEngine(ir).net({ by: "id", value: id });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function cable(ir: ElectricalIr, designation = "CBL1"): CableResult {
  const result = createQueryEngine(ir).cable({
    by: "designation",
    value: designation,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("D9 net primitive", () => {
  it("returns complete comparator-ordered branched and parallel membership", () => {
    const result = net(createBranchedParallelIr(), terminal("a", "R"));
    expect(result.selectedTerminal.display).toBe("A.R");
    expect(result.net.id).toBe("net:branch");
    expect(result.net.potentials.map(({ name }) => name)).toEqual(["A", "Z"]);
    expect(result.net.terminals.map(({ display }) => display)).toEqual([
      "A.R",
      "B.X",
      "C.Y",
    ]);
    expect(result.net.elements.map(({ element }) => element.display)).toEqual([
      "W-A-B-1",
      "W-A-B-2",
      "W-A-C",
    ]);
    expect(
      result.net.elements.map(({ endpoints }) =>
        endpoints.map(({ display }) => display),
      ),
    ).toEqual([
      ["A.R", "B.X"],
      ["A.R", "B.X"],
      ["A.R", "C.Y"],
    ]);
  });

  it("resolves every singleton terminal with complete empty membership", () => {
    const ir = createTerminalIr([
      { uid: "d1", designation: "D1", terminalKeys: ["A", "B"] },
      { uid: "d2", designation: "D2", terminalKeys: ["C"] },
    ]);
    for (const terminalRecord of ir.terminals) {
      const result = net(ir, terminalRecord.id);
      expect(result.net.terminals).toEqual([result.selectedTerminal]);
      expect(result.net.elements).toEqual([]);
      expect(result.net.potentials).toEqual([]);
      expect(result.net.id).toBe(
        ir.indexes.netIdByTerminal.find(
          ({ key: candidate }) => key(candidate) === key(terminalRecord.id),
        )!.value,
      );
    }
  });

  it("collapses a self-loop to one equal-endpoint net edge", () => {
    const result = net(createSelfLoopIr("shared"), terminal("device-1", "T.1"));
    expect(result.net.terminals).toHaveLength(1);
    expect(result.net.elements).toHaveLength(1);
    expect(result.net.elements[0]!.endpoints[0]).toEqual(
      result.net.elements[0]!.endpoints[1],
    );
  });

  it("matches the reviewed motor-starter flat net membership", () => {
    const result = createQueryEngine(motorIr).net({
      by: "display",
      value: "PLC1.X1.0",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.net.potentials).toEqual([]);
    expect(result.value.net.terminals.map(({ display }) => display)).toEqual([
      "JB1.X1.2",
      "LS1.14",
      "PLC1.X1.0",
      "TB1.3",
    ]);
    expect(
      result.value.net.elements.map(({ element }) => element.display),
    ).toEqual(["W-FLD-001", "W-FLD-003", "CBL1.1-"]);
  });

  it("preserves terminal-selector Q001/Q002/Q003/Q004 behavior", () => {
    const engine = createQueryEngine(motorIr);
    expect(
      engine.net({
        by: "parts",
        deviceDesignation: "missing",
        terminalKey: "X",
      }),
    ).toMatchObject({ ok: false, error: { code: "Q001" } });
    expect(
      engine.net({
        by: "parts",
        deviceDesignation: "CBL1",
        terminalKey: "1+",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "Q002",
        expectedKind: "device",
        actualKind: "cable",
      },
    });
    expect(engine.net({ by: "display", value: "NO_DOT" })).toMatchObject({
      ok: false,
      error: { code: "Q003" },
    });
    expect(
      engine.net({
        by: "parts",
        deviceDesignation: "PLC1",
        terminalKey: "missing",
      }),
    ).toMatchObject({ ok: false, error: { code: "Q004" } });
  });
});

describe("D10 cable primitive", () => {
  it("returns authored conductor membership, metadata, endpoints, nets, and potentials", () => {
    const result = cable(motorIr);
    expect(result.cable).toMatchObject({
      kind: "cable",
      designation: "CBL1",
      typeId: "core:cable-2pair-shielded",
    });
    expect(result.cableType).toMatchObject({
      id: "core:cable-2pair-shielded",
      shield: true,
    });
    expect(
      result.conductors.map(({ id, color, size, net: summary }) => ({
        id: id.conductorId,
        color,
        size,
        potentials: summary.potentials.map(({ name }) => name),
      })),
    ).toEqual([
      { id: "1+", color: "black", size: "18AWG", potentials: ["+24VDC"] },
      { id: "1-", color: "white", size: "18AWG", potentials: [] },
      { id: "2+", color: "red", size: "18AWG", potentials: ["0VDC"] },
      { id: "2-", color: "green", size: "18AWG", potentials: [] },
    ]);
    for (const conductor of result.conductors) {
      expect(conductor.endpoints).toHaveLength(2);
      expect(conductor.net.id).not.toBe("");
      expect(
        motorIr.indexes.netIdByTerminal.find(
          ({ key: id }) => key(id) === key(conductor.endpoints[0].id),
        )!.value,
      ).toBe(conductor.net.id);
      expect(
        motorIr.indexes.netIdByTerminal.find(
          ({ key: id }) => key(id) === key(conductor.endpoints[1].id),
        )!.value,
      ).toBe(conductor.net.id);
    }
  });

  it("does not synthesize an unused type conductor", () => {
    const ir = structuredClone(motorIr);
    const cableRecord = ir.cables.find(
      ({ designation }) => designation === "CBL1",
    )!;
    const cableType = ir.cableTypes.find(
      ({ id }) => id === cableRecord.typeId,
    )!;
    cableType.conductors.push({
      id: "TYPE-ONLY",
      color: "blue",
      size: "16AWG",
      source: fixtureSource,
    });
    const result = cable(ir);
    expect(result.conductors).toHaveLength(4);
    expect(
      result.conductors.some(({ id }) => id.conductorId === "TYPE-ONLY"),
    ).toBe(false);
  });

  it("is endpoint-order and collection-order invariant", () => {
    const baseline = cable(motorIr);
    const shuffled = structuredClone(motorIr);
    shuffled.cables.reverse();
    shuffled.cableConductors.reverse();
    shuffled.cableTypes.reverse();
    shuffled.nets.reverse();
    shuffled.potentials.reverse();
    for (const conductor of shuffled.cableConductors) {
      conductor.endpoints.reverse();
    }
    for (const entry of shuffled.indexes.terminalIdsByConductiveElement) {
      if (entry.key.kind === "cable_conductor") entry.value.reverse();
    }
    for (const entry of shuffled.indexes.conductorIdsByCableUid) {
      entry.value.reverse();
    }
    for (const type of shuffled.cableTypes) type.conductors.reverse();
    const reordered = cable(shuffled);
    expect(reordered).toEqual(baseline);
    expect(serializeQueryResult(reordered)).toBe(
      serializeQueryResult(baseline),
    );
  });

  it("rejects a conductor whose endpoints do not share a derived net", () => {
    const ir = structuredClone(motorIr);
    const conductor = ir.cableConductors[0]!;
    const previousSecond = { ...conductor.endpoints[1].terminal };
    const firstNet = ir.indexes.netIdByTerminal.find(
      ({ key: id }) => key(id) === key(conductor.endpoints[0].terminal),
    )!.value;
    const replacement = ir.terminals.find(
      ({ id }) =>
        ir.indexes.netIdByTerminal.find(
          ({ key: indexed }) => key(indexed) === key(id),
        )!.value !== firstNet,
    )!.id;
    conductor.endpoints[1]!.terminal = { ...replacement };
    const conductorIndex = ir.indexes.terminalIdsByConductiveElement.find(
      ({ key: element }) =>
        element.kind === "cable_conductor" &&
        element.cableUid === conductor.id.cableUid &&
        element.conductorId === conductor.id.conductorId,
    )!;
    conductorIndex.value[1] = { ...replacement };
    const elementId = {
      kind: "cable_conductor" as const,
      cableUid: conductor.id.cableUid,
      conductorId: conductor.id.conductorId,
    };
    const oldIncidence = ir.indexes.conductiveElementIdsByTerminal.find(
      ({ key: id }) => key(id) === key(previousSecond),
    )!;
    const occurrence = oldIncidence.value.findIndex(
      (element) =>
        element.kind === "cable_conductor" &&
        element.cableUid === conductor.id.cableUid &&
        element.conductorId === conductor.id.conductorId,
    );
    oldIncidence.value.splice(occurrence, 1);
    ir.indexes.conductiveElementIdsByTerminal
      .find(({ key: id }) => key(id) === key(replacement))!
      .value.push(elementId);

    expect(() => createQueryEngine(ir)).toThrow(InvalidElectricalIrError);
    expect(() => createQueryEngine(ir)).toThrow(/crosses derived nets/);
  });

  it.each([
    ["device", { by: "designation" as const, value: "K1" }],
    ["wire", { by: "designation" as const, value: "W-PWR-001" }],
    ["jumper", { by: "designation" as const, value: "JP1" }],
    ["relation", { by: "designation" as const, value: "REL-CONTROLS-001" }],
    ["potential", { by: "uid" as const, value: "" }],
  ])("returns exact cable Q002 for a known %s", (kind, baseSelector) => {
    const selector =
      kind === "potential"
        ? { by: "uid" as const, value: motorIr.potentials[0]!.uid }
        : baseSelector;
    expect(createQueryEngine(motorIr).cable(selector)).toEqual({
      ok: false,
      error: {
        code: "Q002",
        message: `Object ${JSON.stringify(selector.value)} is a ${kind}; cable requires a cable.`,
        input: selector.value,
        expectedKind: "cable",
        actualKind: kind,
      },
    });
  });

  it("returns exact cable Q001 for an unknown selector", () => {
    expect(
      createQueryEngine(motorIr).cable({
        by: "designation",
        value: "missing",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: 'No project object has designation "missing".',
        input: "missing",
      },
    });
  });
});

describe("Task 6 DTO isolation and serialization", () => {
  it("copies nested net and cable result state away from the IR", () => {
    const ir = structuredClone(motorIr);
    const netResult = net(
      ir,
      terminal(
        ir.devices.find(({ designation }) => designation === "PLC1")!.uid,
        "X1.0",
      ),
    );
    const cableResult = cable(ir);
    const originalDeviceUid =
      cableResult.conductors[0]!.endpoints[0].id.deviceUid;

    (netResult.net.terminals[0]!.id as { deviceUid: string }).deviceUid =
      "changed";
    (
      cableResult.conductors[0]!.endpoints[0].id as { deviceUid: string }
    ).deviceUid = "changed";
    expect(ir.terminals.some(({ id }) => id.deviceUid === "changed")).toBe(
      false,
    );
    expect(
      cableResult.conductors[1]!.endpoints.some(
        ({ id }) => id.deviceUid === originalDeviceUid,
      ),
    ).toBe(true);
  });

  it("serializes net and cable fields in declaration order", () => {
    const netValue = JSON.parse(
      serializeQueryResult(net(createBranchedParallelIr(), terminal("a", "R"))),
    ) as Record<string, unknown>;
    expect(Object.keys(netValue)).toEqual([
      "command",
      "selectedTerminal",
      "net",
    ]);
    expect(Object.keys(netValue.net as Record<string, unknown>)).toEqual([
      "id",
      "potentials",
      "terminals",
      "elements",
    ]);

    const cableValue = JSON.parse(
      serializeQueryResult(cable(motorIr)),
    ) as Record<string, unknown>;
    expect(Object.keys(cableValue)).toEqual([
      "command",
      "cable",
      "cableType",
      "conductors",
    ]);
    expect(
      Object.keys((cableValue.conductors as Record<string, unknown>[])[0]!),
    ).toEqual(["id", "display", "color", "size", "endpoints", "net"]);
  });
});
