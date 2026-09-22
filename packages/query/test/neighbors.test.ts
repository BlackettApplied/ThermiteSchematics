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
  serializeQueryResult,
  type DeviceView,
  type NeighborsResult,
  type TerminalView,
} from "../src/index.js";
import { createSelfLoopIr, createTerminalIr } from "./fixtures.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
let motorIr: ElectricalIr;

const fixtureSource: SourceRef = {
  file: "neighbors-fixture.json",
  line: 1,
  column: 1,
  jsonPointer: "",
};

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

function createNeighborsIr(): ElectricalIr {
  const subjectA = terminal("subject", "A");
  const subjectB = terminal("subject", "B");
  const isolated = terminal("subject", "ISO");
  const d1x = terminal("d1", "X");
  const d2y = terminal("d2", "Y");
  const definitions = [
    { uid: "subject", designation: "SUB", terminalKeys: ["A", "B", "ISO"] },
    { uid: "d1", designation: "D1", terminalKeys: ["X"] },
    { uid: "d2", designation: "D2", terminalKeys: ["Y"] },
  ];
  const ir = createTerminalIr(definitions);

  const wireRecords = [
    {
      uid: "wire-2",
      designation: "W-BRANCH-D2",
      aliases: [],
      endpoints: [
        { terminal: { ...subjectA }, source: fixtureSource },
        { terminal: { ...d2y }, source: fixtureSource },
      ],
      source: fixtureSource,
    },
    {
      uid: "wire-3",
      designation: "W-PARALLEL-D1",
      aliases: [],
      endpoints: [
        { terminal: { ...subjectA }, source: fixtureSource },
        { terminal: { ...d1x }, source: fixtureSource },
      ],
      source: fixtureSource,
    },
    {
      uid: "wire-1",
      designation: "W-BRANCH-D1",
      aliases: [],
      endpoints: [
        { terminal: { ...subjectA }, source: fixtureSource },
        { terminal: { ...d1x }, source: fixtureSource },
      ],
      source: fixtureSource,
    },
  ] satisfies ElectricalIr["wires"];
  const jumper = {
    uid: "jumper-1",
    designation: "J-SAME",
    aliases: [],
    endpoints: [
      { terminal: { ...subjectA }, source: fixtureSource },
      { terminal: { ...subjectB }, source: fixtureSource },
    ],
    source: fixtureSource,
  } satisfies ElectricalIr["jumpers"][number];
  ir.wires = wireRecords;
  ir.jumpers = [jumper];

  ir.functions = [
    {
      id: { deviceUid: "subject", functionKey: "contact" },
      kind: "contact",
      normal_state: "open",
      terminals: [{ ...subjectA }, { ...subjectB }],
      source: fixtureSource,
    },
    {
      id: { deviceUid: "subject", functionKey: "coil" },
      kind: "coil",
      terminals: [{ ...isolated }],
      source: fixtureSource,
    },
  ];
  ir.internalRelations = [
    {
      deviceUid: "subject",
      verb: "feeds_internal",
      from: { deviceUid: "subject", functionKey: "coil" },
      to: { deviceUid: "subject", functionKey: "contact" },
      sourceOrigins: [fixtureSource],
    },
  ];

  ir.relations = [
    {
      uid: "relation-self",
      designation: "R-SELF",
      verb: "controls",
      fromDeviceUid: "subject",
      toDeviceUid: "subject",
      aliases: [],
      fromSource: fixtureSource,
      toSource: fixtureSource,
      source: fixtureSource,
    },
    {
      uid: "relation-out",
      designation: "R-OUT",
      verb: "controls",
      fromDeviceUid: "subject",
      toDeviceUid: "d2",
      aliases: [],
      fromSource: fixtureSource,
      toSource: fixtureSource,
      source: fixtureSource,
    },
    {
      uid: "relation-in",
      designation: "R-IN",
      verb: "controls",
      fromDeviceUid: "d1",
      toDeviceUid: "subject",
      aliases: [],
      fromSource: fixtureSource,
      toSource: fixtureSource,
      source: fixtureSource,
    },
  ];

  const elementIds: ConductiveElementId[] = [
    { kind: "wire", uid: "wire-2" },
    { kind: "wire", uid: "wire-3" },
    { kind: "wire", uid: "wire-1" },
    { kind: "jumper", uid: "jumper-1" },
  ];
  ir.nets = [
    {
      id: "net:main",
      terminalIds: [{ ...subjectA }, { ...subjectB }, { ...d1x }, { ...d2y }],
      conductiveElementIds: elementIds.map((id) => ({ ...id })),
      potentialUids: [],
    },
    {
      id: "net:isolated",
      terminalIds: [{ ...isolated }],
      conductiveElementIds: [],
      potentialUids: [],
    },
  ];

  const incidence = new Map<string, ConductiveElementId[]>([
    [
      "subject:A",
      [
        { kind: "jumper", uid: "jumper-1" },
        { kind: "wire", uid: "wire-3" },
        { kind: "wire", uid: "wire-2" },
        { kind: "wire", uid: "wire-1" },
      ],
    ],
    ["subject:B", [{ kind: "jumper", uid: "jumper-1" }]],
    ["subject:ISO", []],
    [
      "d1:X",
      [
        { kind: "wire", uid: "wire-3" },
        { kind: "wire", uid: "wire-1" },
      ],
    ],
    ["d2:Y", [{ kind: "wire", uid: "wire-2" }]],
  ]);
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value = incidence.get(
      `${entry.key.deviceUid}:${entry.key.terminalKey}`,
    )!;
  }
  ir.indexes.terminalIdsByConductiveElement = [
    { key: { kind: "wire", uid: "wire-2" }, value: [subjectA, d2y] },
    { key: { kind: "wire", uid: "wire-3" }, value: [subjectA, d1x] },
    { key: { kind: "wire", uid: "wire-1" }, value: [subjectA, d1x] },
    {
      key: { kind: "jumper", uid: "jumper-1" },
      value: [subjectA, subjectB],
    },
  ];
  ir.indexes.netIdByTerminal = [
    { key: subjectA, value: "net:main" },
    { key: subjectB, value: "net:main" },
    { key: d1x, value: "net:main" },
    { key: d2y, value: "net:main" },
    { key: isolated, value: "net:isolated" },
  ];

  for (const wire of wireRecords) {
    ir.indexes.objectRefByUid.push({
      key: wire.uid,
      value: { kind: "wire", uid: wire.uid },
    });
    ir.indexes.objectRefByDesignation.push({
      key: wire.designation,
      value: { kind: "wire", uid: wire.uid },
    });
  }
  ir.indexes.objectRefByUid.push({
    key: jumper.uid,
    value: { kind: "jumper", uid: jumper.uid },
  });
  ir.indexes.objectRefByDesignation.push({
    key: jumper.designation,
    value: { kind: "jumper", uid: jumper.uid },
  });
  for (const relation of ir.relations) {
    ir.indexes.objectRefByUid.push({
      key: relation.uid,
      value: { kind: "relation", uid: relation.uid },
    });
    ir.indexes.objectRefByDesignation.push({
      key: relation.designation!,
      value: { kind: "relation", uid: relation.uid },
    });
    ir.indexes.relationEndpointsByUid.push({
      key: relation.uid,
      value: {
        fromDeviceUid: relation.fromDeviceUid,
        toDeviceUid: relation.toDeviceUid,
      },
    });
  }
  return ir;
}

