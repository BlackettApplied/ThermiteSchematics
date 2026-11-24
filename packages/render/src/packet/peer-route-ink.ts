import type { ConductiveElementId } from "@thermite/compiler";
import {
  expand,
  inside,
  intersection,
  project,
  type Matrix,
  type Rect,
} from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";
import { documentCoverRectangle } from "./document-covering.js";
import { paintedStroke } from "./document-assembly-geometry.js";
import { conductorEndpoints, pathElement } from "./navigation-incidence.js";
import { boxDistance } from "./navigation-symbols.js";
import type { NavigationGeometry } from "./navigation-walk.js";

export interface Point {
  x: number;
  y: number;
}
export interface RouteSegment {
  a: Point;
  b: Point;
  strokeWidth: number;
}
interface RoutePiece {
  segment?: RouteSegment;
  hull?: Rect;
}
interface JunctionCover {
  index: number;
  cx: number;
  cy: number;
  r: number;
  clip: Rect;
}
interface RouteInk {
  runs: Rect[];
  reachRuns: Rect[];
  tips: Rect[];
}

const ANGLE_SIN_TOL = 0.02;
const FLOAT_TOL = 1e-3;
const EPS = 1e-4;

export function transformPoint(p: Point, m: Matrix): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

function matrixScale(m: Matrix): number {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
}

function curveHull(
  kind: "C" | "Q" | "A",
  ox: number,
  oy: number,
  px: () => number,
  py: () => number,
  n: () => number,
): { x: number; y: number; hull: Rect } {
  if (kind === "A") {
    const rx = n(),
      ry = n();
    n();
    n();
    n();
    const x = px(),
      y = py(),
      r = Math.max(rx, ry) * 2;
    return {
      x,
      y,
      hull: {
        x: Math.min(ox, x) - r,
        y: Math.min(oy, y) - r,
        w: Math.abs(x - ox) + r * 2,
        h: Math.abs(y - oy) + r * 2,
      },
    };
  }
  const pts: Point[] = [{ x: ox, y: oy }];
  for (let j = 0; j < (kind === "C" ? 3 : 2); j++)
    pts.push({ x: px(), y: py() });
  const end = required(pts.at(-1), "Missing curve endpoint");
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y),
    minX = Math.min(...xs),
    minY = Math.min(...ys);
  return {
    x: end.x,
    y: end.y,
    hull: {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    },
  };
}

function parsePathPieces(d: string): RoutePiece[] {
  const tokens =
    d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: RoutePiece[] = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const n = () => {
    const t = Number(tokens[i++]);
    if (!Number.isFinite(t)) throw Error("Invalid generated path coordinate");
    return t;
  };
  const seg = (ax: number, ay: number, bx: number, by: number): RoutePiece => ({
    segment: { a: { x: ax, y: ay }, b: { x: bx, y: by }, strokeWidth: 0 },
  });
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(required(tokens[i], "Missing route path token")))
      cmd = required(tokens[i++], "Missing route path command");
    const rel = cmd === cmd.toLowerCase(),
      kind = cmd.toUpperCase(),
      ox = x,
      oy = y;
    const px = () => n() + (rel ? ox : 0),
      py = () => n() + (rel ? oy : 0);
    if (kind === "Z") {
      out.push(seg(x, y, sx, sy));
      x = sx;
      y = sy;
      cmd = "";
    } else if (kind === "M" || kind === "L") {
      x = px();
      y = py();
      if (kind === "M") {
        sx = x;
        sy = y;
        cmd = rel ? "l" : "L";
      } else out.push(seg(ox, oy, x, y));
    } else if (kind === "H") {
      x = px();
      out.push(seg(ox, oy, x, y));
    } else if (kind === "V") {
      y = py();
      out.push(seg(ox, oy, x, y));
    } else if (kind === "C" || kind === "Q" || kind === "A") {
      const next = curveHull(kind, ox, oy, px, py, n);
      x = next.x;
      y = next.y;
      out.push({ hull: next.hull });
    } else throw Error(`Unsupported generated path command ${cmd}`);
  }
  return out;
}

