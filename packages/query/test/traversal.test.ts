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

import * as query from "../src/index.js";
import {
  createQueryEngine,
  serializeQueryResult,
  type TraceResult,
} from "../src/index.js";
import { breadthFirstTraversal } from "../src/traversal.js";
import { createSelfLoopIr, createTerminalIr } from "./fixtures.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
const fixtureSource: SourceRef = {
  file: "traversal-fixture.json",
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

interface DeviceDefinition {
  readonly uid: string;
  readonly designation: string;
  readonly terminalKeys: readonly string[];
}

interface WireDefinition {
  readonly uid: string;
  readonly designation: string;
  readonly endpoints: readonly [TerminalId, TerminalId];
}

interface NetDefinition {
  readonly id: string;
  readonly terminals: readonly TerminalId[];
}

function terminal(deviceUid: string, terminalKey: string): TerminalId {
  return { deviceUid, terminalKey };
}

function terminalKey(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
}

function createPhysicalIr(
  devices: readonly DeviceDefinition[],
  wires: readonly WireDefinition[],
  nets: readonly NetDefinition[],
): ElectricalIr {
  const ir = createTerminalIr(devices);
  ir.wires = wires.map((wire) => ({
    uid: wire.uid,
    designation: wire.designation,
    aliases: [],
    endpoints: wire.endpoints.map((endpoint) => ({
      terminal: { ...endpoint },
      source: fixtureSource,
    })) as ElectricalIr["wires"][number]["endpoints"],
    source: fixtureSource,
  }));

  const incidence = new Map<string, ConductiveElementId[]>(
    ir.terminals.map(({ id }) => [terminalKey(id), []]),
  );
  ir.indexes.terminalIdsByConductiveElement = [];
  for (const wire of wires) {
    const element = { kind: "wire" as const, uid: wire.uid };
    for (const endpoint of wire.endpoints) {
      incidence.get(terminalKey(endpoint))!.push({ ...element });
    }
    ir.indexes.terminalIdsByConductiveElement.push({
      key: { ...element },
      value: wire.endpoints.map((endpoint) => ({ ...endpoint })) as [
        TerminalId,
        TerminalId,
      ],
    });
    ir.indexes.objectRefByUid.push({
      key: wire.uid,
      value: { kind: "wire", uid: wire.uid },
    });
    ir.indexes.objectRefByDesignation.push({
      key: wire.designation,
      value: { kind: "wire", uid: wire.uid },
    });
  }
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value = incidence.get(terminalKey(entry.key))!;
  }

  ir.nets = nets.map((definition) => {
    const memberKeys = new Set(definition.terminals.map(terminalKey));
    return {
      id: definition.id,
      terminalIds: definition.terminals.map((id) => ({ ...id })),
      conductiveElementIds: wires
        .filter((wire) =>
          wire.endpoints.every((endpoint) =>
            memberKeys.has(terminalKey(endpoint)),
          ),
        )
        .map(({ uid }) => ({ kind: "wire" as const, uid })),
      potentialUids: [],
    };
  });
  ir.indexes.netIdByTerminal = nets.flatMap((net) =>
    net.terminals.map((id) => ({ key: { ...id }, value: net.id })),
  );
  return ir;
}

function createLineIr(): ElectricalIr {
  const root = terminal("root", "R");
  const middle = terminal("middle", "M");
  const end = terminal("end", "E");
  return createPhysicalIr(
    [
      { uid: "root", designation: "ROOT", terminalKeys: ["R"] },
      { uid: "middle", designation: "MID", terminalKeys: ["M"] },
      { uid: "end", designation: "END", terminalKeys: ["E"] },
    ],
    [
      {
        uid: "line-1",
        designation: "LINE-1",
        endpoints: [root, middle],
      },
      {
        uid: "line-2",
        designation: "LINE-2",
        endpoints: [middle, end],
      },
    ],
    [{ id: "net:line", terminals: [root, middle, end] }],
  );
}

