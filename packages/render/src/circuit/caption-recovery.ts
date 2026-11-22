import type { ElkLabel } from "elkjs/lib/elk-api.js";
import { routeSegments } from "../layout/ink-geometry.js";
import { required } from "../presentation/util.js";
type Point = { x: number; y: number };
/** Try a fixed set of whole-block positions on owned vertical runs after the
 * shared horizontal recovery. The existing free-space and per-line printed-ink
 * predicates admit them; bounds, routes, text and plate dimensions stay fixed. */
export function circuitCaptionPositions(
  label: Readonly<ElkLabel>,
  routes: readonly (readonly Point[])[],
) {
  const width = required(label.width, "Missing circuit label width"),
    height = required(label.height, "Missing circuit label height");
  return routes
    .flatMap(routeSegments)
    .filter(
      (s) =>
        Math.abs(s.a.x - s.b.x) < 1e-7 && Math.abs(s.a.y - s.b.y) >= height,
    )
    .sort((s, t) => Math.abs(t.a.y - t.b.y) - Math.abs(s.a.y - s.b.y))
    .flatMap(({ a, b }) => {
      const top = Math.min(a.y, b.y),
        bottom = Math.max(a.y, b.y),
        y = Math.max(
          top,
          Math.min(
            bottom - height,
            required(label.y, "Unplaced circuit label"),
          ),
        );
      return [
        ...new Set([y, top, bottom - height, (top + bottom - height) / 2]),
      ].flatMap((y) =>
        [a.x - width - 0.275, a.x + 0.275, a.x - width / 2].map((x) => ({
          x,
          y,
        })),
      );
    });
}
