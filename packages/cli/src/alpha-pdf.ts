import { openSync } from "fontkit";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import type { RenderedPacket } from "@thermite/render";

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

/** Font-only spans preserve the text chunk's shared anchor, baseline and position. */
function withPdfFontFallback(
  svg: string,
  sheet: number,
  primary: ReadonlySet<number>,
  math: ReadonlySet<number>,
): string {
  return svg.replace(
    /(<text\b[^>]*>)([\s\S]*?)(<\/text>)/gu,
    (_, open: string, body: string, close: string) => {
      const converted = body
        .split(/(<[^>]*>)/u)
        .map((part) => {
          if (part.startsWith("<")) return part;
          const runs: { fallback: boolean; value: string }[] = [];
          for (const char of decodeText(part)) {
            const fallback =
              !/\s/u.test(char) && !primary.has(char.codePointAt(0)!);
            if (fallback && !math.has(char.codePointAt(0)!))
              throw new Error(
                `PDF font does not support ${JSON.stringify(char)} on sheet ${sheet}. Use SVG/HTML or a supported label.`,
              );
            if (runs.at(-1)?.fallback === fallback) runs.at(-1)!.value += char;
            else runs.push({ fallback, value: char });
          }
          // Leave existing typography and converter input untouched without fallback.
          if (!runs.some((run) => run.fallback)) return part;
          return runs
            .map((run) =>
              run.fallback
                ? `<tspan font-family="ThermiteMath">${encodeText(run.value)}</tspan>`
                : encodeText(run.value),
            )
            .join("");
        })
        .join("");
      return open + converted + close;
    },
  );
}

/** Convert only an internally generated packet; never import arbitrary SVG documents. */
export async function packetPdf(
  packet: RenderedPacket,
  title: string,
): Promise<Buffer> {
  const regular = fileURLToPath(
    new URL("../assets/fonts/NotoSans-Regular.ttf", import.meta.url),
  );
  const bold = fileURLToPath(
    new URL("../assets/fonts/NotoSans-Bold.ttf", import.meta.url),
  );
  const math = fileURLToPath(
    new URL("../assets/fonts/NotoSansMath-Regular.ttf", import.meta.url),
  );
  const coverage = (path: string) => {
    const font = openSync(path);
    if (!("characterSet" in font))
      throw new Error("Expected the bundled TrueType font.");
    return new Set(font.characterSet);
  };
  const regularCoverage = coverage(regular),
    boldCoverage = coverage(bold),
    mathCoverage = coverage(math);
  const primary = new Set(
    [...regularCoverage].filter((code) => boldCoverage.has(code)),
  );
  const svgs = packet.sheets.map((sheet) =>
    withPdfFontFallback(sheet.svg, sheet.number, primary, mathCoverage),
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
    doc.registerFont("ThermiteRegular", regular);
    doc.registerFont("ThermiteBold", bold);
    doc.registerFont("ThermiteMath", math);
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
