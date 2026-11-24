import { extent, painted } from "./review-geometry.mjs";
import { elementKey, routeKey } from "./tranche4-source.mjs";

// Shared with packages/render/src/packet/navigation-slot-search.ts
// (OWNER_MARGIN_MM = 0.5, CONDUCTOR_OWNER_MARGIN_MM = 0.25).
export const OWNER_MARGIN_MM = 0.5;
export const CONDUCTOR_OWNER_MARGIN_MM = 0.25;

export function boxGap(a, b) {
  return Math.hypot(
    Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w),
    Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h),
  );
}

function routeIdentity(s) {
  const [kind, ...ids] = s.edgeOwnerKey ?? [];
  const edge =
    kind === "cable-conductor"
      ? JSON.stringify(ids)
      : ["wire", "jumper"].includes(kind)
        ? ids[0]
        : undefined;
  const declaration = routeKey(s);
  if (declaration && edge && declaration !== edge) return undefined;
  return declaration ?? edge;
}

function boundRoute(s, key) {
  return routeIdentity(s) === key;
}

function strokeSegmentBox(a, b, strokeWidth) {
  const half = strokeWidth > 0 ? strokeWidth / 2 : 0;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const len = Math.hypot(dx, dy);
  const padX = len > EPS ? (half * dy) / len : half;
  const padY = len > EPS ? (half * dx) / len : half;
  return {
    x: Math.min(a.x, b.x) - padX,
    y: Math.min(a.y, b.y) - padY,
    w: dx + 2 * padX,
    h: dy + 2 * padY,
  };
}

export function conductorInk(g, element) {
  const key = elementKey(element);
  const shapes = (g.shapes ?? []).filter(
    (s) => boundRoute(s, key) && g.tranche3?.routeInk?.[s.element]?.length,
  );
  return {
    runs: shapes.flatMap((s) => g.tranche3.routeInk[s.element]),
    boxes: shapes.flatMap((s) => {
      const w = s.stroke > 0 ? s.stroke : 0;
      return g.tranche3.routeInk[s.element].map(([a, b]) =>
        strokeSegmentBox(a, b, w),
      );
    }),
    tips: shapes.flatMap((s) =>
      s.points?.length ? [s.points[0], s.points.at(-1)] : [],
    ),
  };
}

const ANGLE_SIN_TOL = 0.02;
const FLOAT_TOL = 1e-3;
const EPS = 1e-4;
const ROUTE_INK_STEP_MM = 0.21;

function subtractSpan(spans, cut0, cut1) {
  const next = [];
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

function clipSegmentToRect(a, b, rect) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) <= 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    !clip(-dx, a.x - rect.x) ||
    !clip(dx, rect.x + rect.w - a.x) ||
    !clip(-dy, a.y - rect.y) ||
    !clip(dy, rect.y + rect.h - a.y)
  )
    return null;
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

function parseRouteSegments(d, m, clips) {
  const tokens =
    d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const raw = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(),
      kind = cmd.toUpperCase(),
      ox = x,
      oy = y;
    const px = () => num() + (rel ? ox : 0),
      py = () => num() + (rel ? oy : 0);
    if (kind === "Z") {
      raw.push([
        { x, y },
        { x: sx, y: sy },
      ]);
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
      } else
        raw.push([
          { x: ox, y: oy },
          { x, y },
        ]);
    } else if (kind === "H") {
      x = px();
      raw.push([
        { x: ox, y: oy },
        { x, y },
      ]);
    } else if (kind === "V") {
      y = py();
      raw.push([
        { x: ox, y: oy },
        { x, y },
      ]);
    } else break;
  }
  const project = (p) => ({
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  });
  return raw.flatMap(([a, b]) => {
    let seg = [project(a), project(b)];
    for (const clip of clips) {
      if (!clip) continue;
      seg = clipSegmentToRect(seg[0], seg[1], clip);
      if (!seg) return [];
    }
    return [seg];
  });
}

