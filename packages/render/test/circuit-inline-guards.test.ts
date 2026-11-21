import { expect, it, vi, afterEach } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import * as slots from "../src/layout/circuit-inline-slots.js";
import {
  circuitLayoutRun,
  layoutCircuitGroup,
  circuitInlineGap,
} from "../src/layout/circuit-inline.js";
import {
  circuitNativeGuard,
  circuitLabelGuard,
  circuitCrossingGuard,
  circuitNodeClearanceGuard,
} from "../src/layout/circuit-native-guard.js";
import { circuitConductorGuard } from "../src/layout/circuit-route-quality.js";
import { parallelLabelGraph } from "./circuit-inline.fixture.js";
import { InlineLabelFitError } from "../src/layout/inline-label-error.js";

afterEach(() => vi.restoreAllMocks());
it("derives the gap from the along label box, both stubs and original edge/node clearance", () => {
  for (const vertical of [false, true])
    for (const width of [2, 16, 48])
      for (const height of [3.8, 6.9, 13]) {
        const graph = parallelLabelGraph(vertical),
          labels = new Map([["e0", [{ width, height }]]]);
        expect(circuitInlineGap(graph, labels)).toBe(
          (vertical ? height : width) + 8,
        );
      }
});
it.each([
  "elk.layered.spacing.edgeNodeBetweenLayers",
  "elk.layered.spacing.nodeNodeBetweenLayers",
])(
  "requires the clearance option %s instead of defaulting to zero",
  (option) => {
    const input = parallelLabelGraph();
    delete input.layoutOptions![option];
    expect(() =>
      circuitInlineGap(input, new Map([["e0", [{ width: 6, height: 3.8 }]]])),
    ).toThrow(`Missing required circuit clearance option ${option}`);
  },
);
it.each(["NaN", "Infinity", "-1"])(
  "rejects invalid clearance option %s",
  (value) => {
    const input = parallelLabelGraph();
    input.layoutOptions!["elk.layered.spacing.edgeNodeBetweenLayers"] = value;
    expect(() => circuitInlineGap(input, new Map())).toThrow(
      "Invalid circuit clearance option",
    );
  },
);
it("keeps an unaffected parallel view byte-identical with no extra ELK run", async () => {
  const input = parallelLabelGraph();
  input.children![1]!.ports!.forEach((p, i) => (p.y = 8 + i * 15));
  input.children![1]!.height = 50;
  input.children![0]!.ports!.forEach((p, i) => (p.y = 8 + i * 15));
  input.children![0]!.height = 50;
  const run = circuitLayoutRun(),
    before = await layoutCircuitGroup(input, run);
  run.quality = true;
  expect(await layoutCircuitGroup(input, run)).toEqual(before);
  expect(run.attempts).toBe(1);
});
it.each(["placement", "economy"])(
  "retains baseline at the unchanged %s limit",
  async (limit) => {
    const input = parallelLabelGraph(),
      run = circuitLayoutRun();
    const before = await layoutCircuitGroup(input, run);
    run.quality = true;
    if (limit === "placement") run.attempts = 48;
    else run.qualityAttempts = 4;
    expect(await layoutCircuitGroup(input, run)).toEqual(before);
    expect(run.attempts).toBe(limit === "placement" ? 48 : 1);
  },
);
it("propagates a slot programming error instead of hiding it behind a baseline", async () => {
  const input = parallelLabelGraph(),
    run = circuitLayoutRun();
  await layoutCircuitGroup(input, run);
  run.quality = true;
  const error = new TypeError("synthetic slot bug");
  vi.spyOn(slots, "placeCircuitInlineLabels").mockImplementation(() => {
    throw error;
  });
  await expect(layoutCircuitGroup(input, run)).rejects.toBe(error);
});
it("conserves native sections and labels; rejects moved ports, moved endpoints, phase swaps and dropped content", async () => {
  const input = parallelLabelGraph(),
    graph = await createElkEngine().layout(structuredClone(input));
  expect(circuitNativeGuard(graph, input)).toBe(true);
  for (const mutate of [
    (g: ElkNode) => {
      g.children![0]!.ports![0]!.y! += 0.1;
      g.edges![0]!.sections![0]!.startPoint.y += 0.1;
    },
    (g: ElkNode) => {
      g.edges![0]!.sections![0]!.endPoint.x += 1;
    },
    (g: ElkNode) => {
      [g.edges![0]!.targets, g.edges![1]!.targets] = [
        g.edges![1]!.targets,
        g.edges![0]!.targets,
      ];
    },
    (g: ElkNode) => {
      g.edges!.pop();
    },
    (g: ElkNode) => {
      g.children!.pop();
    },
  ]) {
    const changed = structuredClone(graph);
    mutate(changed);
    expect(circuitNativeGuard(changed, input)).toBe(false);
  }
  const changed = structuredClone(graph);
  changed.edges![0]!.labels = [];
  expect(circuitLabelGuard(changed, input)).toBe(false);
});
const route = (id: string, points: number[][]) => ({
  id,
  sources: [id + "s"],
  targets: [id + "t"],
  sections: [
    {
      id: id + "section",
      startPoint: { x: points[0]![0]!, y: points[0]![1]! },
      endPoint: { x: points.at(-1)![0]!, y: points.at(-1)![1]! },
      bendPoints: points.slice(1, -1).map(([x, y]) => ({ x: x!, y: y! })),
    },
  ],
});
it("rejects new crossings, merged landings, foreign junctions and node penetration", () => {
  const original: ElkNode = {
    id: "g",
    edges: [
      route("a", [
        [0, 0],
        [100, 0],
      ]),
      route("b", [
        [0, 10],
        [100, 10],
      ]),
    ],
  };
  for (const points of [
    [
      [50, -10],
      [50, 10],
    ],
    [
      [20, 0],
      [100, 0],
    ],
    [
      [50, -10],
      [50, 0],
    ],
  ])
    expect(
      circuitCrossingGuard(
        { ...original, edges: [original.edges![0]!, route("b", points)] },
        original,
      ),
    ).toBe(false);
  expect(
    circuitNodeClearanceGuard({
      ...original,
      children: [{ id: "node", x: 20, y: -5, width: 10, height: 10 }],
    }),
  ).toBe(false);
});
it("rejects bends and length transferred to another conductor, including separate cable cores", () => {
  const original: ElkNode = {
    id: "g",
    edges: [
      route("cable/core1", [
        [0, 0],
        [20, 0],
        [20, 1],
        [50, 1],
      ]),
      route("cable/core2", [
        [0, 10],
        [50, 10],
      ]),
    ],
  };
  const repaired = route("cable/core1", [
    [0, 0],
    [50, 0],
  ]);
  expect(
    circuitConductorGuard(
      { ...original, edges: [repaired, original.edges![1]!] },
      original,
    ),
  ).toBe(true);
  expect(
    circuitConductorGuard(
      {
        ...original,
        edges: [
          repaired,
          route("cable/core2", [
            [0, 10],
            [0, 20],
            [50, 20],
          ]),
        ],
      },
      original,
    ),
  ).toBe(false);
  expect(
    circuitConductorGuard(
      {
        ...original,
        edges: [
          repaired,
          route("cable/core2", [
            [0, 10],
            [80, 10],
          ]),
        ],
      },
      original,
    ),
  ).toBe(false);
  expect(
    circuitConductorGuard({ ...original, edges: [repaired] }, original),
  ).toBe(false);
});
it("treats foreign label boxes and full foreign stroke clearance as obstacles", () => {
  const graph: ElkNode = {
    id: "g",
    width: 100,
    height: 40,
    edges: [
      {
        ...route("own", [
          [10, 20],
          [90, 20],
        ]),
        labels: [],
      },
      {
        ...route("foreign", [
          [10, 23],
          [90, 23],
        ]),
        labels: [{ x: 45, y: 18, width: 10, height: 4, text: "other" }],
      },
    ],
  };
  const labels = new Map([["own", [{ width: 10, height: 4, text: "W1" }]]]),
    weights = new Map([
      ["own", 0.32],
      ["foreign", 0.55],
    ]);
  expect(() =>
    slots.placeCircuitInlineLabels(structuredClone(graph), labels, weights, 0),
  ).toThrow(InlineLabelFitError);
  graph.edges![1]!.labels = [];
  expect(() =>
    slots.placeCircuitInlineLabels(structuredClone(graph), labels, weights, 0),
  ).toThrow(InlineLabelFitError);
});

