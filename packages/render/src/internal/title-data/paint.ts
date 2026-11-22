import type { Draft, PaperPage } from "../../packet/types.js";
import type { Slot } from "./model.js";
import { printableTextMetrics } from "../../text-metrics.js";
import { n, text } from "../../packet/svg.js";

import { titleLabels as defaults } from "./resolve.js";
import { headingValue } from "./headings.js";
export function titleField(draft: Draft, slot: Slot, fallback = "") {
  const field = draft.resolvedTitle?.fields.find((f) => f.slot === slot);
  return {
    label: field?.label ?? defaults[slot],
    value: field?.text ?? fallback,
  };
}
export function titlePaint(
  number: number,
  field: string,
  x: number,
  y: number,
  value: string,
  width: number,
  size = 2.5,
  bold = false,
) {
  const ink = printableTextMetrics(value, size, bold);
  const required = ink.right - Math.min(0, ink.left);
  if (required > width + 0.001)
    throw Error(
      `Sheet ${number} field ${field} requires ${required.toFixed(3)} mm; ${width.toFixed(3)} mm are available. Use larger paper/profile or a shorter supplied value.`,
    );
  return text(x, y, value, size, "start", bold ? 700 : 400);
}
function cell(x: number, y: number, w: number, h: number) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="#344054" stroke-width="0.25"/>`;
}
export function authorTitleCells(
  draft: Draft,
  page: PaperPage,
  number: number,
) {
  const out: string[] = [],
    m = page.marginMm,
    bottom = page.heightMm - m;
  const width = (page.widthMm - 2 * m - 66) / 4;
  for (const [index, slot] of (
    ["drawnBy", "date", "checkedBy", "approvedBy"] as const
  ).entries()) {
    const field = titleField(draft, slot),
      x = m + index * width;
    const label = `${field.label}:`;
    out.push(
      cell(x, bottom - 13, width, 7),
      titlePaint(
        number,
        `${slot}.label`,
        x + 2,
        bottom - 10,
        label,
        width - 4,
        2.5,
        true,
      ),
    );
    const offset = 3 + printableTextMetrics(label, 2.5, true).right;
    if (field.value)
      out.push(
        titlePaint(
          number,
          slot,
          x + offset,
          bottom - 10,
          field.value,
          width - offset - 2,
        ),
      );
  }
  return out;
}
export function rightTitleCells(
  draft: Draft,
  page: PaperPage,
  number: number,
  total: number,
  top: number,
  height: number,
) {
  const out: string[] = [],
    right = page.widthMm - page.marginMm - 66;
  for (const [i, slot] of (
    ["drawingNumber", "customer", "revision", "sheetNumber"] as const
  ).entries()) {
    const fallback =
      slot === "revision"
        ? draft.title.revision
        : slot === "sheetNumber"
          ? `${number} of ${total}`
          : "";
    const field = titleField(draft, slot, fallback),
      y = top + (i * height) / 4;
    out.push(
      cell(right, y, 66, height / 4),
      titlePaint(
        number,
        `${slot}.label`,
        right + 2,
        y + 4.5,
        `${field.label}:`,
        21,
        2.5,
        true,
      ),
    );
    if (field.value)
      out.push(
        titlePaint(
          number,
          slot,
          right + 25,
          y + 4.5,
          field.value,
          39,
          2.7,
        ).replace(
          "<text ",
          slot === "sheetNumber"
            ? '<text data-frame-sheet-number="true" '
            : "<text ",
        ),
      );
  }
  return out;
}
export function revisionHistoryText(draft: Draft): string {
  const rows = draft.resolvedTitle?.revisionRows.value ?? [];
  const value = rows.length
    ? rows
        .map((r) =>
          [r.version, r.date ?? "", r.comment ?? "", r.drawnBy ?? ""].join(
            " / ",
          ),
        )
        .join("; ")
    : "UNSPECIFIED";
  return `Revision history: ${value}`;
}
export function headingTitle(
  draft: Draft,
  slot: "project" | "sheetTitle",
  fallback: string,
) {
  const field = titleField(draft, slot, fallback);
  return headingValue(field, defaults[slot]);
}