function clampRunToPath(run, pathSegs, strokeWidth) {
  const [a, b] = run;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= EPS || !pathSegs.length) return { a, b, strokeWidth };
  const ux = (b.x - a.x) / len,
    uy = (b.y - a.y) / len;
  for (const [p0, p1] of pathSegs) {
    const pLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (pLen <= EPS) continue;
    const px = (p1.x - p0.x) / pLen,
      py = (p1.y - p0.y) / pLen;
    if (Math.abs(ux * py - uy * px) > ANGLE_SIN_TOL) continue;
    const perpA = Math.abs((a.x - p0.x) * py - (a.y - p0.y) * px);
    const perpB = Math.abs((b.x - p0.x) * py - (b.y - p0.y) * px);
    if (perpA > 0.01 || perpB > 0.01) continue;
    const tA = (a.x - p0.x) * px + (a.y - p0.y) * py;
    const tB = (b.x - p0.x) * px + (b.y - p0.y) * py;
    const r0 = Math.min(tA, tB),
      r1 = Math.max(tA, tB);
    if (r1 < -0.01 || r0 > pLen + 0.01) continue;
    // Absorb at most one strokeInk sampling step at an interior occluder edge,
    // clamped strictly to the true path endpoints (zero expansion at real ends).
    const c0 = Math.max(0, r0 - ROUTE_INK_STEP_MM);
    const c1 = Math.min(pLen, r1 + ROUTE_INK_STEP_MM);
    return {
      a: { x: p0.x + px * c0, y: p0.y + py * c0 },
      b: { x: p0.x + px * c1, y: p0.y + py * c1 },
      strokeWidth,
    };
  }
  return { a, b, strokeWidth };
}

function ownRouteSegments(g, ownKey, ownRuns) {
  const shapes = (g.shapes ?? []).filter(
    (s) => boundRoute(s, ownKey) && g.tranche3?.routeInk?.[s.element]?.length,
  );
  if (!shapes.length)
    return (ownRuns ?? []).map(([a, b]) => ({ a, b, strokeWidth: 0 }));
  const segs = [];
  for (const s of shapes) {
    const strokeWidth = s.stroke > 0 ? s.stroke : 0;
    const clips = [s.viewport, ...(s.clips ?? [])].filter(Boolean);
    const pathSegs =
      s.routePath && s.routeMatrix
        ? parseRouteSegments(s.routePath, s.routeMatrix, clips)
        : [];
    for (const run of g.tranche3.routeInk[s.element])
      segs.push(clampRunToPath(run, pathSegs, strokeWidth));
  }
  return segs;
}

/** Subtract only collinear ink within half a stroke width over the exact overlapping span. */
function nonCoincidentRunPieces(run, foreignStrokeWidth, ownSegments) {
  if (!ownSegments.length) return [run];
  const [a, b] = run;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= EPS) return [run];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  let spans = [[0, len]];
  let hadOverlap = false;
  for (const o of ownSegments) {
    const oLen = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
    if (oLen <= EPS) continue;
    const ox = (o.b.x - o.a.x) / oLen;
    const oy = (o.b.y - o.a.y) / oLen;
    if (Math.abs(ux * oy - uy * ox) > ANGLE_SIN_TOL) continue;
    const t1 = (o.a.x - a.x) * ux + (o.a.y - a.y) * uy;
    const t2 = (o.b.x - a.x) * ux + (o.b.y - a.y) * uy;
    const ov0 = Math.max(0, Math.min(t1, t2));
    const ov1 = Math.min(len, Math.max(t1, t2));
    if (ov1 - ov0 <= EPS) continue;
    const halfStroke =
      (foreignStrokeWidth > 0 && o.strokeWidth > 0
        ? Math.min(foreignStrokeWidth, o.strokeWidth)
        : Math.max(foreignStrokeWidth, o.strokeWidth)) / 2;
    const perpTol = halfStroke + FLOAT_TOL;
    const perpAt = (u) => {
      const px = a.x + ux * u - o.a.x;
      const py = a.y + uy * u - o.a.y;
      return Math.abs(px * oy - py * ox);
    };
    if (perpAt(ov0) > perpTol || perpAt(ov1) > perpTol) continue;
    hadOverlap = true;
    spans = subtractSpan(spans, ov0, ov1);
    if (!spans.length) return [];
  }
  if (!hadOverlap) return [run];
  return spans
    .filter(([u0, u1]) => u1 - u0 > EPS)
    .map(([u0, u1]) => [
      { x: a.x + ux * u0, y: a.y + uy * u0 },
      { x: a.x + ux * u1, y: a.y + uy * u1 },
    ]);
}

