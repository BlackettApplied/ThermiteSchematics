// Evidence-only geometry from the embedded programs and actual glyph placement.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { embeddedGlyphMetric } from "./pdf-glyph-metrics.mjs";
import { pdfText } from "./pdf.mjs";
import { pdfGlyphRuns } from "./pdf-ink-operators.mjs";
import { canonical } from "./support.mjs";
import { pdfInkRegion, outwardBox } from "./pdf-ink-policy.mjs";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
export async function derivePdfInk(page, document, row) {
  const list = await page.getOperatorList(),
    items = await pdfText(page, document.fontFamilies, document.fontCaps),
    matches = items
      .map((x, i) => ({ x, i }))
      .filter(
        ({ x }) =>
          x.text === row.text &&
          equal(canonical(x.bbox), canonical(row.instanceBbox)),
      );
  assert(
    matches.length === 1,
    "PDF ink requires one exact report text/em association",
  );
  const { x: item, i: textItem } = matches[0];
  const runs = pdfGlyphRuns(
    list,
    OPS,
    page.getViewport({ scale: 25.4 / 72 }).transform,
    embeddedGlyphMetric(page),
  );
  const associated = runs.filter(
    (r) =>
      // PDF extraction collapses adjacent literal spaces; geometry is matched too.
      r.text.trim().replace(/ +/g, " ") === item.text &&
      Math.abs(r.start[0] - item.bbox.x) < 0.001 &&
      Math.abs(r.start[1] - item.bbox.y - item.bbox.h) < 0.001 &&
      Math.abs(r.size - item.bbox.h) < 0.001 &&
      Math.abs(
        Math.hypot(r.end[0] - r.start[0], r.end[1] - r.start[1]) - item.bbox.w,
      ) < 0.001,
  );
  assert(
    associated.length === 1,
    "PDF glyph/operator association is ambiguous or unsupported",
  );
  const run = associated[0];
  assert(
    run.points.length && run.points.length <= 400_000,
    "Missing or excessive PDF glyph outlines",
  );
  const xs = run.points.map((p) => p[0]),
    ys = run.points.map((p) => p[1]);
  const cropShape = {
    kind: "pdf-em-ink/1.0",
    inkBbox: outwardBox(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ),
    marginPixels: 1,
    textItem,
    operators: run.operators,
    fontPrograms: [...run.fonts].sort(),
  };
  return {
    cropShape,
    sourceBbox: pdfInkRegion(
      row.sourceRender.page,
      row.instanceBbox,
      cropShape,
    ),
  };
}
