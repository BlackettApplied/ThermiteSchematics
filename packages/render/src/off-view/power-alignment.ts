import type {
  PresentationGraph,
  RailPresentationNode,
  SymbolPresentationNode,
} from "../types.js";

/** Keep the source rails and poles of parallel power phases at matching primitive offsets.
 * Unequal card margins must not displace one phase's aligned downstream poles. */
export function alignPowerCardReservations(
  graph: PresentationGraph,
): PresentationGraph {
  if (graph.view.family !== "power") return graph;
  const groups = new Map<
    string,
    (RailPresentationNode | SymbolPresentationNode)[]
  >();
  for (const node of graph.nodes)
    if (
      node.kind === "rail" ||
      (node.kind === "symbol" &&
        ["ais:breaker-pole", "ais:disconnector"].includes(node.symbolId))
    ) {
      const key = JSON.stringify([node.deviceUid, node.symbolId]);
      groups.set(key, [...(groups.get(key) ?? []), node]);
    }
  const replacements = new Map<
    string,
    RailPresentationNode | SymbolPresentationNode
  >();
  for (const group of groups.values()) {
    if (group.length < 2 || !group.some((n) => n.contentBox)) continue;
    const left = Math.max(...group.map((n) => n.primitiveOrigin.x)),
      top = Math.max(...group.map((n) => n.primitiveOrigin.y)),
      right = Math.max(...group.map((n) => n.width - n.primitiveOrigin.x)),
      bottom = Math.max(...group.map((n) => n.height - n.primitiveOrigin.y));
    for (const node of group) {
      const vertical = graph.view.flow === "top-to-bottom";
      const dx = vertical ? 0 : left - node.primitiveOrigin.x,
        dy = vertical ? top - node.primitiveOrigin.y : 0,
        box = node.contentBox ?? {
          x: 0,
          y: 0,
          width: node.width,
          height: node.height,
        };
      replacements.set(node.id, {
        ...node,
        width: vertical ? node.width : Math.ceil(left + right),
        height: vertical ? Math.ceil(top + bottom) : node.height,
        primitiveOrigin: {
          x: vertical ? node.primitiveOrigin.x : left,
          y: vertical ? top : node.primitiveOrigin.y,
        },
        contentBox: { ...box, x: box.x + dx, y: box.y + dy },
        labels: node.labels.map((label) =>
          label.offView
            ? {
                ...label,
                offView: {
                  ...label.offView,
                  position: {
                    x: label.offView.position.x + dx,
                    y: label.offView.position.y + dy,
                  },
                },
              }
            : label,
        ),
      });
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.map((n) => replacements.get(n.id) ?? n),
  };
}
