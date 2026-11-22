import type { NormalizedSchematicLayout } from "../../src/types.js";
import { svgSemanticId } from "../../src/svg/escape.js";
import { parseHTML } from "linkedom";
import { required } from "../fixtures.js";
export type Point = { x: number; y: number };
export function nativePath(d: string) {
  const tokens = d.match(/[MLHV]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/giu) ?? [];
  const result: Point[] = [];
  let x = 0,
    y = 0;
  while (tokens.length) {
    const command = tokens.shift();
    if (command === "M" || command === "L") {
      x = Number(tokens.shift());
      y = Number(tokens.shift());
    } else if (command === "H") x = Number(tokens.shift());
    else if (command === "V") y = Number(tokens.shift());
    else throw Error("Unexpected native path command");
    result.push({
      x: Number((x - 20).toFixed(3)),
      y: Number((y - 20).toFixed(3)),
    });
  }
  return result;
}
export function on(point: Point, route: readonly Point[]) {
  return route.slice(1).some((b, i) => {
    const a = required(route[i]);
    return Math.abs(a.x - b.x) < 0.001
      ? Math.abs(point.x - a.x) < 0.001 &&
          point.y >= Math.min(a.y, b.y) - 0.001 &&
          point.y <= Math.max(a.y, b.y) + 0.001
      : Math.abs(point.y - a.y) < 0.001 &&
          point.x >= Math.min(a.x, b.x) - 0.001 &&
          point.x <= Math.max(a.x, b.x) + 0.001;
  });
}
export function horizontalSupport(
  box: { left: number; right: number; top: number; bottom: number },
  route: readonly Point[],
  maxGap: number,
) {
  return route.slice(1).some((b, i) => {
    const a = required(route[i]);
    return (
      Math.abs(a.y - b.y) < 0.001 &&
      Math.min(a.x, b.x) <= box.left + 0.001 &&
      Math.max(a.x, b.x) >= box.right - 0.001 &&
      Math.max(box.top - a.y, a.y - box.bottom, 0) <= maxGap
    );
  });
}

export function printedCaptionSupport(
  ink: { left: number; right: number; top: number; bottom: number },
  own: readonly Point[],
  foreign: readonly (readonly Point[])[],
  stroke = 1.5,
  reach = 8,
) {
  const distance = (route: readonly Point[]) =>
    Math.min(
      ...route.slice(1).map((b, i) => {
        const a = required(route[i]);
        return Math.max(
          0,
          Math.hypot(
            Math.max(
              Math.min(a.x, b.x) - stroke / 2 - ink.right,
              ink.left - Math.max(a.x, b.x) - stroke / 2,
              0,
            ),
            Math.max(
              Math.min(a.y, b.y) - stroke / 2 - ink.bottom,
              ink.top - Math.max(a.y, b.y) - stroke / 2,
              0,
            ),
          ),
        );
      }),
    );
  const owner = distance(own),
    other = Math.min(...foreign.map(distance)),
    inline = horizontalSupport(ink, own, 0) && other > 0;
  return {
    owner,
    foreign: other,
    inline,
    clear: inline || (owner > 0 && other > 0),
    supported:
      inline || (owner > 0 && owner <= reach + 0.001 && other > owner + 0.001),
  };
}

export function foreignRoutes(
  doc: ReturnType<typeof parseHTML>["document"],
  layout: NormalizedSchematicLayout,
  ownerId: string,
) {
  return layout.edges
    .filter((e) => e.id !== ownerId)
    .map((e) =>
      nativePath(
        required(
          required(
            doc.querySelector(
              `[data-edge-key="${svgSemanticId("edge", [e.id])}"]`,
            ),
          ).getAttribute("d"),
        ),
      ),
    );
}