export function subtractSpan(
  spans: readonly (readonly [number, number])[],
  cut0: number,
  cut1: number,
): [number, number][] {
  const next: [number, number][] = [];
  for (const [a, b] of spans) {
    if (cut1 <= a || cut0 >= b) {
      next.push([a, b]);
      continue;
    }
    if (cut0 > a) next.push([a, cut0]);
    if (cut1 < b) next.push([cut1, b]);
  }
  return next;
}

export function clipIntervalToRect(
  a: Point,
  b: Point,
  rect: Rect,
): [number, number] | undefined {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  const planes: readonly (readonly [number, number])[] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.w - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.h - a.y],
  ];
  for (const [p, q] of planes) {
    if (Math.abs(p) <= 1e-12) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return undefined;
  }
  return [t0, t1];
}

export function sliceSegment(
  seg: RouteSegment,
  t0: number,
  t1: number,
): RouteSegment {
  return {
    a: {
      x: seg.a.x + (seg.b.x - seg.a.x) * t0,
      y: seg.a.y + (seg.b.y - seg.a.y) * t0,
    },
    b: {
      x: seg.a.x + (seg.b.x - seg.a.x) * t1,
      y: seg.a.y + (seg.b.y - seg.a.y) * t1,
    },
    strokeWidth: seg.strokeWidth,
  };
}

export function clipSegmentToRect(
  seg: RouteSegment,
  rect: Rect,
): RouteSegment | undefined {
  const interval = clipIntervalToRect(seg.a, seg.b, rect);
  if (!interval) return undefined;
  return sliceSegment(seg, interval[0], interval[1]);
}

export function subtractRectFromSegment(
  seg: RouteSegment,
  rect: Rect,
): RouteSegment[] {
  const cut = clipIntervalToRect(seg.a, seg.b, rect);
  if (!cut) return [seg];
  const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  if (len <= EPS) return [];
  return subtractSpan([[0, 1]], cut[0], cut[1])
    .filter(([u0, u1]) => (u1 - u0) * len > EPS)
    .map(([u0, u1]) => sliceSegment(seg, u0, u1));
}

function subtractCircleFromSegment(
  seg: RouteSegment,
  dot: JunctionCover,
): RouteSegment[] {
  const dx = seg.b.x - seg.a.x,
    dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy);
  if (len <= EPS)
    return inside({ ...seg.a, w: 0, h: 0 }, dot.clip) &&
      Math.hypot(seg.a.x - dot.cx, seg.a.y - dot.cy) <= dot.r
      ? []
      : [seg];
  const fx = seg.a.x - dot.cx,
    fy = seg.a.y - dot.cy;
  const a2 = len * len;
  const b2 = 2 * (fx * dx + fy * dy);
  const c2 = fx * fx + fy * fy - dot.r * dot.r;
  const disc = b2 * b2 - 4 * a2 * c2;
  if (disc <= 0) return [seg];
  const root = Math.sqrt(disc);
  let t0 = Math.max(0, (-b2 - root) / (2 * a2));
  let t1 = Math.min(1, (-b2 + root) / (2 * a2));
  if (t1 <= t0) return [seg];
  const clipSpan = clipIntervalToRect(seg.a, seg.b, dot.clip);
  if (!clipSpan) return [seg];
  t0 = Math.max(t0, clipSpan[0]);
  t1 = Math.min(t1, clipSpan[1]);
  if (t1 <= t0) return [seg];
  return subtractSpan([[0, 1]], t0, t1)
    .filter(([u0, u1]) => (u1 - u0) * len > EPS)
    .map(([u0, u1]) => sliceSegment(seg, u0, u1));
}

function subtractMaskRect(run: Rect, mask: Rect): Rect[] {
  const cut = intersection(run, mask);
  if (!cut) return [run];
  const pieces =
    run.w >= run.h
      ? [
          { ...run, w: cut.x - run.x },
          { ...run, x: cut.x + cut.w, w: run.x + run.w - cut.x - cut.w },
        ]
      : [
          { ...run, h: cut.y - run.y },
          { ...run, y: cut.y + cut.h, h: run.y + run.h - cut.y - cut.h },
        ];
  return pieces.filter((p) => p.w > 0 && p.h > 0);
}

