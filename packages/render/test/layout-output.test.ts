import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr } from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildElkAdapterGraph,
  layoutPresentationGraph,
} from "../src/layout/elk-adapter.js";
import {
  MAX_SVG_MAGNITUDE,
  normalizeAndValidateLayout,
  quantizeLayoutNumber,
} from "../src/layout/validate-output.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { selectLoadsSubgraph } from "../src/selection.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import type { SymbolDefinition } from "../src/symbols/types.js";
import type {
  NormalizedSchematicLayout,
  PresentationGraph,
  SchematicFlow,
  SchematicViewFamily,
} from "../src/types.js";
import {
  compileCoreFixture,
  required,
  selectCoreSubgraph,
} from "./fixtures.js";

const ElkConstructor = BundledElk as unknown as { new (): ELK };

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

function presentation(
  ir: ElectricalIr,
  root: string,
  family: SchematicViewFamily,
  flow: SchematicFlow,
): PresentationGraph {
  const result = buildPresentationGraph({
    ir,
    selected: selectCoreSubgraph(ir, root, family, flow),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.graph;
}

function loadsPresentation(
  ir: ElectricalIr,
  flow: SchematicFlow,
  catalog: readonly SymbolDefinition[] = SYMBOL_CATALOG,
): PresentationGraph {
  const root = required(
    ir.devices.find(({ designation }) => designation === "PS1"),
  );
  const selected = selectLoadsSubgraph({
    ir,
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: root.uid, designation: root.designation },
      flow,
    },
    engine: createQueryEngine(ir),
    catalog,
  });
  if (!selected.ok) throw new Error(JSON.stringify(selected.error));
  const built = buildPresentationGraph({
    ir,
    selected: selected.value,
    catalog,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value.graph;
}

function oldDcCatalog(): readonly SymbolDefinition[] {
  const replacements = new Map<string, SymbolDefinition>([
    [
      "ais:power-source-dc",
      {
        format: "ais-symbol/0.1",
        id: "ais:power-source-dc",
        size: { width: 36, height: 48 },
        ports: [
          { id: "positive", side: "east", offset: 1 / 4, order: 0 },
          { id: "return", side: "east", offset: 3 / 4, order: 1 },
        ],
        primitives: [
          {
            kind: "line",
            from: { x: 8, y: 6 },
            to: { x: 8, y: 42 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 8, y: 12 },
            to: { x: 36, y: 12 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 8, y: 36 },
            to: { x: 36, y: 36 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 13, y: 12 },
            to: { x: 21, y: 12 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 17, y: 8 },
            to: { x: 17, y: 16 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 13, y: 36 },
            to: { x: 21, y: 36 },
            style: "annotation",
          },
        ],
      },
    ],
    [
      "ais:dc-load",
      {
        format: "ais-symbol/0.1",
        id: "ais:dc-load",
        size: { width: 40, height: 48 },
        ports: [
          { id: "positive", side: "west", offset: 1 / 4, order: 0 },
          { id: "return", side: "west", offset: 3 / 4, order: 1 },
        ],
        primitives: [
          {
            kind: "line",
            from: { x: 0, y: 12 },
            to: { x: 8, y: 12 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 0, y: 36 },
            to: { x: 8, y: 36 },
            style: "body",
          },
          {
            kind: "rect",
            x: 8,
            y: 4,
            width: 24,
            height: 40,
            radius: 2,
            style: "body",
          },
          {
            kind: "line",
            from: { x: 13, y: 12 },
            to: { x: 19, y: 12 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 16, y: 9 },
            to: { x: 16, y: 15 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 13, y: 36 },
            to: { x: 19, y: 36 },
            style: "annotation",
          },
        ],
      },
    ],
  ]);
  return SYMBOL_CATALOG.map(
    (definition) => replacements.get(definition.id) ?? definition,
  );
}

async function rawLayout(graph: PresentationGraph): Promise<{
  readonly input: ElkNode;
  readonly output: ElkNode;
}> {
  const input = buildElkAdapterGraph(graph).graph;
  const output = await new ElkConstructor().layout(structuredClone(input));
  return { input, output };
}

function allNodes(root: ElkNode): ElkNode[] {
  return (root.children ?? []).flatMap((child) => [child, ...allNodes(child)]);
}

function rawLeafLabelPositions(
  root: Readonly<ElkNode>,
  leafIds: ReadonlySet<string>,
  parentX = 0,
  parentY = 0,
  result = new Map<
    string,
    Readonly<{
      nodeId: string;
      localX: number;
      localY: number;
      absoluteX: number;
      absoluteY: number;
    }>
  >(),
): ReadonlyMap<
  string,
  Readonly<{
    nodeId: string;
    localX: number;
    localY: number;
    absoluteX: number;
    absoluteY: number;
  }>
> {
  for (const child of root.children ?? []) {
    const nodeId = required(child.id);
    const localNodeX = required(child.x);
    const localNodeY = required(child.y);
    const nodeX = parentX + localNodeX;
    const nodeY = parentY + localNodeY;
    if (leafIds.has(nodeId)) {
      for (const label of child.labels ?? []) {
        const labelId = required(label.id);
        const localX = required(label.x);
        const localY = required(label.y);
        result.set(labelId, {
          nodeId,
          localX,
          localY,
          absoluteX: nodeX + localX,
          absoluteY: nodeY + localY,
        });
      }
    }
    rawLeafLabelPositions(child, leafIds, nodeX, nodeY, result);
  }
  return result;
}

function reverseReturnedArrays(root: ElkNode): void {
  root.children?.reverse();
  root.labels?.reverse();
  root.ports?.reverse();
  for (const port of root.ports ?? []) port.labels?.reverse();
  for (const child of root.children ?? []) reverseReturnedArrays(child);
  root.edges?.reverse();
  for (const edge of root.edges ?? []) {
    edge.labels?.reverse();
    edge.sections?.reverse();
  }
}

function expectR004(
  graph: PresentationGraph,
  input: ElkNode,
  output: ElkNode,
): void {
  r004Message(graph, input, output);
}

function r004Message(
  graph: PresentationGraph,
  input: ElkNode,
  output: ElkNode,
): string {
  const result = normalizeAndValidateLayout(
    graph,
    input,
    output,
    SYMBOL_CATALOG,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected layout validation to fail.");
  expect(result.error.code).toBe("R004");
  return result.error.message;
}

function expectGeometryContract(layout: NormalizedSchematicLayout): void {
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThan(0);
  const ports = new Map(layout.ports.map((port) => [port.id, port]));
  for (const edge of layout.edges) {
    const source = required(ports.get(edge.sourcePortId));
    const target = required(ports.get(edge.targetPortId));
    expect(edge.points[0]).toEqual({ x: source.x, y: source.y });
    expect(edge.points.at(-1)).toEqual({ x: target.x, y: target.y });
    for (let index = 1; index < edge.points.length; index++) {
      const first = edge.points[index - 1]!;
      const second = edge.points[index]!;
      expect(first.x === second.x || first.y === second.y).toBe(true);
      expect(first).not.toEqual(second);
    }
  }
  const numbers = [
    layout.width,
    layout.height,
    ...layout.nodes.flatMap(({ x, y, width, height }) => [x, y, width, height]),
    ...layout.ports.flatMap(({ x, y, width, height }) => [x, y, width, height]),
    ...layout.labels.flatMap(({ x, y, width, height }) => [
      x,
      y,
      width,
      height,
    ]),
    ...layout.edges.flatMap(({ points }) =>
      points.flatMap(({ x, y }) => [x, y]),
    ),
  ];
  expect(
    numbers.every(
      (value) => Number.isFinite(value) && Math.abs(value) <= MAX_SVG_MAGNITUDE,
    ),
  ).toBe(true);
}

describe("real pinned ELK layouts", () => {
  for (const [root, family] of [
    ["K1", "control"],
    ["M1", "power"],
  ] as const) {
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      it(`validates ${root} ${family} ${flow}`, async () => {
        const graph = presentation(coreIr, root, family, flow);
        const result = await layoutPresentationGraph(graph);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expectGeometryContract(result.value);
        expect(result.value.nodes).toHaveLength(
          graph.locationGroups.length +
            graph.deviceGroups.length +
            graph.nodes.length,
        );
        expect(result.value.edges).toHaveLength(graph.edges.length);
      });
    }
  }

  it.each(["left-to-right", "top-to-bottom"] as const)(
    "validates the complete B1 PS1 load distribution in %s flow",
    async (flow) => {
      const graph = loadsPresentation(coreIr, flow);
      const result = await layoutPresentationGraph(graph);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expectGeometryContract(result.value);
      const source = required(
        graph.nodes.find(
          (node) => node.kind === "symbol" && node.designation === "PS1",
        ),
      );
      const load = required(
        graph.nodes.find(
          (node) => node.kind === "symbol" && node.designation === "PLC1",
        ),
      );
      expect(source.symbolSize).toEqual(
        flow === "left-to-right"
          ? { width: 36, height: 64 }
          : { width: 64, height: 36 },
      );
      expect(load.symbolSize).toEqual(
        flow === "left-to-right"
          ? { width: 40, height: 64 }
          : { width: 64, height: 40 },
      );
      expect(source.boundaryConstraint).toBe("FIRST");
      expect(load.boundaryConstraint).toBe("LAST");
      expect(source.ports).toHaveLength(2);
      expect(load.ports).toHaveLength(2);
    },
  );

  it("freezes B1 arithmetic and reproduces the old DOWN R004 before exact corrected coordinates", async () => {
    const measuredWidth = (value: string): number =>
      Math.max(12, 6 + 6.2 * [...value].length);
    const potentialWidths = ["+24VDC", "0VDC", "PE", "L1"].map(measuredWidth);
    expect(potentialWidths).toEqual([43.2, 30.8, 18.4, 18.4]);
    expect([
      [8 + 4, 8 + 4 + 14],
      [56 + 4, 56 + 4 + 14],
    ]).toEqual([
      [12, 26],
      [60, 74],
    ]);
    expect(48 - (4 + measuredWidth("L+"))).toBeCloseTo(25.6, 10);
    expect(Math.max(4 + 14, 4 + 18.4, 3 + 43.2)).toBeCloseTo(46.2, 10);
    expect(48 - 46.2).toBeCloseTo(1.8, 10);

    const portPosition = (
      input: ElkNode,
      graph: PresentationGraph,
      designation: string,
      symbolPortId: string,
    ): Readonly<{ x: number; y: number }> => {
      const semantic = required(
        graph.nodes.find(
          (node) => node.kind === "symbol" && node.designation === designation,
        ),
      );
      const semanticPort = required(
        semantic.ports.find((port) => port.symbolPortId === symbolPortId),
      );
      const elkNode = required(
        allNodes(input).find(({ id }) => id === semantic.id),
      );
      const elkPort = required(
        elkNode.ports?.find(({ id }) => id === semanticPort.id),
      );
      return {
        x: quantizeLayoutNumber(required(elkPort.x), "B1 input port x"),
        y: quantizeLayoutNumber(required(elkPort.y), "B1 input port y"),
      };
    };
    const graphEdge = (graph: PresentationGraph, designation: string) =>
      required(
        graph.edges.find(
          ({ conductor }) => conductor?.designation === designation,
        ),
      );
    const rawEdge = (
      output: ElkNode,
      graph: PresentationGraph,
      designation: string,
    ) =>
      required(
        output.edges?.find(({ id }) => id === graphEdge(graph, designation).id),
      );
    const longestVerticalSegment = (
      output: ElkNode,
      graph: PresentationGraph,
      designation: string,
    ): Readonly<{ x: number; from: number; to: number }> => {
      const segments = required(
        rawEdge(output, graph, designation).sections,
      ).flatMap((section) => {
        const points = [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ];
        return points.slice(1).flatMap((point, index) => {
          const previous = points[index]!;
          return previous.x === point.x
            ? [
                {
                  x: quantizeLayoutNumber(point.x, "B1 lane x"),
                  from: quantizeLayoutNumber(
                    Math.min(previous.y, point.y),
                    "B1 lane start",
                  ),
                  to: quantizeLayoutNumber(
                    Math.max(previous.y, point.y),
                    "B1 lane end",
                  ),
                },
              ]
            : [];
        });
      });
      return required(
        segments.sort(
          (left, right) => right.to - right.from - (left.to - left.from),
        )[0],
      );
    };
    const rawNetLabel = (
      output: ElkNode,
      graph: PresentationGraph,
      designation: string,
    ) => {
      const semantic = graphEdge(graph, designation);
      return required(
        rawEdge(output, graph, designation).labels?.find(
          ({ id }) => id === semantic.netLabel?.id,
        ),
      );
    };

    const oldCatalog = oldDcCatalog();
    const oldGraph = loadsPresentation(coreIr, "top-to-bottom", oldCatalog);
    const old = await rawLayout(oldGraph);
    expect({
      sourcePositive: portPosition(old.input, oldGraph, "PS1", "positive"),
      sourceReturn: portPosition(old.input, oldGraph, "PS1", "return"),
      loadPositive: portPosition(old.input, oldGraph, "PLC1", "positive"),
      loadReturn: portPosition(old.input, oldGraph, "PLC1", "return"),
    }).toEqual({
      sourcePositive: { x: 113.8, y: 58 },
      sourceReturn: { x: 89.8, y: 58 },
      loadPositive: { x: 95.2, y: 22 },
      loadReturn: { x: 71.2, y: 22 },
    });
    expect(longestVerticalSegment(old.output, oldGraph, "W-CTL-001").x).toBe(
      275.4,
    );
    expect(longestVerticalSegment(old.output, oldGraph, "W-CTL-002").x).toBe(
      251.4,
    );
    const oldZero = rawNetLabel(old.output, oldGraph, "W-CTL-002");
    expect({
      x: quantizeLayoutNumber(required(oldZero.x), "old 0VDC label x"),
      y: quantizeLayoutNumber(required(oldZero.y), "old 0VDC label y"),
      width: oldZero.width,
      height: oldZero.height,
    }).toEqual({ x: 254.4, y: 219, width: 30.8, height: 14 });
    const oldResult = normalizeAndValidateLayout(
      oldGraph,
      old.input,
      old.output,
      oldCatalog,
    );
    expect(oldResult.ok).toBe(false);
    if (!oldResult.ok) expect(oldResult.error.code).toBe("R004");

    const graph = loadsPresentation(coreIr, "top-to-bottom");
    const current = await rawLayout(graph);
    expect({
      width: current.output.width,
      height: current.output.height,
    }).toEqual({ width: 417, height: 549 });
    expect({
      sourcePositive: portPosition(current.input, graph, "PS1", "positive"),
      sourceReturn: portPosition(current.input, graph, "PS1", "return"),
      loadPositive: portPosition(current.input, graph, "PLC1", "positive"),
      loadReturn: portPosition(current.input, graph, "PLC1", "return"),
    }).toEqual({
      sourcePositive: { x: 133.8, y: 58 },
      sourceReturn: { x: 85.8, y: 58 },
      loadPositive: { x: 115.2, y: 22 },
      loadReturn: { x: 67.2, y: 22 },
    });
    expect(longestVerticalSegment(current.output, graph, "W-CTL-001")).toEqual({
      x: 295.4,
      from: 199,
      to: 461,
    });
    expect(longestVerticalSegment(current.output, graph, "W-CTL-002")).toEqual({
      x: 247.4,
      from: 199,
      to: 461,
    });
    const positive = rawNetLabel(current.output, graph, "W-CTL-001");
    const returning = rawNetLabel(current.output, graph, "W-CTL-002");
    expect({
      x: quantizeLayoutNumber(required(positive.x), "B1 +24VDC label x"),
      y: quantizeLayoutNumber(required(positive.y), "B1 +24VDC label y"),
      width: positive.width,
      height: positive.height,
    }).toEqual({ x: 298.4, y: 219, width: 43.2, height: 14 });
    expect({
      x: quantizeLayoutNumber(required(returning.x), "B1 0VDC label x"),
      y: quantizeLayoutNumber(required(returning.y), "B1 0VDC label y"),
      width: returning.width,
      height: returning.height,
    }).toEqual({ x: 250.4, y: 219, width: 30.8, height: 14 });
    const result = normalizeAndValidateLayout(
      graph,
      current.input,
      current.output,
      SYMBOL_CATALOG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expectGeometryContract(result.value);
  });

  it.each(["left-to-right", "top-to-bottom"] as const)(
    "copies real ELK leaf-header coordinates verbatim for %s flow",
    async (flow) => {
      for (const [root, family] of [
        ["K1", "control"],
        ["M1", "power"],
      ] as const) {
        const graph = presentation(coreIr, root, family, flow);
        const { input, output } = await rawLayout(graph);
        const normalized = normalizeAndValidateLayout(
          graph,
          input,
          output,
          SYMBOL_CATALOG,
        );
        expect(normalized.ok).toBe(true);
        if (!normalized.ok) continue;
        const leaves = graph.nodes.filter(({ kind }) => kind !== "junction");
        const rawLabels = rawLeafLabelPositions(
          output,
          new Set(leaves.map(({ id }) => id)),
        );
        expect(rawLabels.size).toBe(leaves.length);
        for (const leaf of leaves) {
          const header = required(
            leaf.labels.find(
              ({ role }) =>
                role === "function" || role === "aggregate" || role === "rail",
            ),
          );
          const raw = required(rawLabels.get(header.id));
          expect(raw.nodeId).toBe(leaf.id);
          expect(quantizeLayoutNumber(raw.localX, `${header.id} raw x`)).toBe(
            flow === "top-to-bottom"
              ? leaf.kind === "rail"
                ? 5
                : 8
              : quantizeLayoutNumber(
                  (leaf.width - header.width) / 2,
                  `${header.id} frozen x`,
                ),
          );
          expect(quantizeLayoutNumber(raw.localY, `${header.id} raw y`)).toBe(
            leaf.kind === "rail" ? 5 : 4,
          );
          const copied = required(
            normalized.value.labels.find(({ id }) => id === header.id),
          );
          expect({ x: copied.x, y: copied.y }).toEqual({
            x: quantizeLayoutNumber(raw.absoluteX, `${header.id} absolute x`),
            y: quantizeLayoutNumber(raw.absoluteY, `${header.id} absolute y`),
          });
        }
      }
    },
  );

  it("normalizes root-owned nested edge sections and labels without container offsets", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const result = normalizeAndValidateLayout(
      graph,
      input,
      output,
      SYMBOL_CATALOG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const semanticNodes = new Map(
      graph.nodes.map((node) => [
        node.id,
        node.kind === "junction"
          ? node.parentId
          : (node.deviceGroupId ?? node.parentId),
      ]),
    );
    const portNode = new Map(
      graph.nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, node.id] as const),
      ),
    );
    const nested = required(
      result.value.edges.find(
        (edge) =>
          semanticNodes.get(required(portNode.get(edge.sourcePortId))) !==
            "root" &&
          semanticNodes.get(required(portNode.get(edge.targetPortId))) !==
            "root",
      ),
    );
    const sourcePort = required(
      result.value.ports.find(({ id }) => id === nested.sourcePortId),
    );
    expect(nested.points[0]).toEqual({ x: sourcePort.x, y: sourcePort.y });
    const raw = required(output.edges?.find(({ id }) => id === nested.id));
    expect(nested.sections[0]!.points[0]).toEqual({
      x: quantizeLayoutNumber(
        raw.sections![0]!.startPoint.x,
        `${nested.id} raw start x`,
      ),
      y: quantizeLayoutNumber(
        raw.sections![0]!.startPoint.y,
        `${nested.id} raw start y`,
      ),
    });
    const rawLabels = raw.labels ?? [];
    for (const label of rawLabels) {
      const normalized = required(
        result.value.labels.find(({ id }) => id === label.id),
      );
      expect({ x: normalized.x, y: normalized.y }).toEqual({
        x: label.x,
        y: label.y,
      });
    }
  });

  it("retains independently addressable nested-compound multi-edge fanout", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const result = await layoutPresentationGraph(graph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.edges.map(({ id }) => id)).toEqual(
      buildElkAdapterGraph(graph).graph.edges!.map(({ id }) => id),
    );
    expect(new Set(result.value.edges.map(({ id }) => id)).size).toBe(
      graph.edges.length,
    );
    const nodeForPort = new Map(
      graph.nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, node.id] as const),
      ),
    );
    const fanout = new Map<string, Set<string>>();
    for (const edge of result.value.edges) {
      for (const portId of [edge.sourcePortId, edge.targetPortId]) {
        const nodeId = required(nodeForPort.get(portId));
        const ports = fanout.get(nodeId) ?? new Set<string>();
        ports.add(portId);
        fanout.set(nodeId, ports);
      }
      expect(edge.sectionIds).toHaveLength(edge.sections.length);
      const sourcePort = required(
        result.value.ports.find(({ id }) => id === edge.sourcePortId),
      );
      expect(edge.points[0]).toEqual({ x: sourcePort.x, y: sourcePort.y });
    }
    expect(Math.max(...[...fanout.values()].map(({ size }) => size))).toBe(4);
  });

  it("reindexes reversed ELK arrays into the same canonical layout", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const baseline = normalizeAndValidateLayout(
      graph,
      input,
      output,
      SYMBOL_CATALOG,
    );
    expect(baseline.ok).toBe(true);
    const reversed = structuredClone(output);
    reverseReturnedArrays(reversed);
    const normalized = normalizeAndValidateLayout(
      graph,
      input,
      reversed,
      SYMBOL_CATALOG,
    );
    expect(normalized).toEqual(baseline);
  });

  it("grows deterministic compound minimums around long locations and designations", async () => {
    for (const [root, family, designation] of [
      ["K1", "control", "PLC1"],
      ["M1", "power", "CB1"],
    ] as const) {
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const ir = structuredClone(coreIr);
        const device = required(
          ir.devices.find((candidate) => candidate.designation === designation),
        );
        const longDesignation = `${designation}-${"LONG".repeat(30)}`;
        device.designation = longDesignation;
        device.location = `LOCATION-${"WIDE".repeat(40)}`;
        const designationIndex = required(
          ir.indexes.objectRefByDesignation.find(
            ({ value }) => value.kind === "device" && value.uid === device.uid,
          ),
        );
        designationIndex.key = longDesignation;
        const graph = presentation(ir, root, family, flow);
        const result = await layoutPresentationGraph(graph);
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const group = required(
          graph.deviceGroups.find(({ deviceUid }) => deviceUid === device.uid),
        );
        const location = required(
          graph.locationGroups.find(({ id }) => id === group.parentId),
        );
        const groupLayout = required(
          result.value.nodes.find(({ id }) => id === group.id),
        );
        const locationLayout = required(
          result.value.nodes.find(({ id }) => id === location.id),
        );
        expect(groupLayout.width).toBeGreaterThanOrEqual(
          group.label.width + 16,
        );
        expect(locationLayout.width).toBeGreaterThanOrEqual(
          location.label.width + 16,
        );
      }
    }
  });

  it("is identical across repeated, concurrent, and reordered calls", async () => {
    const control = presentation(coreIr, "K1", "control", "left-to-right");
    const power = presentation(coreIr, "M1", "power", "top-to-bottom");
    const sequentialControl = await layoutPresentationGraph(control);
    const sequentialPower = await layoutPresentationGraph(power);
    expect(sequentialControl.ok && sequentialPower.ok).toBe(true);
    const [concurrentPower, concurrentControl, repeatedControl] =
      await Promise.all([
        layoutPresentationGraph(power),
        layoutPresentationGraph(control),
        layoutPresentationGraph(control),
      ]);
    expect(concurrentControl).toEqual(sequentialControl);
    expect(repeatedControl).toEqual(sequentialControl);
    expect(concurrentPower).toEqual(sequentialPower);
  });
});

