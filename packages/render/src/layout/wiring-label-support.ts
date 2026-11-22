import { captionPlacementDiagnostic } from "./caption-diagnostic.js";
import { CircuitRenderError } from "../render-error-context.js";
import { routeInkDistance, routeSegments } from "./ink-geometry.js";
import { wiringPlateFits, wiringPlateRuns } from "./wiring-plate-clearance.js";
import type { ElkNode, ElkLabel } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import {
  horizontalLabelSupport,
  ownedLabelLeader,
  type LabelInkBox,
} from "./wire-label-support.js";

type Point = { x: number; y: number };
function box(label: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): LabelInkBox {
  const x = required(label.x, "Unplaced wiring label"),
    y = required(label.y, "Unplaced wiring label");
  return {
    left: x,
    right: x + required(label.width, "Missing wiring label width"),
    top: y,
    bottom: y + required(label.height, "Missing wiring label height"),
  };
}
function overlaps(a: LabelInkBox, b: LabelInkBox) {
  return (
    a.left < b.right - 0.01 &&
    a.right > b.left + 0.01 &&
    a.top < b.bottom - 0.01 &&
    a.bottom > b.top + 0.01
  );
}
function paths(graph: ElkNode) {
  return (graph.edges ?? []).map((e) => ({
    id: e.id,
    labels: e.labels ?? [],
    routes: (e.sections ?? []).map((s) => [
      s.startPoint,
      ...(s.bendPoints ?? []),
      s.endPoint,
    ]),
  }));
}
function free(
  label: ElkLabel,
  own: string,
  graph: ElkNode,
  edges: ReturnType<typeof paths>,
) {
  const area = box(label);
  if (
    area.left < 0 ||
    area.top < 0 ||
    area.right > required(graph.width, "Missing wiring width") ||
    area.bottom > required(graph.height, "Missing wiring height")
  )
    return false;
  if ((graph.children ?? []).some((n) => overlaps(area, box(n)))) return false;
  return !edges.some(
    (e) =>
      e.labels.some((l) => l !== label && overlaps(area, box(l))) ||
      (e.id !== own &&
        e.routes.some((r) =>
          routeSegments(r).some(({ a, b }) => {
            return overlaps(area, {
              left: Math.min(a.x, b.x),
              right: Math.max(a.x, b.x),
              top: Math.min(a.y, b.y),
              bottom: Math.max(a.y, b.y),
            });
          }),
        )),
  );
}
function positions(
  label: ElkLabel,
  routes: readonly (readonly Point[])[],
  nativeWiring: boolean,
) {
  const width = required(label.width, "Missing label width"),
    height = required(label.height, "Missing label height");
  const runs = nativeWiring
    ? wiringPlateRuns(routes, height)
    : routes
        .flatMap((r) => routeSegments(r))
        .map(({ a, b }) => ({
          a,
          b,
          lo: Math.min(a.x, b.x),
          hi: Math.max(a.x, b.x),
        }));
  const segments = runs
    .filter(
      (s) =>
        Math.abs(s.a.y - s.b.y) < 1e-7 &&
        (nativeWiring ? s.hi - s.lo >= width : s.hi - s.lo > width),
    )
    .sort((s, t) => Math.abs(t.a.x - t.b.x) - Math.abs(s.a.x - s.b.x));
  return segments.flatMap(({ a, b, lo: left, hi: right }) => {
    const x = Math.max(
      left,
      Math.min(right - width, required(label.x, "Unplaced label")),
    );
    const middle = nativeWiring
      ? Math.max(left, Math.min(right - width, (a.x + b.x - width) / 2))
      : (left + right - width) / 2;
    const proposals = nativeWiring
      ? [middle, x, left, right - width]
      : [left, right - width, x, middle];
    return [...new Set(proposals)].map((x) => ({ x, y: a.y - height / 2 }));
  });
}

