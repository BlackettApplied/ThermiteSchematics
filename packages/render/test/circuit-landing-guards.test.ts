import { beforeAll, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { readFile } from "node:fs/promises";
import * as engine from "../src/layout/elk-runtime.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { prepareCircuitView, type CircuitViewRequest } from "../src/circuit.js";
import { required } from "./fixtures.js";
let ir: ElectricalIr, request: CircuitViewRequest;
beforeAll(async () => {
  const c = await compileProject("examples/self-loop-labels");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  request = JSON.parse(
    await readFile("examples/self-loop-labels/packet.json", "utf8"),
  ).views[0];
});
function forge(graph: ElkNode) {
  const edge = required(graph.edges?.find((e) => e.id === "e1"));
  const node = required(
    graph.children?.find((n) => n.ports?.some((p) => p.id === edge.targets[0])),
  );
  const port = required(node.ports?.find((p) => p.id === "n1p2"));
  const section = required(edge.sections?.[0]);
  edge.targets = [port.id];
  section.endPoint = {
    x: required(node.x) + required(port.x),
    y: required(node.y) + required(port.y),
  };
  section.bendPoints = [
    { x: section.startPoint.x + 5, y: section.startPoint.y },
    { x: section.startPoint.x + 5, y: section.endPoint.y },
  ];
}
it.each(["missing", "detached", "forged"] as const)(
  "refuses a %s native conductor from ELK",
  async (kind) => {
    const create = engine.createElkEngine;
    const spy = vi.spyOn(engine, "createElkEngine").mockImplementation(() => {
      const elk = create(),
        layout = elk.layout.bind(elk);
      elk.layout = async (input, options) => {
        const graph = await layout(input, options);
        const e = required(graph.edges?.find((e) => e.id === "e1"));
        if (kind === "missing")
          graph.edges = graph.edges?.filter((p) => p !== e);
        else if (kind === "detached") required(e.sections?.[0]).endPoint.x -= 4;
        else forge(graph);
        return graph;
      };
      return elk;
    });
    try {
      await expect(prepareCircuitView(ir, request)).rejects.toThrow(
        kind === "missing"
          ? "incomplete conductor coverage"
          : "route endpoints moved away from their source terminals",
      );
    } finally {
      spy.mockRestore();
    }
  },
);