function junctionDotCover(
  g: NavigationGeometry,
  index: number,
): JunctionCover | undefined {
  if (!g.visible || g.node.name !== "circle") return undefined;
  const a = g.node.attrs;
  const isJunction =
    /\bjunction-dot\b/u.test(a.class ?? "") ||
    a["data-circuit-junction"] !== undefined ||
    a["data-wiring-junction"] !== undefined;
  if (!isJunction) return undefined;
  const s = g.style ?? a;
  const fill = (s.fill ?? "black").trim().toLowerCase();
  if (fill === "none" || fill === "transparent") return undefined;
  const alpha = Number(s.opacity ?? 1) * Number(s["fill-opacity"] ?? 1);
  if (!(alpha >= 0.95)) return undefined;
  const r = Number(a.r) * matrixScale(g.matrix);
  if (!(r > 0)) return undefined;
  const center = transformPoint(
    { x: Number(a.cx ?? 0), y: Number(a.cy ?? 0) },
    g.matrix,
  );
  return { index, cx: center.x, cy: center.y, r, clip: g.clip };
}

function segmentToBox(seg: RouteSegment, clip: Rect): Rect | undefined {
  const half = seg.strokeWidth > 0 ? seg.strokeWidth / 2 : 0;
  const dx = Math.abs(seg.b.x - seg.a.x);
  const dy = Math.abs(seg.b.y - seg.a.y);
  const len = Math.hypot(dx, dy);
  const padX = len > EPS ? (half * dy) / len : half;
  const padY = len > EPS ? (half * dx) / len : half;
  return intersection(
    {
      x: Math.min(seg.a.x, seg.b.x) - padX,
      y: Math.min(seg.a.y, seg.b.y) - padY,
      w: dx + 2 * padX,
      h: dy + 2 * padY,
    },
    clip,
  );
}

function paintedPieces(
  g: NavigationGeometry,
  rectCovers: readonly Rect[],
  dotCovers: readonly JunctionCover[],
): RoutePiece[] {
  const s = g.style ?? g.node.attrs;
  const rawStroke = Number(s["stroke-width"] ?? 1);
  const strokeWidth =
    Number.isFinite(rawStroke) && rawStroke > 0
      ? rawStroke * matrixScale(g.matrix)
      : 0;
  const out: RoutePiece[] = [];
  for (const piece of parsePathPieces(g.node.attrs.d ?? "")) {
    if (piece.segment) {
      const projected: RouteSegment = {
        a: transformPoint(piece.segment.a, g.matrix),
        b: transformPoint(piece.segment.b, g.matrix),
        strokeWidth,
      };
      const clipped = clipSegmentToRect(projected, g.clip);
      if (!clipped) continue;
      let segs = rectCovers.reduce<RouteSegment[]>(
        (acc, rect) => acc.flatMap((seg) => subtractRectFromSegment(seg, rect)),
        [clipped],
      );
      segs = dotCovers.reduce<RouteSegment[]>(
        (acc, dot) => acc.flatMap((seg) => subtractCircleFromSegment(seg, dot)),
        segs,
      );
      for (const seg of segs) out.push({ segment: seg });
    } else if (piece.hull) {
      const box = intersection(
        expand(
          project(piece.hull, g.matrix),
          strokeWidth > 0 ? strokeWidth / 2 : 0,
        ),
        g.clip,
      );
      if (!box) continue;
      for (const rem of rectCovers.reduce(
        (acc, mask) => acc.flatMap((p) => subtractMaskRect(p, mask)),
        [box],
      ))
        out.push({ hull: rem });
    }
  }
  return out;
}

function routeKey(id: ConductiveElementId) {
  return id.kind === "cable_conductor"
    ? JSON.stringify({ cableUid: id.cableUid, conductorId: id.conductorId })
    : id.uid;
}

