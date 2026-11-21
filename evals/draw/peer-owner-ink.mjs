import { extent, painted } from "./review-geometry.mjs";
import { elementKey, routeKey } from "./tranche4-source.mjs";

export function boxGap(a, b) {
  return Math.hypot(
    Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w),
    Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h),
  );
}

function boundRoute(s, key) {
  const [kind, ...ids] = s.edgeOwnerKey ?? [];
  const edge =
    kind === "cable-conductor"
      ? JSON.stringify(ids)
      : ["wire", "jumper"].includes(kind)
        ? ids[0]
        : undefined;
  const declaration = routeKey(s);
  return (
    (declaration ?? edge) === key &&
    (!declaration || !edge || declaration === edge)
  );
}

export function conductorInk(g, element) {
  const key = elementKey(element);
  const shapes = (g.shapes ?? []).filter(
    (s) => boundRoute(s, key) && g.tranche3?.routeInk?.[s.element]?.length,
  );
  return {
    runs: shapes.flatMap((s) => g.tranche3.routeInk[s.element]),
    tips: shapes.flatMap((s) =>
      s.points?.length ? [s.points[0], s.points.at(-1)] : [],
    ),
  };
}

export function paintedToBothEnds({ runs, tips }, a, b) {
  const ink = runs.map(extent);
  return [a, b].every((marks) =>
    marks?.some(
      (m) =>
        tips.some((p) => boxGap({ ...p, w: 0, h: 0 }, m) <= 0.05) &&
        ink.some((stroke) => boxGap(stroke, m) <= 0.25),
    ),
  );
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

export function inOwnerReach(gap, named) {
  return gap <= (named ? 6.25 : 2.25);
}
