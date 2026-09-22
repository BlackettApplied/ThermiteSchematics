import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  deriveProjectNets,
  expandResolvedProject,
  loadProject,
  normalizeProjectGraph,
  resolveLoadedProject,
  type ConductiveElementId,
  type ExpansionResult,
  type GraphNormalizationResult,
  type IrPotentialDeclaration,
  type LoadedProject,
  type NetDerivationResult,
  type SourceRef,
  type TerminalId,
} from "../src/index.js";

const motorStarterRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/motor-starter",
);

const UID_A = "00000000-0000-4000-8000-000000000001";
const UID_B = "00000000-0000-4000-8000-000000000002";
const UID_C = "00000000-0000-4000-8000-000000000003";
const UID_D = "00000000-0000-4000-8000-000000000004";
const UID_E = "00000000-0000-4000-8000-000000000005";

interface TestElement {
  id: ConductiveElementId;
  endpoints: [TerminalId, TerminalId];
}

interface PipelineResult {
  expansion: ExpansionResult;
  graph: GraphNormalizationResult;
  netResult: NetDerivationResult;
}

let motorStarter: LoadedProject;

beforeAll(async () => {
  const loaded = await loadProject(motorStarterRoot);

  if (!loaded.ok) {
    throw new Error(
      `Motor-starter fixture failed structural load: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }

  motorStarter = loaded.project;
});

function source(): SourceRef {
  return { file: "topology.json", line: 1, column: 1, jsonPointer: "" };
}

function terminal(deviceUid: string, terminalKey: string): TerminalId {
  return { deviceUid, terminalKey };
}

function terminalKey(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
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

function elementKey(id: ConductiveElementId): string {
  if (id.kind === "cable_conductor") {
    return `2\0${id.cableUid}\0${id.conductorId}`;
  }

  return `${id.kind === "wire" ? 0 : 1}\0${id.uid}`;
}

function copyElementId(id: ConductiveElementId): ConductiveElementId {
  return id.kind === "cable_conductor"
    ? {
        kind: "cable_conductor",
        cableUid: id.cableUid,
        conductorId: id.conductorId,
      }
    : { kind: id.kind, uid: id.uid };
}

function canonicalPair(
  endpoints: [TerminalId, TerminalId],
): [TerminalId, TerminalId] {
  return endpoints
    .map((endpoint) => ({ ...endpoint }))
    .sort(compareTerminalId) as [TerminalId, TerminalId];
}

function expansionFor(terminalIds: readonly TerminalId[]): ExpansionResult {
  return {
    deviceTypes: [],
    cableTypes: [],
    devices: [],
    cables: [],
    terminals: terminalIds.map((id) => ({ id: { ...id }, source: source() })),
    functions: [],
    internalRelations: [],
    gangedGroups: [],
  };
}

function graphFor(
  terminalIds: readonly TerminalId[],
  elements: readonly TestElement[],
  potentials: readonly IrPotentialDeclaration[] = [],
): GraphNormalizationResult {
  const wires: GraphNormalizationResult["wires"] = [];
  const jumpers: GraphNormalizationResult["jumpers"] = [];
  const cableConductors: GraphNormalizationResult["cableConductors"] = [];
  const sortedElements = [...elements].sort((left, right) =>
    compareText(elementKey(left.id), elementKey(right.id)),
  );
  const elementsByTerminal = new Map(
    terminalIds.map((id) => [terminalKey(id), [] as ConductiveElementId[]]),
  );

  for (const element of sortedElements) {
    const endpoints = canonicalPair(element.endpoints);
    for (const endpoint of endpoints) {
      elementsByTerminal
        .get(terminalKey(endpoint))!
        .push(copyElementId(element.id));
    }

    const resolvedEndpoints = endpoints.map((id) => ({
      terminal: { ...id },
      source: source(),
    })) as GraphNormalizationResult["wires"][number]["endpoints"];

    if (element.id.kind === "wire") {
      wires.push({
        uid: element.id.uid,
        designation: `W-${element.id.uid}`,
        aliases: [],
        endpoints: resolvedEndpoints,
        source: source(),
      });
    } else if (element.id.kind === "jumper") {
      jumpers.push({
        uid: element.id.uid,
        aliases: [],
        endpoints: resolvedEndpoints,
        source: source(),
      });
    } else {
      cableConductors.push({
        id: {
          cableUid: element.id.cableUid,
          conductorId: element.id.conductorId,
        },
        cableUid: element.id.cableUid,
        typeId: "test:cable",
        endpoints: resolvedEndpoints,
        typeConductor: null,
        source: source(),
      });
    }
  }

  const terminalIdsByDevice = new Map<string, TerminalId[]>();
  for (const id of terminalIds) {
    const members = terminalIdsByDevice.get(id.deviceUid) ?? [];
    members.push({ ...id });
    terminalIdsByDevice.set(id.deviceUid, members);
  }

  const conductorIdsByCable = new Map<
    string,
    { cableUid: string; conductorId: string }[]
  >();
  for (const conductor of cableConductors) {
    const members = conductorIdsByCable.get(conductor.cableUid) ?? [];
    members.push({ ...conductor.id });
    conductorIdsByCable.set(conductor.cableUid, members);
  }

  return {
    wires,
    jumpers,
    cableConductors,
    relations: [],
    potentials: potentials.map((potential) => structuredClone(potential)),
    indexes: {
      terminalIdsByDeviceUid: [...terminalIdsByDevice]
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, value]) => ({ key, value: value.sort(compareTerminalId) })),
      conductiveElementIdsByTerminal: [...elementsByTerminal]
        .map(([key, value]) => ({
          key: terminalIds.find((id) => terminalKey(id) === key)!,
          value: value.sort((left, right) =>
            compareText(elementKey(left), elementKey(right)),
          ),
        }))
        .sort((left, right) => compareTerminalId(left.key, right.key)),
      terminalIdsByConductiveElement: sortedElements.map((element) => ({
        key: copyElementId(element.id),
        value: canonicalPair(element.endpoints),
      })),
      conductorIdsByCableUid: [...conductorIdsByCable]
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, value]) => ({
          key,
          value: value.sort((left, right) =>
            compareText(left.conductorId, right.conductorId),
          ),
        })),
      objectRefByUid: [],
      objectRefByDesignation: [],
      relationEndpointsByUid: [],
      instanceRefsByTypeId: [],
    },
  };
}

function potential(
  uid: string,
  name: string,
  at: TerminalId,
  electrical: IrPotentialDeclaration["electrical"],
): IrPotentialDeclaration {
  return {
    uid,
    name,
    electrical: { ...electrical },
    aliases: [],
    terminal: { ...at },
    terminalSource: source(),
    source: source(),
  };
}

function runPipeline(project: LoadedProject): PipelineResult {
  const resolution = resolveLoadedProject(project);

  if (!resolution.ok) {
    throw new Error(
      `Fixture failed resolution: ${JSON.stringify(resolution.diagnostics)}`,
    );
  }

  expect(resolution.diagnostics).toEqual([]);
  const expansion = expandResolvedProject(resolution);
  const graph = normalizeProjectGraph(expansion, resolution);
  return {
    expansion,
    graph,
    netResult: deriveProjectNets(expansion, graph),
  };
}

describe("D5/D11 net derivation", () => {
  it("derives sorted branch, cycle, parallel, and singleton membership with exact content IDs", () => {
    const a = terminal(UID_A, "T.1");
    const b = terminal(UID_B, "T/2");
    const c = terminal(UID_C, "T:3");
    const d = terminal(UID_D, "D");
    const elements: TestElement[] = [
      {
        id: {
          kind: "cable_conductor",
          cableUid: "40000000-0000-4000-8000-000000000001",
          conductorId: "parallel",
        },
        endpoints: [b, a],
      },
      {
        id: { kind: "wire", uid: "30000000-0000-4000-8000-000000000002" },
        endpoints: [c, a],
      },
      {
        id: {
          kind: "jumper",
          uid: "20000000-0000-4000-8000-000000000001",
        },
        endpoints: [c, b],
      },
      {
        id: { kind: "wire", uid: "30000000-0000-4000-8000-000000000001" },
        endpoints: [a, b],
      },
    ];
    const expansion = expansionFor([d, c, a, b]);
    const result = deriveProjectNets(
      expansion,
      graphFor([d, c, a, b], elements),
    );
    const connected = result.nets.find(({ terminalIds }) =>
      terminalIds.some(({ deviceUid }) => deviceUid === UID_A),
    )!;
    const singleton = result.nets.find(({ terminalIds }) =>
      terminalIds.some(({ deviceUid }) => deviceUid === UID_D),
    )!;

    expect(connected).toEqual({
      id: "net:sha256:b938e6f9964701f13c3708db3be42d4deab8a62305c41d2471d3d9a9ba18e3e1",
      terminalIds: [a, b, c],
      conductiveElementIds: [
        { kind: "wire", uid: "30000000-0000-4000-8000-000000000001" },
        { kind: "wire", uid: "30000000-0000-4000-8000-000000000002" },
        { kind: "jumper", uid: "20000000-0000-4000-8000-000000000001" },
        {
          kind: "cable_conductor",
          cableUid: "40000000-0000-4000-8000-000000000001",
          conductorId: "parallel",
        },
      ],
      potentialUids: [],
    });
    expect(singleton).toEqual({
      id: "net:sha256:bd60f1998a902fa70cf28c25de6763a069c6f239f790573d842e4bb84fff09f0",
      terminalIds: [d],
      conductiveElementIds: [],
      potentialUids: [],
    });
    expect(result.nets.map(({ id }) => id)).toEqual(
      result.nets.map(({ id }) => id).sort(compareText),
    );
    expect(
      result.nets.every(({ id }) => /^net:sha256:[0-9a-f]{64}$/.test(id)),
    ).toBe(true);
  });

  it("keeps hashes stable across traversal and endpoint order but changes them with connectivity", () => {
    const a = terminal(UID_A, "T.1");
    const b = terminal(UID_B, "T/2");
    const c = terminal(UID_C, "T:3");
    const elements: TestElement[] = [
      {
        id: { kind: "wire", uid: "30000000-0000-4000-8000-000000000001" },
        endpoints: [a, b],
      },
      {
        id: {
          kind: "jumper",
          uid: "20000000-0000-4000-8000-000000000001",
        },
        endpoints: [b, c],
      },
    ];
    const first = deriveProjectNets(
      expansionFor([a, b, c]),
      graphFor([a, b, c], elements),
    );
    const reordered = deriveProjectNets(
      expansionFor([c, a, b]),
      graphFor(
        [c, a, b],
        [...elements].reverse().map((element) => ({
          ...element,
          endpoints: [...element.endpoints].reverse() as [
            TerminalId,
            TerminalId,
          ],
        })),
      ),
    );
    const disconnected = deriveProjectNets(
      expansionFor([a, b, c]),
      graphFor([a, b, c], [elements[0]!]),
    );

    expect(reordered.nets).toEqual(first.nets);
    expect(disconnected.nets).toHaveLength(2);
    expect(disconnected.nets.map(({ id }) => id)).not.toContain(
      first.nets[0]!.id,
    );
  });

  it("gives every materialized terminal exactly one complete terminal-to-net index entry", () => {
    const terminalIds = [
      terminal(UID_A, "1"),
      terminal(UID_A, "2"),
      terminal(UID_B, "1"),
      terminal(UID_C, "1"),
    ];
    const result = deriveProjectNets(
      expansionFor(terminalIds),
      graphFor(terminalIds, [
        {
          id: { kind: "wire", uid: "30000000-0000-4000-8000-000000000001" },
          endpoints: [terminalIds[0]!, terminalIds[2]!],
        },
      ]),
    );

    expect(result.indexes.netIdByTerminal).toHaveLength(terminalIds.length);
    expect(
      new Set(result.indexes.netIdByTerminal.map(({ key }) => terminalKey(key)))
        .size,
    ).toBe(terminalIds.length);
    expect(
      result.indexes.netIdByTerminal.map(({ key }) => terminalKey(key)),
    ).toEqual([...terminalIds].sort(compareTerminalId).map(terminalKey));

    for (const { key, value } of result.indexes.netIdByTerminal) {
      expect(
        result.nets.filter(
          (net) =>
            net.id === value &&
            net.terminalIds.some(
              (terminalId) => terminalKey(terminalId) === terminalKey(key),
            ),
        ),
      ).toHaveLength(1);
    }
  });

  it("does not treat functions, internal relations, gang groups, or project relations as conductive", () => {
    const terminalIds = [
      terminal(UID_A, "1"),
      terminal(UID_A, "2"),
      terminal(UID_A, "3"),
      terminal(UID_A, "4"),
    ];
    const expansion = expansionFor(terminalIds);
    expansion.functions = [
      {
        id: { deviceUid: UID_A, functionKey: "contact" },
        kind: "contact",
        normal_state: "closed",
        terminals: [terminalIds[0]!, terminalIds[1]!],
        source: source(),
      },
      {
        id: { deviceUid: UID_A, functionKey: "channel" },
        kind: "channel",
        direction: "input",
        terminals: [terminalIds[2]!, terminalIds[3]!],
        source: source(),
      },
    ];
    expansion.internalRelations = [
      ...(["feeds_internal", "actuates", "trips", "ganged_with"] as const).map(
        (verb) => ({
          deviceUid: UID_A,
          verb,
          from: { deviceUid: UID_A, functionKey: "contact" },
          to: { deviceUid: UID_A, functionKey: "channel" },
          sourceOrigins: [source()],
        }),
      ),
    ];
    expansion.gangedGroups = [
      {
        id: "gang:sha256:test",
        functionIds: expansion.functions.map(({ id }) => ({ ...id })),
      },
    ];
    const graph = graphFor(terminalIds, []);
    graph.relations = [
      {
        uid: "50000000-0000-4000-8000-000000000001",
        verb: "actuates",
        fromDeviceUid: UID_A,
        toDeviceUid: UID_B,
        aliases: [],
        fromSource: source(),
        toSource: source(),
        source: source(),
      },
    ];

    const result = deriveProjectNets(expansion, graph);
    expect(result.nets).toHaveLength(terminalIds.length);
    expect(
      result.nets.every(
        ({ terminalIds: members, conductiveElementIds }) =>
          members.length === 1 && conductiveElementIds.length === 0,
      ),
    ).toBe(true);
  });
});

describe("D12 potential propagation", () => {
  it("propagates across wire, jumper, and cable paths while retaining contradictory declarations", () => {
    const a = terminal(UID_A, "A");
    const b = terminal(UID_B, "B");
    const c = terminal(UID_C, "C");
    const d = terminal(UID_D, "D");
    const e = terminal(UID_E, "E");
    const terminalIds = [e, d, c, b, a];
    const declarations = [
      potential("60000000-0000-4000-8000-000000000003", "SINGLETON", e, {
        nominal_voltage: 5,
        voltage_type: "DC",
        polarity: "positive",
      }),
      potential("60000000-0000-4000-8000-000000000002", "CONTRADICTORY-AC", d, {
        nominal_voltage: 120,
        voltage_type: "AC",
        polarity: "line",
        current: 2,
        power: 240,
        frequency: 60,
      }),
      potential("60000000-0000-4000-8000-000000000001", "+24VDC", a, {
        nominal_voltage: 24,
        voltage_type: "DC",
        polarity: "positive",
        current: 10,
        power: 240,
        frequency: 0,
      }),
    ];
    const graph = graphFor(
      terminalIds,
      [
        {
          id: { kind: "wire", uid: "70000000-0000-4000-8000-000000000001" },
          endpoints: [b, a],
        },
        {
          id: {
            kind: "jumper",
            uid: "70000000-0000-4000-8000-000000000002",
          },
          endpoints: [c, b],
        },
        {
          id: {
            kind: "cable_conductor",
            cableUid: "70000000-0000-4000-8000-000000000003",
            conductorId: "1",
          },
          endpoints: [d, c],
        },
      ],
      declarations,
    );
    const result = deriveProjectNets(expansionFor(terminalIds), graph);
    const dc = result.potentials.find(({ name }) => name === "+24VDC")!;
    const contradictory = result.potentials.find(
      ({ name }) => name === "CONTRADICTORY-AC",
    )!;
    const singleton = result.potentials.find(
      ({ name }) => name === "SINGLETON",
    )!;

    expect(dc.netId).toBe(contradictory.netId);
    expect(dc.terminal).toEqual(a);
    expect(contradictory.terminal).toEqual(d);
    expect(dc.electrical).toEqual(declarations[2]!.electrical);
    expect(contradictory.electrical).toEqual(declarations[1]!.electrical);
    expect(
      result.nets.find(({ id }) => id === dc.netId)?.potentialUids,
    ).toEqual([
      "60000000-0000-4000-8000-000000000001",
      "60000000-0000-4000-8000-000000000002",
    ]);
    expect(singleton.netId).not.toBe(dc.netId);
    expect(result.nets.find(({ id }) => id === singleton.netId)).toMatchObject({
      terminalIds: [e],
      potentialUids: [singleton.uid],
    });
    expect(
      result.nets.find(({ id }) => id === dc.netId)?.potentialUids,
    ).not.toContain(singleton.uid);
  });
});

describe("load to nets pipeline", () => {
  it("exposes a complete direct pipeline with singleton nets and a total net index", () => {
    const compiled = runPipeline(motorStarter);

    expect(compiled.netResult.nets).toHaveLength(31);
    expect(
      compiled.netResult.nets.filter(
        ({ terminalIds, conductiveElementIds }) =>
          terminalIds.length === 1 && conductiveElementIds.length === 0,
      ),
    ).toHaveLength(11);
    expect(compiled.netResult.potentials).toHaveLength(4);
    expect(compiled.netResult.indexes.netIdByTerminal).toHaveLength(
      compiled.expansion.terminals.length,
    );
    expect(
      new Set(
        compiled.netResult.indexes.netIdByTerminal.map(({ key }) =>
          terminalKey(key),
        ),
      ).size,
    ).toBe(compiled.expansion.terminals.length);
  });

  it("keeps semantic net IDs stable when objects move between authored files and orders", () => {
    const baseline = runPipeline(motorStarter).netResult;
    const reordered = structuredClone(motorStarter);
    const objects = reordered.sources
      .flatMap(({ value }) => value.objects)
      .reverse();
    reordered.sources.reverse();
    for (const sourceDocument of reordered.sources) {
      sourceDocument.value.objects = [];
    }
    for (const [index, object] of objects.entries()) {
      reordered.sources[index % reordered.sources.length]!.value.objects.push(
        object,
      );
    }

    const changed = runPipeline(reordered).netResult;
    expect(changed.nets).toEqual(baseline.nets);
    expect(changed.indexes.netIdByTerminal).toEqual(
      baseline.indexes.netIdByTerminal,
    );
  });

  it("successfully carries contradictory authored declarations onto one compiled net", () => {
    const changed = structuredClone(motorStarter);
    const potentials = changed.sources
      .flatMap(({ value }) => value.objects)
      .filter((object) => object.kind === "potential");
    const positive = potentials.find(({ name }) => name === "+24VDC");
    const contradictory = potentials.find(({ name }) => name === "0VDC");

    if (positive?.kind !== "potential" || contradictory?.kind !== "potential") {
      throw new Error("Expected motor-starter potentials were not found.");
    }

    contradictory.at = { ...positive.at };
    contradictory.name = "CONTRADICTORY-120VAC";
    contradictory.electrical = {
      nominal_voltage: 120,
      voltage_type: "AC",
      polarity: "line",
      frequency: 60,
    };

    const compiled = runPipeline(changed).netResult;
    const first = compiled.potentials.find(({ uid }) => uid === positive.uid)!;
    const second = compiled.potentials.find(
      ({ uid }) => uid === contradictory.uid,
    )!;
    const net = compiled.nets.find(({ id }) => id === first.netId)!;

    expect(second.netId).toBe(first.netId);
    expect(second).toMatchObject({
      name: "CONTRADICTORY-120VAC",
      electrical: {
        nominal_voltage: 120,
        voltage_type: "AC",
        polarity: "line",
        frequency: 60,
      },
    });
    expect(net.potentialUids).toEqual(
      [positive.uid, contradictory.uid].sort(compareText),
    );
  });
});
