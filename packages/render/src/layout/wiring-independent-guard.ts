import { routeSegments } from "./ink-geometry.js";
import type { ElkNode, ElkExtendedEdge, ElkPoint } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import { WIRING_TERMINAL_RADIUS } from "./wiring-landings.js";

type Segment = { a: ElkPoint; b: ElkPoint };
const EPSILON = 1e-7;
function segments(edge: ElkExtendedEdge): Segment[] {
  return (edge.sections ?? []).flatMap((s) =>
    routeSegments([s.startPoint, ...(s.bendPoints ?? []), s.endPoint]),
  );
}
function intersection(a: Segment, b: Segment) {
  const left = Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x));
  const right = Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x));
  const top = Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y));
  const bottom = Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y));
  return right < left - EPSILON || bottom < top - EPSILON
    ? undefined
    : ([
        { x: left, y: top },
        { x: right, y: bottom },
      ] as const);
}
function physicalMarks(graph: ElkNode, aliases: ReadonlyMap<string, string>) {
  const marks = new Map<string, ElkPoint>();
  for (const node of graph.children ?? [])
    for (const port of node.ports ?? []) {
      if (aliases.has(port.id)) continue;
      marks.set(port.id, {
        x:
          required(node.x, "Unplaced wiring device") +
          required(port.x, "Unplaced wiring terminal"),
        y:
          required(node.y, "Unplaced wiring device") +
          required(port.y, "Unplaced wiring terminal"),
      });
    }
  return marks;
}
function insideTerminalMark(point: ElkPoint, mark: ElkPoint) {
  return (
    Math.hypot(point.x - mark.x, point.y - mark.y) <=
    WIRING_TERMINAL_RADIUS + EPSILON
  );
}
function through(point: ElkPoint, segment: Segment) {
  return [segment.a, segment.b].every(
    (end) => Math.hypot(point.x - end.x, point.y - end.y) > EPSILON,
  );
}
function aliasLandingsFit(
  graph: ElkNode,
  aliases: ReadonlyMap<string, string>,
  marks: ReadonlyMap<string, ElkPoint>,
) {
  return (graph.children ?? []).every((node) =>
    (node.ports ?? []).every((port) => {
      const owner = aliases.get(port.id);
      if (!owner) return true;
      const mark = required(marks.get(owner), "Missing physical wiring mark");
      return insideTerminalMark(
        {
          x:
            required(node.x, "Unplaced wiring device") +
            required(port.x, "Unplaced wiring landing"),
          y:
            required(node.y, "Unplaced wiring device") +
            required(port.y, "Unplaced wiring landing"),
        },
        mark,
      );
    }),
  );
}

/** Distinct wires may meet at their actual terminal mark, not in a remote trunk.
 * Reconstruct contacts from the complete native paths; dot flags cannot exempt it. */
export function independentWiringRoutes(
  graph: ElkNode,
  aliases: ReadonlyMap<string, string>,
) {
  const marks = physicalMarks(graph, aliases);
  if (!aliasLandingsFit(graph, aliases, marks)) return false;
  const edges = graph.edges ?? [];
  for (const [i, edge] of edges.entries())
    for (const other of edges.slice(i + 1)) {
      const physical = (id: string) => aliases.get(id) ?? id;
      const ends = [...edge.sources, ...edge.targets].map(physical);
      const common = [...other.sources, ...other.targets]
        .map(physical)
        .filter((id) => ends.includes(id));
      for (const a of segments(edge))
        for (const b of segments(other)) {
          const overlap = intersection(a, b);
          if (!overlap) continue;
          // Ordinary four-way crossings without a dot are not physical splices.
          // A touching bend would generate a remote junction, so it is not exempt.
          if (
            Math.hypot(
              overlap[1].x - overlap[0].x,
              overlap[1].y - overlap[0].y,
            ) <= EPSILON &&
            through(overlap[0], a) &&
            through(overlap[0], b)
          )
            continue;
          if (!common.length) {
            if (
              Math.hypot(
                overlap[1].x - overlap[0].x,
                overlap[1].y - overlap[0].y,
              ) > EPSILON
            )
              return false;
          } else if (
            !common.some((id) =>
              overlap.every((p) =>
                insideTerminalMark(
                  p,
                  required(marks.get(id), "Missing physical terminal"),
                ),
              ),
            )
          )
            return false;
        }
    }
  return true;
}
