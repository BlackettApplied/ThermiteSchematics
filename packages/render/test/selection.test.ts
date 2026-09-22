import type {
  ConductiveElementId,
  ElectricalIr,
  TerminalId,
} from "@thermite/compiler";
import { createQueryEngine, type QueryEngine } from "@thermite/query";
import { beforeAll, describe, expect, it } from "vitest";

import { InvalidSymbolMappingError } from "../src/errors.js";
import {
  selectCableConductorSubgraph,
  selectCableConductors,
  selectLoadsSubgraph,
  selectSemanticSubgraph,
  selectTraceSubgraph,
  type CableConductorSelection,
} from "../src/selection.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  type DeviceTypeSymbolMapping,
} from "../src/symbols/mappings.js";
import type { SelectedSubgraph } from "../src/types.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import {
  compileCoreFixture,
  mutableCoreMappings,
  pnpTraceFixture,
  required,
} from "./fixtures.js";

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

function select(
  ir: ElectricalIr,
  root: string,
  family: "control" | "power",
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
) {
  const normalized = normalizeSchematicView(
    ir,
    {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: root },
      family,
    },
    { mappings },
  );
  if (!normalized.ok) return normalized;
  return selectSemanticSubgraph({
    ir,
    view: normalized.value.view,
    engine: normalized.value.engine,
    mappings,
  });
}

function selected(
  ir: ElectricalIr,
  root: string,
  family: "control" | "power",
  mappings?: readonly DeviceTypeSymbolMapping[],
): SelectedSubgraph {
  const result = select(ir, root, family, mappings);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function deviceDesignation(ir: ElectricalIr, uid: string): string {
  return required(ir.devices.find((device) => device.uid === uid)).designation;
}

function conductorDesignation(
  ir: ElectricalIr,
  id: SelectedSubgraph["conductiveElementIds"][number],
): string {
  switch (id.kind) {
    case "wire":
      return required(ir.wires.find(({ uid }) => uid === id.uid)).designation;
    case "jumper":
      return (
        required(ir.jumpers.find(({ uid }) => uid === id.uid)).designation ??
        id.uid
      );
    case "cable_conductor":
      return `${required(ir.cables.find(({ uid }) => uid === id.cableUid)).designation}.${id.conductorId}`;
  }
}

function wireDesignations(ir: ElectricalIr, graph: SelectedSubgraph): string[] {
  return graph.conductiveElementIds
    .map((id) => conductorDesignation(ir, id))
    .sort();
}

function pathWireDesignations(
  ir: ElectricalIr,
  path: SelectedSubgraph["paths"][number],
): string[] {
  return path.steps
    .filter((step) => step.kind === "conductor")
    .map((step) => conductorDesignation(ir, step.elementId));
}

function terminalDesignation(
  ir: ElectricalIr,
  terminal: SelectedSubgraph["terminalIds"][number],
): string {
  return `${deviceDesignation(ir, terminal.deviceUid)}.${terminal.terminalKey}`;
}

function canonicalSelectedPathProjection(
  ir: ElectricalIr,
  graph: SelectedSubgraph,
) {
  return graph.paths.map((path) => {
    const boundaryAtStart = path.start.boundary !== undefined;
    const boundary = path.start.boundary ?? path.end.boundary;
    if (boundary === undefined) {
      throw new Error(`Selected path ${path.id} has no M5 boundary.`);
    }
    const steps = boundaryAtStart ? path.steps : [...path.steps].reverse();
    return {
      id: path.id,
      lane: path.lane,
      source: [
        boundary.kind,
        terminalDesignation(ir, boundary.terminal),
        boundary.potentialUid ?? null,
      ],
      steps: steps.map((step) =>
        step.kind === "conductor"
          ? `conductor:${conductorDesignation(ir, step.elementId)}`
          : `function:${deviceDesignation(ir, step.functionId.deviceUid)}.${step.functionId.functionKey}`,
      ),
      target: terminalDesignation(
        ir,
        boundaryAtStart ? path.end.terminal : path.start.terminal,
      ),
    };
  });
}

function deviceUid(ir: ElectricalIr, designation: string): string {
  return required(
    ir.devices.find((device) => device.designation === designation),
  ).uid;
}

function potential(ir: ElectricalIr, name: string) {
  return required(ir.potentials.find((candidate) => candidate.name === name));
}

function traceResult(
  ir: ElectricalIr,
  includePower: boolean,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  engine: QueryEngine = createQueryEngine(ir),
) {
  const root = required(
    ir.devices.find(({ designation }) => designation === "LS1"),
  );
  const target = required(
    ir.devices.find(({ designation }) => designation === "PLC1"),
  );
  return selectTraceSubgraph({
    ir,
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: root.uid, designation: root.designation },
      flow: "left-to-right",
    },
    target: { deviceUid: target.uid, designation: target.designation },
    includePower,
    engine,
    mappings,
  });
}

function traceSelected(
  ir: ElectricalIr,
  includePower: boolean,
  mappings?: readonly DeviceTypeSymbolMapping[],
): SelectedSubgraph {
  const result = traceResult(
    ir,
    includePower,
    mappings ?? CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function loadsResult(
  ir: ElectricalIr,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  engine: QueryEngine = createQueryEngine(ir),
) {
  const root = required(
    ir.devices.find(({ designation }) => designation === "PS1"),
  );
  return selectLoadsSubgraph({
    ir,
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: root.uid, designation: root.designation },
      flow: "left-to-right",
    },
    engine,
    mappings,
  });
}

