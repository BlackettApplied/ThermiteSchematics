// Only native source fields can exempt report prose. Query cells are subjects.
const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s/gu, "");
function parts(key) {
  try {
    const value = JSON.parse(key);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
export function authoredReportFields(ir, kind, row, column) {
  const [uid, key] = parts(row),
    d = ir.devices.find((d) => d.uid === uid),
    type = ir.deviceTypes?.find((t) => t.id === d?.typeId),
    relation = ir.relations?.find((r) => r.uid === row),
    cable = ir.cables?.find((c) => c.uid === row),
    channel = d?.io?.channels?.[key],
    assignment = d?.connectorIo?.ports?.[key];
  if (kind === "bom") {
    const t = ir.deviceTypes?.find((t) => t.id === uid),
      owner = ir.devices.find(
        (d) => d.typeId === uid && (d.location ?? null) === (key ?? null),
      ),
      ct = ir.cableTypes?.find((t) => t.id === cable?.typeId),
      spec = relation?.assembly?.cable;
    return (
      {
        2: [
          owner?.location,
          cable?.fromLocation,
          cable?.toLocation,
          ...[relation?.fromDeviceUid, relation?.toDeviceUid].map(
            (uid) => ir.devices.find((d) => d.uid === uid)?.location,
          ),
        ],
        3: [t?.catalog?.manufacturer, spec?.manufacturer],
        4: [t?.catalog?.orderNumber, spec?.orderNumber],
        5: [t?.description, ct?.description, spec?.specification],
        6: [
          owner?.description,
          owner?.nonProcurement?.reason,
          cable?.description,
          relation?.description,
        ],
      }[column] ?? []
    );
  }
  if (kind === "io")
    return (
      { 3: [d?.io?.addressSpace], 4: [channel?.address], 5: [channel?.signal] }[
        column
      ] ?? []
    );
  if (kind === "terminals")
    return (
      {
        1: [d?.location],
        3: [type?.terminals?.find((t) => t.key === key)?.description],
      }[column] ?? []
    );
  if (kind === "network" && column === 1) {
    const c = relation?.connection;
    return [c?.protocol, c?.cable?.specification, c?.cable?.route];
  }
  if (kind === "io-ports") {
    // Mixed generated columns get only their specific authored reason, never the
    // whole query output (connection review/status text is generated).
    const review = d?.connectionReview?.connectorPorts?.[key];
    const assembly = ir.relations?.find(
      (r) =>
        r.assembly &&
        ((r.fromDeviceUid === uid && r.assembly.fromPort === key) ||
          (r.toDeviceUid === uid && r.assembly.toPort === key)),
    )?.assembly;
    return (
      {
        3: [d?.connectorIo?.addressSpace, assignment?.address],
        4: [assignment?.signal],
        6: [assembly?.pinMapping?.reason],
        7: [review?.reason],
      }[column] ?? []
    );
  }
  if (kind === "assemblies") {
    const a = relation?.assembly;
    return (
      {
        1: [
          a?.cable?.specification,
          a?.cable?.manufacturer,
          a?.cable?.orderNumber,
          a?.cable?.route,
          relation?.description,
        ],
        4: [a?.pinMapping?.reason],
      }[column] ?? []
    );
  }
  if (kind === "wires") {
    const w = [...(ir.wires ?? []), ...(ir.jumpers ?? [])].find(
        (w) => w.uid === row,
      ),
      c = ir.cables?.find((c) => c.uid === uid),
      core = ir.cableTypes
        ?.find((t) => t.id === c?.typeId)
        ?.conductors?.find((t) => t.id === key);
    return (
      {
        0: [w?.designation, w?.properties?.label],
        3: [w?.properties?.color, w?.properties?.size, core?.color, core?.size],
      }[column] ?? []
    );
  }
  return [];
}
export function isAuthoredReportText(ir, kind, t) {
  if (t.row == null || !Number.isInteger(t.columnIndex)) return false;
  const fields = authoredReportFields(ir, kind, t.row, t.columnIndex);
  // Wrapping can split a source field and can combine adjacent authored fields.
  // Strip only exact source substrings, never accept generated suffixes.
  let remaining = compact(t.text);
  for (const field of fields
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    const value = compact(field);
    if (value.includes(remaining)) return true;
    remaining = remaining.split(value).join("");
  }
  return remaining.length === 0;
}
