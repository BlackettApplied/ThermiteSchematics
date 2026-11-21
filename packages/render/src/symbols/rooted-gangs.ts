import type { ElectricalIr } from "@thermite/compiler";
import type {
  PresentationGraph,
  NormalizedSchematicLayout,
  LayoutPoint,
  SymbolPresentationNode,
  RenderOutcome,
} from "../types.js";
import {
  GANG_CLEARANCE,
  gangAnchor,
  visibleRootedGangs,
} from "./gang-geometry.js";

export interface RootedGangSegment {
  groupId: string;
  from: LayoutPoint;
  to: LayoutPoint;
  functions: SymbolPresentationNode["functionIds"];
}
type VisibleGang = ReturnType<typeof visibleRootedGangs>[number];
type Anchor = LayoutPoint & { node: SymbolPresentationNode };

function gangFailure(
  gang: VisibleGang,
  graph: Readonly<PresentationGraph>,
  blockedBy: string,
): RenderOutcome<never> {
  const designation = gang.members[0]?.designation ?? "unknown device";
  return {
    ok: false,
    error: {
      code: "R006",
      reason: "unprintable-layout",
      root: graph.view.root.designation,
      message: `Mechanical gang ${gang.group.id} (${designation}) cannot paint all ${gang.members.length - 1} links: ${blockedBy}.`,
      details: {
        reason: "mechanical-gang",
        groupId: gang.group.id,
        designation,
        expectedStrokes: gang.members.length - 1,
        blockedBy,
      },
    },
  };
}

function obstruction(
  from: Anchor,
  to: Anchor,
  vertical: boolean,
  layout: Readonly<NormalizedSchematicLayout>,
  labels: ReadonlyMap<string, string>,
) {
  const between = (x: number, y: number, w: number, h: number) =>
    vertical
      ? from.x > x - GANG_CLEARANCE &&
        from.x < x + w + GANG_CLEARANCE &&
        y + h > from.y - GANG_CLEARANCE &&
        y < to.y + GANG_CLEARANCE
      : from.y > y - GANG_CLEARANCE &&
        from.y < y + h + GANG_CLEARANCE &&
        x + w > from.x - GANG_CLEARANCE &&
        x < to.x + GANG_CLEARANCE;
  const node = layout.nodes.find(
    (n) =>
      n.id !== from.node.id &&
      n.id !== to.node.id &&
      ["symbol", "rail", "junction"].includes(n.kind) &&
      between(n.x, n.y, n.width, n.height),
  );
  if (node) return `node ${node.id}`;
  const label = layout.labels.find(
    (l) => labels.get(l.id) && between(l.x, l.y, l.width, l.height),
  );
  if (label) return `annotation ${label.id}`;
  const edge = layout.edges.find((e) =>
    e.points.some((p, j) => {
      const previous = e.points[j - 1];
      return (
        previous &&
        between(
          Math.min(p.x, previous.x),
          Math.min(p.y, previous.y),
          Math.abs(p.x - previous.x),
          Math.abs(p.y - previous.y),
        )
      );
    }),
  );
  return edge ? `conductor ${edge.id}` : undefined;
}

function placeGang(
  gang: VisibleGang,
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
  labels: ReadonlyMap<string, string>,
): RenderOutcome<readonly RootedGangSegment[]> {
  const vertical = graph.view.flow === "left-to-right";
  const centers = gang.members
    .flatMap((node) => {
      const o = layout.nodes.find((n) => n.id === node.id)?.primitiveOrigin,
        a = gangAnchor(node);
      return o && a ? [{ node, x: o.x + a.x, y: o.y + a.y }] : [];
    })
    .sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
  const first = centers[0];
  if (!first || centers.length !== gang.members.length)
    return gangFailure(gang, graph, "missing supported gang anchor");
  if (
    centers.some(
      (c) =>
        Math.abs((vertical ? c.x : c.y) - (vertical ? first.x : first.y)) >
        0.001,
    )
  )
    return gangFailure(gang, graph, "misaligned poles");
  const segments: RootedGangSegment[] = [];
  for (let i = 1; i < centers.length; i++) {
    const from = centers[i - 1],
      to = centers[i];
    if (!from || !to)
      return gangFailure(gang, graph, "missing supported gang anchor");
    const blocked = obstruction(from, to, vertical, layout, labels);
    if (blocked) return gangFailure(gang, graph, blocked);
    segments.push({
      groupId: gang.group.id,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      functions: [...from.node.functionIds, ...to.node.functionIds],
    });
  }
  return { ok: true, value: segments };
}

/** Power switching poles must retain their authored mechanical association.
 * Other groups paint only supported, aligned, unobstructed links; shared device
 * designation retains their relationship when a link cannot be represented. */
export function rootedGangSegments(
  ir: Readonly<ElectricalIr>,
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
): RenderOutcome<readonly RootedGangSegment[]> {
  const labels = new Map(
    [
      ...graph.locationGroups.map((g) => g.label),
      ...graph.deviceGroups.map((g) => g.label),
      ...graph.nodes.flatMap((n) => (n.kind === "junction" ? [] : n.labels)),
      ...graph.edges.flatMap((e) => [
        ...(e.label ? [e.label] : []),
        ...(e.netLabel ? [e.netLabel] : []),
      ]),
    ].map((l) => [l.id, l.printableText ?? l.text]),
  );
  const result: RootedGangSegment[] = [];
  for (const gang of visibleRootedGangs(ir, graph)) {
    const placed = placeGang(gang, graph, layout, labels);
    if (placed.ok) result.push(...placed.value);
    else if (gang.mandatory) return placed;
  }
  return { ok: true, value: result };
}

/** Optional IR supports legacy geometry-only callers only for diagrams without
 * gang-capable marks. All such marks require authored IR, even if no group is
 * inferred by the caller; this closes the emission guard bypass. */
export function rootedGangEmission(
  ir: Readonly<ElectricalIr> | undefined,
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
): RenderOutcome<readonly RootedGangSegment[]> {
  if (ir) return rootedGangSegments(ir, graph, layout);
  if (
    graph.nodes.some(
      (n) => n.kind === "symbol" && (n.mechanicalGangId || gangAnchor(n)),
    )
  )
    return {
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        root: graph.view.root.designation,
        message:
          "Electrical IR is required to verify authored mechanical gangs before SVG emission.",
        details: { reason: "mechanical-gang-ir-required" },
      },
    };
  return { ok: true, value: [] };
}
