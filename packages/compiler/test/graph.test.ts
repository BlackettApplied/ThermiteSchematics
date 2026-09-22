import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  expandResolvedProject,
  loadProject,
  normalizeProjectGraph,
  resolveLoadedProject,
  type ConductiveElementId,
  type ExpansionResult,
  type GraphNormalizationResult,
  type LoadedProject,
  type TerminalId,
} from "../src/index.js";

const motorStarterRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/motor-starter",
);
const expansionFixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/device-expansion",
);
const CABLE_UID = "c4c1bfdf-567a-4f6c-9e08-147342061afe";

interface NormalizedFixture {
  expansion: ExpansionResult;
  graph: GraphNormalizationResult;
}

let project: LoadedProject;
let fixture: NormalizedFixture;

beforeAll(async () => {
  const loaded = await loadProject(motorStarterRoot);

  if (!loaded.ok) {
    throw new Error(
      `Motor-starter fixture failed structural load: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }

  project = loaded.project;
  fixture = normalize(project);
});

function normalize(input: LoadedProject): NormalizedFixture {
  const resolution = resolveLoadedProject(input);

  if (!resolution.ok) {
    throw new Error(
      `Fixture failed resolution: ${JSON.stringify(resolution.diagnostics)}`,
    );
  }

  const expansion = expandResolvedProject(resolution);
  return {
    expansion,
    graph: normalizeProjectGraph(expansion, resolution),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function terminalKey(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
}

function conductiveKey(id: ConductiveElementId): string {
  if (id.kind === "cable_conductor") {
    return `2\0${id.cableUid}\0${id.conductorId}`;
  }

  return `${id.kind === "wire" ? 0 : 1}\0${id.uid}`;
}

function withoutProvenance(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutProvenance);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "source" &&
          key !== "fromSource" &&
          key !== "toSource" &&
          key !== "terminalSource",
      )
      .map(([key, member]) => [key, withoutProvenance(member)]),
  );
}

function deviceUid(designation: string): string {
  const device = fixture.expansion.devices.find(
    (candidate) => candidate.designation === designation,
  );

  if (device === undefined) {
    throw new Error(`Fixture device ${designation} not found.`);
  }

  return device.uid;
}

describe("D8-D11 conductive and project graph normalization", () => {
  it("normalizes every authored graph kind with resolved identities and provenance", () => {
    expect(fixture.graph.wires).toHaveLength(26);
    expect(fixture.graph.jumpers).toHaveLength(1);
    expect(fixture.graph.cableConductors).toHaveLength(4);
    expect(fixture.graph.relations).toHaveLength(2);
    expect(fixture.graph.potentials).toHaveLength(4);

    const conductor = fixture.graph.cableConductors.find(
      ({ id }) => id.cableUid === CABLE_UID && id.conductorId === "1+",
    );
    expect(conductor).toMatchObject({
      id: { cableUid: CABLE_UID, conductorId: "1+" },
      cableUid: CABLE_UID,
      typeId: "core:cable-2pair-shielded",
      typeConductor: {
        color: "black",
        size: "18AWG",
        source: {
          file: "@thermite/core-library/types/cable-2pair-shielded.json",
          jsonPointer: "/types/0/conductors/0",
        },
      },
      source: {
        file: "cables/field-cable.json",
        jsonPointer: "/objects/0/conductors/0",
      },
    });
    expect(conductor?.endpoints.map(({ terminal }) => terminal)).toEqual(
      [
        { deviceUid: deviceUid("TB1"), terminalKey: "2" },
        { deviceUid: deviceUid("JB1"), terminalKey: "X1.1" },
      ].sort((left, right) =>
        compareText(terminalKey(left), terminalKey(right)),
      ),
    );
    expect(
      Object.fromEntries(
        conductor?.endpoints.map(({ terminal, source }) => [
          terminal.deviceUid,
          source.jsonPointer,
        ]) ?? [],
      ),
    ).toEqual({
      [deviceUid("TB1")]: "/objects/0/conductors/0/endpoints/0",
      [deviceUid("JB1")]: "/objects/0/conductors/0/endpoints/1",
    });

    expect(
      fixture.graph.wires.find(
        ({ uid }) => uid === "e84a9629-373c-4946-8b48-184b7464d474",
      ),
    ).toMatchObject({
      designation: "W-FLD-001",
      aliases: [],
      properties: {
        label: "LS1-RETURN-PLC1-DI0",
        size: "18AWG",
        color: "violet",
      },
      source: {
        file: "connections/field-terminations.json",
        jsonPointer: "/objects/0",
      },
    });
    expect(fixture.graph.jumpers[0]).toMatchObject({
      designation: "JP1",
      aliases: [],
      description:
        "Distributes +24 VDC from TB1.1 to the LS1 cable feed at TB1.2",
    });

    const protects = fixture.graph.relations.find(
      ({ verb }) => verb === "protects",
    );
    expect(protects).toMatchObject({
      designation: "REL-PROTECTS-001",
      fromDeviceUid: deviceUid("CB1"),
      toDeviceUid: deviceUid("M1"),
      aliases: [],
      fromSource: { jsonPointer: "/objects/0/from" },
      toSource: { jsonPointer: "/objects/0/to" },
    });

    expect(
      fixture.graph.potentials.find(({ name }) => name === "+24VDC"),
    ).toMatchObject({
      aliases: [],
      electrical: {
        nominal_voltage: 24,
        voltage_type: "DC",
        polarity: "positive",
      },
      terminal: { deviceUid: deviceUid("PS1"), terminalKey: "+" },
      terminalSource: { jsonPointer: "/objects/0/at" },
    });
    expect(Object.hasOwn(fixture.graph.potentials[0]!, "netId")).toBe(false);
  });

  it("retains all allowed optional metadata in its normalized locations", () => {
    const changed = structuredClone(project);
    const objects = changed.sources.flatMap(({ value }) => value.objects);
    const wire = objects.find(
      (object) => object.kind === "wire" && object.designation === "W-FLD-001",
    );
    const jumper = objects.find((object) => object.kind === "jumper");
    const relation = objects.find((object) => object.kind === "relation");
    const potential = objects.find((object) => object.kind === "potential");

    if (
      wire?.kind !== "wire" ||
      jumper?.kind !== "jumper" ||
      relation?.kind !== "relation" ||
      potential?.kind !== "potential"
    ) {
      throw new Error("Expected graph fixture objects were not found.");
    }

    wire.description = "wire description";
    wire.aliases = ["WIRE-ALIAS"];
    jumper.aliases = ["JUMPER-ALIAS"];
    relation.aliases = ["RELATION-ALIAS"];
    potential.designation = "POT-DESIGNATION";
    potential.description = "potential description";
    potential.aliases = ["POTENTIAL-ALIAS"];

    const graph = normalize(changed).graph;
    expect(graph.wires.find(({ uid }) => uid === wire.uid)).toMatchObject({
      description: "wire description",
      aliases: ["WIRE-ALIAS"],
    });
    expect(
      graph.jumpers.find(({ uid }) => uid === jumper.uid)?.aliases,
    ).toEqual(["JUMPER-ALIAS"]);
    expect(
      graph.relations.find(({ uid }) => uid === relation.uid)?.aliases,
    ).toEqual(["RELATION-ALIAS"]);
    expect(
      graph.potentials.find(({ uid }) => uid === potential.uid),
    ).toMatchObject({
      designation: "POT-DESIGNATION",
      description: "potential description",
      aliases: ["POTENTIAL-ALIAS"],
    });
  });

  it("preserves unmatched authored conductor ids as independently addressable null metadata", () => {
    const changed = structuredClone(project);
    const cable = changed.sources
      .flatMap(({ value }) => value.objects)
      .find(({ uid }) => uid === CABLE_UID);

    if (cable?.kind !== "cable") {
      throw new Error("Fixture cable not found.");
    }

    cable.conductors[0]!.id = "unknown-authored-id";
    const resolution = resolveLoadedProject(changed);
    expect(resolution.ok).toBe(true);
    expect(resolution.diagnostics).toEqual([]);
    const expansion = expandResolvedProject(resolution);
    const graph = normalizeProjectGraph(expansion, resolution);

    expect(graph.cableConductors).toHaveLength(cable.conductors.length);
    expect(
      graph.cableConductors.find(
        ({ id }) => id.conductorId === "unknown-authored-id",
      ),
    ).toMatchObject({
      id: { cableUid: CABLE_UID, conductorId: "unknown-authored-id" },
      cableUid: CABLE_UID,
      typeId: "core:cable-2pair-shielded",
      typeConductor: null,
    });
    expect(
      graph.cableConductors.some(({ id }) => id.conductorId === "1+"),
    ).toBe(false);
    expect(
      graph.indexes.conductorIdsByCableUid.find(({ key }) => key === CABLE_UID)
        ?.value,
    ).toContainEqual({
      cableUid: CABLE_UID,
      conductorId: "unknown-authored-id",
    });
  });

  it("round-trips every pre-net D10 index in both directions without missing or dangling entries", () => {
    const { expansion, graph } = fixture;
    expect(graph.wires.map(({ uid }) => uid)).toEqual(
      graph.wires.map(({ uid }) => uid).sort(compareText),
    );
    expect(graph.jumpers.map(({ uid }) => uid)).toEqual(
      graph.jumpers.map(({ uid }) => uid).sort(compareText),
    );
    expect(
      graph.cableConductors.map(({ id }) =>
        JSON.stringify([id.cableUid, id.conductorId]),
      ),
    ).toEqual(
      graph.cableConductors
        .map(({ id }) => JSON.stringify([id.cableUid, id.conductorId]))
        .sort(compareText),
    );
    expect(graph.relations.map(({ uid }) => uid)).toEqual(
      graph.relations.map(({ uid }) => uid).sort(compareText),
    );
    expect(graph.potentials.map(({ uid }) => uid)).toEqual(
      graph.potentials.map(({ uid }) => uid).sort(compareText),
    );
    const primaryElements = [
      ...graph.wires.map((wire) => ({
        id: { kind: "wire" as const, uid: wire.uid },
        terminals: wire.endpoints.map(({ terminal }) => terminal),
      })),
      ...graph.jumpers.map((jumper) => ({
        id: { kind: "jumper" as const, uid: jumper.uid },
        terminals: jumper.endpoints.map(({ terminal }) => terminal),
      })),
      ...graph.cableConductors.map((conductor) => ({
        id: { kind: "cable_conductor" as const, ...conductor.id },
        terminals: conductor.endpoints.map(({ terminal }) => terminal),
      })),
    ].sort((left, right) =>
      compareText(conductiveKey(left.id), conductiveKey(right.id)),
    );
    const primaryElementByKey = new Map(
      primaryElements.map((record) => [conductiveKey(record.id), record]),
    );
    const primaryTerminalKeys = new Set(
      expansion.terminals.map(({ id }) => terminalKey(id)),
    );

    expect(new Set(primaryElements.map(({ id }) => id.kind))).toEqual(
      new Set(["wire", "jumper", "cable_conductor"]),
    );
    expect(graph.indexes.terminalIdsByConductiveElement).toHaveLength(
      primaryElements.length,
    );
    expect(
      graph.indexes.terminalIdsByConductiveElement.map(({ key }) =>
        conductiveKey(key),
      ),
    ).toEqual(primaryElements.map(({ id }) => conductiveKey(id)));

    for (const { key, value } of graph.indexes.terminalIdsByConductiveElement) {
      expect(value).toEqual(
        primaryElementByKey.get(conductiveKey(key))?.terminals,
      );
      expect(
        value.every((terminal) =>
          primaryTerminalKeys.has(terminalKey(terminal)),
        ),
      ).toBe(true);
    }

    expect(graph.indexes.conductiveElementIdsByTerminal).toHaveLength(
      expansion.terminals.length,
    );
    expect(
      graph.indexes.conductiveElementIdsByTerminal.map(({ key }) =>
        terminalKey(key),
      ),
    ).toEqual(expansion.terminals.map(({ id }) => terminalKey(id)));
    const expectedElementsByTerminal = new Map(
      expansion.terminals.map(({ id }) => [terminalKey(id), [] as string[]]),
    );

    for (const { id, terminals } of primaryElements) {
      for (const terminal of terminals) {
        expectedElementsByTerminal
          .get(terminalKey(terminal))!
          .push(conductiveKey(id));
      }
    }

    for (const { key, value } of graph.indexes.conductiveElementIdsByTerminal) {
      const expected = expectedElementsByTerminal
        .get(terminalKey(key))!
        .sort(compareText);
      expect(value.map(conductiveKey)).toEqual(expected);

      for (const element of value) {
        const reverse = graph.indexes.terminalIdsByConductiveElement.find(
          ({ key: candidate }) =>
            conductiveKey(candidate) === conductiveKey(element),
        );
        expect(reverse?.value).toContainEqual(key);
      }
    }

    expect(graph.indexes.terminalIdsByDeviceUid).toHaveLength(
      expansion.devices.length,
    );
    const indexedTerminalKeys = graph.indexes.terminalIdsByDeviceUid.flatMap(
      ({ key, value }) => {
        expect(value.every(({ deviceUid }) => deviceUid === key)).toBe(true);
        return value.map(terminalKey);
      },
    );
    expect(indexedTerminalKeys).toEqual(
      expansion.terminals.map(({ id }) => terminalKey(id)),
    );

    expect(graph.indexes.conductorIdsByCableUid).toHaveLength(
      expansion.cables.length,
    );
    expect(
      graph.indexes.conductorIdsByCableUid.flatMap(({ key, value }) => {
        expect(value.every(({ cableUid }) => cableUid === key)).toBe(true);
        return value.map(({ cableUid, conductorId }) =>
          JSON.stringify([cableUid, conductorId]),
        );
      }),
    ).toEqual(
      graph.cableConductors.map(({ id }) =>
        JSON.stringify([id.cableUid, id.conductorId]),
      ),
    );

    const sourceObjects = project.sources.flatMap(({ value }) => value.objects);
    expect(graph.indexes.objectRefByUid).toHaveLength(sourceObjects.length);
    expect(graph.indexes.objectRefByUid.map(({ key }) => key)).toEqual(
      sourceObjects.map(({ uid }) => uid).sort(compareText),
    );
    for (const { key, value } of graph.indexes.objectRefByUid) {
      const object = sourceObjects.find(({ uid }) => uid === key);
      expect(value).toEqual({ kind: object?.kind, uid: object?.uid });
    }

    const designated = sourceObjects
      .filter(
        (object): object is typeof object & { designation: string } =>
          typeof object.designation === "string",
      )
      .sort((left, right) => compareText(left.designation, right.designation));
    expect(graph.indexes.objectRefByDesignation).toEqual(
      designated.map((object) => ({
        key: object.designation,
        value: { kind: object.kind, uid: object.uid },
      })),
    );

    expect(graph.indexes.relationEndpointsByUid).toEqual(
      graph.relations.map((relation) => ({
        key: relation.uid,
        value: {
          fromDeviceUid: relation.fromDeviceUid,
          toDeviceUid: relation.toDeviceUid,
        },
      })),
    );
    const deviceUids = new Set(expansion.devices.map(({ uid }) => uid));
    expect(
      graph.indexes.relationEndpointsByUid.every(({ value }) =>
        [value.fromDeviceUid, value.toDeviceUid].every((uid) =>
          deviceUids.has(uid),
        ),
      ),
    ).toBe(true);

    expect(graph.indexes.instanceRefsByTypeId).toHaveLength(
      expansion.deviceTypes.length + expansion.cableTypes.length,
    );
    expect(graph.indexes.instanceRefsByTypeId.map(({ key }) => key)).toEqual(
      [...expansion.deviceTypes, ...expansion.cableTypes]
        .map(({ id }) => id)
        .sort(compareText),
    );
    const instanceByUid = new Map([
      ...expansion.devices.map((instance) => [instance.uid, instance] as const),
      ...expansion.cables.map((instance) => [instance.uid, instance] as const),
    ]);
    const indexedInstanceUids: string[] = [];
    for (const { key, value } of graph.indexes.instanceRefsByTypeId) {
      expect(value.map(({ uid }) => uid)).toEqual(
        value.map(({ uid }) => uid).sort(compareText),
      );
      for (const reference of value) {
        expect(instanceByUid.get(reference.uid)?.typeId).toBe(key);
        expect(instanceByUid.has(reference.uid)).toBe(true);
        indexedInstanceUids.push(reference.uid);
      }
    }
    expect(indexedInstanceUids.sort(compareText)).toEqual(
      [...instanceByUid.keys()].sort(compareText),
    );
  });

  it("includes required empty-array index entries", async () => {
    const loaded = await loadProject(expansionFixtureRoot);

    if (!loaded.ok) {
      throw new Error(
        `Expansion fixture failed structural load: ${JSON.stringify(loaded.diagnostics)}`,
      );
    }

    const changed = structuredClone(loaded.project);
    const source = changed.sources[0]!.value.objects;
    changed.sources[0]!.value.objects = source.filter(
      ({ uid }) =>
        uid !== "10000000-0000-4000-8000-000000000006" &&
        uid !== "10000000-0000-4000-8000-000000000008",
    );
    const emptyDevice = changed.sources[0]!.value.objects.find(
      ({ uid }) => uid === "10000000-0000-4000-8000-000000000005",
    );

    if (emptyDevice?.kind !== "device") {
      throw new Error("Expansion fixture empty device not found.");
    }

    emptyDevice.type = "expansion:unused";
    const normalized = normalize(changed);
    expect(
      normalized.graph.indexes.terminalIdsByDeviceUid.find(
        ({ key }) => key === emptyDevice.uid,
      )?.value,
    ).toEqual([]);
    expect(
      normalized.graph.indexes.conductorIdsByCableUid.find(
        ({ key }) => key === "10000000-0000-4000-8000-000000000007",
      )?.value,
    ).toEqual([]);
    expect(
      normalized.graph.indexes.instanceRefsByTypeId.find(
        ({ key }) => key === "expansion:all-kinds",
      )?.value,
    ).toEqual([]);
    expect(
      normalized.graph.indexes.conductiveElementIdsByTerminal.every(
        ({ value }) => value.length === 0,
      ),
    ).toBe(true);
  });

  it("is deterministic across reversed map and reference traversal order", () => {
    const resolution = resolveLoadedProject(project);
    const reversedResolution = {
      ...resolution,
      catalogs: {
        projectObjectsByUid: new Map(
          [...resolution.catalogs.projectObjectsByUid].reverse(),
        ),
        projectObjectsByDesignation: new Map(
          [...resolution.catalogs.projectObjectsByDesignation].reverse(),
        ),
        libraryTypesById: new Map(
          [...resolution.catalogs.libraryTypesById].reverse(),
        ),
      },
      instanceTypesByUid: new Map([...resolution.instanceTypesByUid].reverse()),
      deviceReferences: [...resolution.deviceReferences].reverse(),
      terminalReferences: [...resolution.terminalReferences].reverse(),
    };
    const reversedExpansion = expandResolvedProject(reversedResolution);
    const reversedGraph = normalizeProjectGraph(
      reversedExpansion,
      reversedResolution,
    );

    expect(reversedExpansion).toEqual(fixture.expansion);
    expect(reversedGraph).toEqual(fixture.graph);
  });

  it("is invariant to authored endpoint order apart from endpoint source refs", () => {
    const reversed = structuredClone(project);

    for (const object of reversed.sources.flatMap(
      ({ value }) => value.objects,
    )) {
      if (object.kind === "wire" || object.kind === "jumper") {
        object.endpoints = [object.endpoints[1], object.endpoints[0]];
      } else if (object.kind === "cable") {
        for (const conductor of object.conductors) {
          conductor.endpoints = [
            conductor.endpoints[1],
            conductor.endpoints[0],
          ];
        }
      }
    }

    const reversedGraph = normalize(reversed).graph;
    expect(reversedGraph.indexes).toEqual(fixture.graph.indexes);
    expect(withoutProvenance(reversedGraph)).toEqual(
      withoutProvenance(fixture.graph),
    );

    const wireUid = "e84a9629-373c-4946-8b48-184b7464d474";
    const originalWire = fixture.graph.wires.find(
      ({ uid }) => uid === wireUid,
    )!;
    const reversedWire = reversedGraph.wires.find(
      ({ uid }) => uid === wireUid,
    )!;
    expect(originalWire.endpoints.map(({ terminal }) => terminal)).toEqual(
      reversedWire.endpoints.map(({ terminal }) => terminal),
    );
    expect(
      originalWire.endpoints.map(({ source }) => source.jsonPointer),
    ).not.toEqual(
      reversedWire.endpoints.map(({ source }) => source.jsonPointer),
    );
  });
});
