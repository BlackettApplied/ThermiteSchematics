import { descendants, type SvgNode } from "../device-legend/svg-tree.js";
import {
  expand,
  inside,
  intersection,
  project,
  type Matrix,
  type Rect,
} from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";
import { paintedStroke } from "./document-assembly-geometry.js";
import { boxDistance } from "./navigation-symbols.js";
import type { NavigationGeometry } from "./navigation-walk.js";
import {
  clipIntervalToRect,
  clipSegmentToRect,
  sliceSegment,
  subtractRectFromSegment,
  subtractSpan,
  transformPoint,
  type Point,
  type RouteSegment,
} from "./peer-route-ink.js";

const EPS = 1e-4;
const ENDPOINT_TOL = 0.05;
const MARKER_TOUCH_TOL = 0.25;

type AttachmentCover =
  | { kind: "rect"; index: number; box: Rect }
  | {
      kind: "ellipse";
      index: number;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      inverse: Matrix;
      clip: Rect;
    }
  | {
      kind: "polygon";
      index: number;
      rings: Point[][];
      bbox: Rect;
      evenOdd: boolean;
      clip: Rect;
    };

function hasDashArray(style: Readonly<Record<string, string>> | undefined) {
  const raw = style?.["stroke-dasharray"]?.trim().toLowerCase();
  if (!raw || raw === "none") return false;
  const parts = raw.split(/[\s,]+/u).filter(Boolean);
  if (!parts.length) return false;
  let total = 0;
  for (const part of parts) {
    const value = Number.parseFloat(part);
    if (!Number.isFinite(value) || value < 0) return true;
    total += value;
  }
  return total > 0;
}

function cssOpacity(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (!trimmed) return 1;
  const value = trimmed.endsWith("%")
    ? Number(trimmed.slice(0, -1)) / 100
    : Number(trimmed);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function colorAlpha(raw: string | undefined): number {
  const fill = (raw ?? "black").trim().toLowerCase();
  if (fill === "none" || fill === "transparent") return 0;
  if (/^#[0-9a-f]{4}$/u.test(fill)) {
    const hex = required(fill[4], "Missing alpha hex digit");
    return Number.parseInt(hex + hex, 16) / 255;
  }
  if (/^#[0-9a-f]{8}$/u.test(fill))
    return Number.parseInt(fill.slice(7, 9), 16) / 255;
  const slash = /\/\s*([^)]+)\)$/u.exec(fill);
  if (slash) return cssOpacity(slash[1]);
  const rgba = /^(?:rgba|hsla)\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)$/u.exec(fill);
  if (rgba) return cssOpacity(rgba[1]);
  return 1;
}

function hasOpaqueFill(g: NavigationGeometry): boolean {
  if (!g.visible) return false;
  const s = g.style ?? g.node.attrs;
  return (
    colorAlpha(s.fill) *
      cssOpacity(s.opacity) *
      cssOpacity(s["fill-opacity"]) >=
    0.95
  );
}

function invertMatrix(m: Matrix): Matrix | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) <= 1e-12) return undefined;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

function pointsBbox(rings: readonly (readonly Point[])[]): Rect | undefined {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const ring of rings)
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    : undefined;
}

function parsePolyPoints(raw: string, matrix: Matrix): Point[] {
  const nums = raw
    .match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)
    ?.map(Number);
  if (!nums || nums.length < 6) return [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    pts.push(
      transformPoint(
        {
          x: required(nums[i], "Missing polygon x"),
          y: required(nums[i + 1], "Missing polygon y"),
        },
        matrix,
      ),
    );
  return pts;
}

