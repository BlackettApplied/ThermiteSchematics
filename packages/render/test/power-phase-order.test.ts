import { beforeAll, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../src/renderer.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
import { compileCoreFixture, selectCoreSubgraph } from "./fixtures.js";
import { validatePresentationGraph } from "../src/presentation/validate.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});

const sequences = [
  ["SRC1", ["L1", "L2", "L3", "PE"]],
  ...["CB1", "K1", "OL1"].flatMap((device) => [
    [device, ["1/L1", "3/L2", "5/L3"]],
    [device, ["2/T1", "4/T2", "6/T3"]],
  ]),
  ["M1", ["U", "V", "W", "PE"]],
] as const;

function semanticProjection(drawing: PreparedSchematicDrawing) {
  return {
    ports: drawing.graph.nodes.flatMap((node) =>
      node.ports.map((p) => ({
        id: p.id,
        terminal: p.terminal,
        netId: p.netId,
      })),
    ),
    edges: drawing.graph.edges.map((e) => ({
      id: e.id,
      sourcePortId: e.sourcePortId,
      targetPortId: e.targetPortId,
      netId: e.netId,
      endpoints: e.endpoints,
      elementIds: e.elementIds,
    })),
    summary: drawing.summary,
  };
}

it("reads the synthetic starter's phases and PE in physical order at every pole end in both flows, without changing connections", async () => {
  const before = JSON.stringify(ir);
  const drawings: PreparedSchematicDrawing[] = [];
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const result = await prepareSchematicDrawing(ir, {
      format: "schematic-view-request/0.1",
      family: "power",
      root: { by: "designation", value: "M1" },
      flow,
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const drawing = result.value;
    drawings.push(drawing);
    const selected = selectCoreSubgraph(ir, "M1", "power", flow);
    validatePresentationGraph(ir, selected, drawing.graph);
    const invalid = structuredClone(drawing.graph);
    const header = invalid.nodes
      .flatMap((n) => (n.kind === "symbol" ? n.labels : []))
      .find((label) => label.role === "aggregate")!;
    header.width -= 1;
    expect(() => validatePresentationGraph(ir, selected, invalid)).toThrow(
      "width",
    );
    const ports = drawing.graph.nodes.flatMap((n) => n.ports);
    const portFor = (device: string, terminal: string) => {
      const uid = ir.devices.find((d) => d.designation === device)!.uid;
      return ports.find(
        (p) =>
          p.terminal.deviceUid === uid && p.terminal.terminalKey === terminal,
      )!;
    };
    const position = (device: string, terminal: string) =>
      drawing.layout.ports.find((p) => p.id === portFor(device, terminal).id)!;
    const axis = flow === "left-to-right" ? "y" : "x";
    for (const [device, terminals] of sequences) {
      const coordinates = terminals.map((key) => position(device, key)[axis]);
      for (let i = 1; i < coordinates.length; i++)
        expect(
          coordinates[i],
          `${flow}: ${device} ${terminals.join(",")}`,
        ).toBeGreaterThan(coordinates[i - 1]!);
    }
    for (const device of ["CB1", "K1", "OL1"]) {
      for (const [input, output] of [
        ["1/L1", "2/T1"],
        ["3/L2", "4/T2"],
        ["5/L3", "6/T3"],
      ]) {
        expect(position(device, input!)[axis]).toBe(
          position(device, output!)[axis],
        );
        // A device function is never an electrical short.
        expect(portFor(device, input!).netId).not.toBe(
          portFor(device, output!).netId,
        );
      }
    }
    expect(portFor("SRC1", "PE").netId).toBe(portFor("M1", "PE").netId);
    expect(
      new Set(["U", "V", "W", "PE"].map((key) => portFor("M1", key).netId))
        .size,
    ).toBe(4);
    for (const port of ports) {
      expect(
        ir.nets.find((n) => n.id === port.netId)!.terminalIds,
      ).toContainEqual(port.terminal);
    }
    for (const edge of drawing.graph.edges) {
      const wire = ir.wires.find((w) =>
        edge.elementIds.some((id) => id.kind === "wire" && id.uid === w.uid),
      )!;
      expect(edge.endpoints).toEqual(
        expect.arrayContaining(wire.endpoints.map((e) => e.terminal)),
      );
      for (const id of [edge.sourcePortId, edge.targetPortId])
        expect(ports.find((p) => p.id === id)!.netId).toBe(edge.netId);
    }
  }
  expect(semanticProjection(drawings[1]!)).toEqual(
    semanticProjection(drawings[0]!),
  );
  expect(JSON.stringify(ir)).toBe(before);
}, 30000);
