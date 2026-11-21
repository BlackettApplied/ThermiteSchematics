import type { NormalizedSchematicLayout } from "../types.js";
interface Interval {
  start: number;
  end: number;
}

export function protectedDrawingIntervals(
  layout: NormalizedSchematicLayout,
  pad: number,
) {
  const protectedX: Interval[] = [],
    protectedY: Interval[] = [];
  for (const item of [
    ...layout.nodes.filter((node) => node.kind !== "location"),
    ...layout.labels,
  ]) {
    protectedX.push({
      start: item.x + pad - 12,
      end: item.x + item.width + pad + 12,
    });
    protectedY.push({
      start: item.y + pad - 12,
      end: item.y + item.height + pad + 12,
    });
  }
  // Avoid routing bends and collinear cuts as well as symbols.
  for (const edge of layout.edges)
    for (const point of edge.points) {
      protectedX.push({ start: point.x + pad - 6, end: point.x + pad + 6 });
      protectedY.push({ start: point.y + pad - 6, end: point.y + pad + 6 });
    }
  return { protectedX, protectedY };
}
