import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { lengths } from "./helpers/route-quality.js";

function edges(node: ElkNode): ElkExtendedEdge[] {
  return [...(node.edges ?? []), ...(node.children ?? []).flatMap(edges)];
}
function internal(edge: ElkExtendedEdge) {
  return (edge.sections ?? []).flatMap((s) =>
    lengths([s.startPoint, ...(s.bendPoints ?? []), s.endPoint])
      .slice(1, -1)
      .map((n) => n * 0.25),
  );
}
function ns(node: ElkNode) {
  if (!node.children?.length) return;
  node.layoutOptions = {
    ...node.layoutOptions,
    "org.eclipse.elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  };
  node.children.forEach(ns);
}

it.each(["motor-starter", "conveyor-line", "machine-demo"])(
  "asserts %s's first-attempt L3-CB1-K1 1.0 mm jog is retained by NS",
  async (project) => {
    const c = await compileProject(`examples/${project}`);
    if (!c.ok) throw Error(JSON.stringify(c));
    const engine = createElkEngine(),
      native = engine.layout.bind(engine);
    let input: ElkNode | undefined, first: ElkNode | undefined;
    engine.layout = async (graph, options) => {
      input ??= structuredClone(graph);
      const output = await native(graph, options);
      first ??= structuredClone(output);
      return output;
    };
    const p = await prepareSchematicDrawing(
      c.ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow: "left-to-right",
        root: { by: "designation", value: "M1" },
      },
      c.presentation,
      { layoutEngine: engine },
    );
    if (!p.ok || !input || !first) throw Error(JSON.stringify(p));
    const wire = c.ir.wires.find((w) => w.properties?.label === "L3-CB1-K1")!;
    const id = p.value.graph.edges.find((e) =>
      e.elementIds.some((id) => id.kind === "wire" && id.uid === wire.uid),
    )!.id;
    const before = internal(edges(first).find((e) => e.id === id)!);
    expect(before).toContain(1);
    ns(input);
    const candidate = await createElkEngine().layout(input);
    expect(internal(edges(candidate).find((e) => e.id === id)!)).toContain(1);
  },
  30000,
);
