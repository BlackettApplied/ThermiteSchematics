import type { PresentationGraph } from "../types.js";

/** A captioned pole has a wider transverse reservation than a blank pole.
 * Give ELK a turn lane beside that reservation instead of moving terminals or
 * equalising every phase card, which can make narrow paper unprintable. */
export function reservePowerJogSpace(
  graph: PresentationGraph,
  clearance: number,
): PresentationGraph {
  if (
    !clearance ||
    graph.view.family !== "power" ||
    graph.view.flow !== "top-to-bottom"
  )
    return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.kind === "symbol" &&
      node.classification === "power-contact" &&
      node.labels.some((l) => l.role === "function" && l.printableText)
        ? { ...node, width: node.width + 2 * clearance }
        : node,
    ),
  };
}
