import type { DocumentationContext } from "./context.js";
export function documentationCables<T>(context: DocumentationContext<T>) {
  const { cables, rows, typeDescription, table, typeNote } = context;
  for (const c of cables)
    rows.push({
      key: c.cableUid,
      cells: [
        c.designation,
        typeDescription(c.description, c.typeId),
        c.fromLocation ?? "",
        c.toLocation ?? "",
        String(c.cores.length),
        String(c.counts.connected),
        String(c.counts.spare),
        String(c.counts.unassigned),
        c.shield === true
          ? "Shielded; bonds not modeled"
          : c.shield === false
            ? "Unshielded"
            : "",
      ],
      deviceUids: c.cores.flatMap((k) =>
        k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
      ),
    });
  return table(
    "Cable schedule",
    [
      "Cable",
      "Description / type",
      "End A location",
      "End B location",
      "Cores",
      "Connected",
      "Spare",
      "Unassigned",
      "Shield construction",
    ],
    [0.1, 0.18, 0.15, 0.15, 0.06, 0.08, 0.07, 0.08, 0.13],
    [
      "Connected and spare counts may overlap: a spare may be terminated. Construction does not specify shield bonding.",
      ...(typeNote() ? [typeNote()] : []),
    ],
  );
}