describe("post-layout rejection", () => {
  it("rejects missing, extra, and duplicate returned IDs", async () => {
    const graph = presentation(coreIr, "K1", "control", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const firstNode = required(allNodes(output)[0]);
    const firstPortNode = required(
      allNodes(output).find(({ ports }) => (ports?.length ?? 0) > 0),
    );
    const firstLabelNode = required(
      allNodes(output).find(({ labels }) => (labels?.length ?? 0) > 0),
    );
    const firstLabeledEdge = required(
      output.edges?.find(({ labels }) => (labels?.length ?? 0) > 0),
    );
    const cases: Array<(candidate: ElkNode) => void> = [
      (candidate) => {
        candidate.children!.pop();
      },
      (candidate) => {
        candidate.children!.push({
          id: "unexpected-node",
          x: 20,
          y: 20,
          width: 10,
          height: 10,
        });
      },
      (candidate) => {
        candidate.children!.push(structuredClone(firstNode));
      },
      (candidate) => {
        required(
          allNodes(candidate).find(({ id }) => id === firstPortNode.id)?.ports,
        ).pop();
      },
      (candidate) => {
        required(
          allNodes(candidate).find(({ id }) => id === firstPortNode.id)?.ports,
        ).push({ id: "unexpected-port", x: 0, y: 0, width: 0, height: 0 });
      },
      (candidate) => {
        const ports = required(
          allNodes(candidate).find(({ id }) => id === firstPortNode.id)?.ports,
        );
        ports.push(structuredClone(required(ports[0])));
      },
      (candidate) => {
        candidate.edges!.pop();
      },
      (candidate) => {
        candidate.edges!.push({
          ...structuredClone(required(candidate.edges?.[0])),
          id: "unexpected-edge",
        });
      },
      (candidate) => {
        candidate.edges!.push(structuredClone(required(candidate.edges?.[0])));
      },
      (candidate) => {
        const labels = required(
          allNodes(candidate).find(({ id }) => id === firstLabelNode.id)
            ?.labels,
        );
        labels.push({
          id: "unexpected-label",
          text: "x",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        });
      },
      (candidate) => {
        const labels = required(
          allNodes(candidate).find(({ id }) => id === firstLabelNode.id)
            ?.labels,
        );
        labels.push(structuredClone(required(labels[0])));
      },
      (candidate) => {
        required(
          candidate.edges?.find(({ id }) => id === firstLabeledEdge.id)?.labels,
        ).pop();
      },
      (candidate) => {
        required(
          candidate.edges?.find(({ id }) => id === firstLabeledEdge.id)?.labels,
        ).push({
          id: "unexpected-edge-label",
          text: "x",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        });
      },
      (candidate) => {
        const labels = required(
          candidate.edges?.find(({ id }) => id === firstLabeledEdge.id)?.labels,
        );
        labels.push(structuredClone(required(labels[0])));
      },
    ];
    for (const mutate of cases) {
      const malformed = structuredClone(output);
      mutate(malformed);
      expectR004(graph, input, malformed);
    }
  });

  it("rejects missing label coordinates, non-finite and unsafe coordinates", async () => {
    const graph = presentation(coreIr, "K1", "control", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const missing = structuredClone(output);
    const missingLabel = required(
      allNodes(missing).flatMap(({ labels }) => labels ?? [])[0],
    );
    delete missingLabel.x;
    expectR004(graph, input, missing);

    const missingNodeCoordinate = structuredClone(output);
    delete required(missingNodeCoordinate.children?.[0]).x;
    expectR004(graph, input, missingNodeCoordinate);

    const missingPortCoordinate = structuredClone(output);
    delete required(
      allNodes(missingPortCoordinate).find(
        ({ ports }) => (ports?.length ?? 0) > 0,
      )?.ports?.[0],
    ).x;
    expectR004(graph, input, missingPortCoordinate);

    const missingSectionCoordinate = structuredClone(output);
    delete required(missingSectionCoordinate.edges?.[0]?.sections?.[0])
      .startPoint.x;
    expectR004(graph, input, missingSectionCoordinate);

    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      MAX_SVG_MAGNITUDE + 0.001,
      -MAX_SVG_MAGNITUDE - 0.001,
      1e21,
      -1e21,
    ]) {
      const malformed = structuredClone(output);
      required(malformed.children?.[0]).x = value;
      expectR004(graph, input, malformed);
    }

    const unsafeSum = structuredClone(output);
    const unsafeNode = required(unsafeSum.children?.[0]);
    unsafeNode.x = MAX_SVG_MAGNITUDE - unsafeNode.width! / 2;
    expectR004(graph, input, unsafeSum);

    for (const axis of ["width", "height"] as const) {
      const safePaddedViewBox = structuredClone(output);
      safePaddedViewBox[axis] = MAX_SVG_MAGNITUDE - 40;
      expect(
        normalizeAndValidateLayout(
          graph,
          input,
          safePaddedViewBox,
          SYMBOL_CATALOG,
        ).ok,
      ).toBe(true);

      const unsafePaddedViewBox = structuredClone(output);
      unsafePaddedViewBox[axis] = MAX_SVG_MAGNITUDE - 39;
      expectR004(graph, input, unsafePaddedViewBox);
    }

    const edgeLabel = required(
      output.edges?.find(({ labels }) => (labels?.length ?? 0) > 0)
        ?.labels?.[0],
    );
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? edgeLabel.width! : edgeLabel.height!;
      const translatedOverflow = structuredClone(output);
      const translatedLabel = required(
        translatedOverflow.edges
          ?.find(
            ({ id }) =>
              output.edges?.find(({ labels }) =>
                labels?.some(({ id }) => id === edgeLabel.id),
              )?.id === id,
          )
          ?.labels?.find(({ id }) => id === edgeLabel.id),
      );
      translatedLabel[axis] = MAX_SVG_MAGNITUDE - size - 1;
      expectR004(graph, input, translatedOverflow);

      const negativeUnionOverflow = structuredClone(output);
      const negativeLabel = required(
        negativeUnionOverflow.edges
          ?.flatMap(({ labels }) => labels ?? [])
          .find(({ id }) => id === edgeLabel.id),
      );
      negativeLabel[axis] = -MAX_SVG_MAGNITUDE + 1;
      expectR004(graph, input, negativeUnionOverflow);
    }

    expect(quantizeLayoutNumber(1.23456, "probe")).toBe(1.235);
    expect(quantizeLayoutNumber(-0.0004, "probe")).toBe(0);
  });

  it("rejects changed attachments, dimensions, fixed ports, and role regions", async () => {
    const graph = presentation(coreIr, "K1", "control", "left-to-right");
    const { input, output } = await rawLayout(graph);

    const attachment = structuredClone(output);
    required(attachment.edges?.[0]).sources[0] = "wrong-port";
    expectR004(graph, input, attachment);

    const leafDimensions = structuredClone(output);
    const leaf = required(
      allNodes(leafDimensions).find(({ id }) =>
        graph.nodes.some((node) => node.id === id),
      ),
    );
    leaf.width! += 1;
    expectR004(graph, input, leafDimensions);

    const movedPort = structuredClone(output);
    const portNode = required(
      allNodes(movedPort).find(({ ports }) => (ports?.length ?? 0) > 0),
    );
    required(portNode.ports?.[0]).x! += 1;
    expectR004(graph, input, movedPort);

    const labelDimensions = structuredClone(output);
    const label = required(
      allNodes(labelDimensions).flatMap(({ labels }) => labels ?? [])[0],
    );
    label.width! += 1;
    expectR004(graph, input, labelDimensions);

    const negativeDimension = structuredClone(output);
    required(negativeDimension.children?.[0]).height = -1;
    expectR004(graph, input, negativeDimension);

    const nonFiniteDimension = structuredClone(output);
    nonFiniteDimension.width = Infinity;
    expectR004(graph, input, nonFiniteDimension);

    const wrongRegion = structuredClone(output);
    const terminal = required(
      allNodes(wrongRegion)
        .flatMap(({ ports }) => ports ?? [])
        .flatMap(({ labels }) => labels ?? [])[0],
    );
    terminal.x! += 1;
    expectR004(graph, input, wrongRegion);

    const compoundRegion = structuredClone(output);
    const compoundLabel = required(
      allNodes(compoundRegion).find(
        ({ children, labels }) =>
          children !== undefined && (labels?.length ?? 0) > 0,
      )?.labels?.[0],
    );
    compoundLabel.x = -1;
    expectR004(graph, input, compoundRegion);
  });

  it("rejects collapsed, diagonal, disconnected, wrong-endpoint, and implied-junction routes", async () => {
    const graph = presentation(coreIr, "K1", "control", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const edge = required(output.edges?.[0]);
    const section = required(edge.sections?.[0]);

    const collapsed = structuredClone(output);
    required(collapsed.edges?.[0]?.sections?.[0]).bendPoints = [
      structuredClone(section.startPoint),
    ];
    expectR004(graph, input, collapsed);

    const diagonal = structuredClone(output);
    const diagonalSection = required(diagonal.edges?.[0]?.sections?.[0]);
    diagonalSection.bendPoints = [
      {
        x: diagonalSection.startPoint.x + 1,
        y: diagonalSection.startPoint.y + 1,
      },
    ];
    expectR004(graph, input, diagonal);

    const wrongEndpoint = structuredClone(output);
    required(wrongEndpoint.edges?.[0]?.sections?.[0]).startPoint.x += 1;
    expectR004(graph, input, wrongEndpoint);

    const disconnected = structuredClone(output);
    required(disconnected.edges?.[0]?.sections).push({
      id: "disconnected",
      startPoint: { x: 900_000, y: 900_000 },
      endPoint: { x: 900_010, y: 900_000 },
    });
    expectR004(graph, input, disconnected);

    const branched = structuredClone(output);
    const branchStart = required(
      branched.edges?.[0]?.sections?.[0]?.startPoint,
    );
    required(branched.edges?.[0]?.sections).push({
      id: "branch",
      startPoint: structuredClone(branchStart),
      endPoint: { x: branchStart.x + 10, y: branchStart.y },
    });
    expectR004(graph, input, branched);

    const quantizedCollapse = structuredClone(output);
    const quantizedSection = required(
      quantizedCollapse.edges?.[0]?.sections?.[0],
    );
    quantizedSection.bendPoints = [
      {
        x: quantizedSection.startPoint.x + 0.0004,
        y: quantizedSection.startPoint.y,
      },
    ];
    expectR004(graph, input, quantizedCollapse);

    const impliedJunction = structuredClone(output);
    required(impliedJunction.edges?.[0]).junctionPoints = [{ x: 1, y: 1 }];
    expectR004(graph, input, impliedJunction);
  });

  it("rejects an orthogonal route through an unrelated symbol", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const baseline = normalizeAndValidateLayout(
      graph,
      input,
      output,
      SYMBOL_CATALOG,
    );
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const edge = required(baseline.value.edges[0]);
    const endpointNodes = new Set(
      baseline.value.ports
        .filter(
          ({ id }) => id === edge.sourcePortId || id === edge.targetPortId,
        )
        .map(({ nodeId }) => nodeId),
    );
    const obstacle = required(
      baseline.value.nodes.find(
        ({ id, kind, primitiveOrigin }) =>
          kind === "symbol" &&
          primitiveOrigin !== undefined &&
          !endpointNodes.has(id),
      ),
    );
    const rawEdge = required(output.edges?.find(({ id }) => id === edge.id));
    const source = required(
      baseline.value.ports.find(({ id }) => id === edge.sourcePortId),
    );
    const target = required(
      baseline.value.ports.find(({ id }) => id === edge.targetPortId),
    );
    const center = {
      x:
        obstacle.primitiveOrigin!.x +
        required(graph.nodes.find(({ id }) => id === obstacle.id)!).symbolSize
          .width /
          2,
      y:
        obstacle.primitiveOrigin!.y +
        required(graph.nodes.find(({ id }) => id === obstacle.id)!).symbolSize
          .height /
          2,
    };
    rawEdge.sections = [
      {
        id: "penetrating-section",
        startPoint: { x: source.x, y: source.y },
        bendPoints: [
          { x: source.x, y: center.y },
          center,
          { x: target.x, y: center.y },
        ],
        endPoint: { x: target.x, y: target.y },
      },
    ];
    expectR004(graph, input, output);
  });

  it("throws for malformed adapter input and catalog invariants", async () => {
    const graph = presentation(coreIr, "K1", "control", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const malformedInput = structuredClone(input);
    malformedInput.children!.push(
      structuredClone(required(malformedInput.children?.[0])),
    );
    expect(() =>
      normalizeAndValidateLayout(graph, malformedInput, output, SYMBOL_CATALOG),
    ).toThrow("Layout input invariant");
    expect(() => normalizeAndValidateLayout(graph, input, output, [])).toThrow(
      "Layout input invariant: symbol",
    );
  });

  it("rejects label collisions with symbols, owning edges, and peer labels", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const baseline = normalizeAndValidateLayout(
      graph,
      input,
      output,
      SYMBOL_CATALOG,
    );
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const edgeWithLabel = required(
      output.edges?.find(({ labels }) => (labels?.length ?? 0) > 0),
    );

    const symbolCollision = structuredClone(output);
    const primitive = required(
      baseline.value.nodes.find(
        ({ kind, primitiveOrigin }) =>
          kind === "symbol" && primitiveOrigin !== undefined,
      )?.primitiveOrigin,
    );
    const symbolLabel = required(
      symbolCollision.edges?.find(({ id }) => id === edgeWithLabel.id)
        ?.labels?.[0],
    );
    symbolLabel.x = primitive.x;
    symbolLabel.y = primitive.y;
    expectR004(graph, input, symbolCollision);

    const ownEdgeCollision = structuredClone(output);
    const ownEdge = required(
      ownEdgeCollision.edges?.find(({ id }) => id === edgeWithLabel.id),
    );
    const ownSection = required(ownEdge.sections?.[0]);
    const ownLabel = required(ownEdge.labels?.[0]);
    const start = ownSection.startPoint;
    const end = ownSection.bendPoints?.[0] ?? ownSection.endPoint;
    if (start.y === end.y) {
      ownLabel.x = (start.x + end.x) / 2 - ownLabel.width! / 2;
      ownLabel.y = start.y - ownLabel.height! / 2;
    } else {
      ownLabel.x = start.x - ownLabel.width! / 2;
      ownLabel.y = (start.y + end.y) / 2 - ownLabel.height! / 2;
    }
    expectR004(graph, input, ownEdgeCollision);

    const labelCollision = structuredClone(output);
    const labels = labelCollision.edges!.flatMap(
      (candidate) => candidate.labels ?? [],
    );
    expect(labels.length).toBeGreaterThan(1);
    labels[1]!.x = labels[0]!.x;
    labels[1]!.y = labels[0]!.y;
    expectR004(graph, input, labelCollision);
  });

  it("rejects a terminal label crossed by its own leaf lead", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const baseline = normalizeAndValidateLayout(
      graph,
      input,
      output,
      SYMBOL_CATALOG,
    );
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const portById = new Map(
      baseline.value.ports.map((port) => [port.id, port]),
    );
    const labelByPort = new Map(
      baseline.value.labels
        .filter(
          ({ ownerKind, role }) => ownerKind === "port" && role === "terminal",
        )
        .map((label) => [label.ownerId, label]),
    );
    const candidate = required(
      baseline.value.edges
        .map((edge) => {
          const port = portById.get(edge.sourcePortId);
          const label = labelByPort.get(edge.sourcePortId);
          const first = edge.points[0];
          const second = edge.points[1];
          if (
            port === undefined ||
            label === undefined ||
            first === undefined ||
            second === undefined ||
            (port.side !== "west" && port.side !== "east") ||
            first.y !== second.y
          ) {
            return undefined;
          }
          const beyond =
            port.side === "east" ? label.x + label.width + 2 : label.x - 2;
          const reachesBeyond =
            port.side === "east" ? second.x > beyond : second.x < beyond;
          return reachesBeyond ? { edge, label, port, beyond } : undefined;
        })
        .find((value) => value !== undefined),
    );
    const centerX = candidate.label.x + candidate.label.width / 2;
    const centerY = candidate.label.y + candidate.label.height / 2;
    const original = candidate.edge.points;
    const points = [
      original[0]!,
      { x: candidate.beyond, y: original[0]!.y },
      { x: candidate.beyond, y: centerY },
      { x: centerX, y: centerY },
      { x: centerX, y: original[0]!.y },
      { x: candidate.beyond, y: original[0]!.y },
      ...original.slice(1),
    ];
    const rawEdge = required(
      output.edges?.find(({ id }) => id === candidate.edge.id),
    );
    rawEdge.sections = [
      {
        id: "terminal-label-crossing",
        startPoint: points[0]!,
        bendPoints: points.slice(1, -1),
        endPoint: points.at(-1)!,
      },
    ];
    const message = r004Message(graph, input, output);
    expect(message).toContain(candidate.label.id);
    expect(message).toContain(candidate.edge.id);
    expect(message).toContain("overlaps edge");
  });

  it("rejects an edge label crossed by a lead at a shared endpoint node", async () => {
    const graph = presentation(coreIr, "M1", "power", "left-to-right");
    const { input, output } = await rawLayout(graph);
    const baseline = normalizeAndValidateLayout(
      graph,
      input,
      output,
      SYMBOL_CATALOG,
    );
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const nodeForPort = new Map(
      graph.nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, node.id] as const),
      ),
    );
    let candidate:
      | {
          label: NormalizedSchematicLayout["labels"][number];
          peer: NormalizedSchematicLayout["edges"][number];
          leadStart: { x: number; y: number };
          leadEnd: { x: number; y: number };
        }
      | undefined;
    for (const label of baseline.value.labels) {
      if (label.ownerKind !== "edge" || candidate !== undefined) continue;
      const owner = required(
        baseline.value.edges.find(({ id }) => id === label.ownerId),
      );
      const ownerNodes = new Set([
        nodeForPort.get(owner.sourcePortId),
        nodeForPort.get(owner.targetPortId),
      ]);
      for (const peer of baseline.value.edges) {
        if (peer.id === owner.id) continue;
        const sourceNode = nodeForPort.get(peer.sourcePortId);
        const targetNode = nodeForPort.get(peer.targetPortId);
        let leadStart: { x: number; y: number } | undefined;
        let leadEnd: { x: number; y: number } | undefined;
        if (sourceNode !== undefined && ownerNodes.has(sourceNode)) {
          [leadStart, leadEnd] = peer.points;
        } else if (targetNode !== undefined && ownerNodes.has(targetNode)) {
          leadStart = peer.points.at(-1);
          leadEnd = peer.points.at(-2);
        }
        if (leadStart === undefined || leadEnd === undefined) continue;
        const horizontal = leadStart.y === leadEnd.y;
        const length = horizontal
          ? Math.abs(leadEnd.x - leadStart.x)
          : Math.abs(leadEnd.y - leadStart.y);
        const labelLength = horizontal ? label.width : label.height;
        if (length <= labelLength + 8) continue;
        candidate = { label, peer, leadStart, leadEnd };
        break;
      }
    }
    const found = required(candidate);
    const horizontal = found.leadStart.y === found.leadEnd.y;
    const direction = horizontal
      ? Math.sign(found.leadEnd.x - found.leadStart.x)
      : Math.sign(found.leadEnd.y - found.leadStart.y);
    const center = horizontal
      ? {
          x: found.leadEnd.x - direction * (found.label.width / 2 + 2),
          y: found.leadStart.y,
        }
      : {
          x: found.leadStart.x,
          y: found.leadEnd.y - direction * (found.label.height / 2 + 2),
        };
    const rawLabel = required(
      output.edges
        ?.flatMap(({ labels }) => labels ?? [])
        .find(({ id }) => id === found.label.id),
    );
    rawLabel.x = center.x - found.label.width / 2;
    rawLabel.y = center.y - found.label.height / 2;
    const message = r004Message(graph, input, output);
    expect(message).toContain(found.label.id);
    expect(message).toContain(found.peer.id);
    expect(message).toContain("overlaps edge");
  });

  it("rejects positive-area overlap between two labels on the same leaf", async () => {
    const graph = structuredClone(
      presentation(coreIr, "M1", "power", "left-to-right"),
    );
    const leaf = required(
      graph.nodes.find((node) => {
        if (node.kind === "junction") return false;
        return node.ports.some(
          (port, index) =>
            node.ports.findIndex(
              (candidate) =>
                candidate.side === port.side && candidate.id !== port.id,
            ) > index,
        );
      }),
    );
    if (leaf.kind === "junction") return;
    const first = required(
      leaf.ports.find((port) =>
        leaf.ports.some(
          (candidate) =>
            candidate.id !== port.id && candidate.side === port.side,
        ),
      ),
    );
    const second = required(
      leaf.ports.find(
        (port) => port.id !== first.id && port.side === first.side,
      ),
    );
    (second as { offset: number }).offset = first.offset;
    const firstLabel = required(
      leaf.labels.find(
        ({ ownerKind, ownerId, role }) =>
          ownerKind === "port" && ownerId === first.id && role === "terminal",
      ),
    );
    const secondLabel = required(
      leaf.labels.find(
        ({ ownerKind, ownerId, role }) =>
          ownerKind === "port" && ownerId === second.id && role === "terminal",
      ),
    );
    const { input, output } = await rawLayout(graph);
    const message = r004Message(graph, input, output);
    expect(message).toContain("labels ");
    expect(message).toContain(firstLabel.id);
    expect(message).toContain(secondLabel.id);
    expect(message).toContain(" overlap");
  });
});