function parseLinearPathRings(
  d: string,
  matrix: Matrix,
): { rings: Point[][]; curved: boolean } | undefined {
  const tokens =
    d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings: Point[][] = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    cur: Point[] = [];
  const n = () => Number(tokens[i++]);
  const push = (px: number, py: number) =>
    cur.push(transformPoint({ x: px, y: py }, matrix));
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i] ?? "")) cmd = tokens[i++] ?? "";
    const rel = cmd === cmd.toLowerCase(),
      kind = cmd.toUpperCase();
    if (kind === "Z") {
      x = sx;
      y = sy;
      cmd = "";
      continue;
    }
    if (kind === "M" || kind === "L") {
      const nx = n() + (rel ? x : 0),
        ny = n() + (rel ? y : 0);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return undefined;
      x = nx;
      y = ny;
      if (kind === "M") {
        if (cur.length) rings.push(cur);
        cur = [];
        sx = x;
        sy = y;
        cmd = rel ? "l" : "L";
      }
      push(x, y);
    } else if (kind === "H" || kind === "V") {
      const v = n();
      if (!Number.isFinite(v)) return undefined;
      if (kind === "H") x = v + (rel ? x : 0);
      else y = v + (rel ? y : 0);
      push(x, y);
    } else return { rings: [], curved: true };
  }
  if (cur.length) rings.push(cur);
  return { rings, curved: false };
}

function curveCoverBox(
  d: string,
  matrix: Matrix,
  clip: Rect,
): Rect | undefined {
  const nums = d
    .match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)
    ?.map(Number);
  if (!nums || nums.length < 2) return undefined;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const p = transformPoint(
      {
        x: required(nums[i], "Missing curve x"),
        y: required(nums[i + 1], "Missing curve y"),
      },
      matrix,
    );
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return intersection(
    { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    clip,
  );
}

function rectCover(
  g: NavigationGeometry,
  index: number,
  evenOdd: boolean,
): AttachmentCover | undefined {
  const a = g.node.attrs;
  const raw = {
    x: Number(a.x ?? 0),
    y: Number(a.y ?? 0),
    w: Number(a.width),
    h: Number(a.height),
  };
  if (!(raw.w > 0 && raw.h > 0)) return undefined;
  if (g.matrix[1] === 0 && g.matrix[2] === 0) {
    const box = intersection(project(raw, g.matrix), g.clip);
    return box ? { kind: "rect", index, box } : undefined;
  }
  const ring = [
    { x: raw.x, y: raw.y },
    { x: raw.x + raw.w, y: raw.y },
    { x: raw.x + raw.w, y: raw.y + raw.h },
    { x: raw.x, y: raw.y + raw.h },
  ].map((p) => transformPoint(p, g.matrix));
  const bbox = intersection(
    required(pointsBbox([ring]), "Missing rect bbox"),
    g.clip,
  );
  return bbox
    ? { kind: "polygon", index, rings: [ring], bbox, evenOdd, clip: g.clip }
    : undefined;
}

function polygonCover(
  rings: Point[][],
  index: number,
  evenOdd: boolean,
  clip: Rect,
): AttachmentCover | undefined {
  const valid = rings.filter((r) => r.length >= 3);
  const rawBox = valid.length ? pointsBbox(valid) : undefined;
  const bbox = rawBox ? intersection(rawBox, clip) : undefined;
  return bbox
    ? { kind: "polygon", index, rings: valid, bbox, evenOdd, clip }
    : undefined;
}

function extractShapeCover(
  g: NavigationGeometry,
  index: number,
): AttachmentCover | undefined {
  if (!hasOpaqueFill(g)) return undefined;
  const tag = g.node.name,
    a = g.node.attrs,
    s = g.style ?? a;
  const evenOdd = (s["fill-rule"] ?? "").trim().toLowerCase() === "evenodd";
  if (tag === "rect") return rectCover(g, index, evenOdd);
  if (tag === "circle" || tag === "ellipse") {
    const rx = Number(tag === "circle" ? a.r : a.rx);
    const ry = Number(tag === "circle" ? a.r : a.ry);
    const inverse = invertMatrix(g.matrix);
    if (!(rx > 0 && ry > 0) || !inverse) return undefined;
    return {
      kind: "ellipse",
      index,
      cx: Number(a.cx ?? 0),
      cy: Number(a.cy ?? 0),
      rx,
      ry,
      inverse,
      clip: g.clip,
    };
  }
  if (tag === "polygon" || tag === "polyline")
    return polygonCover(
      [parsePolyPoints(a.points ?? "", g.matrix)],
      index,
      evenOdd,
      g.clip,
    );
  if (tag === "path") {
    const d = a.d ?? "";
    const parsed = parseLinearPathRings(d, g.matrix);
    if (!parsed) return undefined;
    if (parsed.curved) {
      const box = curveCoverBox(d, g.matrix, g.clip);
      return box ? { kind: "rect", index, box } : undefined;
    }
    return polygonCover(parsed.rings, index, evenOdd, g.clip);
  }
  return undefined;
}

