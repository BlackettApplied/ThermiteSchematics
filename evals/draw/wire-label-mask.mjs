import { routePoints, segments, finding } from "./tranche3-geometry.mjs";

// Precision of the existing route-point / terminal coincidence check.
const COINCIDENCE_MM = 0.01;

function axis([a, b]) {
  if (Math.abs(a.y - b.y) <= COINCIDENCE_MM)
    return {
      horizontal: true,
      across: a.y,
      lo: Math.min(a.x, b.x),
      hi: Math.max(a.x, b.x),
    };
  if (Math.abs(a.x - b.x) <= COINCIDENCE_MM)
    return {
      horizontal: false,
      across: a.x,
      lo: Math.min(a.y, b.y),
      hi: Math.max(a.y, b.y),
    };
}

function span(box, horizontal) {
  return horizontal
    ? { lo: box.x, hi: box.x + box.w, bottom: box.y, top: box.y + box.h }
    : { lo: box.y, hi: box.y + box.h, bottom: box.x, top: box.x + box.w };
}

function straightRuns(points) {
  const runs = [];
  for (const segment of segments(points)) {
    const previous = runs.at(-1);
    const a = previous && axis(previous),
      b = axis(segment);
    const collinear =
      a &&
      b &&
      a.horizontal === b.horizontal &&
      Math.abs(a.across - b.across) <= COINCIDENCE_MM;
    const direction = ([p, q]) => (a?.horizontal ? q.x - p.x : q.y - p.y);
    if (previous && collinear && direction(previous) * direction(segment) > 0)
      previous[1] = segment[1];
    else runs.push(segment);
  }
  return runs;
}

// A bend keeps one regular conductor stroke visible. A terminal needs a
// full plate height or 2 mm, measured from the painted marker's outer edge.
const BEND_MM = 0.35;
const PRINT_EPSILON_MM = 0.00001;

function finiteBox(box) {
  return box && [box.x, box.y, box.w, box.h].every(Number.isFinite);
}

function intersects(a, b, pad = 0) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function coveredRun(segment, plate, clip, stroke) {
  const run = axis(segment);
  if (!run) return undefined;
  const p = span(plate, run.horizontal),
    c = span(clip, run.horizontal),
    half = stroke / 2;
  if (
    run.across + half <= c.bottom ||
    run.across - half >= c.top ||
    run.across + half <= p.bottom ||
    run.across - half >= p.top
  )
    return undefined;
  const lo = Math.max(run.lo, c.lo),
    hi = Math.min(run.hi, c.hi);
  const covered = Math.min(hi, p.hi) - Math.max(lo, p.lo);
  if (covered <= PRINT_EPSILON_MM) return undefined;
  return { ...run, lo, hi, covered, beforeMm: p.lo - lo, afterMm: hi - p.hi };
}

function markerSpan(marker, horizontal, across) {
  const p = span(marker.bbox, horizontal);
  const center = (p.lo + p.hi) / 2;
  const offset = (across - (p.bottom + p.top) / 2) / ((p.top - p.bottom) / 2);
  if (Math.abs(offset) >= 1) return undefined;
  const half = ((p.hi - p.lo) / 2) * Math.sqrt(1 - offset ** 2);
  return [center - half, center + half];
}

function markerInk(markers, run, end) {
  const lower = end === "before",
    terminal = lower ? run.lo : run.hi;
  let hidden = 0;
  for (const marker of markers) {
    if (marker.junction) continue;
    const ink = markerSpan(marker, run.horizontal, run.across);
    if (
      !ink ||
      terminal < ink[0] - COINCIDENCE_MM ||
      terminal > ink[1] + COINCIDENCE_MM
    )
      continue;
    if (!finiteBox(marker.clip)) return null;
    const clip = span(marker.clip, run.horizontal);
    if (run.across < clip.bottom || run.across > clip.top) continue;
    hidden = Math.max(
      hidden,
      lower
        ? Math.min(ink[1], clip.hi) - terminal
        : terminal - Math.max(ink[0], clip.lo),
    );
  }
  return hidden;
}

function clearance(run, ends, markers, plate, end) {
  const coord = (p) => (run.horizontal ? p.x : p.y);
  const boundary = end === "before" ? run.lo : run.hi;
  const terminal = ends.some(
    (p) =>
      Math.abs(coord(p) - boundary) <= COINCIDENCE_MM &&
      Math.abs((run.horizontal ? p.y : p.x) - run.across) <= COINCIDENCE_MM,
  );
  const markerMm = terminal ? markerInk(markers, run, end) : 0;
  const minimumMm = terminal ? Math.max(2, plate.heightMm) : BEND_MM;
  return {
    terminal,
    markerMm,
    minimumMm,
    visibleMm:
      markerMm === null
        ? null
        : (end === "before" ? run.beforeMm : run.afterMm) - markerMm,
  };
}

