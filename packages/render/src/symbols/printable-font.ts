import { create } from "fontkit";
import { readFileSync } from "node:fs";
import { unshapedPrintableFont } from "./font-shaping.js";
import { fileURLToPath } from "node:url";

export const PRINTABLE_FONT_FAMILY = "Thermite Sans, Thermite Math, sans-serif";
const load = (name: string) => {
  const face = create(
    unshapedPrintableFont(
      readFileSync(
        fileURLToPath(
          new URL(`../../assets/fonts/${name}.ttf`, import.meta.url),
        ),
      ),
    ),
  );
  if (!("unitsPerEm" in face))
    throw Error("Expected a single bundled TrueType face");
  return face;
};
const regular = load("NotoSans-Regular"),
  boldFace = load("NotoSans-Bold"),
  math = load("NotoSansMath-Regular");
/** Exact, pinned font tables; no host font service, clock or platform measurement.
 * Fontkit 2.0.4 uses the same feature-free tables as SVG and PDFKit. */
export function printableTextMetrics(value: string, size = 10, bold = false) {
  const text = value
    .normalize("NFC")
    .replace(/[\t\r\n ]+/gu, " ")
    .trim();
  let advance = 0,
    left = Infinity,
    right = -Infinity,
    bottom = Infinity,
    top = -Infinity;
  const primary = bold ? boldFace : regular;
  const runs: { face: typeof primary; text: string }[] = [];
  for (const c of text) {
    const face = primary.hasGlyphForCodePoint(c.codePointAt(0)!)
      ? primary
      : math.hasGlyphForCodePoint(c.codePointAt(0)!)
        ? math
        : primary;
    if (runs.at(-1)?.face === face) runs.at(-1)!.text += c;
    else runs.push({ face, text: c });
  }
  for (const run of runs) {
    const scale = size / run.face.unitsPerEm,
      layout = run.face.layout(run.text);
    for (const [i, g] of layout.glyphs.entries()) {
      const p = layout.positions[i]!,
        box = g.bbox;
      if (Number.isFinite(box.minX) && box.maxX > box.minX) {
        left = Math.min(left, advance + (p.xOffset + box.minX) * scale);
        right = Math.max(right, advance + (p.xOffset + box.maxX) * scale);
        bottom = Math.min(bottom, (p.yOffset + box.minY) * scale);
        top = Math.max(top, (p.yOffset + box.maxY) * scale);
      }
      advance += p.xAdvance * scale;
    }
  }
  return {
    advance,
    left: Number.isFinite(left) ? left : 0,
    right: Number.isFinite(right) ? right : 0,
    bottom: Number.isFinite(bottom) ? bottom : 0,
    top: Number.isFinite(top) ? top : 0,
    middleBaseline: (size * regular.xHeight) / regular.unitsPerEm / 2,
  };
}
/** Keep reservations where possible. Single glyphs print uncompressed. */
export function printableSlotWidth(text: string, oldWidth: number, size = 10) {
  const m = printableTextMetrics(text, size),
    minimum = [...text].length === 1 ? m.advance : m.advance * 0.91;
  return Math.max(
    oldWidth,
    Math.ceil((6 + Math.max(minimum, m.right * 0.91)) * 1000) / 1000,
  );
}
/** Native advance when it fits; compression only, never below 91%. */
export function boundedPrintableAdvance(
  value: string,
  size: number,
  capacity: number,
) {
  const m = printableTextMetrics(value, size);
  const advance = Math.min(m.advance, capacity);
  if (advance + 0.002 < m.advance * 0.91)
    throw Error("Printable text slot is too narrow");
  return advance === m.advance
    ? advance
    : Math.floor(advance * 1000 + 1e-9) / 1000;
}

/** Omit textLength entirely at natural width: rounding cannot stretch glyphs. */
export function printableFitAttributes(
  text: string,
  size: number,
  capacity: number,
) {
  const natural = printableTextMetrics(text, size).advance;
  return Number(natural.toFixed(3)) <= Number(capacity.toFixed(3))
    ? {}
    : {
        textLength: boundedPrintableAdvance(text, size, capacity),
        lengthAdjust: "spacingAndGlyphs" as const,
      };
}