it("rejects coherent phase reordering across distributed appearances of one physical device", async () => {
  const { circuitPortGroups, circuitPortOrderGuard } =
    await import("../src/layout/circuit-port-order.js");
  const graph: ElkNode = {
    id: "g",
    children: [
      {
        id: "a",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        ports: [{ id: "L1", x: 10, y: 5 }],
      },
      {
        id: "b",
        x: 0,
        y: 20,
        width: 10,
        height: 10,
        ports: [{ id: "L2", x: 10, y: 5 }],
      },
    ],
  };
  const groups = circuitPortGroups([
    { device: { uid: "physical-device" }, pins: [{ id: "L1" }] },
    { device: { uid: "physical-device" }, pins: [{ id: "L2" }] },
  ]);
  const changed = structuredClone(graph);
  [changed.children![0]!.y, changed.children![1]!.y] = [
    changed.children![1]!.y,
    changed.children![0]!.y,
  ];
  expect(circuitNativeGuard(changed, graph)).toBe(true); // All local fixed geometry and identities survive.
  expect(circuitPortOrderGuard(changed, graph, groups)).toBe(false);
  expect(circuitPortOrderGuard(graph, graph, groups)).toBe(true);
});

it("retains the whole native group when the physical port-order guard vetoes an alternative", async () => {
  const order = await import("../src/layout/circuit-port-order.js");
  const input = parallelLabelGraph(),
    run = circuitLayoutRun();
  const original = await layoutCircuitGroup(input, run);
  run.quality = true;
  vi.spyOn(order, "circuitPortOrderGuard").mockReturnValue(false);
  expect(
    await layoutCircuitGroup(input, run, undefined, [["a0", "b0"]]),
  ).toEqual(original);
});

it("rechecks cached native routes for different port groups and strokes without another ELK call", async () => {
  const order = await import("../src/layout/circuit-port-order.js");
  const input = parallelLabelGraph(),
    run = circuitLayoutRun();
  const original = await layoutCircuitGroup(input, run);
  run.quality = true;
  const accepted = await layoutCircuitGroup(input, run);
  expect(accepted).not.toEqual(original);
  const veto = vi.spyOn(order, "circuitPortOrderGuard").mockReturnValue(false);
  expect(
    await layoutCircuitGroup(input, run, undefined, [["a0", "b0"]]),
  ).toEqual(original);
  veto.mockRestore();
  const strokes = new Map(input.edges!.map((e) => [e.id, 10]));
  expect(await layoutCircuitGroup(input, run, strokes)).toEqual(original);
  expect(run.attempts).toBe(2);
  expect(await layoutCircuitGroup(input, run)).toEqual(accepted);
});
