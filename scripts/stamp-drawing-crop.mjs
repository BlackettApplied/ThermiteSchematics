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
/** Refuse a row's representative crop when it does not show the cited instance. */
export function assertCropContainsInstance(instance, cropBbox) {
  const box = instance.bbox;
  assert(
    box &&
      cropBbox &&
      [
        box.x,
        box.y,
        box.w,
        box.h,
        cropBbox.x,
        cropBbox.y,
        cropBbox.w,
        cropBbox.h,
      ].every(Number.isFinite) &&
      box.x >= cropBbox.x - 0.001 &&
      box.y >= cropBbox.y - 0.001 &&
      box.x + box.w <= cropBbox.x + cropBbox.w + 0.001 &&
      box.y + box.h <= cropBbox.y + cropBbox.h + 0.001,
    "Cited instance is outside the source crop; render its own crop before stamping",
  );
}
export async function stampInstanceDrawingCrop(
  bytes,
  headerLines,
  instance,
  cropBbox,
) {
  assertCropContainsInstance(instance, cropBbox);
  return stampDrawingCrop(bytes, headerLines);
}
/** Lines are literal provenance, stored unchanged in the crop-index row. */
export async function stampDrawingCrop(
  bytes,
  headerLines,
  stripHeader = false,
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
  ctx.fillStyle = "#111";
  ctx.font = '14px "Thermite Crop Header"';
  headerLines.forEach((line, i) => ctx.fillText(line, 8, 17 + i * 19));
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
    },
  });
  assert(
    values.drawing && values["header-lines"] && values.output,
    "Use --drawing <png> --header-lines <four-lines.json> --output <png> [--strip-header]",
  );
  const bytes = await stampDrawingCrop(
    await readFile(values.drawing),
    JSON.parse(await readFile(values["header-lines"], "utf8")),
    values["strip-header"],
  );
  await writeFile(values.output, bytes, { flag: "wx" });
}