function paintedRouteKey(geometry: NavigationGeometry) {
  const native = pathElement(geometry);
  if (native) return routeKey(native);
  return (
    geometry.style?.["data-circuit-conductor"] ??
    geometry.style?.["data-wiring-conductor"] ??
    geometry.style?.["data-loop-conductor"]
  );
}

/** Subtract only collinear ink within half a stroke width over the exact overlapping span. */
function subtractCoincidentSegment(
  foreign: RouteSegment,
  ownSegments: readonly RouteSegment[],
): RouteSegment[] {
  if (!ownSegments.length) return [foreign];
  const len = Math.hypot(foreign.b.x - foreign.a.x, foreign.b.y - foreign.a.y);
  if (len <= EPS) return [foreign];
  const ux = (foreign.b.x - foreign.a.x) / len;
  const uy = (foreign.b.y - foreign.a.y) / len;
  let spans: [number, number][] = [[0, len]];
  let hadOverlap = false;
  for (const o of ownSegments) {
    const oLen = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
    if (oLen <= EPS) continue;
    const ox = (o.b.x - o.a.x) / oLen;
    const oy = (o.b.y - o.a.y) / oLen;
    if (Math.abs(ux * oy - uy * ox) > ANGLE_SIN_TOL) continue;
    const t1 = (o.a.x - foreign.a.x) * ux + (o.a.y - foreign.a.y) * uy;
    const t2 = (o.b.x - foreign.a.x) * ux + (o.b.y - foreign.a.y) * uy;
    const ov0 = Math.max(0, Math.min(t1, t2));
    const ov1 = Math.min(len, Math.max(t1, t2));
    if (ov1 - ov0 <= EPS) continue;
    const halfStroke =
      (foreign.strokeWidth > 0 && o.strokeWidth > 0
        ? Math.min(foreign.strokeWidth, o.strokeWidth)
        : Math.max(foreign.strokeWidth, o.strokeWidth)) / 2;
    const perpTol = halfStroke + FLOAT_TOL;
    const perpAt = (u: number) => {
      const px = foreign.a.x + ux * u - o.a.x;
      const py = foreign.a.y + uy * u - o.a.y;
      return Math.abs(px * oy - py * ox);
    };
    if (perpAt(ov0) > perpTol || perpAt(ov1) > perpTol) continue;
    hadOverlap = true;
    spans = subtractSpan(spans, ov0, ov1);
    if (!spans.length) return [];
  }
  if (!hadOverlap) return [foreign];
  return spans
    .filter(([u0, u1]) => u1 - u0 > EPS)
    .map(([u0, u1]) => ({
      a: { x: foreign.a.x + ux * u0, y: foreign.a.y + uy * u0 },
      b: { x: foreign.a.x + ux * u1, y: foreign.a.y + uy * u1 },
      strokeWidth: foreign.strokeWidth,
    }));
}

export interface PeerRouteIndex {
  route(element: ConductiveElementId): RouteInk;
  foreignRuns(element: ConductiveElementId): Rect[];
}

function collectRouteState(geometry: readonly NavigationGeometry[]) {
  const rectMasks = geometry.flatMap((g, index) => {
    const cover = documentCoverRectangle(g, index);
    return cover ? [cover] : [];
  });
  const dotMasks = geometry.flatMap((g, index) => {
    const cover = junctionDotCover(g, index);
    return cover ? [cover] : [];
  });
  const index = new Map<string, { g: NavigationGeometry; i: number }[]>();
  geometry.forEach((g, i) => {
    if (g.node.name !== "path" || !paintedStroke(g)) return;
    const key = paintedRouteKey(g);
    if (!key) return;
    const paths = index.get(key) ?? [];
    paths.push({ g, i });
    index.set(key, paths);
  });
  return { rectMasks, dotMasks, index };
}

function reachSegmentToBox(seg: RouteSegment, clip: Rect): Rect | undefined {
  const raw = {
    x: Math.min(seg.a.x, seg.b.x),
    y: Math.min(seg.a.y, seg.b.y),
    w: Math.abs(seg.b.x - seg.a.x),
    h: Math.abs(seg.b.y - seg.a.y),
  };
  return intersection(expand(raw, 0.01), clip);
}

