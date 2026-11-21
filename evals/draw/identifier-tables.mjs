import { IdentifierMeasurementError } from "./identifier-errors.mjs";
import { tableForSheet } from "./m3-documents.mjs";
// Index/reference tables are packet-owned; public query tables cover all other
// reports. Values below come from packet references and IR, never printed text.
// Keep this explicit: normalized documentation views also include diagrams.
// A renderer-backed test pins every documentationTable kind to this list.
export const documentationTableKinds = [
  "bom",
  "wires",
  "cables",
  "terminals",
  "io",
  "io-ports",
  "network",
  "assemblies",
  "index",
  "references",
];

function referenceContent(packet, content) {
  const selection = packet.referenceSelection;
  if (!selection) return content;
  if (
    selection.enabled !== true ||
    !["all", "drawings"].includes(selection.appearances) ||
    !Array.isArray(selection.deviceUids)
  )
    throw new IdentifierMeasurementError(
      "Identifier measurement: invalid reference selection",
    );
  const selected = new Set(selection.deviceUids);
  return content
    .filter(
      (s) =>
        selection.appearances !== "drawings" ||
        !documentationTableKinds.includes(s.view.kind),
    )
    .map((s) => ({
      ...s,
      references: s.references.filter((r) => selected.has(r.deviceUid)),
    }));
}

export function identifierTable(sheet, packet, g, ir, tables) {
  const kind = sheet.view.kind;
  const table = tableForSheet(sheet, g, tables);
  if (table) return table;
  if (!["index", "references"].includes(kind)) {
    if (g.reportRows.length)
      throw new IdentifierMeasurementError(
        `Identifier measurement: source table missing for ${kind}`,
      );
    return null;
  }
  const content = packet.sheets.filter(
    (s) => !["index", "references"].includes(s.view.kind),
  );
  // Index every content sheet; only the reference projection obeys its scope.
  const appearances =
    kind === "references" ? referenceContent(packet, content) : [];
  const columns =
    kind === "index"
      ? ["Sheet", "View", "Devices"]
      : ["Device", "Function / representation", "Sheet / zone"];
  const rows =
    kind === "index"
      ? content.map((s) => ({
          key: String(s.number),
          cells: [
            String(s.number),
            "",
            [...new Set(s.references.map((r) => r.designation))].join(", "),
          ],
          deviceUids: [...new Set(s.references.map((r) => r.deviceUid))],
        }))
      : g.reportRows.map((key) => {
          const [uid, functions, representation] = JSON.parse(key);
          const device = ir.devices.find((d) => d.uid === uid);
          if (!device)
            throw new IdentifierMeasurementError(
              `Identifier measurement: unknown reference device ${uid}`,
            );
          const entries = appearances.flatMap((s) =>
            s.references
              .filter(
                (r) =>
                  r.deviceUid === uid &&
                  JSON.stringify(r.functions) === JSON.stringify(functions) &&
                  r.representation === representation,
              )
              .map((r) => `${s.number} / ${r.zone}`),
          );
          if (!entries.length)
            throw new IdentifierMeasurementError(
              `Identifier measurement: reference source missing for ${key}`,
            );
          return {
            key,
            cells: [device.designation, "", [...new Set(entries)].join("; ")],
            deviceUids: [uid],
          };
        });
  return { kind, columns, rows };
}
