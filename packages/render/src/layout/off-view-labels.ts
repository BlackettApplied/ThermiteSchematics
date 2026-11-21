import { compareText } from "../ordering.js";
import { required } from "../presentation/util.js";
import type { ElkLabel } from "elkjs/lib/elk-api.js";
import type { SymbolPresentationNode, RailPresentationNode } from "../types.js";

export function offViewAdapterLabels(
  node: SymbolPresentationNode | RailPresentationNode,
): ElkLabel[] {
  return node.labels
    .filter((l) => l.offView)
    .sort((a, b) => compareText(a.id, b.id))
    .map((l) => ({
      id: l.id,
      text: l.text,
      width: l.width,
      height: l.height,
      x: required(l.offView, "Missing off-view label").position.x,
      y: required(l.offView, "Missing off-view label").position.y,
      layoutOptions: { "elk.nodeLabels.placement": "INSIDE" },
    }));
}
