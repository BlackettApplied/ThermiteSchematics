import { expect, it } from "vitest";
import { layoutDirectLoop } from "../src/layout/direct-loop-layout.js";
import fixture from "./direct-loop-jog.fixture.json";
import { routeQuality } from "../../../evals/draw/checks.mjs";
import type { ElkExtendedEdge } from "elkjs/lib/elk-api.js";

function findings(points: { x: number; y: number }[]) {
  return routeQuality({
    width: 1000,
    height: 1000,
    shapes: [
      {
        conductor: true,
        stroke: 0.4,
        points,
        bbox: { x: 0, y: 0, w: 150, h: 300 },
      },
    ],
  });
}
it("routes fixed loop ports without sub-3 mm internal segments", async () => {
  const { children, edges } = structuredClone(fixture);
  const expected = structuredClone(children);
  const graph = await layoutDirectLoop(
    children,
    edges as ElkExtendedEdge[],
    true,
    edges.filter((e) => e.id !== "e6").map((e) => e.id),
  );
  expect(JSON.stringify(graph.children!.map((n) => n.ports))).toBe(
    JSON.stringify(expected.map((n) => n.ports)),
  );
  expect(graph.edges).toHaveLength(edges.length);
  for (const edge of graph.edges!) {
    expect(edge.sources).toEqual(edges.find((e) => e.id === edge.id)!.sources);
    expect(edge.targets).toEqual(edges.find((e) => e.id === edge.id)!.targets);
    for (const section of edge.sections!) {
      for (const [ids, point] of [
        [edge.sources, section.startPoint],
        [edge.targets, section.endPoint],
      ] as const) {
        const node = graph.children!.find((n) =>
          n.ports!.some((p) => ids.includes(p.id)),
        )!;
        const port = node.ports!.find((p) => ids.includes(p.id))!;
        expect(point.x).toBeCloseTo(node.x! + port.x!, 6);
        expect(point.y).toBeCloseTo(node.y! + port.y!, 6);
      }
      const points = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ];
      expect(findings(points), edge.id).toEqual([]);
    }
  }
});
it.each([
  [2.99, true],
  [3, false],
])(
  "measures an internal segment of %s mm at the exact threshold",
  (length, fails) => {
    const result = findings([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: length, y: 10 },
      { x: length, y: 20 },
    ]);
    expect(result.some((f: any) => f.kind === "jog-under-3mm")).toBe(fails);
  },
);