function boxesFromPieces(
  items: readonly { piece: RoutePiece; clip: Rect }[],
  boxOf: (seg: RouteSegment, clip: Rect) => Rect | undefined = segmentToBox,
): Rect[] {
  return items.flatMap(({ piece, clip }) => {
    if (piece.segment) {
      const box = boxOf(piece.segment, clip);
      return box ? [box] : [];
    }
    return piece.hull ? [piece.hull] : [];
  });
}

export function peerRouteIndex(
  geometry: readonly NavigationGeometry[],
): PeerRouteIndex {
  const { rectMasks, dotMasks, index } = collectRouteState(geometry);
  const pieceCache = new Map<string, { piece: RoutePiece; clip: Rect }[]>();
  const tipCache = new Map<string, Rect[]>();
  const piecesForKey = (key: string) => {
    const found = pieceCache.get(key);
    if (found) return found;
    const pieces: { piece: RoutePiece; clip: Rect }[] = [];
    for (const { g, i } of index.get(key) ?? []) {
      const rects = rectMasks.filter((m) => m.index > i).map((m) => m.box);
      const dots = dotMasks.filter((m) => m.index > i);
      for (const piece of paintedPieces(g, rects, dots))
        pieces.push({ piece, clip: g.clip });
    }
    pieceCache.set(key, pieces);
    return pieces;
  };
  const tipsForKey = (key: string): Rect[] => {
    const found = tipCache.get(key);
    if (found) return found;
    const tips = (index.get(key) ?? []).flatMap(({ g }) =>
      conductorEndpoints(g.node.attrs.d ?? "")
        .map((p) => project({ ...p, w: 0, h: 0 }, g.matrix))
        .filter((p) => inside(p, g.clip)),
    );
    tipCache.set(key, tips);
    return tips;
  };
  return {
    route: (element: ConductiveElementId): RouteInk => {
      const key = routeKey(element);
      const pieces = piecesForKey(key);
      return {
        runs: boxesFromPieces(pieces),
        reachRuns: boxesFromPieces(pieces, reachSegmentToBox),
        tips: tipsForKey(key),
      };
    },
    foreignRuns: (element: ConductiveElementId): Rect[] => {
      const ownKey = routeKey(element);
      const ownSegs = piecesForKey(ownKey).flatMap(({ piece }) =>
        piece.segment ? [piece.segment] : [],
      );
      const out: Rect[] = [];
      for (const key of index.keys()) {
        if (key === ownKey) continue;
        for (const { piece, clip } of piecesForKey(key)) {
          if (piece.segment) {
            for (const rem of subtractCoincidentSegment(
              piece.segment,
              ownSegs,
            )) {
              const box = segmentToBox(rem, clip);
              if (box) out.push(box);
            }
          } else if (piece.hull) out.push(piece.hull);
        }
      }
      return out;
    },
  };
}

export function landsOnMarks(route: RouteInk, marks: readonly Rect[] = []) {
  return marks.some(
    (marker) =>
      route.tips.some((tip) => inside(tip, expand(marker, 0.05))) &&
      route.runs.some((run) => boxDistance(run, marker) <= 0.25),
  );
}

export function markerRegion(mark: NavigationGeometry, includeStroke = false) {
  const { cx, cy, r } = mark.node.attrs;
  const sw =
    includeStroke && paintedStroke(mark)
      ? Number((mark.style ?? mark.node.attrs)["stroke-width"] ?? 1)
      : 0;
  const rad = Number(r) + (Number.isFinite(sw) && sw > 0 ? sw / 2 : 0);
  return project(
    {
      x: Number(cx ?? 0) - rad,
      y: Number(cy ?? 0) - rad,
      w: 2 * rad,
      h: 2 * rad,
    },
    mark.matrix,
  );
}

export { attachmentRouteEnds } from "./peer-attachment-ink.js";
