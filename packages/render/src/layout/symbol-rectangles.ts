import type { PresentationGraph } from "../types.js";
import type { Bounds, GeometryIndex } from "./validate-output.js";

export function symbolRectangles(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
  reject: (message: string) => never,
): Map<string, Bounds> {
  const result = new Map<string, Bounds>();
  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const layout = geometry.nodes.get(node.id);
    if (layout?.primitiveOrigin === undefined)
      reject(`node ${node.id} has no primitive origin`);
    result.set(node.id, {
      left: layout.primitiveOrigin.x,
      top: layout.primitiveOrigin.y,
      right: layout.primitiveOrigin.x + node.symbolSize.width,
      bottom: layout.primitiveOrigin.y + node.symbolSize.height,
    });
  }
  return result;
}
