import type { DocumentationContext } from "./context.js";
import {
  appendDeviceBom,
  appendCableBom,
  appendAssemblyBom,
} from "./bom-rows.js";
export function documentationBomTable<T>(context: DocumentationContext<T>) {
  const { rows, table, options, typeNote } = context;
  // Measured with 1–80 five-character designations on letter/A4 landscape:
  // widen before the one-name-per-line gap; 23% also preserves the base's
  // printable upper range. Ordinary rows retain their description space.
  const longDesignations = rows.some((row) => row.cells[1]!.length > 100);
  return table(
    "Bill of materials",
    [
      "Qty",
      "Designations",
      "Location",
      options?.output === "csv" ? "Manufacturer" : "Mfr.",
      "Order number",
      "Description / type",
      "Instance description / requirements",
    ],
    longDesignations
      ? [0.05, 0.23, 0.13, 0.08, 0.09, 0.21, 0.21]
      : [0.05, 0.1, 0.13, 0.08, 0.09, 0.25, 0.3],
    [
      [
        "Qty counts instances, not purchasable totals. No length/accessory estimates.",
        ...(rows.some((r) => r.cells[4] === "")
          ? ["Blank order numbers need selection."]
          : []),
      ].join(" "),
      ...(typeNote() ? [typeNote()] : []),
      ...(rows.some((r) => !r.cells[1]?.trim())
        ? ["Blank assembly references need review against the source."]
        : []),
    ],
  );
}
export function documentationBom<T>(context: DocumentationContext<T>) {
  const {
    ir,
    selected,
    orderedDevices,
    compare,
    reportDescription,
    compareDesignation,
    cables,
    incident,
  } = context;
  const groups = new Map<string, typeof orderedDevices>();
  for (const device of selected) {
    const key = JSON.stringify([
      device.typeId,
      device.location ?? null,
      reportDescription(device.description) ?? null,
      device.nonProcurement?.reason ?? null,
    ]);
    const group = groups.get(key) ?? [];
    group.push(device);
    groups.set(key, group);
  }
  for (const group of groups.values())
    group.sort((a, b) => compareDesignation(a.designation, b.designation));
  for (const [key, group] of [...groups].sort(
    ([ak, a], [bk, b]) =>
      compare(
        JSON.stringify([a[0]!.typeId, a[0]!.location ?? null]),
        JSON.stringify([b[0]!.typeId, b[0]!.location ?? null]),
      ) ||
      compareDesignation(a[0]!.designation, b[0]!.designation) ||
      compare(ak, bk),
  )) {
    appendDeviceBom(key, group, context);
  }
  for (const cable of ir.cables.filter((c) =>
    cables.some((s) => s.cableUid === c.uid),
  ))
    appendCableBom(cable, context);
  for (const relation of ir.relations.filter(
    (r) => r.assembly?.kind === "cable",
  )) {
    if (!incident([relation.fromDeviceUid, relation.toDeviceUid])) continue;
    appendAssemblyBom(relation, context);
  }
  return documentationBomTable(context);
}