function subtractCoincidentBox(foreign, ownBoxes) {
  const horiz = foreign.h <= FLOAT_TOL && foreign.w > foreign.h;
  const vert = !horiz && foreign.w <= FLOAT_TOL && foreign.h > foreign.w;
  if (!horiz && !vert) return [foreign];
  const center = horiz ? foreign.y + foreign.h / 2 : foreign.x + foreign.w / 2;
  const f0 = horiz ? foreign.x : foreign.y;
  const f1 = f0 + (horiz ? foreign.w : foreign.h);
  let spans = [[f0, f1]];
  let hadOverlap = false;
  for (const o of ownBoxes) {
    const oMatch = horiz
      ? o.h <= FLOAT_TOL && o.w > o.h
      : o.w <= FLOAT_TOL && o.h > o.w;
    if (!oMatch) continue;
    const oCenter = horiz ? o.y + o.h / 2 : o.x + o.w / 2;
    if (Math.abs(oCenter - center) > FLOAT_TOL) continue;
    const o0 = horiz ? o.x : o.y;
    const o1 = o0 + (horiz ? o.w : o.h);
    const ov0 = Math.max(f0, o0);
    const ov1 = Math.min(f1, o1);
    if (ov1 - ov0 <= EPS) continue;
    hadOverlap = true;
    spans = subtractSpan(spans, ov0, ov1);
    if (!spans.length) return [];
  }
  if (!hadOverlap) return [foreign];
  return spans
    .filter(([a, b]) => b - a > EPS)
    .map(([a, b]) =>
      horiz
        ? { x: a, y: foreign.y, w: b - a, h: foreign.h }
        : { x: foreign.x, y: a, w: foreign.w, h: b - a },
    );
}

export function excludeCoincidentBoxes(foreignBoxes, ownBoxes) {
  if (!foreignBoxes.length || !ownBoxes.length) return foreignBoxes;
  return foreignBoxes.flatMap((box) => subtractCoincidentBox(box, ownBoxes));
}

export function foreignConductorBoxes(
  g,
  element,
  ownRuns = conductorInk(g, element).runs,
) {
  const ownKey = elementKey(element);
  const ownSegs = ownRouteSegments(g, ownKey, ownRuns);
  const boxes = [];
  for (const s of g.shapes ?? []) {
    const runs = g.tranche3?.routeInk?.[s.element];
    if (!runs?.length) continue;
    const id = routeIdentity(s);
    if (!id || id === ownKey) continue;
    const wf = s.stroke > 0 ? s.stroke : 0;
    for (const run of runs)
      for (const piece of nonCoincidentRunPieces(run, wf, ownSegs))
        boxes.push(strokeSegmentBox(piece[0], piece[1], wf));
  }
  return boxes;
}

export function paintedToBothEnds({ runs, boxes, tips }, a, b) {
  const ink = boxes ?? runs.map(extent);
  return [a, b].every((marks) =>
    marks?.some(
      (m) =>
        tips.some((p) => boxGap({ ...p, w: 0, h: 0 }, m) <= 0.05) &&
        ink.some((stroke) => boxGap(stroke, m) <= 0.25),
    ),
  );
}

function parseAttachmentKey(raw) {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw);
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

function hasDashArray(raw) {
  const trimmed = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!trimmed || trimmed === "none") return false;
  const parts = trimmed.split(/[\s,]+/u).filter(Boolean);
  if (!parts.length) return false;
  let total = 0;
  for (const part of parts) {
    const value = Number.parseFloat(part);
    if (!Number.isFinite(value) || value < 0) return true;
    total += value;
  }
  return total > 0;
}

function readPathNumber(d, state, flag) {
  while (state.i < d.length && /[\s,]/.test(d[state.i])) state.i++;
  const match = d
    .slice(state.i)
    .match(flag ? /^[01]/ : /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/);
  if (!match || !Number.isFinite(Number(match[0]))) return null;
  state.i += match[0].length;
  return Number(match[0]);
}

/** Reject a multi-subpath lead if any M/m move jumps > 0.05 mm from the prior end. */
function subpathsContinuous(d, m) {
  const sizes = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  const state = { i: 0 };
  const project = (px, py) =>
    m
      ? { x: m[0] * px + m[2] * py + m[4], y: m[1] * px + m[3] * py + m[5] }
      : { x: px, y: py };
  let cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    lastEnd = null;
  while (state.i < d.length) {
    while (state.i < d.length && /[\s,]/.test(d[state.i])) state.i++;
    if (state.i === d.length) break;
    if (/^[a-zA-Z]$/.test(d[state.i])) cmd = d[state.i++];
    const kind = cmd.toUpperCase(),
      rel = cmd !== kind;
    if (kind === "Z") {
      x = sx;
      y = sy;
      lastEnd = project(x, y);
      cmd = "";
      continue;
    }
    const count = sizes[kind];
    if (!count) return false;
    const vals = [];
    for (let j = 0; j < count; j++) {
      const v = readPathNumber(d, state, kind === "A" && (j === 3 || j === 4));
      if (v === null) return false;
      vals.push(v);
    }
    if (kind === "H") x = rel ? x + vals[0] : vals[0];
    else if (kind === "V") y = rel ? y + vals[0] : vals[0];
    else {
      x = (rel ? x : 0) + vals.at(-2);
      y = (rel ? y : 0) + vals.at(-1);
    }
    const pt = project(x, y);
    if (kind === "M") {
      if (lastEnd && Math.hypot(pt.x - lastEnd.x, pt.y - lastEnd.y) > 0.05)
        return false;
      sx = x;
      sy = y;
      cmd = rel ? "l" : "L";
    }
    lastEnd = pt;
  }
  return lastEnd !== null;
}

