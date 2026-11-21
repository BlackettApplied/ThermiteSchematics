import { afterEach, expect, it, vi } from "vitest";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import * as layouts from "../src/layout/direct-loop-layout.js";
import * as runtime from "../src/layout/elk-runtime.js";
import { InlineLabelFitError } from "../src/layout/inline-label-error.js";
import { checkLabels } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { fixture, removeFixtures } from "../../cli/test/analog-output.cases.js";
import graphFixture from "./direct-loop-jog.fixture.json";

const factory = runtime.createElkEngine;
afterEach(async () => {
  vi.restoreAllMocks();
  await removeFixtures();
});

it("rethrows unexpected inline-label failures without a fallback layout", async () => {
  const { children, edges } = structuredClone(graphFixture);
  const failure = new TypeError("synthetic label programming error");
  const create = vi.spyOn(runtime, "createElkEngine");
  await expect(
    layouts.layoutDirectLoop(children, edges, true, [edges[0]!.id], () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(create).toHaveBeenCalledTimes(1);
});

it.each([
  ["x", NaN],
  ["y", Infinity],
  ["width", 0],
  ["height", -1],
] as const)(
  "propagates malformed inline label geometry (%s=%s) without fallback",
  async (field, value) => {
    const { children, edges } = structuredClone(graphFixture);
    const create = vi.spyOn(runtime, "createElkEngine");
    const failure = await layouts
      .layoutDirectLoop(children, edges, true, [edges[0]!.id], (graph) => {
        graph.edges![0]!.labels![0]![field] = value;
        checkLabels(graph);
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect((failure as Error | undefined)?.constructor).toBe(Error);
    expect((failure as Error).message).toContain("invalid content geometry");
    expect(create).toHaveBeenCalledTimes(1);
  },
);

it("keeps finite out-of-bounds label geometry as a recoverable fit error", () => {
  expect(() =>
    checkLabels({
      id: "out-of-bounds",
      width: 10,
      height: 10,
      edges: [
        {
          id: "e",
          sources: [],
          targets: [],
          labels: [{ x: -1, y: 1, width: 2, height: 2 }],
        },
      ],
    }),
  ).toThrow(InlineLabelFitError);
});

// Independent reference: pre-RT1 dev 7bbe4f7's native layout options.
async function nativeDev(
  children: ElkNode[],
  edges: ElkExtendedEdge[],
  vertical: boolean,
) {
  return factory().layout({
    id: "loop",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "8",
      "elk.spacing.edgeEdge": "6",
      "elk.spacing.edgeNode": "5",
      "elk.padding": "[top=6,left=6,bottom=6,right=6]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: structuredClone(children),
    edges: structuredClone(edges),
  });
}

function captureLoopLayouts() {
  const attempts: ElkNode[] = [],
    outputs: ElkNode[] = [];
  let selected: ElkNode | undefined;
  const directLayout = layouts.layoutDirectLoop;
  const chosen = vi
    .spyOn(layouts, "layoutDirectLoop")
    .mockImplementation(async (...args) => {
      selected = await directLayout(...args);
      return selected;
    });
  const capture = vi
    .spyOn(runtime, "createElkEngine")
    .mockImplementation(() => {
      const engine = factory();
      return {
        layout: async (graph: ElkNode) => {
          attempts.push(structuredClone(graph));
          const result = await engine.layout(graph);
          outputs.push(structuredClone(result));
          return result;
        },
      } as ReturnType<typeof factory>;
    });

  return () => {
    capture.mockRestore();
    chosen.mockRestore();
    const selectedIndex = outputs.findIndex(
      (output) =>
        JSON.stringify([
          output.children,
          output.edges?.map(({ labels: _, ...edge }) => edge),
        ]) ===
        JSON.stringify([
          selected?.children,
          selected?.edges?.map(({ labels: _, ...edge }) => edge),
        ]),
    );

    return { attempts, selectedIndex };
  };
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "matches dev refusals and native fallback SVGs across uniform and mixed wire widths in %s",
  async (flow) => {
    const f = await fixture(),
      ir = await f.compile();
    const names = [
      (i: number) => `W${i}`,
      (i: number) => `W1${i}`,
      (i: number) => `AO${i}+`,
      (i: number) => `W-AO-0${i}`,
      ...[1, 3, 6, 10, 15, 19, 20, 21, 22, 26, 40, 80].map(
        (n) => (i: number) => `W${"A".repeat(n)}${i}`,
      ),
    ];
    const outcomes: boolean[] = [],
      modes = new Set<string>();
    for (const label of names)
      for (const mixed of [false, true]) {
        const input = structuredClone(ir);
        for (const [i, wire] of input.wires.entries())
          wire.designation = mixed && i % 2 ? `W${i + 1}` : label(i + 1);
        for (const entry of input.indexes.objectRefByDesignation) {
          const wire = input.wires.find((w) => w.uid === entry.value.uid);
          if (wire) entry.key = wire.designation!;
        }
        input.indexes.objectRefByDesignation.sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        );
        const request = {
          ...f.packet,
          page: {
            ...f.packet.page,
            orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
          },
          views: [{ ...f.packet.views[0], flow }],
        };
        const mock = vi
          .spyOn(layouts, "layoutDirectLoop")
          .mockImplementation(nativeDev);
        const before = await renderSchematicPacket(input, request);
        mock.mockRestore();
        const captured = captureLoopLayouts();
        const after = await renderSchematicPacket(input, request);
        const { attempts, selectedIndex } = captured();
        expect(selectedIndex).toBeGreaterThanOrEqual(0);
        expect(attempts.length).toBeLessThanOrEqual(3);
        expect(
          after.ok,
          JSON.stringify({
            flow,
            label: input.wires[0]!.designation,
            mixed,
            before: before.ok ? null : before.error,
            after: after.ok ? null : after.error,
          }),
        ).toBe(before.ok);
        outcomes.push(before.ok);
        for (const attempt of attempts)
          expect(attempt.layoutOptions!["elk.spacing.edgeEdge"]).toBe("6");
        const inline =
          flow === "top-to-bottom" &&
          attempts[selectedIndex]!.edges!.some(
            (edge) => edge.labels!.length === 0,
          );
        modes.add(after.ok ? (inline ? "inline" : "native") : "refuse");
        if (after.ok) {
          expect(after.value.sheets).toHaveLength(2);
          expect(after.value.sheets[1]!.view.kind).toBe("wires");
          const routes = parseHTML(
            after.value.sheets[0]!.svg,
          ).document.querySelectorAll("[data-loop-conductor]");
          expect(routes).toHaveLength(6);
          if (inline) {
            // The four wires between fixed-pitch terminal/connector lanes must
            // print straight. Source/destination approaches keep native bends.
            let straight = 0;
            for (const route of routes) {
              const wire = input.wires.find(
                (w) => w.uid === route.getAttribute("data-loop-conductor"),
              )!;
              if (
                wire.endpoints.every((end) =>
                  ["XT1", "XP1"].includes(
                    input.devices.find((d) => d.uid === end.terminal.deviceUid)!
                      .designation,
                  ),
                )
              ) {
                const points = [
                  ...route
                    .querySelector("path")!
                    .getAttribute("d")!
                    .matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g),
                ];
                expect(points).toHaveLength(2);
                expect(points[0]![1]).toBe(points[1]![1]);
                straight++;
              }
            }
            expect(straight).toBe(4);
          } else if (before.ok)
            expect(after.value.sheets[0]!.svg).toBe(
              before.value.sheets[0]!.svg,
            );
        } else if (!before.ok) expect(after.error).toEqual(before.error);
      }
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
    expect(modes).toContain("native");
    if (flow === "top-to-bottom") expect(modes).toContain("inline");
  },
);

it("retries the whole loop when no inline vertical segment fits the label height", async () => {
  const { children, edges } = structuredClone(graphFixture);
  const ids = edges.slice(0, 6).map((e) => e.id);
  for (const edge of edges.slice(0, 6)) edge.labels[0]!.height = 20;
  const inputs: ElkNode[] = [],
    outputs: ElkNode[] = [];
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    return {
      layout: async (input: ElkNode) => {
        inputs.push(structuredClone(input));
        const graph = await engine.layout(input);
        outputs.push(structuredClone(graph));
        return graph;
      },
    } as ReturnType<typeof factory>;
  });
  const graph = await layouts.layoutDirectLoop(
    children,
    edges,
    true,
    ids,
    checkLabels,
  );
  checkLabels(graph);
  expect(inputs).toHaveLength(3);
  expect(
    inputs[2]?.layoutOptions?.["elk.layered.spacing.nodeNodeBetweenLayers"],
  ).toBe(String(2 * 20 + 1));
  expect(
    inputs[0]!
      .edges!.filter((e) => ids.includes(e.id))
      .every((e) => e.labels!.length === 0),
  ).toBe(true);
  expect(inputs[1]!.edges).toEqual(edges);
  expect(inputs[1]!.layoutOptions!["elk.spacing.edgeEdge"]).toBe("6");
  expect(graph).toEqual(outputs[1]);
});
