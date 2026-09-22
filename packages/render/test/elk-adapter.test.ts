import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr } from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildElkAdapterGraph,
  serializeElkAdapterForTest,
  validateElkRuntimeOptions,
} from "../src/layout/elk-adapter.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import { buildPresentationGraph } from "../src/presentation.js";
import type { PresentationGraph } from "../src/types.js";
import {
  compileCoreFixture,
  required,
  selectCoreSubgraph,
} from "./fixtures.js";

const ElkConstructor = BundledElk as unknown as { new (): ELK };
const testRoot = dirname(fileURLToPath(import.meta.url));

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

function presentation(
  root: string,
  family: "control" | "power",
  flow: "left-to-right" | "top-to-bottom" = "left-to-right",
): PresentationGraph {
  const result = buildPresentationGraph({
    ir: coreIr,
    selected: selectCoreSubgraph(coreIr, root, family, flow),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.graph;
}

function nodes(root: Readonly<ElkNode>): ElkNode[] {
  return (root.children ?? []).flatMap((child) => [child, ...nodes(child)]);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

describe("pinned ELK adapter", () => {
  it("matches the complete reviewed adapter and option-assignment golden", () => {
    const builds = [
      buildElkAdapterGraph(presentation("K1", "control", "left-to-right")),
      buildElkAdapterGraph(presentation("K1", "control", "top-to-bottom")),
      buildElkAdapterGraph(presentation("M1", "power", "left-to-right")),
      buildElkAdapterGraph(presentation("M1", "power", "top-to-bottom")),
    ];
    const serialized = builds.map(serializeElkAdapterForTest).join("\n");
    const golden = JSON.parse(
      readFileSync(join(testRoot, "elk-options.golden.json"), "utf8"),
    ) as {
      readonly adapterSha256: string;
      readonly assignmentSha256: string;
      readonly assignmentCounts: readonly number[];
      readonly optionCount: number;
    };
    expect({
      adapterSha256: sha256(serialized),
      assignmentSha256: sha256(
        canonical(builds.map(({ optionAssignments }) => optionAssignments)),
      ),
      assignmentCounts: builds.map(
        ({ optionAssignments }) => optionAssignments.length,
      ),
      optionCount: new Set(
        builds.flatMap(({ optionAssignments }) =>
          optionAssignments.map(({ option }) => option),
        ),
      ).size,
    }).toEqual(golden);
  });

  it("puts every option on a legal pinned-runtime target", async () => {
    const build = buildElkAdapterGraph(presentation("M1", "power"));
    const metadata = await validateElkRuntimeOptions(build);
    expect(metadata).toHaveLength(
      new Set(build.optionAssignments.map(({ option }) => option)).size,
    );
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.nodeLabelsPadding,
      type: "OBJECT",
      targets: ["PARENTS"],
    });
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.nodeLabelsPlacement,
      type: "ENUMSET",
      targets: ["LABELS", "NODES"],
    });
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.portLabelsPlacement,
      type: "ENUMSET",
      targets: ["NODES"],
    });
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.edgeLabelsInline,
      type: "BOOLEAN",
      targets: ["LABELS"],
    });
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.labelPortHorizontalSpacing,
      type: "DOUBLE",
      targets: ["PARENTS"],
    });
    const leafId = required(
      nodes(build.graph).find(({ children }) => children === undefined)?.id,
    );
    for (const option of [
      ELK_OPTIONS.nodeLabelsPadding,
      ELK_OPTIONS.labelPortHorizontalSpacing,
      ELK_OPTIONS.labelPortVerticalSpacing,
    ]) {
      await expect(
        validateElkRuntimeOptions({
          graph: build.graph,
          optionAssignments: [
            {
              targetKind: "node",
              targetId: leafId,
              option,
              value: "4",
            },
          ],
        }),
      ).rejects.toThrow(`cannot target node ${leafId}`);
    }
    await expect(
      validateElkRuntimeOptions({
        graph: build.graph,
        optionAssignments: [
          {
            targetKind: "parent",
            targetId: leafId,
            option: ELK_OPTIONS.labelPortHorizontalSpacing,
            value: "4",
          },
        ],
      }),
    ).rejects.toThrow(`targets non-parent ${leafId}`);
  });

  it("uses exact hierarchy, compound contracts, boundary constraints, and port anchors", () => {
    const graph = presentation("M1", "power");
    const build = buildElkAdapterGraph(graph);
    const root = build.graph;
    expect(root.layoutOptions).toMatchObject({
      [ELK_OPTIONS.direction]: "RIGHT",
      [ELK_OPTIONS.hierarchyHandling]: "INCLUDE_CHILDREN",
      [ELK_OPTIONS.edgeCoords]: "ROOT",
      [ELK_OPTIONS.mergeEdges]: "false",
      [ELK_OPTIONS.mergeHierarchyEdges]: "false",
      [ELK_OPTIONS.padding]: "[top=16,left=16,bottom=16,right=16]",
    });
    expect(root.edges).toHaveLength(graph.edges.length);

    const byId = new Map(nodes(root).map((node) => [node.id, node]));
    for (const group of graph.locationGroups) {
      const node = required(byId.get(group.id));
      expect(node.layoutOptions).toMatchObject({
        [ELK_OPTIONS.padding]: "[top=38,left=16,bottom=16,right=16]",
        [ELK_OPTIONS.nodeLabelsPadding]: "[top=8,left=8,bottom=8,right=8]",
        [ELK_OPTIONS.nodeSizeConstraints]: "NODE_LABELS MINIMUM_SIZE",
        [ELK_OPTIONS.nodeSizeMinimum]: `(${Math.max(32, group.label.width + 16)},54)`,
      });
    }
    for (const group of graph.deviceGroups) {
      const node = required(byId.get(group.id));
      expect(node.layoutOptions).toMatchObject({
        [ELK_OPTIONS.padding]: "[top=30,left=8,bottom=8,right=8]",
        [ELK_OPTIONS.nodeLabelsPadding]: "[top=4,left=8,bottom=4,right=8]",
        [ELK_OPTIONS.nodeSizeConstraints]: "NODE_LABELS MINIMUM_SIZE",
        [ELK_OPTIONS.nodeSizeMinimum]: `(${Math.max(16, group.label.width + 16)},38)`,
        [ELK_OPTIONS.labelPortHorizontalSpacing]: "4",
        [ELK_OPTIONS.labelPortVerticalSpacing]: "4",
      });
    }
    for (const semantic of graph.nodes) {
      const node = required(byId.get(semantic.id));
      if (semantic.kind === "junction") continue;
      expect(node.width).toBe(semantic.width);
      expect(node.height).toBe(semantic.height);
      expect(node.layoutOptions?.[ELK_OPTIONS.portConstraints]).toBe(
        "FIXED_POS",
      );
      expect(node.layoutOptions).not.toHaveProperty(
        ELK_OPTIONS.nodeLabelsPadding,
      );
      expect(node.layoutOptions).not.toHaveProperty(
        ELK_OPTIONS.labelPortHorizontalSpacing,
      );
      const header = required(
        semantic.labels.find(
          ({ role }) =>
            role === "function" || role === "aggregate" || role === "rail",
        ),
      );
      const adaptedHeader = required(
        node.labels?.find(({ id }) => id === header.id),
      );
      expect({ x: adaptedHeader.x, y: adaptedHeader.y }).toEqual({
        x: Number(((semantic.width - header.width) / 2).toFixed(3)),
        y: semantic.kind === "rail" ? 5 : 4,
      });
      expect(adaptedHeader.layoutOptions).toEqual({
        [ELK_OPTIONS.nodeLabelsPlacement]: "INSIDE",
      });
      if (semantic.boundaryConstraint !== undefined) {
        expect(node.layoutOptions?.[ELK_OPTIONS.layerConstraint]).toBe(
          semantic.boundaryConstraint,
        );
      }
      for (const port of semantic.ports) {
        const adapted = required(node.ports?.find(({ id }) => id === port.id));
        expect(adapted.layoutOptions?.[ELK_OPTIONS.portSide]).toBe(
          port.side.toUpperCase(),
        );
        const expected =
          port.side === "west"
            ? {
                x: semantic.primitiveOrigin.x,
                y:
                  semantic.primitiveOrigin.y +
                  port.offset * semantic.symbolSize.height,
              }
            : port.side === "east"
              ? {
                  x: semantic.primitiveOrigin.x + semantic.symbolSize.width,
                  y:
                    semantic.primitiveOrigin.y +
                    port.offset * semantic.symbolSize.height,
                }
              : port.side === "north"
                ? {
                    x:
                      semantic.primitiveOrigin.x +
                      port.offset * semantic.symbolSize.width,
                    y: semantic.primitiveOrigin.y,
                  }
                : {
                    x:
                      semantic.primitiveOrigin.x +
                      port.offset * semantic.symbolSize.width,
                    y: semantic.primitiveOrigin.y + semantic.symbolSize.height,
                  };
        expect({ x: adapted.x, y: adapted.y }).toEqual(expected);
      }
    }
    expect(
      graph.nodes
        .filter(
          (node) =>
            node.kind !== "junction" && node.boundaryConstraint !== undefined,
        )
        .map(({ boundaryConstraint }) => boundaryConstraint),
    ).toEqual(expect.arrayContaining(["FIRST", "LAST"]));
    const downGraph = presentation("M1", "power", "top-to-bottom");
    const downRoot = buildElkAdapterGraph(downGraph).graph;
    expect(downRoot.layoutOptions?.[ELK_OPTIONS.direction]).toBe("DOWN");
    const downById = new Map(nodes(downRoot).map((node) => [node.id, node]));
    for (const semantic of downGraph.nodes) {
      if (semantic.kind === "junction") continue;
      const node = required(downById.get(semantic.id));
      expect(node.layoutOptions?.[ELK_OPTIONS.nodeLabelsPlacement]).toBe(
        "INSIDE H_LEFT V_TOP",
      );
      const header = required(
        semantic.labels.find(
          ({ role }) =>
            role === "function" || role === "aggregate" || role === "rail",
        ),
      );
      expect(semantic.primitiveOrigin.x - (8 + header.width)).toBeCloseTo(8);
      const adaptedHeader = required(
        node.labels?.find(({ id }) => id === header.id),
      );
      expect({ x: adaptedHeader.x, y: adaptedHeader.y }).toEqual({
        x: semantic.kind === "rail" ? 5 : 8,
        y: semantic.kind === "rail" ? 5 : 4,
      });
      expect(adaptedHeader.layoutOptions).toEqual({
        [ELK_OPTIONS.nodeLabelsPlacement]: "INSIDE",
      });
    }

    for (const [candidate, axis] of [
      [graph, "y"],
      [downGraph, "x"],
    ] as const) {
      for (const semantic of candidate.nodes.filter(
        (node) =>
          node.kind === "symbol" &&
          (node.symbolId === "ais:power-source-3ph" ||
            node.symbolId === "ais:motor-3ph"),
      )) {
        const adapted = required(
          new Map(
            nodes(axis === "y" ? root : downRoot).map((node) => [
              node.id,
              node,
            ]),
          ).get(semantic.id),
        );
        const coordinates = adapted
          .ports!.map((port) => port[axis] as number)
          .sort((left, right) => left - right);
        expect(
          coordinates
            .slice(1)
            .map((value, index) => value - coordinates[index]!),
        ).toEqual([24, 24, 24]);
      }
    }
    expect(24 - (4 + 14)).toBe(6);
    expect(24 - (4 + 18.4)).toBeCloseTo(1.6);
  });
});

