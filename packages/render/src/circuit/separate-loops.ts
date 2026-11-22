import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import {
  circuitCrossingGuard,
  circuitNodeClearanceGuard,
} from "../layout/circuit-native-guard.js";
import { required } from "../presentation/util.js";
import { formatSvgNumber } from "../svg/numbers.js";
import { fullyCoincidentCaption } from "./coincident-caption.js";
import type { Point } from "./types.js";

type Section = NonNullable<ElkExtendedEdge["sections"]>[number];
type Loop = {
  edge: ElkExtendedEdge;
  section: Section;
  bends: [Point, Point, Point, Point];
};
const EPSILON = 1e-7;
const RAIL_PITCH_MM = 2.5;
const FAN_STEP_MM = 1.25;
const FAN_LIMIT_MM = 3;
const near = (a: number, b: number) => Math.abs(a - b) < EPSILON;
const samePoint = (a: Point, b: Point) => near(a.x, b.x) && near(a.y, b.y);
export const circuitPointKey = ({ x, y }: Point) =>
  `${formatSvgNumber(x)},${formatSvgNumber(y)}`;

export type CircuitLoopSeparation = NonNullable<
  ReturnType<typeof separateCoincidentLoops>
>;

function segments(graph: ElkNode) {
  return (graph.edges ?? []).flatMap((edge) =>
    (edge.sections ?? []).flatMap(({ startPoint, bendPoints, endPoint }) => {
      const points = [startPoint, ...(bendPoints ?? []), endPoint];
      return points.slice(1).map((b, i) => ({
        index: Number(edge.id.slice(1)),
        a: required(points[i], "Missing circuit route point"),
        b,
      }));
    }),
  );
}

function sharedLoopFamilies(graph: ElkNode, selfLoops: ReadonlySet<number>) {
  const groups = new Map<string, Loop[]>();
  for (const edge of graph.edges ?? []) {
    if (!selfLoops.has(Number(edge.id.slice(1)))) continue;
    const section = edge.sections?.[0];
    if (edge.sections?.length !== 1 || section?.bendPoints?.length !== 4)
      continue;
    const [leave, outer, back, arrive] = section.bendPoints;
    if (!leave || !outer || !back || !arrive) continue;
    const key = JSON.stringify([
      edge.sources,
      section.startPoint,
      leave,
      outer,
      back,
    ]);
    const group = groups.get(key) ?? [];
    group.push({ edge, section, bends: [leave, outer, back, arrive] });
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function loopAxes(startPoint: Point, leave: Point, outer: Point) {
  // Measure along the launch and toward the wrapped side. This keeps the same
  // nesting rule for either flow and leaves the native terminal order intact.
  const along = near(startPoint.y, leave.y) ? "x" : "y";
  const across = along === "x" ? "y" : "x";
  const forward = Math.sign(leave[along] - startPoint[along]);
  const turn = Math.sign(outer[across] - leave[across]);
  if (!forward || !turn) return;
  const axial = (p: Point) => p[along] * forward;
  const lateral = (p: Point) => p[across] * turn;
  const point = (u: number, v: number): Point =>
    along === "x"
      ? { x: u * forward, y: v * turn }
      : { x: v * turn, y: u * forward };
  return { axial, lateral, point };
}

function nestLoops(loops: Loop[], graph: ElkNode) {
  const {
    section: { startPoint },
    bends: [leave, outer, back],
  } = required(loops[0], "Missing circuit loop family");
  const axes = loopAxes(startPoint, leave, outer);
  if (!axes) return;
  const { axial, lateral, point } = axes;
  const sorted = [...loops].sort(
      (l, r) => lateral(l.section.endPoint) - lateral(r.section.endPoint),
    ),
    inset = (sorted.length - 1) * RAIL_PITCH_MM,
    split = Math.floor(sorted.length / 2),
    exit = axial(startPoint) + FAN_STEP_MM;
  // Leave room for the dot on the spine and at each branch. Every lane
  // turns off the spine, so no route continues straight through the launch.
  const lane = (i: number) =>
    (i - split + (i >= split ? 1 : 0)) *
    (sorted.length === 2 ? FAN_STEP_MM / 2 : FAN_STEP_MM);
  if (
    Math.hypot(FAN_STEP_MM, lane(sorted.length - 1)) > FAN_LIMIT_MM ||
    axial(leave) - inset <= exit ||
    sorted.some(({ section: { endPoint }, bends: [, , , arrive] }, i) => {
      const previous = sorted[i - 1];
      return (
        (previous &&
          near(lateral(endPoint), lateral(previous.section.endPoint))) ||
        !samePoint(arrive, point(axial(back), lateral(endPoint))) ||
        axial(endPoint) - axial(back) <= inset + FAN_STEP_MM ||
        lateral(outer) - lateral(endPoint) <= inset + 2 * FAN_STEP_MM
      );
    })
  )
    return;

  const edges = new Map<string, ElkExtendedEdge>(),
    fan = new Set<string>(),
    width = required(graph.width, "Missing circuit width"),
    height = required(graph.height, "Missing circuit height");
  for (const [i, { edge, section }] of sorted.entries()) {
    const shift = i * RAIL_PITCH_MM,
      exitLane = lateral(startPoint) + lane(i),
      launch = point(exit, lateral(startPoint)),
      leaveFan = point(exit, exitLane),
      arrival = point(
        axial(section.endPoint) - FAN_STEP_MM,
        lateral(section.endPoint),
      ),
      approach = lateral(section.endPoint) + FAN_STEP_MM;
    const bends = [
      launch,
      leaveFan,
      point(axial(leave) - shift, exitLane),
      point(axial(leave) - shift, lateral(outer) - shift),
      point(axial(back) + shift, lateral(outer) - shift),
      point(axial(back) + shift, approach),
      point(axial(arrival), approach),
      arrival,
    ];
    if (bends.some(({ x, y }) => x < 0 || y < 0 || x > width || y > height))
      return;
    for (const p of [launch, leaveFan, arrival]) fan.add(circuitPointKey(p));
    edges.set(edge.id, {
      ...edge,
      sections: [{ ...section, bendPoints: bends }],
    });
  }
  return { edges, fan };
}

/** ELK assigns one set of routing slots to a family of shared-port loops.
 * Separate the nested rectangular runs inside that envelope. The native
 * nodes, terminal sites and every other route retain their geometry. */
export function separateCoincidentLoops(
  graph: ElkNode,
  selfLoops: ReadonlySet<number>,
) {
  if (selfLoops.size < 2) return;
  const families = sharedLoopFamilies(graph, selfLoops);
  if (!families.length) return;
  const before = segments(graph),
    replacements = new Map<string, ElkExtendedEdge>(),
    fan = new Set<string>();
  for (const family of families) {
    if (
      !family.some(({ edge }) =>
        fullyCoincidentCaption(Number(edge.id.slice(1)), before),
      )
    )
      continue;
    const proposal = nestLoops(family, graph);
    if (!proposal) continue;
    for (const [id, edge] of proposal.edges) replacements.set(id, edge);
    for (const p of proposal.fan) fan.add(p);
  }
  if (!replacements.size) return;
  const candidate = {
    ...graph,
    edges: (graph.edges ?? []).map((edge) => replacements.get(edge.id) ?? edge),
  };
  const after = segments(candidate);
  if (
    !circuitNodeClearanceGuard(candidate) ||
    !circuitCrossingGuard(candidate, graph) ||
    candidate.edges.some(({ id }) =>
      fullyCoincidentCaption(Number(id.slice(1)), after),
    )
  )
    return;
  return { graph: candidate, fan, nestedEdges: new Set(replacements.keys()) };
}
