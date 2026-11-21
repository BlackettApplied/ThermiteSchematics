import { mergeRayAngles } from "./ray-directions.mjs";
import { physicalOracleGeometry } from "./tranche3-identities.mjs";
import { nativeConductors4, sameEnds, terminalId } from "./tranche4-source.mjs";
import { finding, pointDistance } from "./review-geometry.mjs";
import { distance } from "./checks.mjs";
function nativeAttachment(s, ir, marker) {
  let id;
  try {
    const a = JSON.parse(s.attachment);
    id = { deviceUid: a[0], terminalKey: a[1] };
  } catch {}
  const f = ir.functions?.find(
    (f) => f.id.deviceUid === s.deviceUid && f.id.functionKey === s.functionKey,
  );
  if (id && s.deviceUid && id.deviceUid !== s.deviceUid) return false;
  if (
    id &&
    s.functionKey &&
    !f?.terminals.some((t) => terminalId(t) === terminalId(id))
  )
    return false;
  return (
    marker.terminal &&
    (id
      ? terminalId(id) ===
        terminalId({
          deviceUid: marker.deviceUid,
          terminalKey: marker.terminal,
        })
      : s.lead &&
        f?.terminals.some(
          (t) =>
            t.terminalKey === marker.terminal &&
            t.deviceUid === marker.deviceUid,
        ))
  );
}
function raysAt(marker, g, catalog, ir) {
  const rays = [],
    owners = new Set(),
    p = marker.point,
    radius = Math.max(marker.bbox.w, marker.bbox.h) / 2;
  for (const s of g.shapes) {
    if (s.appearanceScope !== marker.appearanceScope) continue;
    const w = s.conductor && catalog.get(s.wire),
      native =
        w &&
        sameEnds(s.endpoints, w.ends) &&
        (!marker.terminal ||
          w.ends.some(
            (t) =>
              terminalId(t) ===
              terminalId({
                deviceUid: marker.deviceUid,
                terminalKey: marker.terminal,
              }),
          ));
    if (!native && !nativeAttachment(s, ir, marker)) continue;
    const ink = native ? g.tranche3?.routeInk?.[s.element] : s.inkSegments;
    for (const seg of ink ?? [])
      if (distance(p, ...seg) <= radius + (s.stroke ?? 0) / 2 + 0.01) {
        for (const q of seg)
          if (pointDistance(p, q) > radius + 0.01)
            rays.push((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI);
        owners.add(
          w?.key ??
            s.attachment ??
            JSON.stringify([s.deviceUid, s.functionKey]),
        );
      }
  }
  return { rays: mergeRayAngles(rays), owners: [...owners] };
}
function nativeMarker(m, g, ir) {
  const exists = (t) =>
    ir.terminals?.some(
      (n) => n.id.deviceUid === t.deviceUid && n.id.terminalKey === t.terminal,
    );
  if (m.terminal) return exists(m) ? m : null;
  const candidates = g.terminals.filter(
    (t) =>
      t.appearanceScope === m.appearanceScope &&
      pointDistance(t.point, m.point) <= 0.01 &&
      exists(t),
  );
  const distinct = new Map(
    candidates.map((t) => [JSON.stringify([t.deviceUid, t.terminal]), t]),
  );
  if (distinct.size !== 1) return null;
  const t = [...distinct.values()][0];
  return { ...m, deviceUid: t.deviceUid, terminal: t.terminal };
}
export function junctionRayAudit(input, ir) {
  if (
    !Array.isArray(input?.shapes) ||
    !Array.isArray(input?.texts) ||
    !Array.isArray(input?.terminals)
  )
    return {
      eligible: 1,
      findings: [finding("junction-marker-measurement-unavailable")],
    };
  const g = physicalOracleGeometry(input, ir),
    markers = g.tranche4?.markers;
  if (!Array.isArray(markers))
    return {
      eligible: 1,
      findings: [finding("junction-marker-measurement-unavailable")],
    };
  let catalog;
  try {
    catalog = nativeConductors4(ir);
  } catch (e) {
    return {
      eligible: 1,
      findings: [
        finding("junction-native-data-unavailable", {}, { reason: e.message }),
      ],
    };
  }
  const findings = [],
    measurements = [];
  for (const m of markers.filter((m) => m.filled && m.painted)) {
    const native = nativeMarker(m, g, ir);
    const measured = raysAt(native ?? m, g, catalog, ir);
    measurements.push({ element: m.element, ...measured });
    if (!native)
      findings.push(finding("filled-junction-native-node-unavailable", m));
    else if (measured.rays.length < 3)
      findings.push(
        finding("filled-endpoint-without-three-native-rays", native, {
          nativeTerminal: {
            deviceUid: native.deviceUid,
            terminalKey: native.terminal,
          },
          incidentRays: measured.rays.length,
          ...measured,
        }),
      );
  }
  return { findings, eligible: markers.length, measurements };
}
