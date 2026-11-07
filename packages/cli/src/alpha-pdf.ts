import { bundledFontUrl } from "./font-assets.js";
import { readFileSync } from "node:fs";
import { unshapedPrintableFont } from "@thermite/render";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import {
  describeCodePoint,
  supportsGlyph,
  type RenderedPacket,
} from "@thermite/render";

const decodeText = (value: string) =>
  value.replace(
    /&(?:#(x[0-9a-f]+|[0-9]+)|(amp|lt|gt|quot|apos));/giu,
    (_, code: string | undefined, name: string | undefined) =>
      code
        ? String.fromCodePoint(
            code[0]!.toLowerCase() === "x"
              ? parseInt(code.slice(1), 16)
              : Number(code),
          )
        : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
            name!.toLowerCase() as "amp"
          ]!,
  );
const encodeText = (value: string) =>
  value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

/**
 * Keep the emitter's rectangular label clips, using native PDF clipping.
 * svg-to-pdfkit implements clipPath with a luminosity soft mask. Apple
 * PDFKit/Quartz (Preview, Quick Look) truncates these masks at the untransformed
 * page bounds, losing labels whose local coordinates lie outside those bounds
 * in a scaled/folded view.
 * An identity viewport produces a real PDF clip in the current coordinate
 * system instead. This handles only the internal emitter's rectangular clips;
 * the original SVG and its font-overhang protection remain unchanged.
 */
function withPdfLabelClips(svg: string, sheet: number): string {
  const attributePattern = /\s+([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/gu;
  const unsupported = (feature: string) =>
    new Error(
      `Unsupported PDF ${feature} on sheet ${sheet}. Use SVG/HTML or a supported rectangular label clip.`,
    );
  const attributes = (source: string, allowed: readonly string[]) => {
    const values = new Map<string, string>();
    let valid = true;
    const remainder = source.replace(
      attributePattern,
      (_, name: string, _quote: string, value: string) => {
        if (!allowed.includes(name) || values.has(name)) valid = false;
        values.set(name, value);
        return "";
      },
    );
    return valid && !remainder.trim() ? values : undefined;
  };
  const clips = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const match of svg.matchAll(
    /<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/gu,
  )) {
    const clip = attributes(match[1]!, ["id", "clipPathUnits"]),
      rect = /^\s*<rect\b([^>]*?)(?:\/>|>\s*<\/rect>)\s*$/u.exec(match[2]!);
    if (
      !clip?.get("id") ||
      clip.get("clipPathUnits") !== "userSpaceOnUse" ||
      !rect
    )
      continue;
    const geometry = attributes(rect[1]!, ["x", "y", "width", "height"]),
      [x, y, width, height] = ["x", "y", "width", "height"].map((name) => {
        const value = geometry?.get(name)?.trim() ?? "";
        return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)
          ? Number(value)
          : NaN;
      });
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width! < 0 ||
      height! < 0
    )
      continue;
    clips.set(clip.get("id")!, {
      x: x!,
      y: y!,
      width: width!,
      height: height!,
    });
  }
  const normalized = svg.replace(
    /<text\b([^>]*)>([\s\S]*?)<\/text>/gu,
    (text, attrs: string, body: string) => {
      const reference = [...attrs.matchAll(attributePattern)].find(
        (attribute) => attribute[1] === "clip-path",
      );
      if (!reference) return text;
      const id = /^url\(#([^)]+)\)$/u.exec(reference[3]!);
      const clip = id && clips.get(id[1]!);
      if (!clip) throw unsupported("label clip");
      const { x, y, width, height } = clip;
      if (width === 0 || height === 0) return "";
      return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" overflow="hidden"><text${attrs.replace(reference[0], "")}>${body}</text></svg>`;
    },
  );
  // Inspect real attributes, not escaped label text or words in other values.
  // Any future group clips/masks must also avoid the converter's soft-mask path.
  for (const tag of normalized.matchAll(/<[A-Za-z][^>]*>/gu)) {
    for (const attribute of tag[0].matchAll(attributePattern)) {
      if (attribute[1] === "clip-path" || attribute[1] === "mask")
        throw unsupported(`${attribute[1]} attribute`);
    }
  }
  return normalized;
}

