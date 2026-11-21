import { routePortAttributes } from "../layout/port-attributes.js";
import { circuitRoutePin } from "./landing-ports.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "../svg/escape.js";
import { InlineLabelCollisionError } from "../layout/inline-label-error.js";
import type { DeviceNode, PhysicalConductor, Point } from "./types.js";
import type { LayoutGroup, LayoutHooks } from "./layout-input.js";
import { circuitPointKey } from "./separate-loops.js";
import { circuitJunctionIdentity } from "./junction-identity.js";
export type CircuitRouteState = ReturnType<typeof circuitRouteState>;
type TopologyBase = CircuitRouteState & {
  segments: { index: number; a: Point; b: Point }[];
  on: (p: Point, a: Point, b: Point) => boolean;
  common: (a: number, b: number) => boolean;
};
export type CircuitTopologyState = TopologyBase & { dots: Map<string, Point> };
export type CircuitLabelState = ReturnType<typeof circuitLabelChecks>;
type Segment = CircuitTopologyState["segments"][number];
type Label = CircuitRouteState["labels"][number];
export function circuitRouteState(
  graph: ElkNode,
  nodes: DeviceNode[],
  cs: PhysicalConductor[],
  group: LayoutGroup,
  hooks: LayoutHooks,
) {
  if (
    ![graph.width, graph.height].every(Number.isFinite) ||
    graph.width! <= 0 ||
    graph.height! <= 0
  )
    throw new Error(`Circuit ${group.id}: invalid layout bounds.`);
  const laidNodes = new Map((graph.children ?? []).map((d) => [d.id, d]));
  for (const d of nodes) {
    const l = laidNodes.get(d.id);
    if (!l || ![l.x, l.y, l.width, l.height].every(Number.isFinite))
      throw new Error(`Circuit ${group.id}: missing device layout.`);
  }
  const routes: { index: number; points: Point[] }[] = [],
    labels: {
      index: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
    }[] = [];
  const wireSvg: string[] = [];
  return {
    ...hooks,
    graph,
    nodes,
    cs,
    group,
    laidNodes,
    routes,
    labels,
    wireSvg,
  };
}

export function appendCircuitRoute(
  e: ElkExtendedEdge,
  state: CircuitRouteState,
  nested = false,
) {
  const { cs, group, routes, wireSvg, labels, n } = state;
  const index = Number(e.id.slice(1)),
    c = cs[index];
  if (!c || e.sections?.length !== 1)
    throw new Error(`Circuit ${group.id}: incomplete physical route.`);
  const section = e.sections[0]!,
    points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];
  assertCircuitSegments(points, c, state);
  assertCircuitEndpoints(e, points, state);
  routes.push({ index, points });
  const path = circuitRoutePath(points, n);
  // Nested rails use plain, dotless crossings to preserve the crossing ink
  // through the whole nest. Only the two terminal jog segments are marked.
  const knockout = nested
    ? ""
    : `<path d="${path}" fill="none" stroke="white" stroke-width="1.1"/>`;
  const jogs = nested
    ? ` data-circuit-fan-in="source:1 target:${points.length - 3}"`
    : "";
  wireSvg.push(
    `<g ${routePortAttributes(e)} data-circuit-conductor="${attr(c.id)}" data-conductor-designation="${attr(c.name)}" data-net-id="${attr(c.netId)}" data-endpoints="${attr(JSON.stringify(c.ends))}"><title>${xml([c.name, c.detail].filter(Boolean).join(" | "))}</title>${knockout}<path d="${path}" fill="none" stroke="#17212b" stroke-width="${c.jumper ? 0.55 : 0.32}"${jogs}/></g>`,
  );
  for (const l of e.labels ?? []) {
    if (![l.x, l.y, l.width, l.height].every(Number.isFinite))
      throw new Error(`Circuit ${group.id}: unplaced conductor label.`);
    labels.push({
      index,
      x: l.x!,
      y: l.y!,
      width: l.width!,
      height: l.height!,
      text: l.text!,
    });
  }
}

function circuitRoutePath(points: readonly Point[], n: LayoutHooks["n"]) {
  return points.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ");
}

export function assertCircuitSegments(
  points: Point[],
  c: PhysicalConductor,
  state: CircuitRouteState,
) {
  const { laidNodes, group, nodes } = state;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if (
      ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
      (Math.abs(a.x - b.x) > 1e-7 && Math.abs(a.y - b.y) > 1e-7)
    )
      throw new Error(`Circuit ${group.id}: nonorthogonal route.`);
    for (const d of laidNodes.values()) {
      const left = d.x! + 0.01,
        right = d.x! + d.width! - 0.01,
        top = d.y! + 0.01,
        bottom = d.y! + d.height! - 0.01;
      if (
        (a.x === b.x &&
          a.x > left &&
          a.x < right &&
          Math.max(a.y, b.y) > top &&
          Math.min(a.y, b.y) < bottom) ||
        (a.y === b.y &&
          a.y > top &&
          a.y < bottom &&
          Math.max(a.x, b.x) > left &&
          Math.min(a.x, b.x) < right)
      )
        throw new InlineLabelCollisionError(
          `Circuit ${group.id}: conductor ${c.name} (${c.id}) crosses device ${nodes.find((node) => node.id === d.id)!.device.designation}.`,
        );
    }
  }
}

