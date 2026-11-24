import type {
  LayoutLabel,
  LayoutPoint,
  NormalizedSchematicLayout,
} from "../types.js";
import { printableLabelGeometry } from "../symbols/printable-label.js";
import { besideCaption } from "../layout/beside-caption.js";
import { rectInkBox, type InkBox } from "../layout/ink-geometry.js";
import {
  labelFrameObstacles,
  ownedLabelLeader,
} from "../layout/wire-label-support.js";
import { TWO_LINE_NET_LABEL_PITCH } from "../presentation/net-label-wrap.js";
import {
  boundedPrintableAdvance,
  printableTextMetrics,
} from "../text-metrics.js";

type Position = ReturnType<typeof printableLabelGeometry>;
type Plan =
  | { ok: true; position: Position; leader?: { x: number; y: number }[] }
  | { ok: false };

export interface TwoLineCaptionSpec {
  readonly lines: readonly [string, string];
  readonly capacity: number;
}

const ROUTE_SOURCE_SAFETY_MARGIN_MM = 0.25;

export function isConductorToRight(
  ink: Readonly<InkBox>,
  points: readonly LayoutPoint[],
): boolean {
  let bestDistance = Infinity;
  let rightSide = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!a || !b || Math.abs(a.x - b.x) >= 1e-7) continue;
    const segTop = Math.min(a.y, b.y),
      segBottom = Math.max(a.y, b.y);
    const dy = Math.max(segTop - ink.bottom, ink.top - segBottom, 0);
    const dx = Math.max(ink.left - a.x, a.x - ink.right, 0);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      rightSide = a.x >= ink.right - 0.01;
    }
  }
  return rightSide;
}

function distanceAlongRoute(
  center: Readonly<LayoutPoint>,
  points: readonly LayoutPoint[],
): { readonly at: number; readonly total: number } {
  let total = 0;
  let best = Infinity;
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const u = Math.max(
      0,
      Math.min(
        1,
        ((center.x - a.x) * (b.x - a.x) + (center.y - a.y) * (b.y - a.y)) /
          (length * length),
      ),
    );
    const d = Math.hypot(
      center.x - (a.x + u * (b.x - a.x)),
      center.y - (a.y + u * (b.y - a.y)),
    );
    if (d < best) {
      best = d;
      at = total + u * length;
    }
    total += length;
  }
  return { at, total };
}

function centerAtRouteSource(
  cx: number,
  cy: number,
  points: readonly LayoutPoint[],
  marginUnits: number,
): boolean {
  const probes: readonly LayoutPoint[] = [
    { x: cx, y: cy },
    { x: cx - marginUnits, y: cy - marginUnits },
    { x: cx + marginUnits, y: cy - marginUnits },
    { x: cx - marginUnits, y: cy + marginUnits },
    { x: cx + marginUnits, y: cy + marginUnits },
  ];
  return probes.every((probe) => {
    const { at, total } = distanceAlongRoute(probe, points);
    return total === 0 || at <= total / 2 - marginUnits;
  });
}

function twoLineRouteSourceAdmissible(
  position: Position,
  twoLine: TwoLineCaptionSpec,
  routePoints: readonly LayoutPoint[],
  mmPerUnit: number,
): ((candidate: InkBox) => boolean) | undefined {
  if (routePoints.length < 2) return undefined;
  const [b0, b1] = position.baselines ?? [
    position.baseline,
    position.baseline + TWO_LINE_NET_LABEL_PITCH,
  ];
  const rows = (
    [
      [twoLine.lines[0], b0],
      [twoLine.lines[1], b1],
    ] as const
  ).map(([line, baseline]) => {
    const m = printableTextMetrics(line.normalize("NFC"), 10, false, true);
    const advance = boundedPrintableAdvance(line, 10, twoLine.capacity, true);
    const scale = m.advance ? advance / m.advance : 1;
    return {
      inkWidth: (m.right - m.left) * scale,
      centerOffsetY: baseline - (m.top + m.bottom) / 2 - position.ink.top,
    };
  });
  const marginUnits = ROUTE_SOURCE_SAFETY_MARGIN_MM / mmPerUnit;
  return (candidate) => {
    const alignRight = isConductorToRight(candidate, routePoints);
    return rows.every((row) => {
      const cx = alignRight
        ? candidate.right - row.inkWidth / 2
        : candidate.left + row.inkWidth / 2;
      const cy = candidate.top + row.centerOffsetY;
      return centerAtRouteSource(cx, cy, routePoints, marginUnits);
    });
  };
}

function context(
  label: LayoutLabel,
  layout: Readonly<NormalizedSchematicLayout>,
) {
  return {
    foreign: layout.edges
      .filter((e) => e.id !== label.ownerId)
      .map((e) => e.points),
    obstacles: [
      ...layout.nodes
        .filter((n) => ["symbol", "rail", "junction"].includes(n.kind))
        .map(rectInkBox),
      ...layout.labels.filter((l) => l.id !== label.id).map(rectInkBox),
      ...layout.nodes
        .filter((n) => n.kind === "location" || n.kind === "device")
        .flatMap((n) => labelFrameObstacles(rectInkBox(n))),
    ],
    bounds: { left: 0, top: 0, right: layout.width, bottom: layout.height },
    strokeClearance: 1,
  };
}

export function rootedCaptionPlan(
  label: LayoutLabel,
  position: Position,
  layout: Readonly<NormalizedSchematicLayout>,
  mmPerUnit: number,
  twoLine?: TwoLineCaptionSpec,
): Plan {
  if (
    label.ownerKind !== "edge" ||
    layout.contextReferences?.some((r) => r.id === label.ownerId)
  )
    return { ok: true, position };
  const routePoints =
      layout.edges.find((e) => e.id === label.ownerId)?.points ?? [],
    own = [routePoints],
    surroundings = context(label, layout),
    reservation = rectInkBox(label),
    admissible =
      twoLine !== undefined && label.role === "net"
        ? twoLineRouteSourceAdmissible(
            position,
            twoLine,
            routePoints,
            mmPerUnit,
          )
        : undefined,
    placement = besideCaption(
      position.ink,
      reservation,
      own,
      surroundings,
      mmPerUnit,
      1.5,
      0,
      admissible,
    );
  if (!placement) return { ok: false };
  const baselines: readonly [number, number] | undefined = position.baselines
    ? [
        position.baselines[0] + placement.ink.top - position.ink.top,
        position.baselines[1] + placement.ink.top - position.ink.top,
      ]
    : undefined;
  const moved = {
    ...position,
    x: position.x + placement.ink.left - position.ink.left,
    y: position.y + placement.ink.top - position.ink.top,
    baseline: position.baseline + placement.ink.top - position.ink.top,
    ...(baselines ? { baselines } : {}),
    ink: placement.ink,
  };
  if (!placement.needsLeader) return { ok: true, position: moved };
  const points = ownedLabelLeader(
    moved.ink,
    reservation,
    own,
    surroundings,
    2 / mmPerUnit,
  );
  return points ? { ok: true, position: moved, leader: points } : { ok: false };
}
