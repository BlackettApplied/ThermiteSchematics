import { required } from "../presentation/util.js";
import type { LayoutEdge } from "../types.js";
import type { DrawingBounds } from "./types.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";

export function rootedCrossings(
  edge: Pick<LayoutEdge, "points">,
  xs: readonly number[],
  ys: readonly number[],
  b: DrawingBounds,
  scale: number,
) {
  const nx = xs.length - 1,
    ny = ys.length - 1;
  const result: {
    from: number;
    to: number;
    a: { x: number; y: number; side: "right" | "bottom" };
    z: { x: number; y: number; side: "left" | "top" };
  }[] = [];
  for (let j = 1; j < edge.points.length; j++) {
    const p = required(edge.points[j - 1], "Missing route point"),
      q = required(edge.points[j], "Missing route point");
    for (let col = 1; col < nx; col++) {
      const x = cut(xs, col) - pad;
      if (p.y !== q.y || x <= Math.min(p.x, q.x) || x >= Math.max(p.x, q.x))
        continue;
      const row = ys.findIndex(
        (s, i) => i < ny && p.y + pad >= s && p.y + pad < cut(ys, i + 1),
      );
      if (row < 0) continue;
      const y = b.y + (p.y + pad - cut(ys, row)) * scale,
        from = row * nx + col - 1;
      result.push({
        from,
        to: from + 1,
        a: {
          x: b.x + (cut(xs, col) - cut(xs, col - 1)) * scale,
          y,
          side: "right",
        },
        z: { x: b.x, y, side: "left" },
      });
    }
    for (let row = 1; row < ny; row++) {
      const y = cut(ys, row) - pad;
      if (p.x !== q.x || y <= Math.min(p.y, q.y) || y >= Math.max(p.y, q.y))
        continue;
      const col = xs.findIndex(
        (s, i) => i < nx && p.x + pad >= s && p.x + pad < cut(xs, i + 1),
      );
      if (col < 0) continue;
      const x = b.x + (p.x + pad - cut(xs, col)) * scale,
        from = (row - 1) * nx + col;
      result.push({
        from,
        to: from + nx,
        a: {
          x,
          y: b.y + (cut(ys, row) - cut(ys, row - 1)) * scale,
          side: "bottom",
        },
        z: { x, y: b.y, side: "top" },
      });
    }
  }
  return result;
}

function cut(values: readonly number[], index: number) {
  return required(values[index], "Missing cut");
}