function createRichTraceIr(): ElectricalIr {
  const r1 = terminal("subject", "R1");
  const r2 = terminal("subject", "R2");
  const second = terminal("subject", "S");
  const isolated = terminal("subject", "ISO");
  const a = terminal("a", "T");
  const b = terminal("b", "T");
  const c = terminal("c", "T");
  const d = terminal("d", "T");
  const wires: WireDefinition[] = [
    { uid: "wire-7", designation: "W7-A-B", endpoints: [a, b] },
    { uid: "wire-5", designation: "W5-A-C-P", endpoints: [a, c] },
    { uid: "wire-2", designation: "W2-R2-B", endpoints: [r2, b] },
    { uid: "wire-6", designation: "W6-S-D", endpoints: [second, d] },
    { uid: "wire-3", designation: "W3-A-C", endpoints: [a, c] },
    { uid: "wire-1", designation: "W1-R1-A", endpoints: [r1, a] },
    { uid: "wire-4", designation: "W4-B-C", endpoints: [b, c] },
  ];
  const ir = createPhysicalIr(
    [
      {
        uid: "subject",
        designation: "SUB",
        terminalKeys: ["S", "R2", "ISO", "R1"],
      },
      { uid: "a", designation: "A", terminalKeys: ["T"] },
      { uid: "b", designation: "B", terminalKeys: ["T"] },
      { uid: "c", designation: "C", terminalKeys: ["T"] },
      { uid: "d", designation: "D", terminalKeys: ["T"] },
    ],
    wires,
    [
      { id: "net:main", terminals: [c, r2, a, r1, b] },
      { id: "net:second", terminals: [d, second] },
      { id: "net:isolated", terminals: [isolated] },
    ],
  );

  ir.potentials = [
    {
      uid: "potential-24",
      name: "+24VDC",
      aliases: [],
      electrical: { nominal_voltage: 24, voltage_type: "DC" },
      terminal: { ...r1 },
      netId: "net:main",
      terminalSource: fixtureSource,
      source: fixtureSource,
    },
  ];
  ir.nets.find(({ id }) => id === "net:main")!.potentialUids = ["potential-24"];
  ir.indexes.objectRefByUid.push({
    key: "potential-24",
    value: { kind: "potential", uid: "potential-24" },
  });
  return ir;
}

function createNonconductiveIr(): ElectricalIr {
  const root = terminal("subject", "R");
  const contactIn = terminal("relay", "IN");
  const contactOut = terminal("relay", "OUT");
  const other = terminal("other", "X");
  const ir = createPhysicalIr(
    [
      { uid: "subject", designation: "SUB", terminalKeys: ["R"] },
      {
        uid: "relay",
        designation: "REL",
        terminalKeys: ["IN", "OUT"],
      },
      { uid: "other", designation: "OTHER", terminalKeys: ["X"] },
    ],
    [
      {
        uid: "physical",
        designation: "PHYSICAL",
        endpoints: [root, contactIn],
      },
    ],
    [
      { id: "net:physical", terminals: [root, contactIn] },
      { id: "net:contact-out", terminals: [contactOut] },
      { id: "net:other", terminals: [other] },
    ],
  );
  ir.functions = [
    {
      id: { deviceUid: "relay", functionKey: "contact" },
      kind: "contact",
      normal_state: "closed",
      terminals: [contactIn, contactOut],
      source: fixtureSource,
    },
    {
      id: { deviceUid: "relay", functionKey: "channel" },
      kind: "channel",
      direction: "output",
      terminals: [contactOut],
      source: fixtureSource,
    },
  ];
  ir.internalRelations = [
    {
      deviceUid: "relay",
      verb: "feeds_internal",
      from: { deviceUid: "relay", functionKey: "contact" },
      to: { deviceUid: "relay", functionKey: "channel" },
      sourceOrigins: [fixtureSource],
    },
  ];
  ir.relations = [
    {
      uid: "relation-1",
      designation: "R-CONTROLS",
      verb: "controls",
      fromDeviceUid: "subject",
      toDeviceUid: "other",
      aliases: [],
      fromSource: fixtureSource,
      toSource: fixtureSource,
      source: fixtureSource,
    },
  ];
  ir.indexes.objectRefByUid.push({
    key: "relation-1",
    value: { kind: "relation", uid: "relation-1" },
  });
  ir.indexes.objectRefByDesignation.push({
    key: "R-CONTROLS",
    value: { kind: "relation", uid: "relation-1" },
  });
  ir.indexes.relationEndpointsByUid.push({
    key: "relation-1",
    value: { fromDeviceUid: "subject", toDeviceUid: "other" },
  });
  return ir;
}