describe("observable ELK option placement probes", () => {
  async function portLabelProbe(
    target: "none" | "label" | "node",
  ): Promise<number> {
    const label: {
      id: string;
      text: string;
      width: number;
      height: number;
      layoutOptions?: Record<string, string>;
    } = { id: "label", text: "x", width: 10, height: 4 };
    const leaf: ElkNode = {
      id: "leaf",
      width: 20,
      height: 20,
      layoutOptions: { [ELK_OPTIONS.portConstraints]: "FIXED_POS" },
      ports: [
        {
          id: "port",
          x: 0,
          y: 10,
          width: 0,
          height: 0,
          labels: [label],
          layoutOptions: {
            [ELK_OPTIONS.portSide]: "WEST",
            [ELK_OPTIONS.portIndex]: "0",
          },
        },
      ],
    };
    const placement = "INSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE";
    if (target === "node")
      leaf.layoutOptions![ELK_OPTIONS.portLabelsPlacement] = placement;
    if (target === "label")
      label.layoutOptions = { [ELK_OPTIONS.portLabelsPlacement]: placement };
    const output = await new ElkConstructor().layout({
      id: "root",
      layoutOptions: {
        [ELK_OPTIONS.algorithm]: "layered",
        [ELK_OPTIONS.hierarchyHandling]: "INCLUDE_CHILDREN",
        [ELK_OPTIONS.labelPortHorizontalSpacing]: "1",
        [ELK_OPTIONS.labelPortVerticalSpacing]: "1",
      },
      children: [
        {
          id: "source",
          width: 10,
          height: 10,
          ports: [
            {
              id: "source-port",
              width: 0,
              height: 0,
              layoutOptions: { [ELK_OPTIONS.portSide]: "EAST" },
            },
          ],
        },
        leaf,
      ],
      edges: [
        {
          id: "edge",
          sources: ["source-port"],
          targets: ["port"],
        },
      ],
    });
    return required(output.children?.find(({ id }) => id === "leaf")).ports![0]!
      .labels![0]!.x!;
  }

  it("places port labels only when placement targets the leaf", async () => {
    expect(await portLabelProbe("none")).toBe(-11);
    expect(await portLabelProbe("label")).toBe(-11);
    expect(await portLabelProbe("node")).toBe(1);
  });

  async function spacingProbe(
    target: "none" | "leaf" | "parent",
    side: "WEST" | "NORTH",
  ): Promise<number> {
    const horizontal = side === "WEST";
    const leafOptions: Record<string, string> = {
      [ELK_OPTIONS.portConstraints]: "FIXED_POS",
      [ELK_OPTIONS.portLabelsPlacement]:
        "OUTSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE",
    };
    const rootOptions: Record<string, string> = {
      [ELK_OPTIONS.algorithm]: "layered",
      [ELK_OPTIONS.hierarchyHandling]: "INCLUDE_CHILDREN",
    };
    const spacing = horizontal
      ? ELK_OPTIONS.labelPortHorizontalSpacing
      : ELK_OPTIONS.labelPortVerticalSpacing;
    if (target === "leaf") leafOptions[spacing] = "7";
    if (target === "parent") rootOptions[spacing] = "7";
    const output = await new ElkConstructor().layout({
      id: "root",
      layoutOptions: rootOptions,
      children: [
        {
          id: "source",
          width: 10,
          height: 10,
          ports: [
            {
              id: "source-port",
              width: 0,
              height: 0,
              layoutOptions: {
                [ELK_OPTIONS.portSide]: horizontal ? "EAST" : "SOUTH",
              },
            },
          ],
        },
        {
          id: "leaf",
          width: 20,
          height: 20,
          layoutOptions: leafOptions,
          ports: [
            {
              id: "port",
              x: horizontal ? 0 : 10,
              y: horizontal ? 10 : 0,
              width: 0,
              height: 0,
              labels: [{ id: "label", text: "x", width: 10, height: 4 }],
              layoutOptions: {
                [ELK_OPTIONS.portSide]: side,
                [ELK_OPTIONS.portIndex]: "0",
              },
            },
          ],
        },
      ],
      edges: [{ id: "edge", sources: ["source-port"], targets: ["port"] }],
    });
    const label = required(output.children?.find(({ id }) => id === "leaf"))
      .ports![0]!.labels![0]!;
    return horizontal
      ? -(label.x! + label.width!)
      : -(label.y! + label.height!);
  }

  it("applies horizontal and vertical label-port spacing only on the parent", async () => {
    for (const side of ["WEST", "NORTH"] as const) {
      const control = await spacingProbe("none", side);
      expect(await spacingProbe("leaf", side)).toBe(control);
      const parent = await spacingProbe("parent", side);
      expect(parent).toBe(7);
      expect(parent).not.toBe(control);
    }
  });

  it("keeps the interior anchor only with FIXED_POS, not FIXED_ORDER", async () => {
    async function positioned(
      constraint: "FIXED_POS" | "FIXED_ORDER",
    ): Promise<readonly number[]> {
      const output = await new ElkConstructor().layout({
        id: "root",
        layoutOptions: { [ELK_OPTIONS.algorithm]: "layered" },
        children: [
          {
            id: "source",
            width: 20,
            height: 20,
            layoutOptions: { [ELK_OPTIONS.portConstraints]: constraint },
            ports: [
              {
                id: "source-port",
                x: 0,
                y: 3,
                width: 0,
                height: 0,
                layoutOptions: {
                  [ELK_OPTIONS.portSide]: "WEST",
                  [ELK_OPTIONS.portIndex]: "0",
                },
              },
              {
                id: "source-port-2",
                x: 0,
                y: 17,
                width: 0,
                height: 0,
                layoutOptions: {
                  [ELK_OPTIONS.portSide]: "WEST",
                  [ELK_OPTIONS.portIndex]: "1",
                },
              },
            ],
          },
          { id: "target", width: 20, height: 20 },
        ],
        edges: [
          { id: "edge", sources: ["source-port"], targets: ["target"] },
          { id: "edge-2", sources: ["source-port-2"], targets: ["target"] },
        ],
      });
      return required(
        output.children?.find(({ id }) => id === "source")?.ports,
      ).map(({ y }) => required(y));
    }
    expect(await positioned("FIXED_POS")).toEqual([3, 17]);
    expect(await positioned("FIXED_ORDER")).not.toEqual([3, 17]);
  });

  it("keeps a per-label non-inline edge label off its routed segment", async () => {
    const output = await new ElkConstructor().layout({
      id: "root",
      layoutOptions: {
        [ELK_OPTIONS.algorithm]: "layered",
        [ELK_OPTIONS.edgeRouting]: "ORTHOGONAL",
        [ELK_OPTIONS.edgeLabelSpacing]: "4",
      },
      children: [
        { id: "a", width: 20, height: 20 },
        { id: "b", width: 20, height: 20 },
      ],
      edges: [
        {
          id: "edge",
          sources: ["a"],
          targets: ["b"],
          labels: [
            {
              id: "edge-label",
              text: "label",
              width: 30,
              height: 10,
              layoutOptions: {
                [ELK_OPTIONS.edgeLabelsPlacement]: "CENTER",
                [ELK_OPTIONS.edgeLabelsInline]: "false",
              },
            },
          ],
        },
      ],
    });
    const edge = output.edges![0]!;
    const label = edge.labels![0]!;
    const points = [
      edge.sections![0]!.startPoint,
      ...(edge.sections![0]!.bendPoints ?? []),
      edge.sections![0]!.endPoint,
    ];
    const crossesInterior = points.slice(1).some((end, index) => {
      const start = points[index]!;
      if (start.y === end.y)
        return (
          start.y > label.y! &&
          start.y < label.y! + label.height! &&
          Math.min(Math.max(start.x, end.x), label.x! + label.width!) >
            Math.max(Math.min(start.x, end.x), label.x!)
        );
      return (
        start.x > label.x! &&
        start.x < label.x! + label.width! &&
        Math.min(Math.max(start.y, end.y), label.y! + label.height!) >
          Math.max(Math.min(start.y, end.y), label.y!)
      );
    });
    expect(crossesInterior).toBe(false);
  });
});