/** Font-only spans preserve the text chunk's shared anchor, baseline and position. */
function withPdfFontFallback(svg: string, sheet: number): string {
  type Context = {
    family: string;
    bold: boolean;
    inText: boolean;
    row?: string | undefined;
    column?: string | undefined;
  };
  const stack: Context[] = [
    { family: "sans-serif", bold: false, inText: false },
  ];
  return svg.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/gu, (part) => {
    if (part.startsWith("<?") || part.startsWith("<!")) return part;
    if (part.startsWith("</")) {
      stack.pop();
      return part;
    }
    const parent = stack.at(-1)!;
    if (part.startsWith("<")) {
      const family =
          /\bfont-family\s*=\s*(["'])(.*?)\1/u.exec(part)?.[2] ?? parent.family,
        weight = /\bfont-weight\s*=\s*(["'])(.*?)\1/u.exec(part)?.[2],
        row = /\sdata-row-designation\s*=\s*(["'])(.*?)\1/u.exec(part)?.[2],
        column = /\sdata-report-column\s*=\s*(["'])(.*?)\1/u.exec(part)?.[2],
        columnName = /\sdata-column-name\s*=\s*(["'])(.*?)\1/u.exec(part)?.[2];
      const context = {
        family,
        bold: weight ? weight === "bold" || Number(weight) >= 600 : parent.bold,
        inText: parent.inText || /^<text\b/u.test(part),
        row: row === undefined ? parent.row : decodeText(row),
        column:
          column === undefined
            ? parent.column
            : `${column}${columnName === undefined ? "" : ` ${JSON.stringify(decodeText(columnName))}`}`,
      };
      if (!/\/\s*>$/u.test(part)) stack.push(context);
      return part;
    }
    if (!parent.inText) return part;
    const face =
      parent.family === "ThermiteMath"
        ? "math"
        : /(?:^|[,\s])monospace(?:$|[,\s])/u.test(parent.family)
          ? "mono"
          : parent.bold
            ? "bold"
            : "sans";
    const decoded = decodeText(part),
      // Default ignorables have neither advance nor ink. The embedded Latin/
      // math faces have no supported joiner sequences; their visible characters
      // are still checked below. Keep residual combining marks explicit.
      normalized = decoded
        .normalize("NFC")
        .replace(/\p{Default_Ignorable_Code_Point}/gu, "");
    const unsupported = (char: string) =>
      new Error(
        `PDF font does not support ${describeCodePoint(char)} on sheet ${sheet}${parent.row === undefined ? "" : `, row ${JSON.stringify(parent.row)}`}${parent.column === undefined ? "" : `, column ${parent.column}`}. Use SVG/HTML or a supported label.`,
      );
    const runs: { fallback: boolean; value: string }[] = [];
    for (const char of normalized) {
      // The converter skips zero-advance glyphs and does not apply mark GPOS.
      // NFC handles precomposed accents; a remaining real mark cannot vanish.
      if (/\p{Mark}/u.test(char)) throw unsupported(char);
      const fallback =
        !/\s/u.test(char) && !supportsGlyph(face, char.codePointAt(0)!);
      if (fallback && !supportsGlyph("math", char.codePointAt(0)!))
        throw unsupported(char);
      if (runs.at(-1)?.fallback === fallback) runs.at(-1)!.value += char;
      else runs.push({ fallback, value: char });
    }
    if (!runs.some((run) => run.fallback))
      return normalized === decoded ? part : encodeText(normalized);
    return runs
      .map((run) =>
        run.fallback
          ? `<tspan font-family="ThermiteMath">${encodeText(run.value)}</tspan>`
          : encodeText(run.value),
      )
      .join("");
  });
}

/** Convert only an internally generated packet; never import arbitrary SVG documents. */
export async function packetPdf(
  packet: RenderedPacket,
  title: string,
): Promise<Buffer> {
  const regular = fileURLToPath(bundledFontUrl("NotoSans-Regular"));
  const bold = fileURLToPath(bundledFontUrl("NotoSans-Bold"));
  const math = fileURLToPath(bundledFontUrl("NotoSansMath-Regular"));
  const mono = fileURLToPath(bundledFontUrl("NotoSansMono-Regular"));
  const svgs = packet.sheets.map((sheet) =>
    withPdfFontFallback(
      withPdfLabelClips(sheet.svg, sheet.number),
      sheet.number,
    ),
  );
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: title,
      Author: "Thermite Schematics",
      Creator: "Thermite Schematics",
      CreationDate: new Date(0),
      ModDate: new Date(0),
    },
  });
  // svg-to-pdfkit emits all anchors as URI annotations. Convert our known
  // sheet fragments into actual PDF destinations before their objects flush.
  const ref = doc.ref.bind(doc);
  const destinations = new Set(
    packet.sheets.map((sheet) => `#sheet-${sheet.number}`),
  );
  doc.ref = (data) => {
    const annotation = data as
      | { Type?: string; Subtype?: string; A?: { S?: string; URI?: unknown } }
      | undefined;
    if (
      annotation?.Type === "Annot" &&
      annotation.Subtype === "Link" &&
      annotation.A?.S === "URI"
    ) {
      const target = String(annotation.A.URI);
      if (!destinations.has(target))
        throw new Error(`Unknown packet PDF link: ${target}`);
      return ref({ ...data, A: { S: "GoTo", D: new String(target.slice(1)) } });
    }
    return ref(data);
  };
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const warnings: string[] = [];
  try {
    doc.registerFont(
      "ThermiteRegular",
      unshapedPrintableFont(readFileSync(regular)),
    );
    doc.registerFont("ThermiteBold", unshapedPrintableFont(readFileSync(bold)));
    doc.registerFont("ThermiteMath", unshapedPrintableFont(readFileSync(math)));
    doc.registerFont("ThermiteMono", unshapedPrintableFont(readFileSync(mono)));
    const width = (packet.page.widthMm * 72) / 25.4,
      height = (packet.page.heightMm * 72) / 25.4;
    for (const [index, sheet] of packet.sheets.entries()) {
      doc.addPage({ size: [width, height], margin: 0 });
      doc.addNamedDestination(`sheet-${sheet.number}`, "Fit");
      SVGtoPDF(doc, svgs[index]!, 0, 0, {
        width,
        height,
        assumePt: false,
        fontCallback: (family, isBold, _italic, options) => {
          if (family === "ThermiteMath") {
            options.fauxBold = isBold;
            return "ThermiteMath";
          }
          if (/(?:^|[,\s])monospace(?:$|[,\s])/u.test(family)) {
            options.fauxBold = isBold;
            return "ThermiteMono";
          }
          return isBold ? "ThermiteBold" : "ThermiteRegular";
        },
        imageCallback: () => {
          throw new Error("Packet PDF cannot load external images.");
        },
        documentCallback: () => {
          throw new Error("Packet PDF cannot load external documents.");
        },
        warningCallback: (message) => warnings.push(message),
      });
    }
    doc.end();
  } catch (error) {
    (doc as unknown as Readable).destroy(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  const bytes = await completed;
  if (warnings.length)
    throw new Error(
      `PDF conversion failed validation: ${[...new Set(warnings)].join("; ")}`,
    );
  return bytes;
}
