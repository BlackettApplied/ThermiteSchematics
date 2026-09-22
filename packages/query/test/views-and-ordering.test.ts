import type {
  ElectricalIr,
  IrCable,
  IrCableConductor,
  IrDevice,
  IrJumper,
  IrPotential,
  IrProjectRelation,
  SourceRef,
} from "@thermite/compiler";
import { describe, expect, it } from "vitest";

import {
  compareAlias,
  compareCableConductorId,
  compareCableConductorView,
  compareConductiveEdgeView,
  compareConductiveElementView,
  compareConductiveNeighbor,
  compareFunctionView,
  compareGangedGroupView,
  compareIncidentProjectRelationView,
  compareInternalRelationView,
  comparePotentialView,
  compareProjectObjectView,
  compareProjectRelationView,
  compareRelationNeighbor,
  compareTerminalView,
  compareTraceComponent,
  compareTraceVisit,
} from "../src/ordering.js";
import { serializeQueryResult } from "../src/serializer.js";
import type {
  ConductiveElementView,
  DeviceView,
  ProjectObjectView,
  TerminalView,
} from "../src/types.js";
import {
  buildConductiveEdgeView,
  buildConductiveElementView,
  buildDeviceView,
  buildNetSummaryView,
  buildPotentialView,
  buildProjectObjectView,
  buildProjectRelationView,
  buildTerminalView,
} from "../src/views.js";
import { createSelfLoopIr } from "./fixtures.js";

const source: SourceRef = {
  file: "fixture.json",
  line: 1,
  column: 1,
  jsonPointer: "",
};

function terminal(
  deviceUid: string,
  deviceDesignation: string,
  terminalKey: string,
): TerminalView {
  return {
    id: { deviceUid, terminalKey },
    deviceDesignation,
    display: `${deviceDesignation}.${terminalKey}`,
  };
}

function device(uid: string, designation: string): DeviceView {
  return {
    kind: "device",
    uid,
    designation,
    aliases: [],
    typeId: "type",
  };
}

