import { appendJsonPointer, type JsonValue } from "@thermite/schema";
import { supportsGlyph } from "../../text-metrics.js";
import { bindings, slots } from "./model.js";
import {
  Issues,
  checkLiteral,
  isObject,
} from "#title-schema/validation-common";
import { checkPlainText, visitStrings } from "#title-schema/text";
export {
  Issues,
  checkLiteral,
  isObject,
  validDate,
} from "#title-schema/validation-common";
export function checkText(
  value: string,
  pointer: string,
  issues: Issues,
): void {
  const before = issues.diagnostics.length;
  checkPlainText(value, pointer, issues);
  if (issues.diagnostics.length !== before) return;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!supportsGlyph("sans", cp) || !supportsGlyph("bold", cp)) {
      issues.add(
        "R005",
        pointer,
        `Title field ${pointer} contains unsupported printable glyph U+${cp.toString(16).toUpperCase()}.`,
        "unsupported-glyph",
      );
      return;
    }
  }
}
export function checkStrings(
  value: JsonValue,
  pointer: string,
  issues: Issues,
): void {
  visitStrings(value, pointer, (text, path) => checkText(text, path, issues));
}
export function checkTitleRecord(
  record: Record<string, JsonValue>,
  pointer: string,
  issues: Issues,
): void {
  checkLiteral(
    record.sheetTitle,
    "sheetTitle",
    `${pointer}/sheetTitle`,
    issues,
  );
  checkLiteral(record.revision, "revision", `${pointer}/revision`, issues);
  checkLiteral(
    record.drawingBase,
    "drawingNumber",
    `${pointer}/drawingBase`,
    issues,
  );
  if (isObject(record.values))
    for (const [key, value] of Object.entries(record.values)) {
      const p = appendJsonPointer(`${pointer}/values`, key);
      if (
        !slots.includes(key as (typeof slots)[number]) ||
        Object.hasOwn(bindings, key)
      )
        issues.add(
          "R006",
          p,
          "Packet values must name an ordinary title field; bound project/page/title/revision fields cannot be overridden here.",
          "unknown-title-field",
        );
      checkLiteral(value, key, p, issues);
    }
  if (Array.isArray(record.revisionRows))
    record.revisionRows.forEach((row, i) => {
      if (!isObject(row)) return;
      const p = `${pointer}/revisionRows/${i}`;
      checkLiteral(row.version, "version", `${p}/version`, issues);
      checkLiteral(row.date, "date", `${p}/date`, issues);
      checkLiteral(row.drawnBy, "drawnBy", `${p}/drawnBy`, issues);
    });
}
export function checkTitleData(
  value: Record<string, JsonValue>,
  viewCount: number,
  issues: Issues,
): void {
  if (isObject(value.defaults))
    checkTitleRecord(value.defaults, "/titleData/defaults", issues);
  for (const selector of ["byView", "bySheet"] as const) {
    const entries = value[selector];
    if (!Array.isArray(entries)) continue;
    const used = new Set<JsonValue>();
    entries.forEach((entry, i) => {
      if (!isObject(entry)) return;
      const p = `/titleData/${selector}/${i}`;
      checkTitleRecord(entry, p, issues);
      const selected = selector === "byView" ? entry.viewIndex : entry.sheetKey;
      if (used.has(selected ?? null))
        issues.add(
          "R006",
          p,
          "Duplicate title selector.",
          "duplicate-title-slot",
        );
      used.add(selected ?? null);
      if (
        selector === "byView" &&
        typeof selected === "number" &&
        selected > viewCount
      )
        issues.add(
          "R006",
          `${p}/viewIndex`,
          "Unused authored-view selector.",
          "unresolved-sheet-key",
        );
    });
  }
}
