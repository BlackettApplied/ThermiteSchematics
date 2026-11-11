import { expect } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareCircuitView } from "../../render/src/circuit.js";
import { renderSchematic } from "../../render/src/renderer.js";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import {
  circuitMark,
  emitCircuitMark,
} from "../../render/src/symbols/circuit.js";
import { isolatedMachine } from "./machine-fixtures.js";
import matrix from "./fixtures/machine-render-matrix.json";

type Row = (typeof matrix)[number];
type Flow = "left-to-right" | "top-to-bottom";
// P4's clone method: preserve physical identities and replace only the type ID.
export function cloneMachineType(ir: ElectricalIr, id: string) {
  const next = structuredClone(ir);
  const type = next.deviceTypes.find((t) => t.id === id);
  const index = next.indexes.instanceRefsByTypeId.find((e) => e.key === id);
  if (!type || !index) throw Error(`Missing type/index: ${id}`);
  type.id = id.replace("core:", "local:");
  for (const d of next.devices) if (d.typeId === id) d.typeId = type.id;
  index.key = type.id;
  return next;
}

function circuitRequest(type: any, row: Row, flow: Flow) {
  const cable = type.kind === "cable_type";
  const functions = cable
    ? ["TB1", "TB2"].map((value) => ({
        device: { by: "designation" as const, value },
        key: "terminal1",
      }))
    : Object.entries(type.functions)
        .filter(([, f]: any) => f.kind !== "mechanism")
        .map(([key]) => ({
          device: { by: "designation" as const, value: "DUT" },
          key,
        }));
  return {
    format: "circuit-view-request/0.1" as const,
    title: row.type,
    flow,
    groups: [
      {
        id: "interface",
        label: "Generic interface",
        functions,
        conductors: cable
          ? type.conductors.map((c: any) => `CBL1/${c.id}`)
          : [],
      },
    ],
  };
}

async function circuitGap(
  ir: ElectricalIr,
  type: any,
  row: Row,
  request: ReturnType<typeof circuitRequest>,
) {
  const gap = row.circuitGap;
  if (!gap) throw Error("Missing gap pin");
  const expected = {
    code: gap.code,
    reason: gap.reason,
    details: { reason: gap.detailsReason },
    unsupported: {
      designation: "DUT",
      typeId: type.id,
      profile: type.symbol,
      functionKey: gap.functionKey,
      family: "circuit",
    },
  };
  await expect(prepareCircuitView(ir, request)).rejects.toMatchObject({
    error: expected,
  });
  await expect(
    prepareCircuitView(cloneMachineType(ir, type.id), request),
  ).rejects.toMatchObject({
    error: {
      ...expected,
      unsupported: {
        ...expected.unsupported,
        typeId: type.id.replace("core:", "local:"),
      },
    },
  });
  const packet = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    views: [request],
  });
  expect(packet).toMatchObject({ ok: false, error: expected });
}

async function circuitFunctions(
  ir: ElectricalIr,
  type: any,
  request: ReturnType<typeof circuitRequest>,
) {
  const circuit = await prepareCircuitView(ir, request);
  const cable = type.kind === "cable_type";
  const dut = ir.devices.find((d) => d.designation === "DUT");
  const expected = ir.functions.filter((f) =>
    cable
      ? f.id.functionKey === "terminal1"
      : f.id.deviceUid === dut?.uid && f.kind !== "mechanism",
  );
  expect(circuit.groups.flatMap((g) => g.coverage.functionIds).sort()).toEqual(
    expected
      .map((f) => JSON.stringify([f.id.deviceUid, f.id.functionKey]))
      .sort(),
  );
  if (!cable) {
    const irType = ir.deviceTypes.find((t) => t.id === type.id);
    if (!irType) throw Error(`Missing type: ${type.id}`);
    for (const f of expected) {
      const mark = circuitMark(irType, f);
      expect(
        emitCircuitMark(mark, request.flow === "top-to-bottom", 1),
      ).toContain(`data-circuit-mark="${mark}"`);
    }
    const cloned = await prepareCircuitView(
      cloneMachineType(ir, type.id),
      request,
    );
    expect(
      JSON.stringify(cloned).replaceAll(
        type.id.replace("core:", "local:"),
        type.id,
      ) === JSON.stringify(circuit),
    ).toBe(true);
  } else {
    const conductors = await renderSchematic(ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "CBL1" },
      intent: { kind: "conductors" },
      flow: request.flow,
    });
    expect(conductors.ok, JSON.stringify(conductors.ok ? {} : conductors)).toBe(
      true,
    );
  }
}

export async function probeMachineCircuit(type: any, row: Row, flow: Flow) {
  const fixture = await isolatedMachine(type);
  try {
    expect(fixture.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
    const request = circuitRequest(type, row, flow);
    if (row.circuitGap) return await circuitGap(fixture.ir, type, row, request);
    await circuitFunctions(fixture.ir, type, request);
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      views: [request],
    });
    expect(packet.ok, JSON.stringify(packet.ok ? {} : packet)).toBe(true);
  } finally {
    await fixture.dispose();
  }
}
