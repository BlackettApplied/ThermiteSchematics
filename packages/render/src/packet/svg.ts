import { escapeXmlText as xml } from "../svg/escape.js";

export const n = (value: number): string => String(Number(value.toFixed(3)));

/** Horizontal inset inside the drawing field's left edge for left-anchored
 * report/document text so negative glyph left side bearings (e.g. Noto Sans J:
 * -0.195 mm at 2.5 mm, -0.211 mm at 2.7 mm, -0.312 mm at 4.0 mm) never paint
 * ink into the zone-letter gutter (DQ-02). */
export const FIELD_TEXT_LEFT_INSET_MM = 0.5;

export const fieldTextLeft = (x: number): number =>
  x + FIELD_TEXT_LEFT_INSET_MM;

export const fieldTextWidth = (width: number): number =>
  width - FIELD_TEXT_LEFT_INSET_MM;

export function fieldTextBounds<T extends { x: number; w: number }>(
  area: T,
): T {
  return {
    ...area,
    x: fieldTextLeft(area.x),
    w: fieldTextWidth(area.w),
  };
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
