import { routePoints } from "./checks.mjs";
import { groupBy } from "./review-geometry.mjs";
const round = (x) => Math.round(x * 1000) / 1000;
function source(s, ir) {
  const key = s.edgeOwnerKey;
  const named = key?.[1] ?? s.loopConductor ?? s.wire;
  for (const [kind, list] of [
    ["wire", ir.wires],
    ["jumper", ir.jumpers],
  ]) {
    const found = (list ?? []).filter(
      (w) =>
        (!key || key[0] === kind) &&
        [w.uid, w.designation, w.properties?.label].includes(named),
    );
    if (found.length === 1)
      return {
        key: [kind, found[0].uid],
        designation: found[0].designation ?? found[0].uid,
      };
  }
  const cores = (ir.cableConductors ?? []).filter((c) => {
    const cable = ir.cables?.find((b) => b.uid === c.id.cableUid);
    return ["core", "cable_conductor", "cable-conductor"].includes(key?.[0])
      ? key[1] === c.id.cableUid && key[2] === c.id.conductorId
      : [
          JSON.stringify(c.id),
          `${c.id.cableUid}/${c.id.conductorId}`,
          `${cable?.designation}.${c.id.conductorId}`,
        ].includes(named);
  });
  return cores.length === 1
    ? {
        key: ["core", cores[0].id.cableUid, cores[0].id.conductorId],
        designation: `${ir.cables?.find((c) => c.uid === cores[0].id.cableUid)?.designation}.${cores[0].id.conductorId}`,
      }
    : null;
}
// Liang–Barsky parameter clipping of exact transformed native path segments.
export function clipParameters(a, b, boxes) {
  let lo = 0,
    hi = 1;
  for (const r of boxes.filter(Boolean)) {
    if (r.w <= 0 || r.h <= 0) return null;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, r.x, r.x + r.w],
      [a.y, b.y - a.y, r.y, r.y + r.h],
    ]) {
      if (Math.abs(delta) < 1e-12) {
        if (start < min || start > max) return null;
      } else {
        const t0 = (min - start) / delta,
          t1 = (max - start) / delta;
        lo = Math.max(lo, Math.min(t0, t1));
        hi = Math.min(hi, Math.max(t0, t1));
      }
    }
  }
  return hi > lo + 1e-10 ? [lo, hi] : null;
}
const union = (intervals) => {
  const result = [];
  for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
    if (result.length && lo <= result.at(-1)[1] + 1e-9)
      result.at(-1)[1] = Math.max(result.at(-1)[1], hi);
    else result.push([lo, hi]);
  }
  return result;
};
/** Report only: exact native straight centerlines and visible rectangular clips.
 * Never changes an observation status or applies the renderer's routing guard.
 * Repeated/tiled copies of the same path are unioned by parameter, per view. */
export function conductorLengths(packet, geometries, ir, reference = []) {
  const paths = [],
    gaps = [];
  for (const [i, g] of geometries.entries())
    for (const s of g?.shapes ?? []) {
      if (!s.conductor && !s.loopConductor && !s.loopCandidate) continue;
      const owner = source(s, ir),
        points = routePoints(s),
        sheet = packet.sheets[i];
      if (!owner || !points?.length || s.clipError || s.clips === null) {
        gaps.push({
          sheet: sheet.number,
          element: s.element,
          reason: !owner
            ? "native conductor unresolved"
            : "unsupported route or clip",
        });
        continue;
      }
      const view = s.navigationView ?? JSON.stringify(sheet.view);
      paths.push({ ...owner, view, points, s, sheet: sheet.number });
    }
  const rows = [...groupBy(paths, (p) => JSON.stringify([p.view, p.key]))]
    .map(([key, members]) => {
      let lengthMm = 0,
        bends = 0;
      for (const copies of groupBy(members, (p) =>
        JSON.stringify([
          p.s.routePath ?? p.points,
          p.s.routeMatrix?.slice(0, 4),
        ]),
      ).values()) {
        const points = copies[0].points,
          intervals = [];
        for (let j = 1; j < points.length; j++) {
          const merged = union(
            copies.flatMap((p) => {
              const t = clipParameters(p.points[j - 1], p.points[j], [
                p.s.viewport,
                ...(p.s.clips ?? []),
              ]);
              return t ? [t] : [];
            }),
          );
          intervals.push(merged);
          lengthMm +=
            Math.hypot(
              points[j].x - points[j - 1].x,
              points[j].y - points[j - 1].y,
            ) * merged.reduce((n, [lo, hi]) => n + hi - lo, 0);
        }
        for (let j = 1; j < points.length - 1; j++) {
          const a = points[j - 1],
            b = points[j],
            c = points[j + 1];
          if (
            intervals[j - 1].some(([, hi]) => hi >= 1 - 1e-9) &&
            intervals[j].some(([lo]) => lo <= 1e-9) &&
            Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) >
              1e-8
          )
            bends++;
        }
      }
      const prior = reference.find((r) => r.key === key);
      return {
        key,
        view: members[0].view,
        source: members[0].key,
        designation: members[0].designation,
        sheets: [...new Set(members.map((m) => m.sheet))].sort((a, b) => a - b),
        lengthMm: round(lengthMm),
        bends,
        referenceLengthMm: prior?.lengthMm ?? null,
        referenceBends: prior?.bends ?? null,
        deltaLengthMm: prior ? round(lengthMm - prior.lengthMm) : null,
        deltaBends: prior ? bends - prior.bends : null,
        comparison: prior ? "paired" : "no-reference",
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    format: "thermite-conductor-lengths/1",
    reportOnly: true,
    units: "mm",
    scope:
      "Native straight route centerlines, clipped to visible viewports and rectangular clip paths; plate occlusion excluded. Length and bends union tiled copies per authored view. No fail threshold.",
    conductors: rows,
    removed: reference
      .filter((r) => !rows.some((x) => x.key === r.key))
      .map((r) => ({ ...r, comparison: "removed" })),
    measurementGaps: gaps,
  };
}