function subtractEllipseFromSegment(
  seg: RouteSegment,
  cover: Extract<AttachmentCover, { kind: "ellipse" }>,
): RouteSegment[] {
  const la = transformPoint(seg.a, cover.inverse);
  const lb = transformPoint(seg.b, cover.inverse);
  const uaX = (la.x - cover.cx) / cover.rx,
    uaY = (la.y - cover.cy) / cover.ry;
  const dx = (lb.x - cover.cx) / cover.rx - uaX,
    dy = (lb.y - cover.cy) / cover.ry - uaY;
  const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  const a2 = dx * dx + dy * dy;
  if (len <= EPS || a2 <= 1e-12)
    return inside({ ...seg.a, w: 0, h: 0 }, cover.clip) &&
      uaX * uaX + uaY * uaY <= 1
      ? []
      : [seg];
  const b2 = 2 * (uaX * dx + uaY * dy);
  const c2 = uaX * uaX + uaY * uaY - 1;
  const disc = b2 * b2 - 4 * a2 * c2;
  if (disc <= 0) return [seg];
  const root = Math.sqrt(disc);
  let t0 = Math.max(0, (-b2 - root) / (2 * a2));
  let t1 = Math.min(1, (-b2 + root) / (2 * a2));
  if (t1 <= t0) return [seg];
  const clipSpan = clipIntervalToRect(seg.a, seg.b, cover.clip);
  if (!clipSpan) return [seg];
  t0 = Math.max(t0, clipSpan[0]);
  t1 = Math.min(t1, clipSpan[1]);
  if (t1 <= t0) return [seg];
  return subtractSpan([[0, 1]], t0, t1)
    .filter(([u0, u1]) => (u1 - u0) * len > EPS)
    .map(([u0, u1]) => sliceSegment(seg, u0, u1));
}

function pointInRings(
  p: Point,
  rings: readonly (readonly Point[])[],
  evenOdd: boolean,
): boolean {
  let winding = 0,
    odd = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = required(ring[i], "Missing ring vertex");
      const b = required(ring[(i + 1) % ring.length], "Missing ring vertex");
      if (a.y <= p.y) {
        if (
          b.y > p.y &&
          (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0
        ) {
          winding++;
          odd = !odd;
        }
      } else if (
        b.y <= p.y &&
        (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0
      ) {
        winding--;
        odd = !odd;
      }
    }
  }
  return evenOdd ? odd : winding !== 0;
}

function subtractPolygonFromSegment(
  seg: RouteSegment,
  cover: Extract<AttachmentCover, { kind: "polygon" }>,
): RouteSegment[] {
  const clipSpan = clipIntervalToRect(seg.a, seg.b, cover.bbox);
  if (!clipSpan) return [seg];
  const dx = seg.b.x - seg.a.x,
    dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy);
  if (len <= EPS)
    return inside({ ...seg.a, w: 0, h: 0 }, cover.clip) &&
      pointInRings(seg.a, cover.rings, cover.evenOdd)
      ? []
      : [seg];
  const ts = [0, 1, clipSpan[0], clipSpan[1]];
  for (const ring of cover.rings)
    for (let i = 0; i < ring.length; i++) {
      const p0 = required(ring[i], "Missing edge start");
      const p1 = required(ring[(i + 1) % ring.length], "Missing edge end");
      const ex = p1.x - p0.x,
        ey = p1.y - p0.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) <= 1e-12) continue;
      const t = ((p0.x - seg.a.x) * ey - (p0.y - seg.a.y) * ex) / denom;
      const u = ((p0.x - seg.a.x) * dy - (p0.y - seg.a.y) * dx) / denom;
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  ts.sort((a, b) => a - b);
  const kept: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = required(ts[i], "Missing split start"),
      t1 = required(ts[i + 1], "Missing split end");
    if (t1 - t0 <= 1e-9) continue;
    const mid = {
      x: seg.a.x + dx * ((t0 + t1) / 2),
      y: seg.a.y + dy * ((t0 + t1) / 2),
    };
    if (
      inside({ ...mid, w: 0, h: 0 }, cover.clip) &&
      pointInRings(mid, cover.rings, cover.evenOdd)
    )
      continue;
    const last = kept.at(-1);
    if (last && Math.abs(last[1] - t0) <= 1e-9) last[1] = t1;
    else kept.push([t0, t1]);
  }
  return kept
    .filter(([u0, u1]) => (u1 - u0) * len > EPS)
    .map(([u0, u1]) => sliceSegment(seg, u0, u1));
}