function inkIntervalConnects(intervals, marker, tip) {
  return intervals.some(([a, b]) => {
    const aBox = { ...a, w: 0, h: 0 };
    const bBox = { ...b, w: 0, h: 0 };
    return (
      (boxGap(aBox, marker) <= 0.25 && boxGap(bBox, tip) <= 0.05) ||
      (boxGap(bBox, marker) <= 0.25 && boxGap(aBox, tip) <= 0.05)
    );
  });
}

/** Drawn attachment-lead endpoints that bridge a physical terminal marker to a route tip. */
export function attachmentLeadEnds(g, terminals) {
  const out = new Map();
  for (const s of g.shapes ?? []) {
    if (
      !s.attachment ||
      !(s.stroke > 0) ||
      hasDashArray(s.dash) ||
      !["path", "line", "polyline"].includes(s.shapeTag) ||
      (s.shapeTag === "path" &&
        typeof s.routePath === "string" &&
        !subpathsContinuous(s.routePath, s.routeMatrix)) ||
      !s.points?.length ||
      !s.inkSegments?.length
    )
      continue;
    const key = parseAttachmentKey(s.attachment);
    const region = key && terminals.get(key);
    if (!region?.boxes.length) continue;
    const ends = [s.points[0], s.points.at(-1)];
    for (const [markEnd, tipEnd] of [
      [ends[0], ends[1]],
      [ends[1], ends[0]],
    ]) {
      const markBox = { ...markEnd, w: 0, h: 0 };
      const tipBox = { ...tipEnd, w: 0, h: 0 };
      const marker = region.boxes.find((m) => boxGap(markBox, m) <= 0.05);
      if (!marker || !inkIntervalConnects(s.inkSegments, marker, tipBox))
        continue;
      const list = out.get(key) ?? [];
      list.push(tipBox);
      out.set(key, list);
    }
  }
  return out;
}

export function continuationInk(sheet, g, element, runs) {
  const native = new Set(
    (sheet.continuations ?? [])
      .filter((c) => elementKey(c.provenance) === elementKey(element))
      .map((c) => c.id),
  );
  const links = new Set(
    (g.connectors ?? [])
      .filter(
        (c) =>
          native.has(c.id) &&
          runs.some(
            (run) => boxGap({ ...c.anchor, w: 0, h: 0 }, extent(run)) <= 0.6,
          ),
      )
      .map((c) => c.element),
  );
  return g.texts.flatMap((t) =>
    painted(t) && t.bbox && links.has(t.continuationLink) ? [t.bbox] : [],
  );
}

function noteRegion(lines) {
  return extent(
    lines.flatMap(({ bbox: b }) => [b, { x: b.x + b.w, y: b.y + b.h }]),
  );
}

// Chromium ink boxes are quantized. Allow 0.15 mm for the comparison.
export function noteOwnerGap(lines, obligation, named) {
  if (!lines.every((t) => t.bbox)) return Infinity;
  const region = noteRegion(lines);
  const supports = named
    ? [...obligation.owners, ...(obligation.supports ?? [])]
    : obligation.owners;
  return Math.min(...supports.map((owner) => boxGap(region, owner)));
}

export function notePaintedOwnerGap(lines, obligation, named) {
  if (!lines.every((t) => t.bbox)) return Infinity;
  const region = noteRegion(lines);
  const owners = obligation.paintedOwners ?? obligation.owners;
  const supports = named
    ? [...owners, ...(obligation.paintedSupports ?? obligation.supports ?? [])]
    : owners;
  return Math.min(...supports.map((owner) => boxGap(region, owner)));
}

export function inOwnerReach(gap, named) {
  return gap <= (named ? 6.25 : 2.25);
}
