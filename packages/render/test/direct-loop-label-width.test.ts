import { afterEach, expect, it, vi } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import * as runtime from "../src/layout/elk-runtime.js";
import { layoutDirectLoop } from "../src/layout/direct-loop-layout.js";
import fixture from "./direct-loop-jog.fixture.json";
import { flows, directFixture, directView } from "./direct-loop-fixture.js";
import { checkLabels, prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { routeQuality } from "../../../evals/draw/checks.mjs";
import { placeLoopLabels } from "../src/layout/direct-loop-labels.js";

const factory = runtime.createElkEngine;
afterEach(() => vi.restoreAllMocks());
function captureNative() {
  const captures: { input: ElkNode; native: ElkNode }[] = [];
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    return {
      layout: async (graph: ElkNode) => {
        const input = structuredClone(graph);
        const result = await engine.layout(graph);
        captures.push({ input, native: structuredClone(result) });
        return result;
      },
    } as ReturnType<typeof factory>;
  });
  return (graph?: ElkNode) => {
    const capture = graph
      ? [...captures]
          .reverse()
          .find(
            ({ native }) =>
              JSON.stringify([native.children, routes(native)]) ===
              JSON.stringify([graph.children, routes(graph)]),
          )
      : captures.at(-1);
    if (!capture)
      throw new Error("No complete native graph matches the result");
    return capture;
  };
}
const routes = (g: ElkNode) => g.edges!.map(({ labels: _, ...edge }) => edge);

function expectInlineLabelsOnSegments(graph: ElkNode, wireIds: string[]) {
  for (const edge of graph.edges!.filter((e) => wireIds.includes(e.id)))
    for (const label of edge.labels!) {
      const center = label.x! + label.width! / 2;
      const sections = edge.sections!.flatMap((s) => {
        const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
        return points.slice(1).map((b, i) => [points[i]!, b] as const);
      });
      expect(
        sections.some(
          ([a, b]) =>
            Math.abs(a.x - center) < 1e-6 &&
            Math.abs(b.x - center) < 1e-6 &&
            label.y! >= Math.min(a.y, b.y) &&
            label.y! + label.height! <= Math.max(a.y, b.y),
        ),
      ).toBe(true);
    }
}

it.each(flows)(
  "sweeps transverse label widths across the old threshold in %s",
  async (flow) => {
    const captured = captureNative();
    // A deterministic property sweep: exact boundary controls plus a reproducible
    // distribution of widths, including mixed narrow/wide neighboring labels.
    const widths = [
      0.1, 7.99, 8, 8.001, 8.2, 8.736, 10.595, 10.615, 10.99, 11, 11.01, 13.99,
      14, 14.01, 32, 256,
    ];
    let seed = 226;
    for (let i = 0; i < 24; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      widths.push(0.1 + (seed / 2 ** 32) * 32);
    }
    const first = new Map<string, unknown>();
    for (const width of widths)
      for (const mixed of [false, true]) {
        const { children, edges } = structuredClone(fixture);
        const wireIds = edges.slice(0, 6).map((e) => e.id);
        for (const [i, edge] of edges.slice(0, 6).entries())
          edge.labels[0]!.width = mixed && i % 2 ? 6.8573 : width;
        if (flow === "left-to-right")
          for (const node of children) {
            [node.width, node.height] = [node.height, node.width];
            for (const port of node.ports) {
              [port.x, port.y] = [port.y, port.x];
              port.layoutOptions["elk.port.side"] =
                port.layoutOptions["elk.port.side"] === "NORTH"
                  ? "WEST"
                  : "EAST";
            }
          }
        const graph = await layoutDirectLoop(
          children,
          edges,
          flow === "top-to-bottom",
          flow === "top-to-bottom" ? wireIds : [],
          checkLabels,
        );
        checkLabels(graph);
        const { input, native } = captured(graph);
        const inline =
          flow === "top-to-bottom" &&
          input
            .edges!.filter((e) => wireIds.includes(e.id))
            .every((e) => e.labels!.length === 0);
        expect(routes(graph)).toEqual(routes(native));
        expect(graph.children).toEqual(native.children);
        for (const edge of graph.edges!) {
          const original = edges.find((e) => e.id === edge.id)!;
          expect(
            edge.labels!.map(({ text, width, height }) => ({
              text,
              width,
              height,
            })),
          ).toEqual(original.labels);
          // Fallback and horizontal routes retain native ELK geometry and any
          // honest jogs; accepted inline routes must remain straight.
          for (const s of inline ? edge.sections! : []) {
            const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
            expect(
              routeQuality({
                width: 1000,
                height: 1000,
                shapes: [{ conductor: true, stroke: 0.4, points }],
              }).filter((f: any) => f.kind === "jog-under-3mm"),
            ).toEqual([]);
          }
        }
        if (inline) {
          expect(
            input
              .edges!.filter((e) => wireIds.includes(e.id))
              .every((e) => e.labels!.length === 0),
          ).toBe(true);
          expect(input.edges!.at(-1)!.labels).toEqual(edges.at(-1)!.labels);
          const gap =
            input.layoutOptions?.[
              "elk.layered.spacing.nodeNodeBetweenLayers"
            ] ?? "8";
          if (!first.has(gap)) first.set(gap, routes(graph));
          expect(routes(graph)).toEqual(first.get(gap));
          expectInlineLabelsOnSegments(graph, wireIds);
        } else expect(input.edges).toEqual(edges);
      }
  },
);

it("rejects an inline candidate with no sufficiently long vertical segment", () => {
  const graph: ElkNode = {
    id: "short",
    edges: [
      {
        id: "wire",
        sources: ["a"],
        targets: ["b"],
        sections: [
          { id: "s", startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 2 } },
        ],
      },
    ],
  };
  expect(() =>
    placeLoopLabels(
      graph,
      new Map([["wire", [{ text: "AO1+", width: 10.595, height: 4.8 }]]]),
    ),
  ).toThrow("No vertical segment fits the output loop wire label.");
});

it.each(flows)(
  "keeps input-loop labels in native ELK layout in %s",
  async (flow) => {
    const captured = captureNative(),
      f = await directFixture();
    try {
      await prepareSignalLoopDrawing(f.ir, directView({ flow }));
      expect(captured().input.edges!.every((e) => e.labels!.length === 1)).toBe(
        true,
      );
      expect(captured().input.layoutOptions!["elk.spacing.edgeEdge"]).toBe("6");
    } finally {
      await f.dispose();
    }
  },
);
