import type { PresentationGraph } from "../types.js";

/** Native comparison only: preserve all selected electrical and reference edges. */
export function nativeReservations(
  graph: PresentationGraph,
): PresentationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind === "junction" || !node.contentBox) return node;
      const { contentBox: box, ...native } = node;
      return {
        ...native,
        width: box.width,
        height: box.height,
        primitiveOrigin: {
          x: node.primitiveOrigin.x - box.x,
          y: node.primitiveOrigin.y - box.y,
        },
        labels: node.labels.filter((l) => !l.offView),
      };
    }),
  };
}
