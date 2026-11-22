import { cachedFontMetrics } from "./symbols/font-metric-cache.js";
import { create } from "fontkit";
import { readFileSync } from "node:fs";
import { unshapedPrintableFont } from "./symbols/font-shaping.js";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { glyphCount, packedGlyphMetrics } from "./text-metrics-data.js";

// Use printableTextMetrics/Width and wrapPrintableText for geometry tied to
// the emitted bundled face and weight. Advance positions the glyphs; bearings
// define their painted extent. Reserve adjoining strokes and clearance separately.
// Use measureText/wrapText for a multi-face fallback budget or a layout that
// intentionally preserves the wider reservation across fonts or output media.
export type TextFace = "sans" | "bold" | "math" | "mono";
export type TextFamily = "sans-serif" | "monospace";
const glyphCategories: readonly (readonly [RegExp, string])[] = [
  [/\p{M}/u, "combining mark"],
  [/\p{Cf}/u, "format character"],
  [/\p{L}/u, "letter"],
  [/\p{N}/u, "number"],
  [/\p{S}/u, "symbol"],
  [/\p{P}/u, "punctuation"],
  [/\p{Z}/u, "separator"],
  [/\p{C}/u, "other character"],
];

/** Readable glyph diagnostics using only the runtime's Unicode properties. */
export function describeCodePoint(char: string): string {
  const code = char.codePointAt(0)!;
  const category = glyphCategories.find(([pattern]) => pattern.test(char))![1];
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")} (${category})`;
}

const faceMask: Record<TextFace, number> = {
  sans: 1,
  bold: 2,
  math: 4,
  mono: 8,
};
// Decode committed integers once; this is data decompression, never font parsing.
const data = inflateRawSync(Buffer.from(packedGlyphMetrics, "base64"));
let offset = 0;
function integer(): number {
  let value = 0,
    factor = 1,
    byte: number;
  do {
    byte = data[offset++]!;
    value += (byte & 127) * factor;
    factor *= 128;
  } while (byte & 128);
  return value;
}
const glyphs = new Map<number, readonly number[]>();
let code = 0;
for (let i = 0; i < glyphCount; i++) {
  code += integer();
  glyphs.set(code, [integer(), integer(), integer(), integer()]);
}
if (offset !== data.length) throw Error("Invalid committed text metrics.");
// The bundled faces cover Latin/Greek/Cyrillic and mathematical text. Keep
// their combining marks and joiner sequences together without host locale/ICU
// segmentation (render output must be portable across supported platforms).
export function textClusters(value: string): string[] {
  const clusters: string[] = [];
  for (const char of value) {
    if (
      clusters.length &&
      (/\p{Mark}/u.test(char) ||
        char === "\u200d" ||
        clusters.at(-1)!.endsWith("\u200d"))
    )
      clusters[clusters.length - 1] += char;
    else clusters.push(char);
  }
  return clusters;
}

/** Coverage of the actual embedded face, without opening a font at render time. */
export function supportsGlyph(face: TextFace, code: number): boolean {
  return ((glyphs.get(code)?.[3] ?? 0) & faceMask[face]) !== 0;
}

/**
 * Per-glyph advances/ink bounds for the four bundled Noto faces, Liberation Sans
 * Regular/Bold (PDF.js 6.5.438), and DejaVu Sans/Mono Regular/Bold (2.37.3).
 * Other browser faces, including proprietary Arial/Helvetica, are not claimed as
 * per-glyph bounds. Unknown clusters reserve 1.5 em width, 1.2 em ascent and
 * 0.4 em descent: a fullwidth 1 em glyph plus 50% horizontal bearing reserve,
 * with fixed vertical allowance for fallback marks rather than stacking it.
 */
export function measureText(
  value: string,
  size: number,
  family: TextFamily = "sans-serif",
) {
  if (!(size > 0) || !Number.isFinite(size))
    throw Error("Text size must be finite and positive.");
  // Both generic families need a browser envelope, independent of PDF's face.
  if (family !== "sans-serif" && family !== "monospace")
    throw Error("Unsupported text family.");
  let advance = 0,
    ascent = 0,
    descent = 0;
  const unknownGlyphs = new Set<string>();
  for (const cluster of textClusters(value.normalize("NFC").trimEnd())) {
    let clusterAdvance = 0,
      clusterAscent = 0,
      clusterDescent = 0,
      hasBase = false,
      unknown = false;
    for (const char of cluster) {
      // SHY, joiners, bidi controls, variation selectors and other default
      // ignorables have no ink/advance. Preserve them in SVG text and wrapping.
      if (/\p{Default_Ignorable_Code_Point}/u.test(char)) continue;
      const row = glyphs.get(char.codePointAt(0)!);
      if (!row) {
        unknownGlyphs.add(char);
        unknown = true;
      } else {
        // Known spacing fallback forms contribute their measured bound. Unknown
        // attached marks contribute no advance; their cluster gets one reserve.
        clusterAdvance += row[0]!;
        if (hasBase && /\p{Mark}/u.test(char)) {
          clusterAscent = Math.max(clusterAscent, row[1]! + 2500);
          clusterDescent = Math.max(clusterDescent, row[2]! + 2500);
        } else {
          clusterAscent = Math.max(clusterAscent, row[1]!);
          clusterDescent = Math.max(clusterDescent, row[2]!);
        }
      }
      hasBase = true;
    }
    if (unknown) {
      clusterAdvance = Math.max(clusterAdvance, 15000);
      clusterAscent = Math.max(clusterAscent, 12000);
      clusterDescent = Math.max(clusterDescent, 4000);
    }
    advance += clusterAdvance;
    ascent = Math.max(ascent, clusterAscent);
    descent = Math.max(descent, clusterDescent);
  }
  const scale = size / 10000;
  return {
    width: advance * scale,
    ascent: ascent * scale,
    descent: descent * scale,
    unknownGlyphs: [...unknownGlyphs],
  };
}

