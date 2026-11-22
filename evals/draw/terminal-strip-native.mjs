// Native obligations only. No imports from the renderer or its strip metadata.
export const terminalKey = (t) => JSON.stringify([t.deviceUid, t.terminalKey]);
function nativeGroups(ir, deviceUids) {
  const devices = ir.devices
    .filter((d) => deviceUids.includes(d.uid))
    .sort((a, b) =>
      a.designation < b.designation
        ? -1
        : a.designation > b.designation
          ? 1
          : 0,
    );
  const groups = devices.map((d, i) => {
    const type = ir.deviceTypes.find((t) => t.id === d.typeId);
    if (!type) throw Error(`Missing native strip type ${d.typeId}`);
    return {
      uid: d.uid,
      name: d.designation,
      ordered: !!type.terminalOrder,
      terminals: (type.terminalOrder ?? type.terminals.map((t) => t.key)).map(
        (key, j) => ({
          key: terminalKey({ deviceUid: d.uid, terminalKey: key }),
          label: key,
          ref: `T${i + 1}/R${j + 1}`,
        }),
      ),
    };
  });
  return groups;
}
export function nativeStrip(ir, deviceUids) {
  const groups = nativeGroups(ir, deviceUids);
  const terminals = groups.flatMap((g) => g.terminals),
    selected = new Set(terminals.map((t) => t.key));
  const bridges = ir.jumpers
    .filter(
      (j) =>
        j.endpoints.every((e) => selected.has(terminalKey(e.terminal))) &&
        j.endpoints[0].terminal.deviceUid === j.endpoints[1].terminal.deviceUid,
    )
    .map((j) => ({
      uid: j.uid,
      name: j.designation ?? "Jumper",
      peers: j.endpoints.map(
        (e) =>
          `${ir.devices.find((d) => d.uid === e.terminal.deviceUid).designation}.${e.terminal.terminalKey}`,
      ),
      ends: j.endpoints.map((e) => terminalKey(e.terminal)),
    }));
  const incidences = [];
  const add = (ends, id, label) =>
    ends.forEach((t, i) => {
      if (!t || !selected.has(terminalKey(t))) return;
      const peer = ends[1 - i],
        d = peer && ir.devices.find((d) => d.uid === peer.deviceUid);
      if (peer && !d) throw Error("Missing native strip peer");
      incidences.push({
        id,
        at: terminalKey(t),
        label,
        peer: peer ? `${d.designation}.${peer.terminalKey}` : "Unterminated",
      });
    });
  for (const w of ir.wires)
    add(
      w.endpoints.map((e) => e.terminal),
      w.uid,
      w.designation,
    );
  for (const j of ir.jumpers)
    if (!bridges.some((b) => b.uid === j.uid))
      add(
        j.endpoints.map((e) => e.terminal),
        j.uid,
        j.designation ?? "Jumper",
      );
  nativeCableIncidences(ir, add);
  return { groups, terminals, bridges, incidences };
}
function nativeCableIncidences(ir, add) {
  for (const c of ir.cables) {
    const cores = new Map();
    for (const physical of ir.cableConductors)
      if (physical.cableUid === c.uid)
        cores.set(physical.id.conductorId, physical.endpoints);
    // Authored assignments retain null ends and override the physical projection.
    for (const assigned of c.assignments ?? [])
      cores.set(assigned.id, assigned.endpoints);
    for (const [id, ends] of cores)
      add(
        ends.map((e) => e?.terminal ?? null),
        JSON.stringify([c.uid, id]),
        `${c.designation}/${id}`,
      );
  }
}
