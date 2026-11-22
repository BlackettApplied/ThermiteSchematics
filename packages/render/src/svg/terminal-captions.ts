import { compareText, terminalIdKey } from "../ordering.js";
import { printableLabelGeometry } from "../symbols/printable-label.js";
import type {
  LayoutLabel,
  LayoutNode,
  PresentationGraph,
  PresentationLabel,
  RailPresentationNode,
  SymbolPresentationNode,
} from "../types.js";

function bodyDistance(
  caption: PresentationLabel,
  label: LayoutLabel,
  node: SymbolPresentationNode | RailPresentationNode,
  layout: LayoutNode,
): number {
  const origin = layout.primitiveOrigin;
  if (!origin)
    throw Error(`Terminal caption ${caption.id} has no body origin.`);
  const ink = printableLabelGeometry(
    label,
    caption.printableText ?? caption.text,
    caption.textLength,
  ).ink;
  return Math.hypot(
    Math.max(
      origin.x - ink.right,
      ink.left - origin.x - node.symbolSize.width,
      0,
    ),
    Math.max(
      origin.y - ink.bottom,
      ink.top - origin.y - node.symbolSize.height,
      0,
    ),
  );
}

/** Suppress ink only: every port, label reservation and route stays intact.
 * Ownership is per node appearance, so a split/continuation body keeps its own
 * caption. Prefer the existing caption slot nearest the body, then catalog port
 * order and port ID. Neither traversal order nor electrical identity breaks ties.
 */
export function duplicateTerminalCaptionIds(
  graph: Readonly<PresentationGraph>,
  labels: readonly LayoutLabel[],
  nodeLayouts: ReadonlyMap<string, LayoutNode>,
): ReadonlySet<string> {
  const positions = new Map(labels.map((label) => [label.id, label]));
  const hidden = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const layout = nodeLayouts.get(node.id);
    if (!layout) throw Error(`Terminal caption body ${node.id} has no layout.`);
    const candidates = node.labels
      .filter((label) => label.role === "terminal")
      .map((caption) => {
        const port = node.ports.find((p) => p.id === caption.ownerId);
        const position = positions.get(caption.id);
        if (!port || !position)
          throw Error(
            `Terminal caption ${caption.id} has no owned port or position.`,
          );
        return {
          caption,
          port,
          distance: bodyDistance(caption, position, node, layout),
        };
      })
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.port.order - b.port.order ||
          compareText(a.port.symbolPortId, b.port.symbolPortId),
      );
    const seen = new Set<string>();
    for (const { caption, port } of candidates) {
      const terminal = terminalIdKey(port.terminal);
      if (seen.has(terminal)) hidden.add(caption.id);
      seen.add(terminal);
    }
  }
  return hidden;
}