/** Word boundaries first; only an overlong token can break at a grapheme boundary. */
export function wrapText(
  value: string,
  maxWidth: number,
  size: number,
  family: TextFamily = "sans-serif",
): string[] {
  return wrapMeasuredText(
    value,
    maxWidth,
    size,
    (text) => measureText(text, size, family).width,
  );
}

export function wrapPrintableText(
  value: string,
  maxWidth: number,
  size: number,
  bold = false,
): string[] {
  return wrapMeasuredText(value, maxWidth, size, (text) =>
    printableTextWidth(text, size, bold),
  );
}

function wrapMeasuredText(
  value: string,
  maxWidth: number,
  size: number,
  widthOf: (text: string) => number,
): string[] {
  if (!(maxWidth > 0) || !Number.isFinite(maxWidth))
    throw Error("Text width must be finite and positive.");
  const fits = (s: string) => widthOf(s.trimEnd()) <= maxWidth;
  const result: string[] = [];
  for (const paragraph of value
    .normalize("NFC")
    .split(/\r\n|[\n\r\u2028\u2029]/u)) {
    let line = "";
    const flush = () => {
      result.push(line);
      line = "";
    };
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (/^\s+$/u.test(token)) {
        if (line) line += token;
        else if (result.length) result[result.length - 1] += token;
        else line += token;
        continue;
      }
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (/\S/u.test(token) && fits(token)) {
        if (line) flush();
        line = token;
        continue;
      }
      if (line && /\S/u.test(token)) flush();
      for (const segment of textClusters(token)) {
        if (!fits(segment))
          throw Error(
            `Text grapheme ${[...segment].map(describeCodePoint).join(", ")} cannot fit within ${maxWidth.toFixed(3)} units at size ${size}.`,
          );
        if (!fits(line + segment)) flush();
        line += segment;
      }
    }
    result.push(line);
  }
  return result;
}

export const PRINTABLE_FONT_FAMILY = "Thermite Sans, Thermite Math, sans-serif";
const load = (name: string) => {
  const face = create(
    unshapedPrintableFont(
      readFileSync(
        fileURLToPath(new URL(`../assets/fonts/${name}.ttf`, import.meta.url)),
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
function printableRuns(text: string, primary: typeof regular) {
  const runs: { face: typeof primary; text: string }[] = [];
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    const face =
      !primary.hasGlyphForCodePoint(code) && math.hasGlyphForCodePoint(code)
        ? math
        : primary;
    const previous = runs.at(-1);
    if (previous?.face === face) previous.text += c;
    else runs.push({ face, text: c });
  }
  return runs;
}
/** Exact, pinned font tables; no host font service, clock or platform measurement.
 * Fontkit 2.0.4 uses the same feature-free tables as SVG and PDFKit. */
function measurePrintableText(
  value: string,
  size = 10,
  bold = false,
  literal = false,
) {
  const text = literal
    ? value
    : value
        .normalize("NFC")
        .replace(/[\t\r\n ]+/gu, " ")
        .trim();
  let advance = 0,
    left = Infinity,
    right = -Infinity,
    bottom = Infinity,
    top = -Infinity;
  const primary = bold ? boldFace : regular;
  const runs = printableRuns(text, primary);
  for (const run of runs) {
    const scale = size / run.face.unitsPerEm,
      layout = run.face.layout(run.text);
    for (const [i, g] of layout.glyphs.entries()) {
      const p = layout.positions[i];
      if (!p) throw Error("Missing printable glyph position.");
      const box = g.bbox;
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
/** Cache exact argument tuples only within an explicit rooted-view scope. */
export function printableTextMetrics(
  value: string,
  size = 10,
  bold = false,
  literal = false,
) {
  return cachedFontMetrics([value, size, bold, literal], () =>
    measurePrintableText(value, size, bold, literal),
  );
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

/** Natural horizontal extent, including glyph bearings outside the advance. */
export function printableTextWidth(value: string, size: number, bold = false) {
  const m = printableTextMetrics(value, size, bold);
  return Math.max(m.advance, m.right) - Math.min(0, m.left);
}

/** The original continuous schematic reserves a 6.2-unit slot per code point.
 * Preserve that layout contract and expand the slot for wider pinned ink. */
export function continuousLabelSlot(value: string) {
  const reserved = Math.max(12, 6 + 6.2 * [...value].length);
  return printableSlotWidth(value, Number(reserved.toFixed(3)));
}
