import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareCircuitView } from "../../render/src/circuit.js";
import { prepareSignalLoopDrawing } from "../../render/src/signal-loop.js";
import { cloneMachineType } from "./machine-circuit.js";

type Flow = "left-to-right" | "top-to-bottom";
export async function rm3CircuitViews(ir: ElectricalIr, flow: Flow) {
  const views = [];
  const expected: string[] = [];
  for (const device of ir.devices.filter(
    (d) => d.typeId !== "core:transmitter-2wire-4-20ma",
  )) {
    const functions = ir.functions.filter(
      (f) => f.id.deviceUid === device.uid && f.kind !== "mechanism",
    );
    const request = {
      format: "circuit-view-request/0.1" as const,
      title: device.designation,
      flow,
      groups: [
        {
          id: "interface",
          label: device.designation,
          functions: functions.map((f) => ({
            device: { by: "designation" as const, value: device.designation },
            key: f.id.functionKey,
          })),
          conductors: [],
        },
      ],
    };
    const circuit = await prepareCircuitView(ir, request);
    const ids = functions
      .map((f) => JSON.stringify([device.uid, f.id.functionKey]))
      .sort();
    expect(
      circuit.groups.flatMap((g) => g.coverage.functionIds).sort(),
    ).toEqual(ids);
    expected.push(...ids);
    views.push(request);
  }
  return { views, expected };
}

export async function rm3LoopView(ir: ElectricalIr, root: string, flow: Flow) {
  const request = {
    ...JSON.parse(await readFile(join(root, "loop.request.json"), "utf8")),
    flow,
  };
  const loop = await prepareSignalLoopDrawing(ir, request);
  expect(loop.references.map((r) => r.designation).sort()).toEqual([
    "PLC1",
    "TB1",
    "TX1",
  ]);
  expect(loop.content.match(/data-loop-conductor=/g)).toHaveLength(4);
  const clone = await prepareSignalLoopDrawing(
    cloneMachineType(ir, "core:transmitter-2wire-4-20ma"),
    request,
  );
  expect(clone).toEqual(loop);
  return request;
}
