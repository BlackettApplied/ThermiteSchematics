import type { ElkNode } from "elkjs/lib/elk-api.js";

/** Equal 7 mm fixed pitches: ELK's dummy label bank shifts the far node. */
export function parallelLabelGraph(vertical = false): ElkNode {
  return {
    id: "parallel",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "5",
      "elk.layered.spacing.nodeNodeBetweenLayers": "7",
      "elk.spacing.edgeNode": "3",
      "elk.spacing.edgeEdge": "3",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "3",
      "elk.layered.spacing.edgeNodeBetweenLayers": "3",
      "elk.spacing.edgeLabel": "1",
      "elk.padding": "[top=2,left=2,bottom=2,right=2]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.mergeEdges": "false",
    },
    children: ["a", "b"].map((id) => ({
      id,
      width: 30,
      height: 30,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [8, 15, 22].map((pitch, i) => ({
        id: id + i,
        x: vertical ? pitch : id === "a" ? 30 : 0,
        y: vertical ? (id === "a" ? 30 : 0) : pitch,
        width: 0,
        height: 0,
        layoutOptions: {
          "elk.port.side": vertical
            ? id === "a"
              ? "SOUTH"
              : "NORTH"
            : id === "a"
              ? "EAST"
              : "WEST",
        },
      })),
    })),
    edges: [0, 1, 2].map((i) => ({
      id: `e${i}`,
      sources: [`a${i}`],
      targets: [`b${i}`],
      labels: [
        {
          text: `W${i}`,
          width: 6,
          height: 3.8,
          layoutOptions: { "elk.edgeLabels.inline": "true" },
        },
      ],
    })),
  };
}