export function assertCircuitEndpoints(
  e: ElkExtendedEdge,
  points: Point[],
  state: CircuitRouteState,
) {
  const { nodes, laidNodes, group, cs, key } = state;
  const ports = [e.sources[0], e.targets[0]].map((id) =>
    circuitRoutePin(id ?? "", nodes),
  );
  const expected = ports.map((p) => {
    const l = laidNodes.get(p.node.id)!;
    return { x: l.x! + p.x, y: l.y! + p.y };
  });
  if (
    JSON.stringify(ports.map((p) => key(p.pin.terminal)).sort()) !==
      JSON.stringify(cs[Number(e.id.slice(1))]?.ends.map(key).sort()) ||
    Math.hypot(points[0]!.x - expected[0]!.x, points[0]!.y - expected[0]!.y) >
      0.01 ||
    Math.hypot(
      points.at(-1)!.x - expected[1]!.x,
      points.at(-1)!.y - expected[1]!.y,
    ) > 0.01
  )
    throw new Error(
      `Circuit ${group.id}: route endpoints moved away from their source terminals.`,
    );
}

export function circuitTopology(
  state: CircuitRouteState,
  fan?: ReadonlySet<string>,
): CircuitTopologyState {
  const { routes, cs, key } = state;
  const segments = routes.flatMap((r) =>
    r.points.slice(1).map((b, i) => ({ index: r.index, a: r.points[i]!, b })),
  );
  const on = (p: Point, a: Point, b: Point) =>
    p.x >= Math.min(a.x, b.x) - 1e-7 &&
    p.x <= Math.max(a.x, b.x) + 1e-7 &&
    p.y >= Math.min(a.y, b.y) - 1e-7 &&
    p.y <= Math.max(a.y, b.y) + 1e-7 &&
    (a.x === b.x ? Math.abs(p.x - a.x) < 1e-7 : Math.abs(p.y - a.y) < 1e-7);
  const common = (a: number, b: number) =>
    cs[a]!.ends.some((t) => cs[b]!.ends.some((u) => key(t) === key(u)));
  const topology = { ...state, segments, on, common };
  assertCircuitOverlaps(topology);
  return { ...topology, dots: circuitDots(topology, fan) };
}

function assertCircuitOverlaps(state: Omit<CircuitTopologyState, "dots">) {
  const { segments, common, group, cs } = state;
  for (let i = 0; i < segments.length; i++)
    for (const s of segments.slice(i + 1)) {
      const t = segments[i]!;
      if (t.index === s.index || common(t.index, s.index)) continue;
      const v = t.a.x === t.b.x && s.a.x === s.b.x && t.a.x === s.a.x,
        h = t.a.y === t.b.y && s.a.y === s.b.y && t.a.y === s.a.y;
      const overlap = (axis: "x" | "y") =>
        Math.min(
          Math.max(t.a[axis], t.b[axis]),
          Math.max(s.a[axis], s.b[axis]),
        ) -
          Math.max(
            Math.min(t.a[axis], t.b[axis]),
            Math.min(s.a[axis], s.b[axis]),
          ) >
        1e-7;
      if ((v && overlap("y")) || (h && overlap("x")))
        throw new InlineLabelCollisionError(
          `Circuit ${group.id}: unrelated conductors ${cs[t.index]!.name} (${cs[t.index]!.id}) and ${cs[s.index]!.name} (${cs[s.index]!.id}) overlap.`,
        );
    }
}

function circuitDots(
  state: Omit<CircuitTopologyState, "dots">,
  fan: ReadonlySet<string> | undefined,
): Map<string, Point> {
  const { routes, segments, common, on, group, n, cs } = state;
  const dots = new Map<string, Point>();
  for (const r of routes)
    for (const p of r.points) {
      const touching = segments.filter(
        (s) => common(s.index, r.index) && on(p, s.a, s.b),
      );
      const directions = new Set(
        touching.flatMap((s) =>
          [s.a, s.b].flatMap((q) => [
            ...(q.x > p.x + 1e-7 ? ["E"] : []),
            ...(q.x < p.x - 1e-7 ? ["W"] : []),
            ...(q.y > p.y + 1e-7 ? ["S"] : []),
            ...(q.y < p.y - 1e-7 ? ["N"] : []),
          ]),
        ),
      );
      if (directions.size >= 3) {
        if (segments.some((s) => !common(s.index, r.index) && on(p, s.a, s.b)))
          throw new InlineLabelCollisionError(
            `Circuit ${group.id}: unrelated wire touches a source-terminal junction.`,
          );
        if (
          fan?.has(circuitPointKey(p)) &&
          (directions.size !== 3 ||
            !circuitJunctionIdentity(p, state) ||
            touching.some(
              ({ index }) => cs[index]?.netId !== cs[r.index]?.netId,
            ))
        )
          throw new Error(
            `Circuit ${group.id}: invalid terminal fan-in junction.`,
          );
        dots.set(`${n(p.x)},${n(p.y)}`, p);
      }
    }
  return dots;
}

