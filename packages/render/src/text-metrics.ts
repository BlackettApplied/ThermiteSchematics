import { inflateRawSync } from "node:zlib";
import { glyphCount, packedGlyphMetrics } from "./text-metrics-data.js";

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
function textClusters(value: string): string[] {
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
  if (!(maxWidth > 0) || !Number.isFinite(maxWidth))
    throw Error("Text width must be finite and positive.");
  const fits = (s: string) =>
    measureText(s.trimEnd(), size, family).width <= maxWidth;
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
