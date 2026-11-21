// Portable shape arithmetic; native font/PDF code is confined to derivation.
import assert from "node:assert/strict";
import { canonical } from "./support.mjs";
import { assertCropContainsInstance } from "./crop-geometry.mjs";
export const PDF_INK_FORMAT = "thermite-draw-source-crop/3.0";
export const PDF_INK_MARGIN = 25.4 / 300;
export const outwardBox = (x, y, right, bottom) => {
  const left = Math.floor(x * 1000),
    top = Math.floor(y * 1000),
    r = Math.ceil(right * 1000),
    b = Math.ceil(bottom * 1000);
  return {
    x: left / 1000,
    y: top / 1000,
    w: (r - left) / 1000,
    h: (b - top) / 1000,
  };
};
export function pdfInkRegion(page, em, shape) {
  assert(
    shape &&
      Object.keys(shape).sort().join() ===
        "fontPrograms,inkBbox,kind,marginPixels,operators,textItem" &&
      shape.kind === "pdf-em-ink/1.0" &&
      shape.marginPixels === 1,
    "PDF crop requires the fixed em+ink shape and margin",
  );
  assert(
    Number.isSafeInteger(shape.textItem) &&
      shape.textItem >= 0 &&
      Array.isArray(shape.operators) &&
      shape.operators.length > 0 &&
      shape.operators.length <= 100_000 &&
      shape.operators.every(
        (v, i, a) =>
          Number.isSafeInteger(v) && v >= 0 && (i === 0 || v > a[i - 1]),
      ),
    "Invalid PDF ink operator association",
  );
  assert(
    Array.isArray(shape.fontPrograms) &&
      shape.fontPrograms.length > 0 &&
      shape.fontPrograms.every(
        (v, i, a) => /^[a-f0-9]{64}$/.test(v) && (i === 0 || v > a[i - 1]),
      ),
    "Invalid PDF embedded font-program hashes",
  );
  const ink = shape.inkBbox;
  for (const box of [em, ink]) {
    assertCropContainsInstance({ bbox: box }, box);
    assert(
      box.w > 0 &&
        box.h > 0 &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.w <= page.widthMm + 0.001 &&
        box.y + box.h <= page.heightMm + 0.001,
      "PDF em or glyph ink is outside the physical page",
    );
  }
  const m = PDF_INK_MARGIN,
    box = outwardBox(
      Math.max(0, Math.min(em.x, ink.x) - m),
      Math.max(0, Math.min(em.y, ink.y) - m),
      Math.min(page.widthMm, Math.max(em.x + em.w, ink.x + ink.w) + m),
      Math.min(page.heightMm, Math.max(em.y + em.h, ink.y + ink.h) + m),
    );
  assert(
    Math.ceil((box.w * 300) / 25.4) * Math.ceil((box.h * 300) / 25.4) <=
      20_000_000,
    "PDF ink raster resource budget exceeded",
  );
  return canonical(box);
}
