import { loadPdfBytes } from "./pdf.mjs";
import { paintedPdfItems } from "./pdf-painted.mjs";

// PDF.js reads Tf, text matrices and the graphics CTM from the native content
// stream. The transformed vertical font basis is the physical em, not glyph ink,
// extracted item.height, an SVG font size, or a matched expected string.
export async function pdfFloorRuns(bytes) {
  const doc = await loadPdfBytes(bytes),
    runs = [];
  try {
    for (let sheet = 1; sheet <= doc.numPages; sheet++) {
      const page = await doc.getPage(sheet);
      const content = await page.getTextContent({ disableNormalization: true });
      const viewport = page.getViewport({ scale: 25.4 / 72 });
      const measured = [],
        raw = [];
      for (const [index, item] of content.items.entries()) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const t = item.transform,
          v = viewport.transform;
        const emMm = Math.hypot(
          v[0] * t[2] + v[2] * t[3],
          v[1] * t[2] + v[3] * t[3],
        );
        if (!(emMm > 0) || !Number.isFinite(emMm))
          throw Error("Unmeasured PDF text");
        const [x, y] = viewport.convertToViewportPoint(t[4], t[5]);
        raw.push(item);
        measured.push({
          sheet,
          index,
          text: item.str,
          emMm,
          fontSize: emMm,
          font: item.fontName,
          bbox: { x, y: y - emMm, w: (item.width * 25.4) / 72, h: emMm },
        });
      }
      // Reuse only the native glyph/clip interpreter, never a legibility policy.
      runs.push(...(await paintedPdfItems(page, measured, raw)));
      doc.assertNoExternalResources();
    }
    return runs;
  } finally {
    await doc.loadingTask.destroy();
  }
}
