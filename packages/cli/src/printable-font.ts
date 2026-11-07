import { bundledFontUrl } from "./font-assets.js";
import { readFileSync } from "node:fs";
import { create } from "fontkit";
import { encodeWoff, fontTable, align } from "./printable-font-woff.js";
import { unshapedPrintableFont } from "@thermite/render";

function tables(ttf: Buffer) {
  const result = new Map<string, Buffer>();
  for (let i = 0; i < ttf.readUInt16BE(4); i++) {
    const p = 12 + 16 * i;
    result.set(
      ttf.toString("ascii", p, p + 4),
      Buffer.from(
        ttf.subarray(
          ttf.readUInt32BE(p + 8),
          ttf.readUInt32BE(p + 8) + ttf.readUInt32BE(p + 12),
        ),
      ),
    );
  }
  return result;
}
/** Remove the TrueType VM without changing endpoints, flags, coordinates or components. */
function unhintedOutline(outline: Buffer): Buffer {
  if (!outline.length) return outline;
  if (outline.readInt16BE(0) >= 0) {
    const at = 10 + outline.readInt16BE(0) * 2;
    const length = outline.readUInt16BE(at);
    return Buffer.concat([
      outline.subarray(0, at),
      Buffer.alloc(2),
      outline.subarray(at + 2 + length),
    ]);
  }
  const result = Buffer.from(outline);
  let at = 10,
    flags: number,
    instructions = false;
  do {
    flags = result.readUInt16BE(at);
    instructions ||= Boolean(flags & 0x100);
    result.writeUInt16BE(flags & ~0x100, at);
    at += 4 + (flags & 1 ? 4 : 2);
    at += flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
  } while (flags & 0x20);
  return instructions
    ? Buffer.concat([
        result.subarray(0, at),
        result.subarray(at + 2 + result.readUInt16BE(at)),
      ])
    : result;
}
function subsetCmap(font: import("fontkit").Font, text: string): Buffer {
  // Standalone cmap exposes only requested characters. Keep original glyph IDs.
  const chars = [
    ...new Set([...text.normalize("NFC")].map((c) => c.codePointAt(0)!)),
  ]
    .filter((c) => font.hasGlyphForCodePoint(c))
    .sort((a, b) => a - b);
  const cmap = Buffer.alloc(28 + chars.length * 12);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(10, 6);
  cmap.writeUInt32BE(12, 8);
  cmap.writeUInt16BE(12, 12);
  cmap.writeUInt32BE(16 + chars.length * 12, 16);
  cmap.writeUInt32BE(chars.length, 24);
  chars.forEach((c, i) => {
    const p = 28 + i * 12;
    cmap.writeUInt32BE(c, p);
    cmap.writeUInt32BE(c, p + 4);
    cmap.writeUInt32BE(font.glyphForCodePoint(c).id, p + 8);
  });
  return cmap;
}
/** Retain original glyph IDs, outlines and selected advances; no OpenType layout features. Fontkit supplies the
 * composite closure; unselected outlines become empty. Nothing uses host fonts,
 * locale sorting, clock, random identifiers or native compression. */
export function subsetPrintableFont(name: string, text: string): Buffer {
  const bytes = unshapedPrintableFont(readFileSync(bundledFontUrl(name)));
  const font = create(bytes);
  if (!("unitsPerEm" in font))
    throw Error("Expected a single bundled TrueType face");
  const subset = font.createSubset();
  const ids = new Set<number>([0]);
  for (const c of [...text.normalize("NFC")].sort())
    ids.add(font.glyphForCodePoint(c.codePointAt(0)!).id);
  for (const g of font.layout(text.normalize("NFC")).glyphs) ids.add(g.id);
  for (const id of [...ids].sort((a, b) => a - b))
    subset.includeGlyph(font.getGlyph(id));
  subset.encode(); // Also includes every component of compound glyphs.
  const used = new Set((subset as unknown as { glyphs: number[] }).glyphs);
  const ts = tables(bytes),
    head = fontTable(ts, "head"),
    originalLoca = fontTable(ts, "loca"),
    glyf = fontTable(ts, "glyf");
  const count = fontTable(ts, "maxp").readUInt16BE(4),
    long = head.readInt16BE(50) === 1;
  const offset = (i: number) =>
    long
      ? originalLoca.readUInt32BE(i * 4)
      : originalLoca.readUInt16BE(i * 2) * 2;
  const loca = Buffer.alloc((count + 1) * 4),
    chunks: Buffer[] = [];
  let length = 0;
  for (let i = 0; i < count; i++) {
    loca.writeUInt32BE(length, i * 4);
    if (used.has(i)) {
      const outline = unhintedOutline(glyf.subarray(offset(i), offset(i + 1)));
      chunks.push(
        outline,
        Buffer.alloc(align(outline.length) - outline.length),
      );
      length += align(outline.length);
    }
  }
  loca.writeUInt32BE(length, count * 4);
  head.writeInt16BE(1, 50);
  head.writeUInt32BE(0, 8);
  ts.set("loca", loca);
  ts.set("glyf", Buffer.concat(chunks));
  for (const tag of ["DSIG", "fpgm", "prep", "cvt ", "gasp", "hdmx", "LTSH"])
    ts.delete(tag);
  // Hint VM resource maxima, leaving geometry/component maxima intact.
  fontTable(ts, "maxp").writeUInt16BE(1, 14);
  fontTable(ts, "maxp").fill(0, 16, 28);
  ts.set("cmap", subsetCmap(font, text));
  // Names are retained in 'name'; post v3 omits only unused glyph-name strings.
  const post = Buffer.from(fontTable(ts, "post").subarray(0, 32));
  post.writeUInt32BE(0x30000);
  ts.set("post", post);
  const hmtx = fontTable(ts, "hmtx"),
    metrics = fontTable(ts, "hhea").readUInt16BE(34);
  for (let i = 0; i < metrics; i++)
    if (!used.has(i)) hmtx.fill(0, i * 4, i * 4 + 4);
  for (let i = metrics; i < count; i++)
    if (!used.has(i))
      hmtx.fill(
        0,
        metrics * 4 + (i - metrics) * 2,
        metrics * 4 + (i - metrics) * 2 + 2,
      );
  return encodeWoff(ts);
}