function trace(ir: ElectricalIr, designation: string): TraceResult {
  const result = createQueryEngine(ir).trace({
    by: "designation",
    value: designation,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("private ordered breadth-first traversal", () => {
  it("marks on enqueue and keeps the FIFO first predecessor at equal depth", () => {
    const steps = new Map<string, readonly { node: string; edge: string }[]>([
      [
        "S",
        [
          { node: "A", edge: "S-A" },
          { node: "B", edge: "S-B" },
        ],
      ],
      ["A", [{ node: "T", edge: "A-T" }]],
      ["B", [{ node: "T", edge: "B-T" }]],
      ["T", []],
    ]);
    const visits = breadthFirstTraversal(
      ["S", "S"],
      (node) => node,
      (node) => steps.get(node) ?? [],
    );
    expect(visits).toEqual([
      { node: "S", hops: 0 },
      { node: "A", hops: 1, via: { from: "S", edge: "S-A" } },
      { node: "B", hops: 1, via: { from: "S", edge: "S-B" } },
      { node: "T", hops: 2, via: { from: "A", edge: "A-T" } },
    ]);
    expect("breadthFirstTraversal" in query).toBe(false);
  });
});

describe("D8 conductive traversal and device trace", () => {
  it("counts physical elements along a line", () => {
    const result = trace(createLineIr(), "ROOT");
    expect(
      result.components[0]!.visits.map(({ terminal, hops, via }) => [
        terminal.display,
        hops,
        via?.element.display,
      ]),
    ).toEqual([
      ["ROOT.R", 0, undefined],
      ["MID.M", 1, "LINE-1"],
      ["END.E", 2, "LINE-2"],
    ]);
  });

  it("groups sorted multi-roots by net and retains branch, cycle, and parallel edges", () => {
    const result = trace(createRichTraceIr(), "SUB");
    expect(result.components.map(({ net }) => net.id)).toEqual([
      "net:isolated",
      "net:main",
      "net:second",
    ]);
    const main = result.components.find(({ net }) => net.id === "net:main")!;
    expect(main.roots.map(({ display }) => display)).toEqual([
      "SUB.R1",
      "SUB.R2",
    ]);
    expect(main.net.potentials).toEqual([
      {
        uid: "potential-24",
        name: "+24VDC",
        electrical: { nominal_voltage: 24, voltage_type: "DC" },
      },
    ]);
    expect(
      main.visits.map(({ terminal, hops, via }) => [
        terminal.display,
        hops,
        via?.from.display,
        via?.element.display,
      ]),
    ).toEqual([
      ["SUB.R1", 0, undefined, undefined],
      ["SUB.R2", 0, undefined, undefined],
      ["A.T", 1, "SUB.R1", "W1-R1-A"],
      ["B.T", 1, "SUB.R2", "W2-R2-B"],
      ["C.T", 2, "A.T", "W3-A-C"],
    ]);
    expect(main.elements.map(({ element }) => element.display)).toEqual([
      "W1-R1-A",
      "W2-R2-B",
      "W3-A-C",
      "W4-B-C",
      "W5-A-C-P",
      "W7-A-B",
    ]);
    expect(result.components[0]).toMatchObject({
      roots: [{ display: "SUB.ISO" }],
      visits: [{ hops: 0, terminal: { display: "SUB.ISO" } }],
      elements: [],
    });
  });

  it("validates starts in caller order, then deduplicates and sorts them", () => {
    const engine = createQueryEngine(createRichTraceIr());
    const r1 = terminal("subject", "R1");
    const r2 = terminal("subject", "R2");
    const result = engine.followConductive([r2, r1, r2]);
    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          net: { id: "net:main" },
          roots: [{ display: "SUB.R1" }, { display: "SUB.R2" }],
        },
      ],
    });

    const unknown = terminal("missing", "X");
    const wrongKind = terminal("wire-1", "X");
    expect(engine.followConductive([unknown, wrongKind])).toMatchObject({
      ok: false,
      error: { code: "Q001", input: JSON.stringify(unknown) },
    });
    expect(engine.followConductive([wrongKind, unknown])).toMatchObject({
      ok: false,
      error: {
        code: "Q002",
        input: JSON.stringify(wrongKind),
        expectedKind: "device",
        actualKind: "wire",
      },
    });
    expect(engine.followConductive([terminal("subject", "missing")])).toEqual({
      ok: false,
      error: {
        code: "Q004",
        message: 'Device "SUB" has no terminal "missing".',
        input: "missing",
        deviceDesignation: "SUB",
        terminalKey: "missing",
      },
    });
    expect(engine.followConductive([])).toEqual({ ok: true, value: [] });
  });

  it("emits one hop-zero self-loop visit and one equal-endpoint edge", () => {
    const result = trace(createSelfLoopIr("shared"), "DEV.1");
    expect(result.components).toHaveLength(1);
    const component = result.components[0]!;
    expect(component.visits).toHaveLength(1);
    expect(component.visits[0]).toMatchObject({
      terminal: { display: "DEV.1.T.1" },
      hops: 0,
    });
    expect(component.visits[0]).not.toHaveProperty("via");
    expect(component.elements).toHaveLength(1);
    expect(component.elements[0]!.element.display).toBe("W.1");
    expect(component.elements[0]!.endpoints[0]).toEqual(
      component.elements[0]!.endpoints[1],
    );
  });

  it("does not cross contacts, functions, internal relations, or project relations", () => {
    const result = trace(createNonconductiveIr(), "SUB");
    expect(
      result.components.flatMap(({ visits }) =>
        visits.map(({ terminal }) => terminal.display),
      ),
    ).toEqual(["SUB.R", "REL.IN"]);
    const bytes = serializeQueryResult(result);
    expect(bytes).not.toContain("REL.OUT");
    expect(bytes).not.toContain("OTHER.X");
    expect(bytes).not.toContain("feeds_internal");
    expect(bytes).not.toContain("controls");
  });

  it("returns no components for a valid zero-terminal device", () => {
    expect(
      trace(
        createTerminalIr([
          { uid: "empty", designation: "EMPTY", terminalKeys: [] },
        ]),
        "EMPTY",
      ),
    ).toMatchObject({ command: "trace", components: [] });
  });

  it.each([
    ["wire", { by: "designation" as const, value: "W-PWR-001" }],
    ["jumper", { by: "designation" as const, value: "JP1" }],
    ["cable", { by: "designation" as const, value: "CBL1" }],
    ["relation", { by: "designation" as const, value: "REL-CONTROLS-001" }],
    ["potential", { by: "uid" as const, value: "" }],
  ])("returns exact trace Q002 for a known %s", (kind, baseSelector) => {
    const selector =
      kind === "potential"
        ? { by: "uid" as const, value: motorIr.potentials[0]!.uid }
        : baseSelector;
    expect(createQueryEngine(motorIr).trace(selector)).toEqual({
      ok: false,
      error: {
        code: "Q002",
        message: `Object ${JSON.stringify(selector.value)} is a ${kind}; trace requires a device.`,
        input: selector.value,
        expectedKind: "device",
        actualKind: kind,
      },
    });
  });

  it("returns exact trace Q001 for an unknown selector", () => {
    expect(
      createQueryEngine(createLineIr()).trace({
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

  it("is deterministic under collection, incidence, net, root, and endpoint shuffles", () => {
    const ir = createRichTraceIr();
    const baseline = trace(ir, "SUB");
    const shuffled = structuredClone(ir);
    shuffled.wires.reverse();
    shuffled.terminals.reverse();
    shuffled.nets.reverse();
    shuffled.potentials.reverse();
    for (const value of Object.values(shuffled.indexes)) value.reverse();
    for (const wire of shuffled.wires) wire.endpoints.reverse();
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
    const reordered = trace(shuffled, "SUB");
    expect(reordered).toEqual(baseline);
    expect(serializeQueryResult(reordered)).toBe(
      serializeQueryResult(baseline),
    );
  });

  it("serializes trace DTO fields in declaration order", () => {
    const value = JSON.parse(
      serializeQueryResult(trace(createLineIr(), "ROOT")),
    ) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(["command", "device", "components"]);
    const component = (value.components as Record<string, unknown>[])[0]!;
    expect(Object.keys(component)).toEqual([
      "net",
      "roots",
      "visits",
      "elements",
    ]);
    const visit = (component.visits as Record<string, unknown>[])[1]!;
    expect(Object.keys(visit)).toEqual(["terminal", "hops", "via"]);
    expect(Object.keys(visit.via as Record<string, unknown>)).toEqual([
      "from",
      "element",
    ]);
  });
});
