import type { ElkNode, ElkPoint, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import { routeSegments } from "./ink-geometry.js";
import {
  wiringFrameEdges,
  WIRING_FRAME_STROKE_MM,
} from "./wiring-frame-ink.js";
export const WIRING_MIN_CLEAR_GAP_MM = 0.7;
export const WIRING_MAX_FAN_IN_MM = 3;
export const wiringStrokeMm = (jumper: boolean) => (jumper ? 0.7 : 0.35);
function segments(edge: ElkExtendedEdge) {
  return (edge.sections ?? []).flatMap((s) =>
    routeSegments([s.startPoint, ...(s.bendPoints ?? []), s.endPoint]),
  );
}
function narrowOutsideFan(
  a: ReturnType<typeof segments>[number],
  b: ReturnType<typeof segments>[number],
  stroke: number,
  marks: readonly ElkPoint[],
  minimumOverlap = 0,
) {
  for (const [axis, cross] of [
    ["x", "y"],
    ["y", "x"],
  ] as const) {
    if (
      Math.abs(a.a[cross] - a.b[cross]) > 1e-7 ||
      Math.abs(b.a[cross] - b.b[cross]) > 1e-7
    )
      continue;
    const lo = Math.max(
        Math.min(a.a[axis], a.b[axis]),
        Math.min(b.a[axis], b.b[axis]),
      ),
      hi = Math.min(
        Math.max(a.a[axis], a.b[axis]),
        Math.max(b.a[axis], b.b[axis]),
      );
    if (
      hi - lo <= minimumOverlap + 1e-7 ||
      Math.abs(a.a[cross] - b.a[cross]) - stroke >=
        WIRING_MIN_CLEAR_GAP_MM - 1e-7
    )
      continue;
    if (
      !marks.some((m) =>
        [lo, hi].every((v) =>
          [a, b].every(
            (r) =>
              Math.hypot(v - m[axis], r.a[cross] - m[cross]) <=
              WIRING_MAX_FAN_IN_MM + 1e-7,
          ),
        ),
      )
    )
      return true;
  }
  return false;
}
/** Assess actual physical stroke widths. A small native port offset cannot
 * stand in for readable independent approaches outside the terminal fan-in. */
export function wiringLandingInkFits(
  graph: ElkNode,
  aliases: ReadonlyMap<string, string>,
  strokes: ReadonlyMap<string, number> = new Map(),
) {
  const marks = new Map(
      (graph.children ?? []).flatMap((n) =>
        (n.ports ?? [])
          .filter((p) => !aliases.has(p.id))
          .map(
            (p) =>
              [
                p.id,
                {
                  x:
                    required(n.x, "Unplaced device") +
                    required(p.x, "Unplaced terminal"),
                  y:
                    required(n.y, "Unplaced device") +
                    required(p.y, "Unplaced terminal"),
                },
              ] as const,
          ),
      ),
    ),
    canonical = (id: string) => aliases.get(id) ?? id;
  const edges = graph.edges ?? [];
  const frames = wiringFrameEdges(graph);
  return (
    edges.every((edge) =>
      segments(edge).every((segment) =>
        frames.every(
          (frame) =>
            !narrowOutsideFan(
              segment,
              frame,
              ((strokes.get(edge.id) ?? 0.35) + WIRING_FRAME_STROKE_MM) / 2,
              // Only a short overlap can be frame fan-in. A longer run
              // cannot borrow the conductor/conductor radial exemption.
              [],
              WIRING_MAX_FAN_IN_MM,
            ),
        ),
      ),
    ) &&
    edges.every((a, i) =>
      edges.slice(i + 1).every((b) => {
        const ids = [...a.sources, ...a.targets].map(canonical),
          common = [...b.sources, ...b.targets]
            .map(canonical)
            .filter((id) => ids.includes(id))
            .map((id) => required(marks.get(id), "Missing common terminal"));
        // Centreline distance loses both half-widths, hence (a + b) / 2.
        const stroke =
          ((strokes.get(a.id) ?? 0.35) + (strokes.get(b.id) ?? 0.35)) / 2;
        return segments(a).every((s) =>
          segments(b).every((t) => !narrowOutsideFan(s, t, stroke, common)),
        );
      }),
    )
  );
}