function ownedRuns(route, plate, stroke, markers) {
  const points = routePoints(route);
  if (!points?.length || !finiteBox(stroke?.clip)) return null;
  const ends = [points[0], points.at(-1)];
  const runs = straightRuns(points);
  if (runs.some((s) => !axis(s))) return null;
  return runs.flatMap((segment) => {
    const run = coveredRun(segment, plate.bbox, stroke.clip, route.stroke);
    if (!run) return [];
    return [
      {
        ...run,
        wire: route.wire,
        element: route.element,
        before: clearance(run, ends, markers, plate, "before"),
        after: clearance(run, ends, markers, plate, "after"),
      },
    ];
  });
}

function plateJunction(markers, plate) {
  for (const { bbox, clip, order, junction } of markers) {
    if (!junction || order >= plate.order || !intersects(bbox, plate.bbox))
      continue;
    if (!finiteBox(clip)) return null;
    const x = bbox.x + bbox.w / 2,
      y = bbox.y + bbox.h / 2;
    const left = Math.max(clip.x, plate.bbox.x),
      right = Math.min(clip.x + clip.w, plate.bbox.x + plate.bbox.w),
      top = Math.max(clip.y, plate.bbox.y),
      bottom = Math.min(clip.y + clip.h, plate.bbox.y + plate.bbox.h);
    if (right <= left || bottom <= top) continue;
    if (
      Math.hypot(
        Math.max(left - x, x - right, 0) / (bbox.w / 2),
        Math.max(top - y, y - bottom, 0) / (bbox.h / 2),
      ) < 1
    )
      return true;
  }
  return false;
}

function plateMask(plate, measurement, routes, wire, nativeOwner) {
  if (!finiteBox(plate.clip) || !Number.isFinite(plate.heightMm))
    return { reason: "missing-plate-measurement" };
  const hits = [];
  for (const r of routes) {
    if (!r.stroke || !intersects(r.bbox, plate.bbox, r.stroke / 2)) continue;
    const stroke = measurement.strokes[r.element];
    if (!stroke || !finiteBox(stroke.clip))
      return { reason: "missing-conductor-measurement" };
    if (!stroke.painted || stroke.order >= plate.order) continue;
    const runs = ownedRuns(r, plate, stroke, measurement.markers);
    if (!runs) return { reason: "missing-straight-run-measurement" };
    hits.push(...runs);
  }
  const junction = plateJunction(measurement.markers, plate);
  if (junction === null) return { reason: "missing-junction-measurement" };
  if (junction) return { reason: "junction", hits };
  if (!hits.length) return undefined;
  if (hits.some((r) => r.wire !== wire))
    return { reason: "foreign-conductor", hits };
  if (hits.length > 1) return { reason: "elbow-or-branch", hits };
  const margins = [hits[0].before, hits[0].after];
  if (margins.some((m) => m.visibleMm === null))
    return { reason: "missing-terminal-measurement", hits };
  if (
    !nativeOwner ||
    margins.some((m) => m.visibleMm + PRINT_EPSILON_MM < m.minimumMm)
  )
    return {
      reason: margins.some(
        (m) => m.terminal && m.visibleMm + PRINT_EPSILON_MM < m.minimumMm,
      )
        ? "approach"
        : "elbow-or-branch",
      hits,
    };
}

export function wireLabelMaskFinding(texts, g, routes, nativeOwner) {
  const measurement = g.tranche3?.wirePlatePaint;
  const report = (kind, evidence) =>
    finding(kind, texts[0], {
      wire: texts[0].wire,
      text: texts.map((t) => t.text).join(" "),
      ...evidence,
    });
  if (!measurement?.plates || !measurement.strokes || !measurement.markers)
    return report("wire-label-mask-unmeasurable", {
      reason: "missing-paint-measurement",
    });
  const ids = new Set(texts.map((t) => t.element));
  for (const plate of measurement.plates.filter((p) => ids.has(p.text))) {
    const problem = plateMask(
      plate,
      measurement,
      routes,
      texts[0].wire,
      nativeOwner,
    );
    if (problem)
      return report(
        problem.reason.startsWith("missing-")
          ? "wire-label-mask-unmeasurable"
          : "wire-label-plate-masks-conductor",
        {
          plate: plate.bbox,
          ...problem,
        },
      );
  }
}
