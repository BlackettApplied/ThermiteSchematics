import type { ElkNode } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";

export const WIRING_FRAME_STROKE_MM = 0.3;
export function wiringFrameEdges(graph: ElkNode) {
  return (graph.children ?? []).flatMap((node) => {
    if (!node.width || !node.height) return [];
    const x = required(node.x, "Unplaced device frame"),
      y = required(node.y, "Unplaced device frame"),
      right = x + node.width,
      bottom = y + node.height;
    return [
      { a: { x, y }, b: { x: right, y } },
      { a: { x: right, y }, b: { x: right, y: bottom } },
      { a: { x: right, y: bottom }, b: { x, y: bottom } },
      { a: { x, y: bottom }, b: { x, y } },
    ];
  });
}