function deviceView(uid: string, designation: string): DeviceView {
  return {
    kind: "device",
    uid,
    designation,
    aliases: [],
    typeId: "type:device",
  };
}

function terminalView(
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

function neighbors(ir: ElectricalIr, designation: string): NeighborsResult {
  const result = createQueryEngine(ir).neighbors({
    by: "designation",
    value: designation,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("D7 neighbor primitive", () => {
  it("returns comparator-ordered branch, parallel, and same-device jumper rows", () => {
    const result = neighbors(createNeighborsIr(), "SUB");
    const subject = deviceView("subject", "SUB");
    const d1 = deviceView("d1", "D1");
    const d2 = deviceView("d2", "D2");
    const a = terminalView("subject", "SUB", "A");
    const b = terminalView("subject", "SUB", "B");
    const x = terminalView("d1", "D1", "X");
    const y = terminalView("d2", "D2", "Y");

    expect(result).toEqual({
      command: "neighbors",
      device: subject,
      conductive: [
        {
          terminal: a,
          element: {
            kind: "wire",
            uid: "wire-1",
            designation: "W-BRANCH-D1",
            display: "W-BRANCH-D1",
          },
          otherTerminal: x,
          otherDevice: d1,
        },
        {
          terminal: a,
          element: {
            kind: "wire",
            uid: "wire-2",
            designation: "W-BRANCH-D2",
            display: "W-BRANCH-D2",
          },
          otherTerminal: y,
          otherDevice: d2,
        },
        {
          terminal: a,
          element: {
            kind: "wire",
            uid: "wire-3",
            designation: "W-PARALLEL-D1",
            display: "W-PARALLEL-D1",
          },
          otherTerminal: x,
          otherDevice: d1,
        },
        {
          terminal: a,
          element: {
            kind: "jumper",
            uid: "jumper-1",
            designation: "J-SAME",
            display: "J-SAME",
          },
          otherTerminal: b,
          otherDevice: subject,
        },
        {
          terminal: b,
          element: {
            kind: "jumper",
            uid: "jumper-1",
            designation: "J-SAME",
            display: "J-SAME",
          },
          otherTerminal: a,
          otherDevice: subject,
        },
      ],
      relations: [
        expect.objectContaining({
          direction: "incoming",
          otherDevice: d1,
          relation: expect.objectContaining({ uid: "relation-in" }),
        }),
        expect.objectContaining({
          direction: "outgoing",
          otherDevice: d2,
          relation: expect.objectContaining({ uid: "relation-out" }),
        }),
        expect.objectContaining({
          direction: "self",
          otherDevice: subject,
          relation: expect.objectContaining({ uid: "relation-self" }),
        }),
      ],
    });
    expect(
      result.conductive.some(({ terminal }) => terminal.display === "SUB.ISO"),
    ).toBe(false);
  });

  it("collapses doubled self-loop incidence to one row with an equal other terminal", () => {
    const result = neighbors(createSelfLoopIr("shared"), "DEV.1");
    expect(result.conductive).toHaveLength(1);
    expect(result.conductive[0]).toEqual({
      terminal: expect.objectContaining({
        id: { deviceUid: "device-1", terminalKey: "T.1" },
      }),
      element: {
        kind: "wire",
        uid: "wire-1",
        designation: "W.1",
        display: "W.1",
      },
      otherTerminal: expect.objectContaining({
        id: { deviceUid: "device-1", terminalKey: "T.1" },
      }),
      otherDevice: expect.objectContaining({
        kind: "device",
        uid: "device-1",
        designation: "DEV.1",
      }),
    });
    expect(result.conductive[0]!.otherTerminal).toEqual(
      result.conductive[0]!.terminal,
    );
  });

  it("keeps conductive and project-relation neighbors physically and functionally separate", () => {
    const result = neighbors(createNeighborsIr(), "SUB");
    expect(result.conductive).toHaveLength(5);
    expect(result.relations.map(({ direction }) => direction)).toEqual([
      "incoming",
      "outgoing",
      "self",
    ]);
    expect(
      result.relations.every(({ relation }) => relation.verb === "controls"),
    ).toBe(true);
    expect(serializeQueryResult(result)).not.toContain("feeds_internal");
    expect(serializeQueryResult(result)).not.toContain("contact");
  });

  it("matches the reviewed motor-starter K1 neighbor facts", () => {
    const result = neighbors(motorIr, "K1");
    expect(result.conductive).toHaveLength(8);
    expect(
      result.conductive.some(({ terminal }) => terminal.display === "K1.13"),
    ).toBe(false);
    expect(
      result.conductive.some(({ terminal }) => terminal.display === "K1.14"),
    ).toBe(false);
    expect(result.relations).toEqual([
      expect.objectContaining({
        direction: "incoming",
        otherDevice: expect.objectContaining({ designation: "PLC1" }),
        relation: expect.objectContaining({
          designation: "REL-CONTROLS-001",
          verb: "controls",
        }),
      }),
    ]);
  });

  it.each([
    ["wire", { by: "designation" as const, value: "W-PWR-001" }],
    ["jumper", { by: "designation" as const, value: "JP1" }],
    ["cable", { by: "designation" as const, value: "CBL1" }],
    ["relation", { by: "designation" as const, value: "REL-CONTROLS-001" }],
    ["potential", { by: "uid" as const, value: "" }],
  ])("returns exact Q002 for a known %s", (kind, baseSelector) => {
    const selector =
      kind === "potential"
        ? { by: "uid" as const, value: motorIr.potentials[0]!.uid }
        : baseSelector;
    expect(createQueryEngine(motorIr).neighbors(selector)).toEqual({
      ok: false,
      error: {
        code: "Q002",
        message: `Object ${JSON.stringify(selector.value)} is a ${kind}; neighbors requires a device.`,
        input: selector.value,
        expectedKind: "device",
        actualKind: kind,
      },
    });
  });

  it("returns exact Q001 for an unknown selector", () => {
    expect(
      createQueryEngine(motorIr).neighbors({
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

  it("is deterministic under input shuffles and isolates nested result copies", () => {
    const ir = createNeighborsIr();
    const baseline = neighbors(ir, "SUB");
    const shuffled = structuredClone(ir);
    shuffled.wires.reverse();
    shuffled.jumpers.reverse();
    shuffled.relations.reverse();
    shuffled.terminals.reverse();
    for (const value of Object.values(shuffled.indexes)) value.reverse();
    for (const entry of shuffled.indexes.terminalIdsByDeviceUid) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.conductiveElementIdsByTerminal) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.terminalIdsByConductiveElement) {
      entry.value.reverse();
    }
    const reordered = neighbors(shuffled, "SUB");
    expect(reordered).toEqual(baseline);
    expect(serializeQueryResult(reordered)).toBe(
      serializeQueryResult(baseline),
    );

    (baseline.conductive[0]!.terminal.id as { deviceUid: string }).deviceUid =
      "changed";
    expect(baseline.conductive[1]!.terminal.id.deviceUid).toBe("subject");
    expect(
      ir.terminals.find(({ id }) => id.terminalKey === "A")!.id.deviceUid,
    ).toBe("subject");
  });

  it("serializes declaration-ordered neighbor fields", () => {
    const serialized = serializeQueryResult(
      neighbors(createNeighborsIr(), "SUB"),
    );
    const value = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual([
      "command",
      "device",
      "conductive",
      "relations",
    ]);
    expect(
      Object.keys((value.conductive as Record<string, unknown>[])[0]!),
    ).toEqual(["terminal", "element", "otherTerminal", "otherDevice"]);
  });
});
