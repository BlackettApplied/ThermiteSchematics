import { required } from "../presentation/util.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { LayoutPoint } from "../types.js";
export interface InkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function unionInk(boxes: readonly InkBox[]): InkBox | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}
export function intersectInk(a: InkBox, b: InkBox): InkBox | undefined {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    r = Math.min(a.x + a.w, b.x + b.w),
    d = Math.min(a.y + a.h, b.y + b.h);
  return r >= x && d >= y ? { x, y, w: r - x, h: d - y } : undefined;
}
export function viewportShapes(
  p: PreparedSchematicDrawing,
  view: InkBox,
  scale: number,
  x: number,
  y: number,
) {
  const boxes = p.graph.nodes.flatMap((n) => {
    const pos = required(
      p.layout.nodes.find((b) => b.id === n.id),
      "Missing rooted geometry",
    );
    return [
      {
        x: pos.x + (n.kind === "junction" ? 0 : n.primitiveOrigin.x),
        y: pos.y + (n.kind === "junction" ? 0 : n.primitiveOrigin.y),
        w: n.kind === "junction" ? pos.width : n.symbolSize.width,
        h: n.kind === "junction" ? pos.height : n.symbolSize.height,
      },
    ];
  });
  const conductors = new Set(
    p.graph.edges.filter((e) => e.kind === "conductor").map((e) => e.id),
  );
  for (const e of p.layout.edges.filter((e) => conductors.has(e.id))) {
    const edge = unionInk(
      e.points.map((v) => ({ x: v.x, y: v.y, w: 0, h: 0 })),
    );
    if (edge) boxes.push(edge);
  }
  // Score only ink inside this strip; the evaluator is independently versioned.
  return boxes
    .flatMap((box) => {
      const clipped = intersectInk(box, view);
      return clipped ? [clipped] : [];
    })
    .map((ink) => ({
      x: x + (ink.x - view.x) * scale,
      y: y + (ink.y - view.y) * scale,
      w: ink.w * scale,
      h: ink.h * scale,
    }));
}

function simplified(points: readonly LayoutPoint[]) {
  const result: LayoutPoint[] = [];
  for (const p of points) {
    while (result.length > 1) {
      const a = required(result[result.length - 2], "Missing rooted geometry"),
        b = required(result.at(-1), "Missing rooted geometry");
      if (!((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)))
        break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}
/** Same 3 mm interior-segment threshold; endpoints and zero ticks are excluded. */
export function interiorJogs(p: PreparedSchematicDrawing, scale: number) {
  const wires = new Set(
    p.graph.edges.filter((e) => e.kind === "conductor").map((e) => e.id),
  );
  return new Map(
    p.layout.edges
      .filter((e) => wires.has(e.id))
      .map((e) => {
        const points = simplified(e.points);
        const count = points.slice(2, -1).filter((v, j) => {
          const u = required(points[j + 1], "Missing rooted geometry"),
            length = Math.hypot(v.x - u.x, v.y - u.y) * scale;
          return length > 0.05 && length < 3 - JOG_NUMERICAL_TOLERANCE_MM;
        }).length;
        return [e.id, count] as const;
      }),
  );
}

export function shiftRootedInk(draft: import("./types.js").Draft, dy: number) {
  if (draft.rootedShapes)
    draft.rootedShapes = draft.rootedShapes.map((s) => ({ ...s, y: s.y + dy }));
  if (draft.rootedInk)
    draft.rootedInk = { ...draft.rootedInk, y: draft.rootedInk.y + dy };
}

/** The existing DQ-15 detour criterion, applied to unmodified ELK routes. */
export function routeDetours(p: PreparedSchematicDrawing, scale: number) {
  const wires = new Set(
    p.graph.edges.filter((e) => e.kind === "conductor").map((e) => e.id),
  );
  return new Map(
    p.layout.edges
      .filter((e) => wires.has(e.id))
      .map((e) => {
        const first = required(e.points[0], "Missing route start"),
          last = required(e.points.at(-1), "Missing route end");
        const length =
          e.points
            .slice(1)
            .reduce(
              (n, v, i) =>
                n +
                Math.hypot(
                  v.x - required(e.points[i], "Missing route point").x,
                  v.y - required(e.points[i], "Missing route point").y,
                ),
              0,
            ) * scale;
        const direct =
          (Math.abs(first.x - last.x) + Math.abs(first.y - last.y)) * scale;
        return [e.id, length > 2 * direct + 20 ? 1 : 0] as const;
      }),
  );
}

export function clipRootedInk(draft: import("./types.js").Draft, view: InkBox) {
  draft.rootedShapes = (draft.rootedShapes ?? []).flatMap((s) => {
    const clipped = intersectInk(s, view);
    return clipped ? [clipped] : [];
  });
  const ink = unionInk(draft.rootedShapes);
  if (ink) draft.rootedInk = ink;
  else delete draft.rootedInk;
}
import { JOG_NUMERICAL_TOLERANCE_MM } from "./route-fragments.js";