function leaderSlots(label: ElkLabel, routes: readonly (readonly Point[])[]) {
  const ink = box(label),
    width = ink.right - ink.left,
    height = ink.bottom - ink.top;
  return routes.flatMap(routeSegments).flatMap(({ a, b }) => {
    const fitsAxis = (lo: number, hi: number, center: number) => [
      Math.max(lo, Math.min(hi, center)),
      (lo + hi) / 2,
    ];
    if (a.x === b.x)
      return fitsAxis(
        Math.min(a.y, b.y),
        Math.max(a.y, b.y),
        (ink.top + ink.bottom) / 2,
      ).flatMap((y) =>
        [a.x - width - 1.75, a.x + 1.75].map((x) => ({ x, y: y - height / 2 })),
      );
    return fitsAxis(
      Math.min(a.x, b.x),
      Math.max(a.x, b.x),
      (ink.left + ink.right) / 2,
    ).flatMap((x) =>
      [a.y - height - 1.75, a.y + 1.75].map((y) => ({ x: x - width / 2, y })),
    );
  });
}

function checkedLeader(
  label: ElkLabel,
  edge: ReturnType<typeof paths>[number],
  graph: ElkNode,
  edges: ReturnType<typeof paths>,
) {
  const own = edge.routes,
    ink = box(label);
  const foreign = edges.filter((e) => e !== edge).flatMap((e) => e.routes);
  // A leader must leave the plate clear of every conductor, including its owner.
  if (
    routeInkDistance(ink, own, 0.7) === 0 ||
    routeInkDistance(ink, foreign, 0.7) === 0
  )
    return undefined;
  return ownedLabelLeader(
    ink,
    ink,
    own,
    {
      foreign,
      obstacles: [
        ...(graph.children ?? []).map(box),
        ...edges.flatMap((e) => e.labels.filter((l) => l !== label).map(box)),
      ],
      strokeClearance: 0.25,
      bounds: {
        left: 0,
        top: 0,
        right: required(graph.width, "Missing wiring width"),
        bottom: required(graph.height, "Missing wiring height"),
      },
    },
    2,
    0.25,
  );
}

/** Use the longest free owned straight run without changing native paths,
 * bounds, font, label dimensions or physical identities. Keep legal old plates. */
export function ownedWiringLabels(
  graph: ElkNode,
  keep?: (edgeId: string, label: Readonly<ElkLabel>) => boolean,
  extraPositions?: (
    label: Readonly<ElkLabel>,
    routes: readonly (readonly Point[])[],
  ) => { x: number; y: number }[],
) {
  const copy = structuredClone(graph),
    edges = paths(copy);
  for (const edge of edges)
    for (const label of edge.labels) {
      const foreign = edges
        .filter((e) => e.id !== edge.id)
        .flatMap((e) => e.routes);
      const supported = () =>
        keep
          ? keep(edge.id, label)
          : wiringPlateFits(box(label), edge.routes) &&
            horizontalLabelSupport(box(label), edge.routes, 2, foreign);
      if (supported()) continue;
      const original = { x: label.x, y: label.y };
      let found = false;
      for (const p of [
        ...positions(label, edge.routes, !keep),
        ...(extraPositions?.(label, edge.routes) ?? []),
      ]) {
        Object.assign(label, p);
        if (free(label, edge.id, copy, edges) && supported()) {
          found = true;
          break;
        }
        Object.assign(label, original);
      }
      if (found || keep || checkedLeader(label, edge, copy, edges)) continue;
      for (const p of leaderSlots(label, edge.routes)) {
        Object.assign(label, p);
        if (
          free(label, edge.id, copy, edges) &&
          checkedLeader(label, edge, copy, edges)
        )
          break;
        Object.assign(label, original);
      }
    }
  return copy;
}

export function wiringLabelLeaders(graph: ElkNode) {
  const edges = paths(graph);
  return edges.flatMap((edge) =>
    edge.labels.flatMap((label) => {
      const own = edge.routes,
        foreign = edges
          .filter((e) => e.id !== edge.id)
          .flatMap((e) => e.routes),
        ink = box(label);
      if (
        wiringPlateFits(ink, own) &&
        horizontalLabelSupport(ink, own, 2, foreign)
      )
        return [];
      const points = checkedLeader(label, edge, graph, edges);
      if (!points)
        throw new CircuitRenderError(
          captionPlacementDiagnostic(
            label.text ?? "",
            edge.id,
            edge.id,
            "control",
          ),
        );
      return [{ edgeId: edge.id, points }];
    }),
  );
}
