import {
  isExplicitEmptyState,
  isNullPlaceholder,
} from "./native-empty-state.mjs";
export const reportIssue = (kind, item, measurement = {}) => ({
  element: item.element ?? "sheet",
  ...(item.locatorElement ? { locatorElement: item.locatorElement } : {}),
  ...(item.medium ? { medium: item.medium } : {}),
  ...(item.boxKind ? { boxKind: item.boxKind } : {}),
  designation: item.designation ?? item.text ?? item.deviceUid ?? "sheet",
  ...(item.bbox ? { bbox: item.bbox } : { sheetLevel: true }),
  ...(item.emBbox ? { emBbox: item.emBbox } : {}),
  ...measurement,
  kind,
});
export function reports(g, sheet, packet, table, furniture = true) {
  const out = [];
  if (
    !g.reportRows.length &&
    !["index", "references"].includes(sheet.view?.kind)
  )
    return out;
  const cells = new Map();
  for (const t of g.texts.filter((t) => t.row)) {
    const key = JSON.stringify([t.row, t.cell ?? t.element]);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  for (const fragments of cells.values()) {
    const text = fragments
      .map((t) => t.text)
      .join(" ")
      .trim();
    // Explicit native empty states are meaningful ink, not null placeholders.
    if (isExplicitEmptyState(text)) continue;
    const sourceCell = table?.rows.find((r) => r.key === fragments[0].row)
      ?.cells[fragments[0].columnIndex];
    // Query newlines are semantic field boundaries; SVG line wraps are not.
    // Retain null-location subfields beside real endpoints, while a sentence
    // such as "No assembly; mapping unspecified" is not a null field.
    const sourceLines = sourceCell?.split("\n").map((s) => s.trim());
    const compact = (s) => s.normalize("NFC").replace(/\s/gu, "").toLowerCase();
    // Align semantic source lines against the painted cell after joining visual
    // wraps. Literal native suffixes (including authored pin-map reasons) are
    // boundaries, never evidence that a different source line is still null.
    // The native assembly projection is status, pin-map status, then authored
    // reason lines. A reason is source text even when its entire value is None.
    const fields =
      sourceLines &&
      new RegExp(
        "^" +
          sourceLines
            .map((line, index) =>
              isNullPlaceholder(line) &&
              !(
                table.kind === "assemblies" &&
                fragments[0].columnIndex === 4 &&
                index >= 2
              )
                ? "(.*?)"
                : compact(line).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("") +
          "$",
        "u",
      ).exec(compact(text));
    const placeholders = sourceLines
      ? (fields?.slice(1).filter(isNullPlaceholder) ?? [])
      : isNullPlaceholder(text)
        ? [text]
        : [];
    for (const placeholder of placeholders)
      out.push(
        reportIssue(
          "report-null-placeholder",
          fragments.find((t) => isNullPlaceholder(t.text)) ?? fragments[0],
          { text, placeholder, columnIndex: fragments[0].columnIndex },
        ),
      );
  }
  return [...out, ...(furniture ? reportFurniture(g, sheet) : [])];
}
export function reportFurniture(g, sheet) {
  if (
    g.reportRows.length &&
    sheet.view?.kind === "wires" &&
    !g.texts.some((t) => /from.*sheet|to.*sheet|sheet.zone/i.test(t.text))
  )
    return [
      reportIssue(
        "wire-schedule-without-sheet-zones",
        {},
        { viewKind: sheet.view.kind },
      ),
    ];
  return [];
}
