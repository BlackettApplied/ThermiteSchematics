import { escapeXmlText as xml } from "../svg/escape.js";
import {
  measureText,
  printableTextLeftOverhang,
  printableTextRightExtent,
  wrapMeasuredText,
  type TextFamily,
} from "../text-metrics.js";

export const n = (value: number): string => String(Number(value.toFixed(3)));

/** Safety margin added ONLY when left-anchored text at the drawing field's
 * left edge has a negative left side bearing (overhang > 0): 0.17 mm covers
 * the calibrated two-pixel 300 dpi Chromium/PDF.js ink accuracy bound
 * (INK_ACCURACY_MM), plus 0.01 mm for DQ-02's coordinate/serialization
 * epsilon. Text with zero overhang receives zero shift so its start x and
 * available width remain unchanged. */
export const FIELD_TEXT_LEFT_SAFETY_MM = 0.18;

export function fieldTextLeftShift(
  value: string,
  size: number,
  bold = false,
  literal = false,
): number {
  const overhang = printableTextLeftOverhang(value, size, bold, literal);
  return overhang > 0
    ? Math.ceil((overhang + FIELD_TEXT_LEFT_SAFETY_MM) * 1000) / 1000
    : 0;
}

export function fieldTextLeft(
  x: number,
  value: string,
  size: number,
  bold = false,
  literal = false,
): number {
  return x + fieldTextLeftShift(value, size, bold, literal);
}

/** Total horizontal extent from field.x for left-anchored printable text,
 * including any ink-aware left shift (zero when the text has no overhang). */
export function fieldTextRightExtent(
  value: string,
  size: number,
  bold = false,
  literal = false,
): number {
  return (
    fieldTextLeftShift(value, size, bold, literal) +
    printableTextRightExtent(value, size, bold, literal)
  );
}

/** Envelope width from field.x for multi-face wrapped text, adding only the
 * ink-aware left shift for lines whose first glyph overhangs field.x. */
export function fieldTextMeasureWidth(
  value: string,
  size: number,
  bold = false,
  family: TextFamily = "sans-serif",
): number {
  return (
    fieldTextLeftShift(value, size, bold) +
    measureText(value, size, family).width
  );
}

export function wrapFieldText(
  value: string,
  maxWidth: number,
  size: number,
  bold = false,
  family: TextFamily = "sans-serif",
): string[] {
  return wrapMeasuredText(value, maxWidth, size, (line) =>
    fieldTextMeasureWidth(line, size, bold, family),
  );
}

export function text(
  x: number,
  y: number,
  value: string,
  size = 2.8,
  anchor = "start",
  weight = 400,
  literal = false,
): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="${n(size)}" text-anchor="${anchor}" font-weight="${weight}" fill="#18212b"${literal ? ' xml:space="preserve" style="white-space:pre"' : ""}>${xml(value)}</text>`;
}

/** Provenance for request.notes only; generated notes must use text(). */
export function requestNoteText(...args: Parameters<typeof text>): string {
  return text(...args).replace(
    "<text ",
    '<text data-authored-text="request-note" ',
  );
}
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra = "",
): string {
  return `<path d="M ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)}" fill="none" stroke="#344054" stroke-width="0.3" ${extra}/>`;
}
export function namespaceSheetContent(content: string, number: number): string {
  return namespaceContentIds(content, `sheet-${number}-`);
}
export function namespaceContentIds(content: string, prefix: string): string {
  // Text is XML-escaped by the emitter. Scope rewriting to real tag attributes
  // so a designation containing id="..." or url(#...) remains verbatim.
  return content.replace(/<[^>]+>/g, (tag) =>
    tag
      .replace(/(?<=\s)id="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
      .replace(
        /(?<=\s)clip-path="url\(#([^)]+)\)"/g,
        (_, id: string) => `clip-path="url(#${prefix}${id})"`,
      ),
  );
}