function subtractCover(
  seg: RouteSegment,
  cover: AttachmentCover,
): RouteSegment[] {
  if (cover.kind === "rect") return subtractRectFromSegment(seg, cover.box);
  if (cover.kind === "ellipse") return subtractEllipseFromSegment(seg, cover);
  return subtractPolygonFromSegment(seg, cover);
}

function parseAttachmentKey(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    )
      return JSON.stringify([parsed[0], parsed[1]]);
  } catch {
    return undefined;
  }
  return undefined;
}

function shapePathData(g: NavigationGeometry): string | undefined {
  const a = g.node.attrs;
  if (g.node.name === "path") return a.d;
  if (g.node.name === "line")
    return `M ${Number(a.x1 ?? 0)} ${Number(a.y1 ?? 0)} L ${Number(a.x2 ?? 0)} ${Number(a.y2 ?? 0)}`;
  if (g.node.name === "polyline") {
    const nums = (a.points ?? "")
      .match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)
      ?.map(Number);
    if (!nums || nums.length < 4) return undefined;
    const cmds = [`M ${nums[0]} ${nums[1]}`];
    for (let i = 2; i + 1 < nums.length; i += 2)
      cmds.push(`L ${nums[i]} ${nums[i + 1]}`);
    return cmds.join(" ");
  }
  return undefined;
}

/** Parse a linear attachment path, rejecting any disconnected M/m subpath jump. */
function parseContinuousLead(
  d: string,
  matrix: Matrix,
): { start: Point; end: Point; segments: RouteSegment[] } | undefined {
  const tokens =
    d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const segments: RouteSegment[] = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    start: Point | undefined,
    end: Point | undefined;
  const n = () => Number(tokens[i++]);
  const addSeg = (ax: number, ay: number, bx: number, by: number) => {
    const a = transformPoint({ x: ax, y: ay }, matrix);
    const b = transformPoint({ x: bx, y: by }, matrix);
    segments.push({ a, b, strokeWidth: 0 });
    end = b;
  };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i] ?? "")) cmd = tokens[i++] ?? "";
    const rel = cmd === cmd.toLowerCase(),
      kind = cmd.toUpperCase(),
      ox = x,
      oy = y;
    if (kind === "Z") {
      addSeg(x, y, sx, sy);
      x = sx;
      y = sy;
      cmd = "";
    } else if (kind === "M" || kind === "L") {
      const nx = n() + (rel ? ox : 0),
        ny = n() + (rel ? oy : 0);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return undefined;
      x = nx;
      y = ny;
      if (kind === "M") {
        const moved = transformPoint({ x, y }, matrix);
        if (end && Math.hypot(moved.x - end.x, moved.y - end.y) > ENDPOINT_TOL)
          return undefined;
        start ??= moved;
        end = moved;
        sx = x;
        sy = y;
        cmd = rel ? "l" : "L";
      } else addSeg(ox, oy, x, y);
    } else if (kind === "H" || kind === "V") {
      const v = n();
      if (!Number.isFinite(v)) return undefined;
      if (kind === "H") x = v + (rel ? ox : 0);
      else y = v + (rel ? oy : 0);
      addSeg(ox, oy, x, y);
    } else return undefined;
  }
  return start && end && segments.length ? { start, end, segments } : undefined;
}

