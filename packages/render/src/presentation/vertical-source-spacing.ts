import {
  orientSymbolDefinition,
  verticalSourcePortSpacing,
} from "../symbols/catalog.js";
import type { SymbolDefinition } from "../symbols/types.js";
import { labelInkWidth, originatingSymbolPortId } from "./net-label-wrap.js";
import type { PresentationGraph, SymbolPresentationNode } from "../types.js";

export { originatingSymbolPortId };

// Own-wire label offset (~3-4 units) plus DQ-16 foreign-wire ownership margin (>0.5 mm at 0.25 mm/unit).
export const MIN_PITCH_CLEARANCE = 12;
const COMPACT_HEADER_MARGIN = 8;

function collidingSourceInkWidth(
  graph: Readonly<PresentationGraph>,
  node: SymbolPresentationNode,
  collidingNetLabelIds: ReadonlySet<string>,
): number {
  const southPorts = node.ports
    .filter((port) => port.side === "south")
    .sort((left, right) => left.offset - right.offset);
  if (southPorts.length < 2) return 0;
  let hasCollision = false;
  let maxInkWidth = 0;
  for (let i = 0; i < southPorts.length - 1; i++) {
    const port = southPorts[i];
    if (port === undefined) continue;
    for (const edge of graph.edges) {
      if (edge.netLabel === undefined) continue;
      if (originatingSymbolPortId(graph, edge) !== port.id) continue;
      if (collidingNetLabelIds.has(edge.netLabel.id)) hasCollision = true;
      maxInkWidth = Math.max(maxInkWidth, labelInkWidth(edge.netLabel));
    }
  }
  return hasCollision ? maxInkWidth : 0;
}

function widenedNodeGeometry(
  node: SymbolPresentationNode,
  targetWidth: number,
): SymbolPresentationNode {
  if (node.contentBox === undefined) {
    const headerWidth = Math.max(
      0,
      ...node.labels
        .filter(
          (label) =>
            label.ownerKind === "symbol" &&
            (label.role === "function" || label.role === "aggregate"),
        )
        .map((label) => label.width),
    );
    const contentWidth = Number(
      (Math.max(targetWidth, headerWidth) + COMPACT_HEADER_MARGIN * 2).toFixed(
        3,
      ),
    );
    return {
      ...node,
      symbolSize: { width: targetWidth, height: node.symbolSize.height },
      primitiveOrigin: { x: COMPACT_HEADER_MARGIN, y: node.primitiveOrigin.y },
      width: contentWidth,
    };
  }
  const deltaWidth = targetWidth - node.symbolSize.width;
  const oldSymbolRight = node.primitiveOrigin.x + node.symbolSize.width;
  const shiftedLabels = node.labels.map((label) => {
    if (!label.offView || label.offView.position.x < oldSymbolRight - 0.01) {
      return label;
    }
    return {
      ...label,
      offView: {
        ...label.offView,
        position: {
          x: Number((label.offView.position.x + deltaWidth).toFixed(3)),
          y: label.offView.position.y,
        },
      },
    };
  });
  return {
    ...node,
    symbolSize: { width: targetWidth, height: node.symbolSize.height },
    contentBox: {
      ...node.contentBox,
      width: Number((node.contentBox.width + deltaWidth).toFixed(3)),
    },
    width: Number((node.width + deltaWidth).toFixed(3)),
    labels: shiftedLabels,
  };
}

/**
 * Only after an initial top-to-bottom layout fails with a measured net-label
 * collision (adjacent conductor, non-owner frame or terminal marking), expand
 * the colliding multi-port source symbol's horizontal port pitch by the
 * minimum needed for actual glyph ink clearance. Left-to-right flow and
 * non-colliding top-to-bottom drawings are never modified.
 */
export function widenCollidingVerticalSources(
  graph: Readonly<PresentationGraph>,
  collidingNetLabelIds: ReadonlySet<string>,
  catalog: readonly SymbolDefinition[],
): PresentationGraph | undefined {
  if (graph.view.flow !== "top-to-bottom" || collidingNetLabelIds.size === 0) {
    return undefined;
  }
  const symbolById = new Map(catalog.map((symbol) => [symbol.id, symbol]));
  let changed = false;
  const nextNodes = graph.nodes.map((node) => {
    if (node.kind !== "symbol" || node.orientation !== "top-to-bottom") {
      return node;
    }
    const spec = verticalSourcePortSpacing(node.symbolId);
    if (spec === undefined) return node;
    const maxInkWidth = collidingSourceInkWidth(
      graph,
      node,
      collidingNetLabelIds,
    );
    if (maxInkWidth <= 0) return node;
    const symbol = symbolById.get(node.symbolId);
    if (symbol === undefined) return node;
    const pitch = Math.ceil((maxInkWidth + MIN_PITCH_CLEARANCE) / 2) * 2;
    const targetWidth = spec.widthForPitch(pitch);
    if (targetWidth <= node.symbolSize.width) return node;
    orientSymbolDefinition(symbol, "top-to-bottom", targetWidth);
    changed = true;
    return widenedNodeGeometry(node, targetWidth);
  });
  return changed ? { ...graph, nodes: nextNodes } : undefined;
}
