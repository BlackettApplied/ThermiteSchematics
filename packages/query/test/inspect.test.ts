import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createQueryEngine,
  serializeQueryResult,
  type InspectResult,
} from "../src/index.js";
import { createSelfLoopIr } from "./fixtures.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
let motorIr: ElectricalIr;

beforeAll(async () => {
  const result = await compileProject(
    join(repositoryRoot, "examples", "motor-starter"),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  motorIr = result.ir;
});

function inspect(
  ir: ElectricalIr,
  selector: Parameters<ReturnType<typeof createQueryEngine>["inspect"]>[0],
): InspectResult {
  const result = createQueryEngine(ir).inspect(selector);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("D6 inspection primitive", () => {
  it("returns an exact singleton device projection and deduplicates self-loop incidence", () => {
    expect(
      inspect(createSelfLoopIr("shared"), {
        by: "designation",
        value: "DEV.1",
      }),
    ).toEqual({
      command: "inspect",
      object: {
        kind: "device",
        uid: "device-1",
        designation: "DEV.1",
        description: "Loop device",
        aliases: ["a", "z"],
        typeId: "type:device",
        terminals: [
          {
            id: { deviceUid: "device-1", terminalKey: "T.1" },
            deviceDesignation: "DEV.1",
            display: "DEV.1.T.1",
            role: "loop",
            rating: { voltage_type: "DC", nominal_voltage: 24 },
            connectionPolicy: "shared",
            net: { id: "net:self-loop", potentials: [] },
            elements: [
              {
                kind: "wire",
                uid: "wire-1",
                designation: "W.1",
                display: "W.1",
              },
            ],
          },
        ],
        functions: [],
        gangedGroups: [],
        internalRelations: [],
        projectRelations: [],
      },
    });
  });

  it("returns an exact self-loop wire projection with equal endpoints", () => {
    expect(
      inspect(createSelfLoopIr(), { by: "designation", value: "W.1" }),
    ).toEqual({
      command: "inspect",
      object: {
        kind: "wire",
        uid: "wire-1",
        designation: "W.1",
        aliases: [],
        endpoints: [
          {
            id: { deviceUid: "device-1", terminalKey: "T.1" },
            deviceDesignation: "DEV.1",
            display: "DEV.1.T.1",
            role: "loop",
            rating: { voltage_type: "DC", nominal_voltage: 24 },
          },
          {
            id: { deviceUid: "device-1", terminalKey: "T.1" },
            deviceDesignation: "DEV.1",
            display: "DEV.1.T.1",
            role: "loop",
            rating: { voltage_type: "DC", nominal_voltage: 24 },
          },
        ],
        net: { id: "net:self-loop", potentials: [] },
      },
    });
  });

  it("covers all six discriminants with their exact per-kind payload fields", () => {
    const wire = inspect(motorIr, {
      by: "designation",
      value: "W-PWR-007",
    }).object;
    const jumper = inspect(motorIr, {
      by: "designation",
      value: "JP1",
    }).object;
    const cable = inspect(motorIr, {
      by: "designation",
      value: "CBL1",
    }).object;
    const relation = inspect(motorIr, {
      by: "designation",
      value: "REL-CONTROLS-001",
    }).object;
    const potentialRecord = motorIr.potentials.find(
      ({ name }) => name === "+24VDC",
    )!;
    const potential = inspect(motorIr, {
      by: "uid",
      value: potentialRecord.uid,
    }).object;

    expect(wire).toMatchObject({
      kind: "wire",
      designation: "W-PWR-007",
      properties: { label: "L1-K1-OL1", size: "10AWG", color: "brown" },
      endpoints: [
        { deviceDesignation: "K1", display: "K1.2/T1" },
        { deviceDesignation: "OL1", display: "OL1.1/L1" },
      ],
      net: { potentials: [] },
    });
    expect(Object.keys(wire)).toEqual([
      "kind",
      "uid",
      "designation",
      "aliases",
      "properties",
      "endpoints",
      "net",
    ]);

    expect(jumper).toMatchObject({
      kind: "jumper",
      designation: "JP1",
      endpoints: [{ display: "TB1.1" }, { display: "TB1.2" }],
      net: { potentials: [{ name: "+24VDC" }] },
    });
    expect(Object.keys(jumper)).toEqual([
      "kind",
      "uid",
      "designation",
      "description",
      "aliases",
      "endpoints",
      "net",
    ]);

    const cableRecord = motorIr.cables.find(
      ({ designation }) => designation === "CBL1",
    )!;
    expect(cable).toEqual({
      kind: "cable",
      uid: cableRecord.uid,
      designation: "CBL1",
      description: cableRecord.description,
      aliases: [],
      typeId: "core:cable-2pair-shielded",
      cableType: {
        id: "core:cable-2pair-shielded",
        shield: true,
        construction: {
          conductor_material: "stranded copper",
          jacket_material: "PVC",
          outer_diameter: "8 mm",
          shield_construction: "overall foil shield with drain wire",
        },
      },
      conductorCount: 4,
      conductorIds: ["1+", "1-", "2+", "2-"].map((conductorId) => ({
        cableUid: cableRecord.uid,
        conductorId,
      })),
    });

    expect(relation).toMatchObject({
      kind: "relation",
      designation: "REL-CONTROLS-001",
      verb: "controls",
      from: { kind: "device", designation: "PLC1" },
      to: { kind: "device", designation: "K1" },
    });
    expect(Object.keys(relation)).toEqual([
      "kind",
      "uid",
      "designation",
      "description",
      "aliases",
      "verb",
      "from",
      "to",
    ]);

    expect(potential).toEqual({
      kind: "potential",
      uid: potentialRecord.uid,
      aliases: [],
      name: "+24VDC",
      electrical: {
        nominal_voltage: 24,
        voltage_type: "DC",
        polarity: "positive",
      },
      terminal: expect.objectContaining({
        deviceDesignation: "PS1",
        display: "PS1.+",
      }),
      net: expect.objectContaining({
        potentials: [
          expect.objectContaining({ uid: potentialRecord.uid, name: "+24VDC" }),
        ],
      }),
    });
  });

  it("projects functions, deterministic gang groups, internal relations, and project relations", () => {
    const result = inspect(motorIr, {
      by: "designation",
      value: "K1",
    });
    if (result.object.kind !== "device") throw new Error("Expected device.");

    expect(result.object.terminals.map(({ id }) => id.terminalKey)).toEqual([
      "1/L1",
      "13",
      "14",
      "2/T1",
      "3/L2",
      "4/T2",
      "5/L3",
      "6/T3",
      "A1",
      "A2",
    ]);
    expect(result.object.functions.map(({ key }) => key)).toEqual([
      "aux13",
      "coil",
      "pole1",
      "pole2",
      "pole3",
    ]);
    expect(result.object.functions[0]).toMatchObject({
      key: "aux13",
      kind: "contact",
      normalState: "open",
    });
    expect(result.object.functions[1]).not.toHaveProperty("normalState");
    expect(result.object.functions[1]).not.toHaveProperty("direction");
    expect(result.object.gangedGroups).toEqual([
      {
        id: "gang:sha256:5773084aeee691fec9a44d5d5b388662b42cb5d85e50af67ea24b559d6ec928a",
        functionKeys: ["pole1", "pole2", "pole3"],
      },
    ]);
    expect(result.object.internalRelations).toHaveLength(6);
    expect(result.object.internalRelations[0]).toEqual({
      verb: "actuates",
      fromFunctionKey: "coil",
      toFunctionKey: "aux13",
    });
    expect(result.object.projectRelations).toEqual([
      expect.objectContaining({
        direction: "incoming",
        otherDevice: expect.objectContaining({ designation: "PLC1" }),
        relation: expect.objectContaining({
          designation: "REL-CONTROLS-001",
          display: "REL-CONTROLS-001",
          verb: "controls",
        }),
      }),
    ]);
  });

  it("omits absent metadata and applies undesignated jumper/relation fallbacks", () => {
    const ir = structuredClone(motorIr);
    const jumper = ir.jumpers[0]!;
    const relation = ir.relations[0]!;
    const jumperDesignation = jumper.designation!;
    const relationDesignation = relation.designation!;
    delete jumper.designation;
    delete relation.designation;
    ir.indexes.objectRefByDesignation =
      ir.indexes.objectRefByDesignation.filter(
        ({ key }) => key !== jumperDesignation && key !== relationDesignation,
      );

    const engine = createQueryEngine(ir);
    const jumperResult = engine.inspect({ by: "uid", value: jumper.uid });
    const relationResult = engine.inspect({ by: "uid", value: relation.uid });
    if (!jumperResult.ok || !relationResult.ok) {
      throw new Error("Expected undesignated inspection results.");
    }
    expect(jumperResult.value.object).not.toHaveProperty("designation");
    expect(relationResult.value.object).not.toHaveProperty("designation");

    const endpointDeviceUid = jumper.endpoints[0].terminal.deviceUid;
    const endpointDevice = engine.inspect({
      by: "uid",
      value: endpointDeviceUid,
    });
    if (!endpointDevice.ok || endpointDevice.value.object.kind !== "device") {
      throw new Error("Expected jumper endpoint device.");
    }
    expect(
      endpointDevice.value.object.terminals
        .flatMap(({ elements }) => elements)
        .find(
          (element) => element.kind === "jumper" && element.uid === jumper.uid,
        ),
    ).toMatchObject({ display: `jumper:${jumper.uid}` });

    const fromDevice = engine.inspect({
      by: "uid",
      value: relation.fromDeviceUid,
    });
    if (!fromDevice.ok || fromDevice.value.object.kind !== "device") {
      throw new Error("Expected relation endpoint device.");
    }
    expect(
      fromDevice.value.object.projectRelations.find(
        ({ relation: view }) => view.uid === relation.uid,
      )?.relation.display,
    ).toBe(`relation:${relation.uid}`);

    const cableType = ir.cableTypes[0]!;
    delete cableType.shield;
    delete cableType.construction;
    const cable = ir.cables.find(({ typeId }) => typeId === cableType.id)!;
    const cableResult = inspect(ir, { by: "uid", value: cable.uid });
    if (cableResult.object.kind !== "cable") throw new Error("Expected cable.");
    expect(cableResult.object.cableType).toEqual({ id: cableType.id });
  });

  it("is deterministic under consumed collection shuffles and never dumps SourceRefs", () => {
    const baseline = inspect(motorIr, { by: "designation", value: "K1" });
    const shuffled = structuredClone(motorIr);
    shuffled.terminals.reverse();
    shuffled.functions.reverse();
    shuffled.internalRelations.reverse();
    shuffled.gangedGroups.reverse();
    shuffled.relations.reverse();
    shuffled.potentials.reverse();
    shuffled.nets.reverse();
    for (const group of shuffled.gangedGroups) group.functionIds.reverse();
    for (const fn of shuffled.functions) fn.terminals.reverse();
    for (const value of Object.values(shuffled.indexes)) value.reverse();
    for (const entry of shuffled.indexes.terminalIdsByDeviceUid) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.conductiveElementIdsByTerminal) {
      entry.value.reverse();
    }

    const reordered = inspect(shuffled, {
      by: "designation",
      value: "K1",
    });
    expect(reordered).toEqual(baseline);
    expect(serializeQueryResult(reordered)).toBe(
      serializeQueryResult(baseline),
    );
    expect(serializeQueryResult(baseline)).not.toContain('"source"');
    expect(serializeQueryResult(baseline)).not.toContain('"sourceOrigins"');
  });

  it("copies nested inspection metadata and returns exact Q001", () => {
    const ir = structuredClone(motorIr);
    const engine = createQueryEngine(ir);
    const result = engine.inspect({ by: "designation", value: "CBL1" });
    if (!result.ok || result.value.object.kind !== "cable") {
      throw new Error("Expected cable inspection.");
    }
    const before = serializeQueryResult(result.value);
    const construction = result.value.object.cableType.construction!;
    (construction as Record<string, unknown>).jacket_material = "changed";
    expect(
      ir.cableTypes.find(({ id }) => id === result.value.object.typeId),
    ).not.toBeUndefined();
    expect(
      ir.cableTypes.find(({ id }) => id === result.value.object.typeId)!
        .construction?.jacket_material,
    ).toBe("PVC");
    expect(before).not.toBe(serializeQueryResult(result.value));

    expect(engine.inspect({ by: "designation", value: "missing" })).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: 'No project object has designation "missing".',
        input: "missing",
      },
    });
  });
});