describe("D5 view builders", () => {
  it("projects common/device/terminal views recursively and applies display rules", () => {
    const ir = createSelfLoopIr("shared");
    const deviceRecord = ir.devices[0]!;
    const terminalRecord = ir.terminals[0]!;
    const object = buildProjectObjectView("device", deviceRecord);
    const deviceView = buildDeviceView(deviceRecord);
    const terminalView = buildTerminalView(terminalRecord, deviceRecord);

    expect(object).toEqual({
      kind: "device",
      uid: "device-1",
      designation: "DEV.1",
      description: "Loop device",
      aliases: ["a", "z"],
    });
    expect(deviceView).toMatchObject({
      kind: "device",
      designation: "DEV.1",
      typeId: "type:device",
    });
    expect(terminalView).toEqual({
      id: { deviceUid: "device-1", terminalKey: "T.1" },
      deviceDesignation: "DEV.1",
      display: "DEV.1.T.1",
      role: "loop",
      rating: { voltage_type: "DC", nominal_voltage: 24 },
      connectionPolicy: "shared",
    });

    (object.aliases as string[])[0] = "mutated";
    (
      terminalView.rating as unknown as Record<string, unknown>
    ).nominal_voltage = 999;
    expect(deviceRecord.aliases).toEqual(["z", "a"]);
    expect(terminalRecord.rating?.nominal_voltage).toBe(24);
  });

  it("builds potential/net/relation views with deterministic nested copies", () => {
    const ir = createSelfLoopIr();
    const potential: IrPotential = {
      uid: "potential-1",
      name: "+24V",
      designation: "P1",
      aliases: [],
      electrical: {
        nominal_voltage: 24,
        voltage_type: "DC",
        polarity: "positive",
      },
      terminal: { deviceUid: "device-1", terminalKey: "T.1" },
      netId: "net:self-loop",
      terminalSource: source,
      source,
    };
    const other: IrDevice = {
      uid: "device-2",
      designation: "DEV2",
      typeId: "type:device",
      aliases: ["b"],
      source,
    };
    const relation: IrProjectRelation = {
      uid: "relation-1",
      verb: "controls",
      fromDeviceUid: "device-1",
      toDeviceUid: "device-2",
      aliases: [],
      fromSource: source,
      toSource: source,
      source,
    };

    const potentialView = buildPotentialView(potential);
    const netView = buildNetSummaryView(ir.nets[0]!, [potential]);
    const relationView = buildProjectRelationView(
      relation,
      ir.devices[0]!,
      other,
    );
    expect(netView).toEqual({
      id: "net:self-loop",
      potentials: [potentialView],
    });
    expect(relationView.display).toBe("relation:relation-1");
    expect(relationView.from.designation).toBe("DEV.1");
    (
      potentialView.electrical as unknown as Record<string, unknown>
    ).nominal_voltage = 999;
    (relationView.to.aliases as string[]).push("mutated");
    expect(potential.electrical.nominal_voltage).toBe(24);
    expect(other.aliases).toEqual(["b"]);
  });

  it("builds wire, jumper, cable-conductor, and sorted edge displays", () => {
    const ir = createSelfLoopIr();
    const jumper: IrJumper = {
      uid: "jumper-1",
      aliases: [],
      endpoints: ir.wires[0]!.endpoints.map((endpoint) =>
        structuredClone(endpoint),
      ) as IrJumper["endpoints"],
      source,
    };
    const cable: IrCable = {
      uid: "cable-1",
      designation: "CBL.1",
      typeId: "type:cable",
      aliases: [],
      source,
    };
    const conductor: IrCableConductor = {
      id: { cableUid: "cable-1", conductorId: "1.+" },
      cableUid: "cable-1",
      typeId: "type:cable",
      endpoints: structuredClone(ir.wires[0]!.endpoints),
      typeConductor: { color: "black", source },
      source,
    };
    const wireView = buildConductiveElementView({
      kind: "wire",
      element: ir.wires[0]!,
    });
    const jumperView = buildConductiveElementView({
      kind: "jumper",
      element: jumper,
    });
    const conductorView = buildConductiveElementView({
      kind: "cable_conductor",
      element: conductor,
      cable,
    });
    expect(wireView.display).toBe("W.1");
    expect(jumperView.display).toBe("jumper:jumper-1");
    expect(conductorView.display).toBe("CBL.1.1.+");

    const edge = buildConductiveEdgeView(wireView, [
      terminal("z", "Z", "1"),
      terminal("a", "A", "2"),
    ]);
    expect(edge.endpoints.map(({ display }) => display)).toEqual([
      "A.2",
      "Z.1",
    ]);
    (edge.endpoints[0].id as { deviceUid: string }).deviceUid = "mutated";
    expect(edge.endpoints[1].id.deviceUid).toBe("z");
  });
});

