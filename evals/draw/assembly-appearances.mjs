import { portsOf, portId } from "./assembly-note-source.mjs";
import { nativePortInk } from "./native-port-ink.mjs";
import { rowZones } from "./m3-zones.mjs";
import { painted } from "./review-geometry.mjs";
export function validAssemblyPort(p, ir) {
  return !!(
    portsOf(ir, p.deviceUid)?.[p.key] &&
    p.point &&
    Number.isFinite(p.radius) &&
    p.radius > 0 &&
    p.texts?.some((t) => painted(t) && t.text.trim() === p.key)
  );
}
function add(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}
export function assemblyAppearances(packet, geometries, ir) {
  const ports = new Map(),
    links = new Map();
  for (const [i, s] of packet.sheets.entries()) {
    if (s.view.kind !== "connector-assembly") continue;
    const g = geometries[i],
      ps = g.tranche4?.ports ?? [];
    for (const p of ps.filter(
      (p) => p.kind === "assembly" && validAssemblyPort(p, ir),
    )) {
      const box = p.bbox ?? {
        x: p.point.x - p.radius,
        y: p.point.y - p.radius,
        w: 2 * p.radius,
        h: 2 * p.radius,
      };
      add(ports, portId(p.deviceUid, p.key), {
        sheet: s.number,
        zones: rowZones(g, box),
        element: p.element,
        bbox: box,
        keyBox:
          p.texts?.find((t) => painted(t) && t.text.trim() === p.key)?.bbox ??
          box,
      });
    }
    for (const a of g.tranche4?.assemblies ?? []) {
      const r = ir.relations.find((r) => r.uid === a.uid && r.assembly);
      const ends = r && [
        { deviceUid: r.fromDeviceUid, portKey: r.assembly.fromPort },
        { deviceUid: r.toDeviceUid, portKey: r.assembly.toPort },
      ];
      if (
        !r ||
        JSON.stringify(a.ends) !== JSON.stringify(ends) ||
        !nativePortInk(a, ps, "assembly")
      )
        continue;
      add(links, r.uid, {
        sheet: s.number,
        zones: rowZones(g, a.bbox),
        element: a.element,
        bbox: a.bbox,
      });
    }
  }
  return { ports, links };
}