export function circuitLabelChecks(state: CircuitTopologyState) {
  const { laidNodes, labels, segments } = state;
  const intersects = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    a.y + a.height > b.y + 0.01;
  const segmentBox = (s: (typeof segments)[number]) => ({
    x: Math.min(s.a.x, s.b.x),
    y: Math.min(s.a.y, s.b.y),
    width: Math.abs(s.a.x - s.b.x),
    height: Math.abs(s.a.y - s.b.y),
  });
  const labelObstructed = (label: (typeof labels)[number]) =>
    [...laidNodes.values()].some((d) =>
      intersects(label, {
        x: d.x!,
        y: d.y!,
        width: d.width!,
        height: d.height!,
      }),
    ) ||
    labels.some(
      (other) => other.index !== label.index && intersects(label, other),
    ) ||
    segments.some(
      (s) => s.index !== label.index && intersects(label, segmentBox(s)),
    );
  return { ...state, intersects, segmentBox, labelObstructed };
}

export function recoverCircuitSelfLabels(
  state: CircuitLabelState,
  selfLoops: Set<number>,
) {
  const { labels, segments, labelObstructed, graph, group } = state;
  // ELK can stack fixed-port self-loop labels away from their own loop and
  // across an unrelated incoming wire. Recover labels only, beside an actual
  // routed segment; never move the physical route or relax obstruction checks.
  for (const label of labels.filter((l) => selfLoops.has(l.index))) {
    const own = segments.filter((s) => s.index === label.index);
    if (!labelObstructed(label)) continue;
    const candidates = own.flatMap((s) =>
      circuitLabelCandidates(s, label, state),
    );
    const free = candidates.find(
      (candidate) =>
        candidate.x >= 0 &&
        candidate.y >= 0 &&
        candidate.x + candidate.width <= graph.width! &&
        candidate.y + candidate.height <= graph.height! &&
        !labelObstructed(candidate),
    );
    if (!free)
      throw new InlineLabelCollisionError(
        `Circuit ${group.id}: a self-loop wire label cannot fit beside its route without obscuring other drawing content.`,
      );
    label.x = free.x;
    label.y = free.y;
  }
}

function circuitLabelCandidates(
  s: Segment,
  label: Label,
  state: CircuitLabelState,
) {
  const { segmentBox } = state;
  const box = segmentBox(s);
  // Centered labels may overhang a short segment. The full measured box
  // still has to clear every other route, label and device below.
  if (box.height > 0)
    return [
      box.y + (box.height - label.height) / 2,
      ...(box.height >= label.height + 1
        ? [box.y + box.height - label.height - 0.5, box.y + 0.5]
        : []),
    ].flatMap((y) =>
      [box.x - label.width - 1, box.x + 1].map((x) => ({ ...label, x, y })),
    );
  if (box.width > 0)
    return [
      box.x + (box.width - label.width) / 2,
      ...(box.width >= label.width + 1
        ? [box.x + box.width - label.width - 0.5, box.x + 0.5]
        : []),
    ].flatMap((x) =>
      [box.y - label.height - 1, box.y + 1].map((y) => ({
        ...label,
        x,
        y,
      })),
    );
  return [];
}

export function assertCircuitLabels(state: CircuitLabelState) {
  const { labels, laidNodes, intersects, segments, group } = state;
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!;
    if (
      [...laidNodes.values()].some((d) =>
        intersects(l, { x: d.x!, y: d.y!, width: d.width!, height: d.height! }),
      ) ||
      labels.slice(i + 1).some((o) => intersects(l, o)) ||
      segments.some(
        (s) =>
          s.index !== l.index &&
          intersects(l, {
            x: Math.min(s.a.x, s.b.x),
            y: Math.min(s.a.y, s.b.y),
            width: Math.abs(s.a.x - s.b.x),
            height: Math.abs(s.a.y - s.b.y),
          }),
      )
    )
      throw new InlineLabelCollisionError(
        `Circuit ${group.id}: a wire label overlaps other drawing content.`,
      );
  }
}
