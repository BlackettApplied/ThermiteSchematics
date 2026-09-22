import type { ElkNode } from "elkjs/lib/elk-api.js";
import { describe, expect, it } from "vitest";

import { buildElkAdapterGraph } from "../src/layout/elk-adapter.js";
import { normalizeAndValidateLayout } from "../src/layout/validate-output.js";
import type {
  JunctionPresentationNode,
  PresentationEdge,
  PresentationGraph,
  PresentationPort,
} from "../src/types.js";

function port(id: string, deviceUid: string, netId: string): PresentationPort {
  return {
    id,
    symbolPortId: id,
    terminal: { deviceUid, terminalKey: "T" },
    netId,
    side: "east",
    offset: 0.5,
    order: 0,
    label: "",
  };
}

function junction(id: string, netId: string): JunctionPresentationNode {
  return {
    kind: "junction",
    id,
    parentId: "root",
    classification: "junction",
    netId,
    terminal: { deviceUid: id, terminalKey: "T" },
    ports: [port(`${id}-port`, id, netId)],
  };
}

function edge(
  id: string,
  netId: string,
  sourcePortId: string,
  targetPortId: string,
): PresentationEdge {
  return {
    id,
    parentId: "root",
    kind: "boundary-segment",
    sourcePortId,
    targetPortId,
    netId,
    elementIds: [],
    endpoints: [
      { deviceUid: sourcePortId.replace("-port", ""), terminalKey: "T" },
      { deviceUid: targetPortId.replace("-port", ""), terminalKey: "T" },
    ],
    pathRank: 0,
  };
}

function crossingGraph(): PresentationGraph {
  const nodes = [
    junction("a-top", "net-a"),
    junction("a-bottom", "net-a"),
    junction("b-left", "net-b"),
    junction("b-right", "net-b"),
  ];
  return {
    format: "schematic-presentation/0.1",
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: "a-top", designation: "A" },
      flow: "left-to-right",
    },
    locationGroups: [],
    deviceGroups: [],
    nodes,
    edges: [
      edge("edge-a", "net-a", "a-top-port", "a-bottom-port"),
      edge("edge-b", "net-b", "b-left-port", "b-right-port"),
    ],
    metadataTextSources: [],
  };
}

function positionedOutput(
  graph: PresentationGraph,
  positions: Readonly<Record<string, readonly [number, number]>>,
): Readonly<{ input: ElkNode; output: ElkNode }> {
  const input = buildElkAdapterGraph(graph).graph;
  const output = structuredClone(input);
  output.width = 240;
  output.height = 220;
  for (const node of output.children ?? []) {
    const [x, y] = positions[node.id]!;
    node.x = x;
    node.y = y;
  }
  return { input, output };
}

function setSection(
  output: ElkNode,
  edgeId: string,
  points: readonly { readonly x: number; readonly y: number }[],
): void {
  const target = output.edges!.find(({ id }) => id === edgeId)!;
  target.sections = [
    {
      id: `${edgeId}-section`,
      startPoint: structuredClone(points[0]!),
      endPoint: structuredClone(points.at(-1)!),
      ...(points.length <= 2
        ? {}
        : { bendPoints: structuredClone(points.slice(1, -1)) }),
    },
  ];
}

describe("crossing and ambiguous route validation", () => {
  it("retains an isolated different-net interior crossing without connectivity", () => {
    const graph = crossingGraph();
    const { input, output } = positionedOutput(graph, {
      "a-top": [97, 17],
      "a-bottom": [97, 177],
      "b-left": [17, 97],
      "b-right": [197, 97],
    });
    setSection(output, "edge-a", [
      { x: 100, y: 20 },
      { x: 100, y: 180 },
    ]);
    setSection(output, "edge-b", [
      { x: 20, y: 100 },
      { x: 200, y: 100 },
    ]);
    const result = normalizeAndValidateLayout(graph, input, output, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.crossings).toEqual([
      {
        edgeIds: ["edge-a", "edge-b"],
        netIds: ["net-a", "net-b"],
        point: { x: 100, y: 100 },
      },
    ]);
    expect(graph.nodes).toHaveLength(4);
    expect(new Set(graph.nodes.map(({ netId }) => netId))).toEqual(
      new Set(["net-a", "net-b"]),
    );
  });

  it("rejects positive-length collinear overlap", () => {
    const graph = crossingGraph();
    const { input, output } = positionedOutput(graph, {
      "a-top": [97, 17],
      "a-bottom": [97, 177],
      "b-left": [17, 97],
      "b-right": [197, 97],
    });
    setSection(output, "edge-a", [
      { x: 100, y: 20 },
      { x: 100, y: 180 },
    ]);
    setSection(output, "edge-b", [
      { x: 20, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 150 },
      { x: 200, y: 150 },
      { x: 200, y: 100 },
    ]);
    const result = normalizeAndValidateLayout(graph, input, output, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("R004");
  });

  it("rejects same-net collinear overlap", () => {
    const graph = structuredClone(crossingGraph());
    for (const node of graph.nodes) {
      node.netId = "net-a";
      for (const candidate of node.ports) candidate.netId = "net-a";
    }
    for (const candidate of graph.edges) candidate.netId = "net-a";
    const { input, output } = positionedOutput(graph, {
      "a-top": [97, 17],
      "a-bottom": [97, 177],
      "b-left": [17, 97],
      "b-right": [197, 97],
    });
    setSection(output, "edge-a", [
      { x: 100, y: 20 },
      { x: 100, y: 180 },
    ]);
    setSection(output, "edge-b", [
      { x: 20, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 150 },
      { x: 200, y: 150 },
      { x: 200, y: 100 },
    ]);
    const result = normalizeAndValidateLayout(graph, input, output, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("R004");
  });

  it("rejects an unrelated endpoint/interior T intersection", () => {
    const graph = crossingGraph();
    const { input, output } = positionedOutput(graph, {
      "a-top": [197, 17],
      "a-bottom": [197, 177],
      "b-left": [17, 97],
      "b-right": [197, 97],
    });
    setSection(output, "edge-a", [
      { x: 200, y: 20 },
      { x: 200, y: 180 },
    ]);
    setSection(output, "edge-b", [
      { x: 20, y: 100 },
      { x: 200, y: 100 },
    ]);
    const result = normalizeAndValidateLayout(graph, input, output, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("R004");
  });

  it("rejects a returned junction port that is not centered", () => {
    const graph = crossingGraph();
    const { input, output } = positionedOutput(graph, {
      "a-top": [97, 17],
      "a-bottom": [97, 177],
      "b-left": [17, 97],
      "b-right": [197, 97],
    });
    output.children!.find(({ id }) => id === "a-top")!.ports![0]!.x = 2;
    setSection(output, "edge-a", [
      { x: 99, y: 20 },
      { x: 99, y: 180 },
      { x: 100, y: 180 },
    ]);
    setSection(output, "edge-b", [
      { x: 20, y: 100 },
      { x: 200, y: 100 },
    ]);
    const result = normalizeAndValidateLayout(graph, input, output, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("R004");
  });
});