function paintedConnects(
  segs: readonly RouteSegment[],
  marker: Rect,
  tip: Rect,
): boolean {
  if (!segs.length) return false;
  const touchesMarker = (p: Point) =>
    boxDistance({ ...p, w: 0, h: 0 }, marker) <= MARKER_TOUCH_TOL;
  const touchesTip = (p: Point) =>
    boxDistance({ ...p, w: 0, h: 0 }, tip) <= ENDPOINT_TOL;
  const reached = new Array<boolean>(segs.length).fill(false);
  const queue: number[] = [];
  segs.forEach((seg, idx) => {
    if (touchesMarker(seg.a) || touchesMarker(seg.b)) {
      reached[idx] = true;
      queue.push(idx);
    }
  });
  while (queue.length) {
    const idx = queue.pop();
    if (idx === undefined) continue;
    const cur = required(segs[idx], "Missing attachment segment");
    if (touchesTip(cur.a) || touchesTip(cur.b)) return true;
    for (let j = 0; j < segs.length; j++) {
      if (reached[j]) continue;
      const next = required(segs[j], "Missing attachment segment");
      if (
        Math.hypot(cur.a.x - next.a.x, cur.a.y - next.a.y) <= ENDPOINT_TOL ||
        Math.hypot(cur.a.x - next.b.x, cur.a.y - next.b.y) <= ENDPOINT_TOL ||
        Math.hypot(cur.b.x - next.a.x, cur.b.y - next.a.y) <= ENDPOINT_TOL ||
        Math.hypot(cur.b.x - next.b.x, cur.b.y - next.b.y) <= ENDPOINT_TOL
      ) {
        reached[j] = true;
        queue.push(j);
      }
    }
  }
  return false;
}

function collectAttachmentKeys(
  geometry: readonly NavigationGeometry[],
): Map<SvgNode, string> {
  const keys = new Map<SvgNode, string>();
  for (const g of geometry) {
    const raw = g.node.attrs["data-terminal-attachment"];
    if (!raw || !g.visible) continue;
    const key = parseAttachmentKey(raw);
    if (!key) continue;
    for (const node of [g.node, ...descendants(g.node)])
      if (["path", "line", "polyline"].includes(node.name)) keys.set(node, key);
  }
  return keys;
}

/** Drawn attachment-lead endpoints that bridge a physical terminal marker to a route tip. */
export function attachmentRouteEnds(
  geometry: readonly NavigationGeometry[],
  field: Rect,
  terminalMarks: ReadonlyMap<string, readonly Rect[]>,
): Map<string, Rect[]> {
  const keys = collectAttachmentKeys(geometry);
  const out = new Map<string, Rect[]>();
  if (!keys.size) return out;
  const covers = geometry.flatMap((g, index) => {
    const cover = extractShapeCover(g, index);
    return cover ? [cover] : [];
  });
  geometry.forEach((g, index) => {
    const key = keys.get(g.node);
    const marks = key ? terminalMarks.get(key) : undefined;
    if (
      !key ||
      !marks?.length ||
      !paintedStroke(g) ||
      hasDashArray(g.style ?? g.node.attrs)
    )
      return;
    const d = shapePathData(g);
    const lead = d ? parseContinuousLead(d, g.matrix) : undefined;
    if (!lead) return;
    const p0: Rect = { ...lead.start, w: 0, h: 0 };
    const p1: Rect = { ...lead.end, w: 0, h: 0 };
    if (
      !inside(p0, g.clip) ||
      !inside(p1, g.clip) ||
      !inside(p0, field) ||
      !inside(p1, field)
    )
      return;
    const later = covers.filter((c) => c.index > index);
    const painted = lead.segments.flatMap((seg) => {
      const clipped = clipSegmentToRect(seg, g.clip);
      if (!clipped) return [];
      return later.reduce<RouteSegment[]>(
        (acc, cover) => acc.flatMap((s) => subtractCover(s, cover)),
        [clipped],
      );
    });
    for (const [markEnd, tipEnd] of [
      [p0, p1],
      [p1, p0],
    ] as const) {
      const marker = marks.find((m) =>
        inside(markEnd, expand(m, ENDPOINT_TOL)),
      );
      if (!marker || !paintedConnects(painted, marker, tipEnd)) continue;
      const list = out.get(key) ?? [];
      list.push(tipEnd);
      out.set(key, list);
    }
  });
  return out;
}
