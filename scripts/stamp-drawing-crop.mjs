// Reproducible provenance outside the actual 300 dpi drawing crop.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { drawingHash } from "../evals/draw/png-ink.mjs";

assert(
  GlobalFonts.registerFromPath(
    fileURLToPath(
      new URL(
        "../packages/render/assets/fonts/NotoSans-Regular.ttf",
        import.meta.url,
      ),
    ),
    "Thermite Crop Header",
  ),
  "Could not register bundled crop-header font",
);
export const HEADER_PIXELS = 86;
export const HEADER_FONT_PIXELS = 14;
export const MIN_HEADER_FONT_PIXELS = 10;
export function headerFontPixels(width, available, label) {
  const pixels = Math.min(
    HEADER_FONT_PIXELS,
    (HEADER_FONT_PIXELS * available) / width,
  );
  assert(
    pixels >= MIN_HEADER_FONT_PIXELS,
    `${label}: header needs ${Math.ceil((width * MIN_HEADER_FONT_PIXELS) / HEADER_FONT_PIXELS + 16)} px width at ${MIN_HEADER_FONT_PIXELS} px minimum; available ${available + 16} px`,
  );
  return pixels;
}
function stampHeader(ctx, width, headerLines) {
  ctx.fillStyle = "#111";
  headerLines.forEach((line, i) => {
    ctx.font = `${HEADER_FONT_PIXELS}px "Thermite Crop Header"`;
    const pixels = headerFontPixels(
      ctx.measureText(line).width,
      width - 16,
      `Header line ${i + 1} ${JSON.stringify(line.length > 80 ? line.slice(0, 77) + "..." : line)} (${headerLines[2]})`,
    );
    ctx.font = `${pixels}px "Thermite Crop Header"`;
    ctx.fillText(line, 8, 17 + i * 19);
  });
}
import { assertCropContainsInstance } from "../evals/draw/crop-geometry.mjs";
export { assertCropContainsInstance };
export async function stampInstanceDrawingCrop(
  bytes,
  headerLines,
  instance,
  cropBbox,
) {
  return stampDrawingCrop(bytes, headerLines, false, { instance, cropBbox });
}
/** Lines are literal provenance, stored unchanged in the crop-index row. */
export async function stampDrawingCrop(
  bytes,
  headerLines,
  stripHeader = false,
  geometry,
) {
  assert(
    Array.isArray(headerLines) && headerLines.length === 4,
    "Supply four header lines",
  );
  assert(
    headerLines.every(
      (line) => typeof line === "string" && /^[\x20-\x7e]*$/.test(line),
    ),
    "Header lines must be printable ASCII; use literal Unicode escapes",
  );
  assertCropContainsInstance(geometry?.instance, geometry?.cropBbox);
  if (stripHeader) drawingHash(bytes, HEADER_PIXELS);
  const image = await loadImage(bytes),
    sourceTop = stripHeader ? HEADER_PIXELS : 0,
    height = image.height - sourceTop;
  assert(height > 0, "Drawing has no pixels below its header");
  const canvas = createCanvas(
      Math.max(760, image.width),
      height + HEADER_PIXELS,
    ),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  stampHeader(ctx, canvas.width, headerLines);
  ctx.drawImage(
    image,
    0,
    sourceTop,
    image.width,
    height,
    0,
    HEADER_PIXELS,
    image.width,
    height,
  );
  return canvas.toBuffer("image/png");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      drawing: { type: "string" },
      "header-lines": { type: "string" },
      output: { type: "string" },
      "strip-header": { type: "boolean", default: false },
      instance: { type: "string" },
      "source-bbox": { type: "string" },
    },
  });
  assert(
    values.drawing &&
      values["header-lines"] &&
      values.output &&
      values.instance &&
      values["source-bbox"],
    "Use --drawing <png> --header-lines <four-lines.json> --output <png> --instance <instance.json> --source-bbox <bbox.json> [--strip-header]",
  );
  const bytes = await stampDrawingCrop(
    await readFile(values.drawing),
    JSON.parse(await readFile(values["header-lines"], "utf8")),
    values["strip-header"],
    {
      instance: JSON.parse(await readFile(values.instance, "utf8")),
      cropBbox: JSON.parse(await readFile(values["source-bbox"], "utf8")),
    },
  );
  await writeFile(values.output, bytes, { flag: "wx" });
}
