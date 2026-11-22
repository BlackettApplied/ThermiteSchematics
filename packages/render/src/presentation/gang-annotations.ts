import type { ElectricalIr } from "@thermite/compiler";
import type { PresentationGraph, SymbolPresentationNode } from "../types.js";
import { visibleRootedGangs } from "../symbols/gang-geometry.js";
import {
  contactCaptionSymbol,
  contactCaptionWidth,
} from "./contact-caption.js";

function captionReservation(
  node: SymbolPresentationNode,
): SymbolPresentationNode {
  if (
    !node.mechanicalGangId ||
    node.orientation !== "left-to-right" ||
    !contactCaptionSymbol(node.symbolId)
  )
    return node;
  const labels = node.labels.map((label) => {
    if (label.ownerId !== node.id || label.role !== "function") return label;
    const width = contactCaptionWidth(label);
    return { ...label, width, textLength: Number((width - 6).toFixed(3)) };
  });
  const header = labels.find(
    (l) => l.ownerId === node.id && l.role === "function",
  );
  if (!header) return node;
  const width = Math.max(node.symbolSize.width + 16, header.width + 16);
  return {
    ...node,
    labels,
    width,
    primitiveOrigin: {
      ...node.primitiveOrigin,
      x: Number(((width - node.symbolSize.width) / 2).toFixed(3)),
    },
  };
}

/** Use drawn members, including collapsed aggregate representations, once for
 * both required caption and card reservations. Optional control gangs retain
 * native geometry. Never infer visibility from selection. */
export function reserveGangAnnotations(
  ir: Readonly<ElectricalIr>,
  graph: PresentationGraph,
): PresentationGraph {
  const ids = new Map(
    visibleRootedGangs(ir, graph)
      .filter((g) => g.mandatory)
      .flatMap(({ group, members }) =>
        members.map((n) => [n.id, group.id] as const),
      ),
  );
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "symbol") return node;
      const { mechanicalGangId: previous, ...native } = node;
      const id = ids.get(node.id);
      return id === undefined
        ? native
        : captionReservation({ ...native, mechanicalGangId: id });
    }),
  };
}