const decode = (s: string) =>
  s.replace(
    /&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/giu,
    (_, hex, dec, named) =>
      hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : dec
          ? String.fromCodePoint(Number(dec))
          : (
              { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<
                string,
                string
              >
            )[named]!,
  );
export function printableFontStyle(document: string): string {
  const text = [...document.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gu)]
    .map((m) => decode(m[1]!.replace(/<[^>]+>/gu, "")))
    .join(" ");
  const regular = subsetPrintableFont("NotoSans-Regular", text);
  const faces: [string, string, Buffer][] = [["Thermite Sans", "400", regular]];
  if (
    /font-weight=["'](?:bold|700)["']|font-weight:\s*(?:bold|700)/u.test(
      document,
    )
  )
    faces.push([
      "Thermite Sans",
      "700",
      subsetPrintableFont("NotoSans-Bold", text),
    ]);
  const font = create(readFileSync(bundledFontUrl("NotoSans-Regular")));
  const fallback =
    "unitsPerEm" in font
      ? [...text.normalize("NFC")]
          .filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!))
          .join("")
      : "";
  if (fallback)
    faces.push([
      "Thermite Math",
      "400",
      subsetPrintableFont("NotoSansMath-Regular", fallback),
    ]);
  return (
    '<style data-thermite-font="fontkit-2.0.4-pako-0.2.9">' +
    faces
      .map(
        ([family, weight, bytes]) =>
          `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff;base64,${bytes.toString("base64")}) format('woff')}`,
      )
      .join("") +
    "</style>"
  );
}
/** Delivery boundary: serializable render/agent results remain font-free. */
export class PrintableFontBudgetError extends Error {
  readonly code = "R007";
  constructor(
    readonly bytes: number,
    readonly maximum: number,
    readonly medium: "svg" | "html" = "svg",
  ) {
    super(
      `Printable font block needs ${bytes} bytes, exceeding the ${maximum}-byte export limit; ${medium === "html" ? "export .pdf instead" : "export .html or .pdf instead"}.`,
    );
  }
}
type FontBudgetFailure = {
  code: "R007";
  message: string;
  details: { bytes: number; maximum: number };
};
export function fontBudgetFailure(
  error: unknown,
  root: string,
): (FontBudgetFailure & { root: string }) | undefined;
export function fontBudgetFailure(
  error: unknown,
): FontBudgetFailure | undefined;
export function fontBudgetFailure(error: unknown, root?: string) {
  if (!(error instanceof PrintableFontBudgetError)) return undefined;
  return {
    code: error.code,
    message: error.message,
    ...(root === undefined ? {} : { root }),
    details: { bytes: error.bytes, maximum: error.maximum },
  };
}
export function embedPrintableFont(document: string): string {
  if (document.includes("data-thermite-font="))
    throw Error("Font already embedded");
  const style = printableFontStyle(document);
  const html = document.includes("</head>"),
    maximum = html ? 500 * 1024 : 60 * 1024;
  if (Buffer.byteLength(style) > maximum)
    throw new PrintableFontBudgetError(
      Buffer.byteLength(style),
      maximum,
      html ? "html" : "svg",
    );
  return document.includes("</head>")
    ? document.replace("</head>", style + "</head>")
    : document.replace(/(<svg\b[^>]*>)/u, "$1" + style);
}
