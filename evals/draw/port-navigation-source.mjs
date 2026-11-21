import { nativePartPopulation } from "./native-part-population.mjs";
import { device } from "./tranche4-source.mjs";
import { finding, painted } from "./review-geometry.mjs";
import { hasReferenceName } from "./navigation-reference-ink.mjs";
export const portId = (p) => JSON.stringify([p.deviceUid, p.portKey ?? p.key]);
export function selectedPorts(ir, v) {
  const selected = ir.devices
    .filter((d) => v.devices?.some((n) => n === d.uid || n === d.designation))
    .map((d) => d.uid);
  const links = ir.relations.filter(
    (r) =>
      r.connection?.medium === v.medium &&
      (!v.devices ||
        selected.includes(r.fromDeviceUid) ||
        selected.includes(r.toDeviceUid)),
  );
  const ports = links.flatMap((r) => [
    { deviceUid: r.fromDeviceUid, portKey: r.connection.fromPort },
    { deviceUid: r.toDeviceUid, portKey: r.connection.toPort },
  ]);
  return [...new Map(ports.map((p) => [portId(p), p])).values()];
}
export function visibleNativePort(part, p, ir) {
  const type = ir.deviceTypes.find(
    (t) => t.id === device(ir, p.deviceUid)?.typeId,
  );
  if (!type?.ports?.[p.portKey]) return null;
  const matches = part.ports.filter(
    (t) =>
      portId(t) === portId(p) &&
      painted(t) &&
      t.point &&
      Number.isFinite(t.point.x) &&
      Number.isFinite(t.point.y) &&
      t.radius > 0 &&
      t.bbox?.w > 0 &&
      t.bbox?.h > 0 &&
      (t.texts ?? []).some(
        (n) => painted(n) && hasReferenceName(n.text, p.portKey),
      ),
  );
  return matches.length === 1 ? matches[0] : null;
}
export function portNavigationPopulation(packet, geometries, ir, request) {
  const native = nativePartPopulation(packet, geometries, ir, request),
    parts = native.parts.filter((p) => p.kind === "communication"),
    failures = native.findings
      .filter((f) => f.kind.endsWith("-unavailable"))
      .map((f) => ({
        ...f,
        kind: "port-navigation-" + f.kind,
      })),
    selected = [];
  if (!native.parts.length && failures.length)
    return { parts, failures, selected };
  for (const [view, v] of request.views.entries()) {
    if (v.format !== "communication-view-request/0.1") continue;
    for (const name of v.devices ?? [])
      if (
        ir.devices.filter((d) => d.uid === name || d.designation === name)
          .length !== 1
      )
        failures.push({
          ...finding(
            "port-navigation-request-device-unavailable",
            {},
            { view, name },
          ),
          sheet: packet.sheets[0]?.number,
        });
    const own = parts.filter((p) => p.view === view),
      expected = selectedPorts(ir, v);
    for (const p of expected) {
      const targets = own.filter((part) => visibleNativePort(part, p, ir));
      selected.push({ ...p, view, targets });
      if (!targets.length)
        failures.push({
          ...finding(
            "port-navigation-selected-ink-unavailable",
            {},
            { source: p, view },
          ),
          sheet: own[0]?.sheet ?? packet.sheets[0]?.number,
        });
    }
  }
  return { parts, failures, selected };
}