function loadsSelected(
  ir: ElectricalIr,
  mappings?: readonly DeviceTypeSymbolMapping[],
): SelectedSubgraph {
  const result = loadsResult(ir, mappings ?? CORE_DEVICE_TYPE_SYMBOL_MAPPINGS);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function cableSelectionResult(
  ir: ElectricalIr,
  root = "CBL1",
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  engine: QueryEngine = createQueryEngine(ir),
) {
  return selectCableConductors({
    ir,
    root: { by: "designation", value: root },
    engine,
    mappings,
  });
}

function cableSelected(
  ir: ElectricalIr,
  mappings?: readonly DeviceTypeSymbolMapping[],
): CableConductorSelection {
  const result = cableSelectionResult(
    ir,
    "CBL1",
    mappings ?? CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function functionDesignations(
  ir: ElectricalIr,
  graph: SelectedSubgraph,
): string[] {
  return graph.functionIds.map(
    ({ deviceUid, functionKey }) =>
      `${deviceDesignation(ir, deviceUid)}.${functionKey}`,
  );
}

function netIdFor(ir: ElectricalIr, terminal: TerminalId): string {
  return required(
    ir.indexes.netIdByTerminal.find(
      ({ key }) =>
        key.deviceUid === terminal.deviceUid &&
        key.terminalKey === terminal.terminalKey,
    ),
  ).value;
}

function sameTerminalId(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

function sameElementId(
  left: ConductiveElementId,
  right: ConductiveElementId,
): boolean {
  return left.kind === "cable_conductor" && right.kind === "cable_conductor"
    ? left.cableUid === right.cableUid && left.conductorId === right.conductorId
    : left.kind === right.kind &&
        "uid" in left &&
        "uid" in right &&
        left.uid === right.uid;
}

function moveTerminalToNet(
  ir: ElectricalIr,
  terminal: TerminalId,
  targetNetId: string,
): void {
  const index = required(
    ir.indexes.netIdByTerminal.find(({ key }) => sameTerminalId(key, terminal)),
  );
  const previousNet = required(ir.nets.find(({ id }) => id === index.value));
  previousNet.terminalIds = previousNet.terminalIds.filter(
    (candidate) => !sameTerminalId(candidate, terminal),
  );
  if (
    previousNet.terminalIds.length === 0 &&
    previousNet.conductiveElementIds.length === 0 &&
    previousNet.potentialUids.length === 0
  ) {
    ir.nets = ir.nets.filter(({ id }) => id !== previousNet.id);
  }
  index.value = targetNetId;
  required(ir.nets.find(({ id }) => id === targetNetId)).terminalIds.push(
    structuredClone(terminal),
  );
}

function addFixtureWire(
  ir: ElectricalIr,
  uid: string,
  designation: string,
  first: TerminalId,
  second: TerminalId,
): void {
  const netId = netIdFor(ir, first);
  expect(netIdFor(ir, second)).toBe(netId);
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
        sameTerminalId(key, terminal),
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

function removeFixtureWire(ir: ElectricalIr, designation: string): void {
  const wire = required(
    ir.wires.find((candidate) => candidate.designation === designation),
  );
  const id = { kind: "wire" as const, uid: wire.uid };
  ir.wires = ir.wires.filter(({ uid }) => uid !== wire.uid);
  for (const net of ir.nets) {
    net.conductiveElementIds = net.conductiveElementIds.filter(
      (candidate) => !sameElementId(candidate, id),
    );
  }
  ir.indexes.terminalIdsByConductiveElement =
    ir.indexes.terminalIdsByConductiveElement.filter(
      ({ key }) => !sameElementId(key, id),
    );
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value = entry.value.filter(
      (candidate) => !sameElementId(candidate, id),
    );
  }
  ir.indexes.objectRefByUid = ir.indexes.objectRefByUid.filter(
    ({ key }) => key !== wire.uid,
  );
  ir.indexes.objectRefByDesignation = ir.indexes.objectRefByDesignation.filter(
    ({ key }) => key !== wire.designation,
  );
}

function parallelTraceFixture(source: ElectricalIr): ElectricalIr {
  const ir = structuredClone(source);
  const ls1 = deviceUid(ir, "LS1");
  const plc = deviceUid(ir, "PLC1");
  const jb = deviceUid(ir, "JB1");
  const tb = deviceUid(ir, "TB1");
  const root = { deviceUid: ls1, terminalKey: "14" };
  const target = { deviceUid: plc, terminalKey: "X1.0" };
  const signalNet = netIdFor(ir, root);

  const equalA = { deviceUid: jb, terminalKey: "X1.5" };
  const equalB = { deviceUid: tb, terminalKey: "6" };
  for (const terminal of [equalA, equalB])
    moveTerminalToNet(ir, terminal, signalNet);
  addFixtureWire(
    ir,
    "f0000000-0000-4000-8000-000000000501",
    "EQ-1",
    root,
    equalA,
  );
  addFixtureWire(
    ir,
    "f0000000-0000-4000-8000-000000000502",
    "EQ-2",
    equalA,
    equalB,
  );
  addFixtureWire(
    ir,
    "f0000000-0000-4000-8000-000000000503",
    "EQ-3",
    equalB,
    target,
  );

  const longer = [
    { deviceUid: jb, terminalKey: "X1.6" },
    { deviceUid: tb, terminalKey: "7" },
    { deviceUid: jb, terminalKey: "X1.7" },
  ];
  for (const terminal of longer) moveTerminalToNet(ir, terminal, signalNet);
  addFixtureWire(ir, "fixture-long-1", "LONG-1", root, longer[0]!);
  addFixtureWire(ir, "fixture-long-2", "LONG-2", longer[0]!, longer[1]!);
  addFixtureWire(ir, "fixture-long-3", "LONG-3", longer[1]!, longer[2]!);
  addFixtureWire(ir, "fixture-long-4", "LONG-4", longer[2]!, target);

  const dangling = { deviceUid: tb, terminalKey: "8" };
  moveTerminalToNet(ir, dangling, signalNet);
  addFixtureWire(ir, "fixture-dangling", "DANGLING", root, dangling);
  return ir;
}

function emptyCableFixture(source: ElectricalIr): ElectricalIr {
  const ir = structuredClone(source);
  const template = required(ir.cables[0]);
  const cableType = required(
    ir.cableTypes.find(({ id }) => id === template.typeId),
  );
  const cableUid = "fixture-empty-cable";
  const designation = "EMPTY-CABLE";
  ir.cables.push({
    uid: cableUid,
    designation,
    typeId: cableType.id,
    aliases: [],
    source: structuredClone(template.source),
  });
  ir.indexes.conductorIdsByCableUid.push({ key: cableUid, value: [] });
  ir.indexes.objectRefByUid.push({
    key: cableUid,
    value: { kind: "cable", uid: cableUid },
  });
  ir.indexes.objectRefByDesignation.push({
    key: designation,
    value: { kind: "cable", uid: cableUid },
  });
  required(
    ir.indexes.instanceRefsByTypeId.find(({ key }) => key === cableType.id),
  ).value.push({ kind: "cable", uid: cableUid });
  return ir;
}

describe("motor-starter semantic selection", () => {
  it("selects the exact K1 control path with contacts as function steps", () => {
    const graph = selected(coreIr, "K1", "control");
    expect(
      graph.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["K1", "OL1", "PB1", "PLC1", "PS1"]);
    expect(wireDesignations(coreIr, graph)).toEqual([
      "W-CTL-005",
      "W-CTL-006",
      "W-CTL-007",
      "W-CTL-008",
    ]);
    expect(graph.paths.map(({ lane }) => lane)).toEqual(["return", "input"]);
    const input = graph.paths.find(({ lane }) => lane === "input")!;
    expect(input.start).toMatchObject({
      terminal: { terminalKey: "X2.0" },
      boundary: {
        kind: "channel",
        terminal: { terminalKey: "X2.0" },
      },
      constraint: "FIRST",
    });
    expect(input.end).toEqual({
      terminal: {
        deviceUid: deviceUid(coreIr, "K1"),
        terminalKey: "A1",
      },
    });
    expect(input.steps.map(({ kind }) => kind)).toEqual([
      "conductor",
      "function",
      "conductor",
      "function",
      "conductor",
    ]);
    expect(
      input.steps
        .filter((step) => step.kind === "function")
        .map(({ functionId, normalState }) => [
          deviceDesignation(coreIr, functionId.deviceUid),
          functionId.functionKey,
          normalState,
        ]),
    ).toEqual([
      ["PB1", "contact11", "closed"],
      ["OL1", "aux95", "closed"],
    ]);

    const returning = graph.paths.find(({ lane }) => lane === "return")!;
    expect(returning.start).toEqual({
      terminal: {
        deviceUid: deviceUid(coreIr, "K1"),
        terminalKey: "A2",
      },
    });
    expect(returning.end).toEqual({
      terminal: {
        deviceUid: deviceUid(coreIr, "PS1"),
        terminalKey: "-",
      },
      boundary: {
        kind: "potential",
        terminal: {
          deviceUid: deviceUid(coreIr, "PS1"),
          terminalKey: "-",
        },
        netId: potential(coreIr, "0VDC").netId,
        potentialUid: potential(coreIr, "0VDC").uid,
        label: "0VDC",
      },
      constraint: "LAST",
    });
    expect(pathWireDesignations(coreIr, returning)).toEqual(["W-CTL-008"]);
    expect(returning.steps[0]).toMatchObject({
      from: returning.start.terminal,
      to: returning.end.terminal,
    });
  });

  it("selects exact phase-separated M1 power lanes and prunes the PS1 branch", () => {
    const graph = selected(coreIr, "M1", "power");
    expect(
      graph.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["CB1", "K1", "M1", "OL1", "SRC1"]);
    expect(graph.paths.map(({ lane }) => lane)).toEqual(["U", "V", "W", "PE"]);
    expect(wireDesignations(coreIr, graph)).toEqual(
      Array.from(
        { length: 13 },
        (_, index) => `W-PWR-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    expect(wireDesignations(coreIr, graph)).not.toContain("W-PWR-014");
    expect(wireDesignations(coreIr, graph)).not.toContain("W-PWR-015");

    for (const [index, lane] of ["U", "V", "W"].entries()) {
      const path = graph.paths[index]!;
      expect(path.lane).toBe(lane);
      expect(path.start).toMatchObject({
        terminal: { terminalKey: `L${index + 1}` },
        boundary: { terminal: { terminalKey: `L${index + 1}` } },
        constraint: "FIRST",
      });
      expect(path.end).toMatchObject({
        terminal: { terminalKey: lane },
        constraint: "LAST",
      });
      expect(path.steps[0]!.from).toEqual(path.start.terminal);
      expect(path.steps.at(-1)!.to).toEqual(path.end.terminal);
      expect(
        path.steps
          .filter((step) => step.kind === "function")
          .map(({ functionId }) => [
            deviceDesignation(coreIr, functionId.deviceUid),
            functionId.functionKey,
          ]),
      ).toEqual([
        ["CB1", `pole${index + 1}`],
        ["K1", `pole${index + 1}`],
        ["OL1", `pole${index + 1}`],
      ]);
    }

    const pe = graph.paths[3]!;
    expect(pe.start).toMatchObject({
      terminal: {
        deviceUid: deviceUid(coreIr, "SRC1"),
        terminalKey: "PE",
      },
      boundary: {
        kind: "potential",
        terminal: {
          deviceUid: deviceUid(coreIr, "SRC1"),
          terminalKey: "PE",
        },
        potentialUid: potential(coreIr, "PE").uid,
      },
      constraint: "FIRST",
    });
    expect(pe.end).toMatchObject({
      terminal: { deviceUid: deviceUid(coreIr, "M1"), terminalKey: "PE" },
      constraint: "LAST",
    });
    expect(pathWireDesignations(coreIr, pe)).toEqual(["W-PWR-013"]);
    expect(pe.steps.every(({ kind }) => kind === "conductor")).toBe(true);
  });

  it("never treats selected function steps as derived-net membership", () => {
    const graph = selected(coreIr, "K1", "control");
    const input = graph.paths.find(({ lane }) => lane === "input")!;
    const contacts = input.steps.filter((step) => step.kind === "function");
    expect(contacts).toHaveLength(2);
    for (const contact of contacts) {
      const fromNet = required(
        coreIr.indexes.netIdByTerminal.find(
          ({ key }) =>
            key.deviceUid === contact.from.deviceUid &&
            key.terminalKey === contact.from.terminalKey,
        ),
      ).value;
      const toNet = required(
        coreIr.indexes.netIdByTerminal.find(
          ({ key }) =>
            key.deviceUid === contact.to.deviceUid &&
            key.terminalKey === contact.to.terminalKey,
        ),
      ).value;
      expect(fromNet).not.toBe(toNet);
    }
  });

  it("matches the pre-D4 selected semantics after canonical source/target projection", () => {
    expect(
      canonicalSelectedPathProjection(
        coreIr,
        selected(coreIr, "K1", "control"),
      ),
    ).toEqual([
      {
        id: "control:return",
        lane: "return",
        source: ["potential", "PS1.-", potential(coreIr, "0VDC").uid],
        steps: ["conductor:W-CTL-008"],
        target: "K1.A2",
      },
      {
        id: "control:input",
        lane: "input",
        source: ["channel", "PLC1.X2.0", null],
        steps: [
          "conductor:W-CTL-005",
          "function:PB1.contact11",
          "conductor:W-CTL-006",
          "function:OL1.aux95",
          "conductor:W-CTL-007",
        ],
        target: "K1.A1",
      },
    ]);
    expect(
      canonicalSelectedPathProjection(coreIr, selected(coreIr, "M1", "power")),
    ).toEqual([
      {
        id: "power:U",
        lane: "U",
        source: ["source", "SRC1.L1", null],
        steps: [
          "conductor:W-PWR-001",
          "function:CB1.pole1",
          "conductor:W-PWR-004",
          "function:K1.pole1",
          "conductor:W-PWR-007",
          "function:OL1.pole1",
          "conductor:W-PWR-010",
        ],
        target: "M1.U",
      },
      {
        id: "power:V",
        lane: "V",
        source: ["source", "SRC1.L2", null],
        steps: [
          "conductor:W-PWR-002",
          "function:CB1.pole2",
          "conductor:W-PWR-005",
          "function:K1.pole2",
          "conductor:W-PWR-008",
          "function:OL1.pole2",
          "conductor:W-PWR-011",
        ],
        target: "M1.V",
      },
      {
        id: "power:W",
        lane: "W",
        source: ["source", "SRC1.L3", null],
        steps: [
          "conductor:W-PWR-003",
          "function:CB1.pole3",
          "conductor:W-PWR-006",
          "function:K1.pole3",
          "conductor:W-PWR-009",
          "function:OL1.pole3",
          "conductor:W-PWR-012",
        ],
        target: "M1.W",
      },
      {
        id: "power:PE",
        lane: "PE",
        source: ["potential", "SRC1.PE", potential(coreIr, "PE").uid],
        steps: ["conductor:W-PWR-013"],
        target: "M1.PE",
      },
    ]);
  });
});

describe("internal LS1-to-PLC trace selection", () => {
  it("selects the exact signal and declared two-wire positive-supply arms", () => {
    const graph = traceSelected(coreIr, true);
    expect(
      graph.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["JB1", "LS1", "PLC1", "PS1", "TB1"]);
    expect(graph.paths.map(({ lane }) => lane)).toEqual([
      "signal",
      "positive-supply",
    ]);

    const signal = graph.paths[0]!;
    expect(signal.start).toEqual({
      terminal: { deviceUid: deviceUid(coreIr, "LS1"), terminalKey: "14" },
    });
    expect(signal.end).toMatchObject({
      terminal: {
        deviceUid: deviceUid(coreIr, "PLC1"),
        terminalKey: "X1.0",
      },
      boundary: {
        kind: "channel",
        terminal: {
          deviceUid: deviceUid(coreIr, "PLC1"),
          terminalKey: "X1.0",
        },
      },
      constraint: "LAST",
    });
    expect(pathWireDesignations(coreIr, signal)).toEqual([
      "W-FLD-003",
      "CBL1.1-",
      "W-FLD-001",
    ]);

    const positive = graph.paths[1]!;
    expect(positive.start).toEqual({
      terminal: {
        deviceUid: deviceUid(coreIr, "PS1"),
        terminalKey: "+",
      },
      boundary: {
        kind: "potential",
        terminal: {
          deviceUid: deviceUid(coreIr, "PS1"),
          terminalKey: "+",
        },
        netId: potential(coreIr, "+24VDC").netId,
        potentialUid: potential(coreIr, "+24VDC").uid,
        label: "+24VDC",
      },
      constraint: "FIRST",
    });
    expect(positive.end).toEqual({
      terminal: { deviceUid: deviceUid(coreIr, "LS1"), terminalKey: "13" },
    });
    expect(pathWireDesignations(coreIr, positive)).toEqual([
      "W-CTL-003",
      "JP1",
      "CBL1.1+",
      "W-FLD-002",
    ]);
    expect(graph.paths.some(({ lane }) => lane === "return-supply")).toBe(
      false,
    );
    expect(wireDesignations(coreIr, graph)).toEqual([
      "CBL1.1+",
      "CBL1.1-",
      "JP1",
      "W-CTL-003",
      "W-FLD-001",
      "W-FLD-002",
      "W-FLD-003",
    ]);
    expect(functionDesignations(coreIr, graph)).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "LS1.contact13",
      "PLC1.di0",
      "PS1.dc_output",
      "TB1.terminal1",
      "TB1.terminal2",
      "TB1.terminal3",
    ]);
    expect(
      functionDesignations(coreIr, graph).filter(
        (value) => value === "PS1.dc_output",
      ),
    ).toHaveLength(1);
    expect(graph.netIds).toEqual(
      [
        potential(coreIr, "+24VDC").netId,
        netIdFor(coreIr, {
          deviceUid: deviceUid(coreIr, "LS1"),
          terminalKey: "14",
        }),
      ].sort(),
    );
  });

  it("selects only PLC1 di0 and never another channel or PLC supply", () => {
    const graph = traceSelected(coreIr, true);
    expect(
      graph.functionIds
        .filter(({ deviceUid: uid }) => uid === deviceUid(coreIr, "PLC1"))
        .map(({ functionKey }) => functionKey),
    ).toEqual(["di0"]);
    expect(graph.paths[0]!.end.terminal.terminalKey).toBe("X1.0");
    expect(graph.terminalIds).not.toContainEqual({
      deviceUid: deviceUid(coreIr, "PLC1"),
      terminalKey: "X1.1",
    });
    expect(graph.terminalIds).not.toContainEqual({
      deviceUid: deviceUid(coreIr, "PLC1"),
      terminalKey: "X2.0",
    });
  });

  it("keeps omitted two-wire and PNP root-port nets as non-conductive provenance", () => {
    const twoWire = traceSelected(coreIr, false);
    expect(twoWire.paths.map(({ lane }) => lane)).toEqual(["signal"]);
    expect(wireDesignations(coreIr, twoWire)).toEqual([
      "CBL1.1-",
      "W-FLD-001",
      "W-FLD-003",
    ]);
    expect(twoWire.netIds).toEqual(
      [
        netIdFor(coreIr, {
          deviceUid: deviceUid(coreIr, "LS1"),
          terminalKey: "13",
        }),
        netIdFor(coreIr, {
          deviceUid: deviceUid(coreIr, "LS1"),
          terminalKey: "14",
        }),
      ].sort(),
    );
    expect(
      twoWire.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["JB1", "LS1", "PLC1", "TB1"]);

    const pnpIr = pnpTraceFixture(coreIr);
    const pnp = traceSelected(pnpIr, false);
    expect(pnp.paths.map(({ lane }) => lane)).toEqual(["signal"]);
    expect(wireDesignations(pnpIr, pnp)).toEqual([
      "CBL1.1-",
      "W-FLD-001",
      "W-FLD-003",
    ]);
    expect(new Set(pnp.netIds)).toEqual(
      new Set([
        netIdFor(pnpIr, {
          deviceUid: deviceUid(pnpIr, "LS1"),
          terminalKey: "1",
        }),
        netIdFor(pnpIr, {
          deviceUid: deviceUid(pnpIr, "LS1"),
          terminalKey: "3",
        }),
        netIdFor(pnpIr, {
          deviceUid: deviceUid(pnpIr, "LS1"),
          terminalKey: "4",
        }),
      ]),
    );
    expect(functionDesignations(pnpIr, pnp)).toEqual([
      "JB1.terminal2",
      "LS1.supply",
      "LS1.output",
      "PLC1.di0",
      "TB1.terminal3",
    ]);
    expect(pnpIr.internalRelations).toContainEqual(
      expect.objectContaining({
        deviceUid: deviceUid(pnpIr, "LS1"),
        verb: "feeds_internal",
      }),
    );
    expect(
      pnp.paths
        .flatMap(({ steps }) => steps)
        .every(({ kind }) => kind === "conductor"),
    ).toBe(true);
    expect(pnp.deviceUids.map((uid) => deviceDesignation(pnpIr, uid))).toEqual([
      "JB1",
      "LS1",
      "PLC1",
      "TB1",
    ]);
    for (const omitted of [
      "W-CTL-003",
      "JP1",
      "CBL1.1+",
      "W-FLD-002",
      "W-CTL-004",
      "CBL1.2+",
    ]) {
      expect(wireDesignations(pnpIr, pnp)).not.toContain(omitted);
    }
  });

  it("retains co-located source function provenance without changing potential priority", () => {
    const graph = traceSelected(coreIr, true);
    const positive = required(
      graph.paths.find(({ lane }) => lane === "positive-supply"),
    );
    expect(positive.start.boundary).toMatchObject({
      kind: "potential",
      potentialUid: potential(coreIr, "+24VDC").uid,
    });
    expect(functionDesignations(coreIr, graph)).toContain("PS1.dc_output");

    const mappings = mutableCoreMappings();
    const psu = required(
      mappings.find(({ typeId }) => typeId === "core:psu-24vdc"),
    );
    psu.boundaryTerminals.push(structuredClone(psu.boundaryTerminals[0]!));
    expect(() => traceResult(coreIr, true, mappings)).toThrow(
      InvalidSymbolMappingError,
    );
  });

  it("adds all and only the PNP rule's declared positive and return arms", () => {
    const ir = pnpTraceFixture(coreIr);
    const graph = traceSelected(ir, true);
    expect(graph.paths.map(({ lane }) => lane)).toEqual([
      "signal",
      "positive-supply",
      "return-supply",
    ]);
    expect(
      pathWireDesignations(
        ir,
        required(graph.paths.find(({ lane }) => lane === "return-supply")),
      ),
    ).toEqual(["W-CTL-004", "CBL1.2+", "W-FLD-004"]);
    expect(wireDesignations(ir, graph)).toEqual([
      "CBL1.1+",
      "CBL1.1-",
      "CBL1.2+",
      "JP1",
      "W-CTL-003",
      "W-CTL-004",
      "W-FLD-001",
      "W-FLD-002",
      "W-FLD-003",
      "W-FLD-004",
    ]);
    expect(
      graph.paths
        .flatMap(({ steps }) => steps)
        .every(({ kind }) => kind === "conductor"),
    ).toBe(true);
    expect(functionDesignations(ir, graph)).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "JB1.terminal3",
      "LS1.supply",
      "LS1.output",
      "PLC1.di0",
      "PS1.dc_output",
      "TB1.terminal1",
      "TB1.terminal2",
      "TB1.terminal3",
      "TB1.terminal4",
    ]);
    expect(
      functionDesignations(ir, graph).filter(
        (value) => value === "PS1.dc_output",
      ),
    ).toHaveLength(1);
    expect(new Set(graph.netIds)).toEqual(
      new Set([
        netIdFor(ir, {
          deviceUid: deviceUid(ir, "LS1"),
          terminalKey: "1",
        }),
        netIdFor(ir, {
          deviceUid: deviceUid(ir, "LS1"),
          terminalKey: "3",
        }),
        netIdFor(ir, {
          deviceUid: deviceUid(ir, "LS1"),
          terminalKey: "4",
        }),
      ]),
    );
  });

  it("locks each independent series trace as exact selected-structure bytes", () => {
    const pnpIr = pnpTraceFixture(coreIr);
    const baselineSignal = required(
      traceSelected(coreIr, false).paths.find(({ lane }) => lane === "signal"),
    );
    const pnpPaths = traceSelected(pnpIr, true);
    const pnpSignal = required(
      pnpPaths.paths.find(({ lane }) => lane === "signal"),
    );
    const positive = required(
      pnpPaths.paths.find(({ lane }) => lane === "positive-supply"),
    );
    const returning = required(
      pnpPaths.paths.find(({ lane }) => lane === "return-supply"),
    );
    const bytes = (ir: ElectricalIr, path: SelectedSubgraph["paths"][number]) =>
      JSON.stringify({
        start: terminalDesignation(ir, path.start.terminal),
        uses: pathWireDesignations(ir, path),
        end: terminalDesignation(ir, path.end.terminal),
      });

    expect(bytes(coreIr, baselineSignal)).toBe(
      '{"start":"LS1.14","uses":["W-FLD-003","CBL1.1-","W-FLD-001"],"end":"PLC1.X1.0"}',
    );
    expect(bytes(pnpIr, pnpSignal)).toBe(
      '{"start":"LS1.4","uses":["W-FLD-003","CBL1.1-","W-FLD-001"],"end":"PLC1.X1.0"}',
    );
    expect(bytes(pnpIr, positive)).toBe(
      '{"start":"PS1.+","uses":["W-CTL-003","JP1","CBL1.1+","W-FLD-002"],"end":"LS1.1"}',
    );
    expect(bytes(pnpIr, returning)).toBe(
      '{"start":"PS1.-","uses":["W-CTL-004","CBL1.2+","W-FLD-004"],"end":"LS1.3"}',
    );
  });

  it("requires positive distance for an authored supply anchor", () => {
    const ir = structuredClone(coreIr);
    potential(ir, "+24VDC").terminal = {
      deviceUid: deviceUid(ir, "LS1"),
      terminalKey: "13",
    };
    const mappings = mutableCoreMappings();
    const psu = required(
      mappings.find(({ typeId }) => typeId === "core:psu-24vdc"),
    );
    psu.boundaryTerminals = psu.boundaryTerminals.filter(
      ({ boundaryKind }) => boundaryKind !== "control-source",
    );
    const result = traceResult(ir, true, mappings);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R002",
        family: "control",
        intent: "trace",
        deviceUid: deviceUid(ir, "LS1"),
        targetDeviceUid: deviceUid(ir, "PLC1"),
        segment: "positive-supply",
        message:
          "Incomplete trace view: the requested root cannot reach a required positive-supply boundary.",
        root: "LS1",
      },
    });
  });

  it("unions equal-shortest conductor routes and prunes longer and dangling branches", () => {
    const ir = parallelTraceFixture(coreIr);
    const graph = traceSelected(ir, false);
    const signal = required(graph.paths.find(({ lane }) => lane === "signal"));
    const selectedWires = new Set(pathWireDesignations(ir, signal));
    expect(selectedWires).toEqual(
      new Set(["W-FLD-003", "CBL1.1-", "W-FLD-001", "EQ-1", "EQ-2", "EQ-3"]),
    );
    expect([...selectedWires].some((value) => value.startsWith("LONG-"))).toBe(
      false,
    );
    expect(selectedWires.has("DANGLING")).toBe(false);
    expect(functionDesignations(ir, graph)).toEqual([
      "JB1.terminal2",
      "JB1.terminal5",
      "LS1.contact13",
      "PLC1.di0",
      "TB1.terminal3",
      "TB1.terminal6",
    ]);

    const reordered = structuredClone(ir);
    for (const collection of [
      reordered.devices,
      reordered.terminals,
      reordered.functions,
      reordered.wires,
      reordered.nets,
      reordered.indexes.conductiveElementIdsByTerminal,
      reordered.indexes.terminalIdsByConductiveElement,
      reordered.indexes.netIdByTerminal,
    ]) {
      collection.reverse();
    }
    expect(traceSelected(reordered, false)).toEqual(graph);
  });

  it("returns exact frozen R002 trace segments for missing required arms", () => {
    const signalIr = structuredClone(coreIr);
    removeFixtureWire(signalIr, "W-FLD-003");
    const missingSignal = traceResult(signalIr, false);
    expect(missingSignal).toEqual({
      ok: false,
      error: {
        code: "R002",
        family: "control",
        intent: "trace",
        deviceUid: deviceUid(signalIr, "LS1"),
        targetDeviceUid: deviceUid(signalIr, "PLC1"),
        segment: "signal",
        message:
          "Incomplete trace view: no signal path connects the requested devices.",
        root: "LS1",
      },
    });
    if (!missingSignal.ok)
      expect(Object.isFrozen(missingSignal.error)).toBe(true);

    const positiveIr = structuredClone(coreIr);
    removeFixtureWire(positiveIr, "W-FLD-002");
    const missingPositive = traceResult(positiveIr, true);
    expect(missingPositive).toMatchObject({
      ok: false,
      error: {
        code: "R002",
        intent: "trace",
        segment: "positive-supply",
        message:
          "Incomplete trace view: the requested root cannot reach a required positive-supply boundary.",
      },
    });

    const pnpIr = pnpTraceFixture(coreIr);
    removeFixtureWire(pnpIr, "W-FLD-004");
    const missingReturn = traceResult(pnpIr, true);
    expect(missingReturn).toMatchObject({
      ok: false,
      error: {
        code: "R002",
        intent: "trace",
        segment: "return-supply",
        message:
          "Incomplete trace view: the requested root cannot reach a required return-supply boundary.",
      },
    });
  });

  it("never crosses contact or feeds_internal adjacency", () => {
    const contactIr = structuredClone(coreIr);
    removeFixtureWire(contactIr, "W-FLD-003");
    const positiveNet = potential(contactIr, "+24VDC").netId;
    const plcInput = {
      deviceUid: deviceUid(contactIr, "PLC1"),
      terminalKey: "X1.1",
    };
    moveTerminalToNet(contactIr, plcInput, positiveNet);
    addFixtureWire(
      contactIr,
      "fixture-contact-only",
      "CONTACT-ONLY",
      {
        deviceUid: deviceUid(contactIr, "PS1"),
        terminalKey: "+",
      },
      plcInput,
    );
    expect(traceResult(contactIr, false)).toMatchObject({
      ok: false,
      error: { code: "R002", segment: "signal" },
    });

    const pnpIr = pnpTraceFixture(coreIr);
    removeFixtureWire(pnpIr, "W-FLD-003");
    expect(
      pnpIr.internalRelations.some(
        ({ deviceUid: uid, verb }) =>
          uid === deviceUid(pnpIr, "LS1") && verb === "feeds_internal",
      ),
    ).toBe(true);
    expect(traceResult(pnpIr, false)).toMatchObject({
      ok: false,
      error: { code: "R002", segment: "signal" },
    });
  });

  it("uses exact polarity facts and never a supply-looking potential name", () => {
    const ir = structuredClone(coreIr);
    const positive = potential(ir, "+24VDC");
    positive.name = "POSITIVE-SUPPLY";
    positive.electrical.polarity = "other";
    const graph = traceSelected(ir, true);
    const arm = required(
      graph.paths.find(({ lane }) => lane === "positive-supply"),
    );
    expect(arm.start.boundary).toMatchObject({ kind: "source" });
    expect(arm.start.boundary).not.toHaveProperty("potentialUid");
    expect(functionDesignations(ir, graph)).toContain("PS1.dc_output");
  });
});

describe("internal PS1 load selection", () => {
  it("selects only the complete PLC1 supply over the two mapped output nets", () => {
    const graph = loadsSelected(coreIr);
    expect(
      graph.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["PLC1", "PS1"]);
    expect(graph.paths.map(({ lane }) => lane)).toEqual([
      "PLC1.supply.positive",
      "PLC1.supply.return",
    ]);
    expect(
      graph.paths.map((path) => ({
        lane: path.lane,
        start: terminalDesignation(coreIr, path.start.terminal),
        startKind: path.start.boundary?.kind,
        startConstraint: path.start.constraint,
        wires: pathWireDesignations(coreIr, path),
        end: terminalDesignation(coreIr, path.end.terminal),
        endConstraint: path.end.constraint,
      })),
    ).toEqual([
      {
        lane: "PLC1.supply.positive",
        start: "PS1.+",
        startKind: "source",
        startConstraint: "FIRST",
        wires: ["W-CTL-001"],
        end: "PLC1.L+",
        endConstraint: "LAST",
      },
      {
        lane: "PLC1.supply.return",
        start: "PS1.-",
        startKind: "return",
        startConstraint: "FIRST",
        wires: ["W-CTL-002"],
        end: "PLC1.M",
        endConstraint: "LAST",
      },
    ]);
    expect(functionDesignations(coreIr, graph)).toEqual([
      "PLC1.supply",
      "PS1.dc_output",
    ]);
    expect(wireDesignations(coreIr, graph)).toEqual(["W-CTL-001", "W-CTL-002"]);
    expect(new Set(graph.netIds)).toEqual(
      new Set([
        potential(coreIr, "+24VDC").netId,
        potential(coreIr, "0VDC").netId,
      ]),
    );
    expect(
      graph.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).not.toContain("K1");
    expect(
      graph.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).not.toContain("LS1");
  });

  it("returns the exact frozen R002 when no complete load has both conductor arms", () => {
    const ir = structuredClone(coreIr);
    removeFixtureWire(ir, "W-CTL-002");
    const result = loadsResult(ir);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R002",
        family: "control",
        intent: "loads",
        deviceUid: deviceUid(ir, "PS1"),
        segment: "complete-load",
        message:
          "Incomplete loads view: the requested source has no complete renderable load.",
        root: "PS1",
      },
    });
    if (!result.ok) expect(Object.isFrozen(result.error)).toBe(true);
  });

  it("requires one mapped source/output pair instead of guessing from nets", () => {
    const mappings = mutableCoreMappings();
    const psu = required(
      mappings.find(({ typeId }) => typeId === "core:psu-24vdc"),
    );
    psu.boundaryTerminals = psu.boundaryTerminals.filter(
      ({ boundaryKind }) => boundaryKind !== "control-return",
    );
    expect(loadsResult(coreIr, mappings)).toMatchObject({
      ok: false,
      error: {
        code: "R003",
        family: "control",
        deviceUid: deviceUid(coreIr, "PS1"),
        typeId: "core:psu-24vdc",
        root: "PS1",
      },
    });
  });

  it("unions equal-shortest conductor arms and prunes longer and dangling branches", () => {
    const ir = structuredClone(coreIr);
    const source = { deviceUid: deviceUid(ir, "PS1"), terminalKey: "+" };
    const load = { deviceUid: deviceUid(ir, "PLC1"), terminalKey: "L+" };
    addFixtureWire(ir, "fixture-load-equal", "LOAD-EQUAL", source, load);

    const positiveNet = netIdFor(ir, source);
    const longer = [
      { deviceUid: deviceUid(ir, "JB1"), terminalKey: "X1.5" },
      { deviceUid: deviceUid(ir, "TB1"), terminalKey: "6" },
    ];
    for (const terminal of longer) moveTerminalToNet(ir, terminal, positiveNet);
    addFixtureWire(
      ir,
      "fixture-load-long-1",
      "LOAD-LONG-1",
      source,
      longer[0]!,
    );
    addFixtureWire(
      ir,
      "fixture-load-long-2",
      "LOAD-LONG-2",
      longer[0]!,
      longer[1]!,
    );
    addFixtureWire(ir, "fixture-load-long-3", "LOAD-LONG-3", longer[1]!, load);

    const dangling = { deviceUid: deviceUid(ir, "TB1"), terminalKey: "8" };
    moveTerminalToNet(ir, dangling, positiveNet);
    addFixtureWire(
      ir,
      "fixture-load-dangling",
      "LOAD-DANGLING",
      source,
      dangling,
    );

    const graph = loadsSelected(ir);
    const positive = required(
      graph.paths.find(({ lane }) => lane === "PLC1.supply.positive"),
    );
    expect(new Set(pathWireDesignations(ir, positive))).toEqual(
      new Set(["W-CTL-001", "LOAD-EQUAL"]),
    );
    expect(wireDesignations(ir, graph)).not.toContain("LOAD-LONG-1");
    expect(wireDesignations(ir, graph)).not.toContain("LOAD-LONG-2");
    expect(wireDesignations(ir, graph)).not.toContain("LOAD-LONG-3");
    expect(wireDesignations(ir, graph)).not.toContain("LOAD-DANGLING");
  });

  it("selects PNP supply/output provenance but only positive and return arms", () => {
    const ir = pnpTraceFixture(coreIr);
    const graph = loadsSelected(ir);
    const pnpPaths = graph.paths.filter(({ lane }) =>
      lane.startsWith("LS1.pnp-sensor."),
    );
    expect(pnpPaths.map(({ lane }) => lane)).toEqual([
      "LS1.pnp-sensor.supply",
      "LS1.pnp-sensor.return",
    ]);
    expect(pnpPaths.map((path) => pathWireDesignations(ir, path))).toEqual([
      ["W-CTL-003", "JP1", "CBL1.1+", "W-FLD-002"],
      ["W-CTL-004", "CBL1.2+", "W-FLD-004"],
    ]);
    expect(
      graph.paths
        .flatMap(({ steps }) => steps)
        .every(({ kind }) => kind === "conductor"),
    ).toBe(true);
    expect(functionDesignations(ir, graph)).toContain("LS1.supply");
    expect(functionDesignations(ir, graph)).toContain("LS1.output");
    expect(
      graph.terminalIds
        .filter(({ deviceUid: uid }) => uid === deviceUid(ir, "LS1"))
        .map(({ terminalKey }) => terminalKey),
    ).toEqual(["1", "3", "4"]);
    expect(new Set(graph.netIds)).toEqual(
      new Set([
        netIdFor(ir, { deviceUid: deviceUid(ir, "LS1"), terminalKey: "1" }),
        netIdFor(ir, { deviceUid: deviceUid(ir, "LS1"), terminalKey: "3" }),
        netIdFor(ir, { deviceUid: deviceUid(ir, "LS1"), terminalKey: "4" }),
      ]),
    );
    for (const signal of ["W-FLD-003", "CBL1.1-", "W-FLD-001"]) {
      expect(wireDesignations(ir, graph)).not.toContain(signal);
    }
  });

  it("never crosses feeds_internal when a PNP return conductor is absent", () => {
    const ir = pnpTraceFixture(coreIr);
    removeFixtureWire(ir, "W-FLD-004");
    expect(
      ir.internalRelations.some(
        ({ deviceUid: uid, verb }) =>
          uid === deviceUid(ir, "LS1") && verb === "feeds_internal",
      ),
    ).toBe(true);
    const graph = loadsSelected(ir);
    expect(functionDesignations(ir, graph)).not.toContain("LS1.supply");
    expect(functionDesignations(ir, graph)).not.toContain("LS1.output");
    expect(graph.paths.every(({ lane }) => lane.startsWith("PLC1."))).toBe(
      true,
    );
  });
});

describe("internal cable-conductor detail selection", () => {
  it("adapts the private cable result without a device-root seed or dereference", () => {
    const normalized = normalizeSchematicView(coreIr, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "CBL1" },
      intent: { kind: "conductors" },
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok || !("rootSelector" in normalized.value)) return;
    expect("deviceUid" in normalized.value.view.root).toBe(false);

    const result = selectCableConductorSubgraph({
      ir: coreIr,
      view: normalized.value.view,
      engine: normalized.value.engine,
      mappings: normalized.value.mappings,
      root: normalized.value.rootSelector,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.view).toBe(normalized.value.view);
    expect(
      result.value.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["JB1", "TB1"]);
    expect(result.value.conductiveElementIds).toEqual([
      {
        kind: "cable_conductor",
        cableUid: normalized.value.view.root.cableUid,
        conductorId: "1+",
      },
      {
        kind: "cable_conductor",
        cableUid: normalized.value.view.root.cableUid,
        conductorId: "1-",
      },
      {
        kind: "cable_conductor",
        cableUid: normalized.value.view.root.cableUid,
        conductorId: "2+",
      },
      {
        kind: "cable_conductor",
        cableUid: normalized.value.view.root.cableUid,
        conductorId: "2-",
      },
    ]);
  });

  it("selects every authored CBL1 conductor as one canonically oriented lane", () => {
    const selection = cableSelected(coreIr);
    expect(selection.cableUid).toBe(
      required(coreIr.cables.find(({ designation }) => designation === "CBL1"))
        .uid,
    );
    expect(selection.designation).toBe("CBL1");
    expect(
      selection.paths.map((path) => ({
        id: path.id,
        lane: path.lane,
        start: terminalDesignation(coreIr, path.start.terminal),
        elements: pathWireDesignations(coreIr, path),
        end: terminalDesignation(coreIr, path.end.terminal),
        constrained:
          path.start.constraint !== undefined ||
          path.end.constraint !== undefined ||
          path.start.boundary !== undefined ||
          path.end.boundary !== undefined,
      })),
    ).toEqual([
      {
        id: "cable:1+",
        lane: "1+",
        start: "JB1.X1.1",
        elements: ["CBL1.1+"],
        end: "TB1.2",
        constrained: false,
      },
      {
        id: "cable:1-",
        lane: "1-",
        start: "JB1.X1.2",
        elements: ["CBL1.1-"],
        end: "TB1.3",
        constrained: false,
      },
      {
        id: "cable:2+",
        lane: "2+",
        start: "JB1.X1.3",
        elements: ["CBL1.2+"],
        end: "TB1.4",
        constrained: false,
      },
      {
        id: "cable:2-",
        lane: "2-",
        start: "JB1.X1.4",
        elements: ["CBL1.2-"],
        end: "TB1.5",
        constrained: false,
      },
    ]);
    expect(
      selection.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).toEqual(["JB1", "TB1"]);
    expect(
      selection.terminalIds.map((id) => terminalDesignation(coreIr, id)),
    ).toEqual([
      "JB1.X1.1",
      "JB1.X1.2",
      "JB1.X1.3",
      "JB1.X1.4",
      "TB1.2",
      "TB1.3",
      "TB1.4",
      "TB1.5",
    ]);
    expect(
      selection.functionIds.map(
        ({ deviceUid: uid, functionKey }) =>
          `${deviceDesignation(coreIr, uid)}.${functionKey}`,
      ),
    ).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "JB1.terminal3",
      "JB1.terminal4",
      "TB1.terminal2",
      "TB1.terminal3",
      "TB1.terminal4",
      "TB1.terminal5",
    ]);
    expect(
      selection.conductiveElementIds.map((id) =>
        conductorDesignation(coreIr, id),
      ),
    ).toEqual(["CBL1.1+", "CBL1.1-", "CBL1.2+", "CBL1.2-"]);
    expect(selection.netIds).toEqual(
      [
        { deviceUid: deviceUid(coreIr, "JB1"), terminalKey: "X1.1" },
        { deviceUid: deviceUid(coreIr, "JB1"), terminalKey: "X1.2" },
        { deviceUid: deviceUid(coreIr, "JB1"), terminalKey: "X1.3" },
        { deviceUid: deviceUid(coreIr, "JB1"), terminalKey: "X1.4" },
      ]
        .map((terminal) => netIdFor(coreIr, terminal))
        .sort(),
    );
    expect(selection.paths.every(({ steps }) => steps.length === 1)).toBe(true);
    expect(
      selection.paths
        .flatMap(({ steps }) => steps)
        .every(({ kind }) => kind === "conductor"),
    ).toBe(true);
    expect(Object.hasOwn(selection, "view")).toBe(false);
  });

  it("is invariant to authored endpoint reversal and consumed collection order", () => {
    const baseline = cableSelected(coreIr);
    const reordered = structuredClone(coreIr);
    for (const conductor of reordered.cableConductors) {
      conductor.endpoints.reverse();
    }
    for (const entry of reordered.indexes.terminalIdsByConductiveElement) {
      if (entry.key.kind === "cable_conductor") entry.value.reverse();
    }
    for (const collection of [
      reordered.cableTypes,
      reordered.cables,
      reordered.cableConductors,
      reordered.deviceTypes,
      reordered.devices,
      reordered.terminals,
      reordered.functions,
      reordered.nets,
      reordered.indexes.conductorIdsByCableUid,
      reordered.indexes.conductiveElementIdsByTerminal,
      reordered.indexes.terminalIdsByConductiveElement,
      reordered.indexes.netIdByTerminal,
      reordered.indexes.objectRefByUid,
      reordered.indexes.objectRefByDesignation,
      reordered.indexes.instanceRefsByTypeId,
    ]) {
      collection.reverse();
    }
    for (const cableType of reordered.cableTypes) {
      cableType.conductors.reverse();
    }
    for (const net of reordered.nets) {
      net.terminalIds.reverse();
      net.conductiveElementIds.reverse();
      net.potentialUids.reverse();
    }
    expect(
      cableSelected(reordered, [...CORE_DEVICE_TYPE_SYMBOL_MAPPINGS].reverse()),
    ).toEqual(baseline);
  });

  it("never continues beyond either cable endpoint", () => {
    const selection = cableSelected(coreIr);
    expect(selection.paths).toHaveLength(4);
    expect(
      selection.paths.flatMap(({ steps }) =>
        steps.map((step) => conductorDesignation(coreIr, step.elementId)),
      ),
    ).toEqual(["CBL1.1+", "CBL1.1-", "CBL1.2+", "CBL1.2-"]);
    expect(
      selection.conductiveElementIds.every(
        (element) => element.kind === "cable_conductor",
      ),
    ).toBe(true);
    expect(
      selection.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).not.toContain("LS1");
    expect(
      selection.deviceUids.map((uid) => deviceDesignation(coreIr, uid)),
    ).not.toContain("PS1");
  });

  it("returns the exact frozen R002 result for an empty authored cable", () => {
    const ir = emptyCableFixture(coreIr);
    const result = cableSelectionResult(ir, "EMPTY-CABLE");
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R002",
        family: "control",
        intent: "conductors",
        cableUid: "fixture-empty-cable",
        segment: "conductors",
        message:
          "Incomplete conductor view: the requested cable has no authored conductors.",
        root: "EMPTY-CABLE",
      },
    });
    if (!result.ok) expect(Object.isFrozen(result.error)).toBe(true);
  });
});

describe("positive-distance boundary and frontier rules", () => {
  it("rejects an exact authored anchor at the search start", () => {
    const ir = structuredClone(coreIr);
    const zero = potential(ir, "0VDC");
    zero.terminal = {
      deviceUid: deviceUid(ir, "K1"),
      terminalKey: "A2",
    };
    const mappings = mutableCoreMappings();
    const psu = required(
      mappings.find(({ typeId }) => typeId === "core:psu-24vdc"),
    );
    psu.boundaryTerminals = psu.boundaryTerminals.filter(
      ({ boundaryKind }) => boundaryKind !== "control-return",
    );
    const result = select(ir, "K1", "control", mappings);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "R002",
        family: "control",
        pathSide: "return",
      });
    }
  });

  it("rejects a mapped boundary at the start and traverses W-CTL-008", () => {
    const mappings = mutableCoreMappings();
    const contactor = required(
      mappings.find(({ typeId }) => typeId === "core:contactor-3p-1no"),
    );
    contactor.aggregates.push({
      key: "test-start-boundary",
      families: ["control"],
      functionKeys: ["coil"],
      symbolId: "ais:coil",
      bindings: [
        {
          portId: "A2",
          terminalKey: "A2",
          memberFunctionKey: "coil",
        },
      ],
      classification: "source",
      traversalRole: "source-boundary",
    });
    contactor.boundaryTerminals.push({
      functionKey: "coil",
      terminalKey: "A2",
      families: ["control"],
      boundaryKind: "control-return",
      requiredRole: "coil_return",
    });
    const graph = selected(coreIr, "K1", "control", mappings);
    const returning = graph.paths.find(({ lane }) => lane === "return")!;
    expect(pathWireDesignations(coreIr, returning)).toEqual(["W-CTL-008"]);
    expect(returning.end.boundary?.terminal).toEqual({
      deviceUid: deviceUid(coreIr, "PS1"),
      terminalKey: "-",
    });
  });

  it("does not expand through an accepted boundary to a better class behind it", () => {
    const ir = structuredClone(coreIr);
    potential(ir, "0VDC").electrical.polarity = "other";
    potential(ir, "+24VDC").electrical.polarity = "return";
    const mappings = mutableCoreMappings();
    const psu = required(
      mappings.find(({ typeId }) => typeId === "core:psu-24vdc"),
    );
    psu.functions.push({
      functionKey: "dc_output",
      families: ["control"],
      symbolId: "ais:power-source-dc",
      bindings: [
        { portId: "positive", terminalKey: "+" },
        { portId: "return", terminalKey: "-" },
      ],
      classification: "control-contact",
      traversalRole: "control-contact",
    });
    const graph = selected(ir, "K1", "control", mappings);
    const returning = graph.paths.find(({ lane }) => lane === "return")!;
    expect(returning.end.boundary).toMatchObject({
      kind: "return",
      terminal: { deviceUid: deviceUid(ir, "PS1"), terminalKey: "-" },
    });
    expect(returning.end.boundary).not.toHaveProperty("potentialUid");
    expect(pathWireDesignations(ir, returning)).toEqual(["W-CTL-008"]);
    expect(
      returning.steps.some(
        (step) =>
          step.kind === "function" &&
          step.functionId.functionKey === "dc_output",
      ),
    ).toBe(false);
  });

  it("requires exact polarity tokens and never falls back to a potential name", () => {
    const ir = structuredClone(coreIr);
    const zero = potential(ir, "0VDC");
    zero.name = "RETURN";
    zero.electrical.polarity = "Return";
    const graph = selected(ir, "K1", "control");
    const returning = graph.paths.find(({ lane }) => lane === "return")!;
    expect(returning.end.boundary?.kind).toBe("return");
    expect(returning.end.boundary).not.toHaveProperty("potentialUid");
    expect(returning.end.boundary?.label).toBe("RETURN");
  });
});

describe("selection determinism", () => {
  it("is invariant to physical endpoint reversal and consumed collection shuffle", () => {
    const baselineControl = selected(coreIr, "K1", "control");
    const baselinePower = selected(coreIr, "M1", "power");
    const baselineTrace = traceSelected(coreIr, true);
    const baselineSignalOnlyTrace = traceSelected(coreIr, false);
    const baselineLoads = loadsSelected(coreIr);
    const shuffled = structuredClone(coreIr);
    for (const edge of [
      ...shuffled.wires,
      ...shuffled.jumpers,
      ...shuffled.cableConductors,
    ]) {
      edge.endpoints.reverse();
    }
    for (const entry of shuffled.indexes.terminalIdsByConductiveElement) {
      entry.value.reverse();
    }
    for (const collection of [
      shuffled.deviceTypes,
      shuffled.devices,
      shuffled.terminals,
      shuffled.functions,
      shuffled.wires,
      shuffled.jumpers,
      shuffled.cableConductors,
      shuffled.potentials,
      shuffled.nets,
      shuffled.indexes.terminalIdsByDeviceUid,
      shuffled.indexes.conductiveElementIdsByTerminal,
      shuffled.indexes.terminalIdsByConductiveElement,
      shuffled.indexes.netIdByTerminal,
    ]) {
      collection.reverse();
    }
    for (const materialized of shuffled.functions)
      materialized.terminals.reverse();
    for (const net of shuffled.nets) {
      net.terminalIds.reverse();
      net.conductiveElementIds.reverse();
      net.potentialUids.reverse();
    }
    expect(selected(shuffled, "K1", "control")).toEqual(baselineControl);
    expect(selected(shuffled, "M1", "power")).toEqual(baselinePower);
    const reversedMappings = [...CORE_DEVICE_TYPE_SYMBOL_MAPPINGS].reverse();
    expect(traceSelected(shuffled, true, reversedMappings)).toEqual(
      baselineTrace,
    );
    expect(traceSelected(shuffled, false, reversedMappings)).toEqual(
      baselineSignalOnlyTrace,
    );
    expect(loadsSelected(shuffled, reversedMappings)).toEqual(baselineLoads);
  });

  it("chooses potential UID lexically last after all other duplicate ties", () => {
    const ir = structuredClone(coreIr);
    const original = potential(ir, "0VDC");
    const duplicateUid = "00000000-0000-4000-8000-000000000001";
    ir.potentials.push({ ...structuredClone(original), uid: duplicateUid });
    required(
      ir.nets.find(({ id }) => id === original.netId),
    ).potentialUids.push(duplicateUid);
    ir.indexes.objectRefByUid.push({
      key: duplicateUid,
      value: { kind: "potential", uid: duplicateUid },
    });
    const first = selected(ir, "K1", "control");
    const firstBoundary = first.paths.find(({ lane }) => lane === "return")!.end
      .boundary!;
    expect(firstBoundary.potentialUid).toBe(duplicateUid);

    ir.potentials.reverse();
    for (const net of ir.nets) net.potentialUids.reverse();
    ir.indexes.objectRefByUid.reverse();
    const second = selected(ir, "K1", "control");
    expect(
      second.paths.find(({ lane }) => lane === "return")!.end.boundary,
    ).toEqual(firstBoundary);
    expect(second).toEqual(first);
  });
});