describe("recursive query serialization", () => {
  it("uses DTO field order and recursive metadata key order", () => {
    const value = {
      display: "D.T",
      rating: { z: { b: 2, a: 1 }, a: 0 },
      id: { terminalKey: "T", deviceUid: "D" },
      deviceDesignation: "D",
      connectionPolicy: undefined,
    };
    expect(serializeQueryResult(value)).toBe(
      [
        "{",
        '  "id": {',
        '    "deviceUid": "D",',
        '    "terminalKey": "T"',
        "  },",
        '  "deviceDesignation": "D",',
        '  "display": "D.T",',
        '  "rating": {',
        '    "a": 0,',
        '    "z": {',
        '      "a": 1,',
        '      "b": 2',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("produces identical bytes for recursively shuffled metadata", () => {
    const first = {
      uid: "p",
      name: "P",
      electrical: { z: { b: 2, a: 1 }, a: 0 },
    };
    const second = {
      electrical: { a: 0, z: { a: 1, b: 2 } },
      name: "P",
      uid: "p",
    };
    expect(serializeQueryResult(first)).toBe(serializeQueryResult(second));
  });

  it("preserves QueryResult and QueryError declaration order", () => {
    expect(
      serializeQueryResult({
        error: {
          input: "x",
          message: "missing",
          code: "Q001",
        },
        ok: false,
      }),
    ).toBe(
      [
        "{",
        '  "ok": false,',
        '  "error": {',
        '    "code": "Q001",',
        '    "message": "missing",',
        '    "input": "x"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("complete D5 comparator table", () => {
  it("orders every collection by its complete tie-breakers without mutation", () => {
    const ta = terminal("2", "A", "2");
    const tb = terminal("1", "A", "2");
    const tc = terminal("1", "B", "1");
    const da = device("1", "A");
    const db = device("2", "B");
    const wireA: ConductiveElementView = {
      kind: "wire",
      uid: "2",
      designation: "E",
      display: "E",
    };
    const wireB: ConductiveElementView = {
      kind: "wire",
      uid: "1",
      designation: "E",
      display: "E",
    };
    const relationA = {
      uid: "2",
      display: "relation:2",
      verb: "controls" as const,
      from: da,
      to: db,
    };
    const relationB = { ...relationA, uid: "1", display: "relation:1" };
    const snapshot = structuredClone({
      ta,
      tb,
      tc,
      da,
      db,
      wireA,
      wireB,
      relationA,
      relationB,
    });

    expect(compareAlias("A", "B")).toBeLessThan(0);
    expect(
      compareProjectObjectView(
        { kind: "wire", uid: "2", designation: "X", aliases: [] },
        { kind: "jumper", uid: "1", designation: "X", aliases: [] },
      ),
    ).toBeLessThan(0);
    expect(
      compareProjectObjectView(
        { kind: "wire", uid: "1", aliases: [] },
        { kind: "wire", uid: "2", aliases: [] },
      ),
    ).toBeLessThan(0);
    expect(compareTerminalView(tb, ta)).toBeLessThan(0);
    expect(
      comparePotentialView(
        { uid: "2", name: "A", electrical: {} },
        { uid: "1", name: "B", electrical: {} },
      ),
    ).toBeLessThan(0);
    expect(compareConductiveElementView(wireB, wireA)).toBeLessThan(0);
    expect(
      compareConductiveEdgeView(
        { element: wireB, endpoints: [tb, tc] },
        { element: wireA, endpoints: [ta, tc] },
      ),
    ).toBeLessThan(0);
    expect(
      compareFunctionView(
        { key: "f", kind: "contact", terminals: [tb] },
        {
          key: "f",
          kind: "contact",
          normalState: "open",
          terminals: [ta],
        },
      ),
    ).toBeLessThan(0);
    expect(
      compareGangedGroupView(
        { id: "g", functionKeys: ["a"] },
        { id: "g", functionKeys: ["b"] },
      ),
    ).toBeLessThan(0);
    expect(
      compareInternalRelationView(
        { verb: "a", fromFunctionKey: "z", toFunctionKey: "z" },
        { verb: "b", fromFunctionKey: "a", toFunctionKey: "a" },
      ),
    ).toBeLessThan(0);
    expect(compareProjectRelationView(relationB, relationA)).toBeLessThan(0);
    expect(
      compareIncidentProjectRelationView(
        { relation: relationB, direction: "incoming", otherDevice: da },
        { relation: relationA, direction: "self", otherDevice: db },
      ),
    ).toBeLessThan(0);
    expect(
      compareRelationNeighbor(
        { relation: relationB, direction: "incoming", otherDevice: da },
        { relation: relationA, direction: "outgoing", otherDevice: db },
      ),
    ).toBeLessThan(0);
    expect(
      compareConductiveNeighbor(
        { terminal: tb, element: wireB, otherTerminal: tc, otherDevice: db },
        { terminal: ta, element: wireA, otherTerminal: tc, otherDevice: db },
      ),
    ).toBeLessThan(0);
    expect(
      compareTraceVisit(
        { terminal: tc, hops: 0 },
        { terminal: tb, hops: 1, via: { from: tc, element: wireB } },
      ),
    ).toBeLessThan(0);
    expect(
      compareTraceComponent(
        { net: { id: "n2", potentials: [] }, roots: [tb, tc] },
        { net: { id: "n1", potentials: [] }, roots: [ta, tc] },
      ),
    ).toBeLessThan(0);
    expect(
      compareCableConductorId(
        { cableUid: "a", conductorId: "z" },
        { cableUid: "b", conductorId: "a" },
      ),
    ).toBeLessThan(0);
    expect(
      compareCableConductorView(
        {
          id: { cableUid: "z", conductorId: "1" },
          display: "z.1",
          endpoints: [tb, tc],
        },
        {
          id: { cableUid: "a", conductorId: "2" },
          display: "a.2",
          endpoints: [ta, tc],
        },
      ),
    ).toBeLessThan(0);
    expect({ ta, tb, tc, da, db, wireA, wireB, relationA, relationB }).toEqual(
      snapshot,
    );
  });
});
