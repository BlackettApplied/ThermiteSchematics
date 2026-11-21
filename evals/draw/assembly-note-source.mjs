import { device } from "./tranche4-source.mjs";
export const portId = (uid, key) => JSON.stringify([uid, key]);
export const portsOf = (ir, uid) =>
  ir.deviceTypes.find((t) => t.id === device(ir, uid)?.typeId)?.connectorPorts;
export function assemblySelection(view, ir) {
  const resolve = (list, source) =>
    (list ?? []).map((value) => {
      const matches = source.filter(
        (d) => d.uid === value || d.designation === value,
      );
      if (matches.length !== 1)
        throw Error("Native assembly selector is not unique");
      return matches[0].uid;
    });
  const devices = resolve(view.devices, ir.devices),
    all = ir.relations.filter((r) => r.assembly);
  const exact = resolve(view.assemblies, all);
  const links = all.filter((r) =>
    exact.length
      ? exact.includes(r.uid)
      : !devices.length ||
        devices.includes(r.fromDeviceUid) ||
        devices.includes(r.toDeviceUid),
  );
  if (
    links.some(
      (r) =>
        !r.assembly.pinMapping?.status ||
        !r.assembly.pinMapping?.reason ||
        !portsOf(ir, r.fromDeviceUid)?.[r.assembly.fromPort] ||
        !portsOf(ir, r.toDeviceUid)?.[r.assembly.toPort],
    )
  )
    throw Error("Native assembly endpoint or mapping reason unavailable");
  const included = new Set([
    ...devices,
    ...links.flatMap((r) => [r.fromDeviceUid, r.toDeviceUid]),
  ]);
  if (!devices.length && !exact.length)
    for (const d of ir.devices)
      if (Object.keys(portsOf(ir, d.uid) ?? {}).length) included.add(d.uid);
  return { links, included };
}
export function assemblyPortNeeds(
  g,
  selection,
  ir,
  catalog,
  drawn = { ports: new Map(), links: new Map() },
) {
  const result = [];
  const shown = new Set((g.devices ?? []).map((d) => d.deviceUid));
  for (const uid of selection.included) {
    if (!shown.has(uid)) continue;
    const actual = (g.tranche4?.ports ?? []).filter(
      (p) => p.kind === "assembly" && p.deviceUid === uid,
    );
    for (const key of Object.keys(portsOf(ir, uid) ?? {})) {
      if (actual.some((p) => p.key === key)) continue;
      const targets = drawn.ports.get(portId(uid, key)) ?? [];
      if (targets.length) {
        result.push({
          uid,
          owner: device(ir, uid)?.designation,
          key,
          kind: "drawn-port",
          identity: portId(uid, key),
          targets,
          omitted: false,
        });
        continue;
      }
      const links = ir.relations.filter(
        (r) =>
          r.assembly &&
          ((r.fromDeviceUid === uid && r.assembly.fromPort === key) ||
            (r.toDeviceUid === uid && r.assembly.toPort === key)),
      );
      const keys = links.length ? links.map((r) => r.uid) : [portId(uid, key)];
      for (const rowKey of keys)
        result.push({
          uid,
          owner: device(ir, uid)?.designation,
          key,
          kind: "status-row",
          identity: rowKey,
          omitted: true,
          row: catalog.find((r) => r.kind === "assemblies" && r.key === rowKey),
        });
    }
  }
  return result;
}
