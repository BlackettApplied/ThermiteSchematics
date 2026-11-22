// Portable PDF evidence rules; these do not measure or classify drawings.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { canonical } from "./support.mjs";
import { assertCropContainsInstance } from "./crop-geometry.mjs";
import { PDF_INK_FORMAT, pdfInkRegion } from "./pdf-ink-policy.mjs";
export const PDF_CAPTURE_IMPLEMENTATION = "pdfjs-source/2.0";
export function pdfPageMetadata(page) {
  const viewport = page.getViewport({ scale: 25.4 / 72 });
  return canonical({
    number: page.pageNumber,
    view: [...page.view],
    userUnit: page.userUnit,
    rotation: page.rotate,
    widthMm: viewport.width,
    heightMm: viewport.height,
  });
}
export function checkPdfPage(p, number) {
  assert(
    p && Number.isSafeInteger(p.number) && p.number > 0 && p.number === number,
    "PDF pin physical page differs",
  );
  assert(
    Array.isArray(p.view) &&
      p.view.length === 4 &&
      p.view.every(Number.isFinite) &&
      p.view[2] > p.view[0] &&
      p.view[3] > p.view[1] &&
      Number.isFinite(p.userUnit) &&
      p.userUnit > 0 &&
      [0, 90, 180, 270].includes(p.rotation),
    "PDF pin requires finite page bounds, positive user unit and a supported rotation",
  );
  const w = ((p.view[2] - p.view[0]) * p.userUnit * 25.4) / 72,
    h = ((p.view[3] - p.view[1]) * p.userUnit * 25.4) / 72,
    swapped = p.rotation === 90 || p.rotation === 270;
  assert(
    Number.isFinite(p.widthMm) &&
      Number.isFinite(p.heightMm) &&
      p.widthMm > 0 &&
      p.heightMm > 0 &&
      p.widthMm === canonical(swapped ? h : w) &&
      p.heightMm === canonical(swapped ? w : h),
    "PDF pin page dimensions differ from its bounds and rotation",
  );
}
export function checkPdfRegion(page, instance, box, shape) {
  checkPdfPage(page, page?.number);
  assertCropContainsInstance({ bbox: instance }, box);
  assert(
    instance.w > 0 &&
      instance.h > 0 &&
      equal(
        canonical(box),
        shape ? pdfInkRegion(page, instance, shape) : canonical(instance),
      ),
    "PDF source crop must be exactly the derived em+ink region (or archived instance box)",
  );
  assert(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.w <= page.widthMm + 0.001 &&
      box.y + box.h <= page.heightMm + 0.001,
    "PDF instance box is outside the physical page",
  );
}
export function checkPdfInstance(report, t) {
  const row = report.results?.find((r) => r.id === t.row),
    f = row?.evidence?.findings?.[t.finding];
  assert(
    report.raster?.pdfjs === true &&
      t.scope.medium === "pdf" &&
      f?.medium === "pdf" &&
      ["text-below-minimum-em", "iso-cap-height-policy"].includes(f.kind) &&
      (f.backend === undefined || f.backend === "pdf.js"),
    "Only boxed pdf.js small-text and font-policy instances are supported; PDFKit has no calibrated evidence path",
  );
  assert(
    t.bbox &&
      (f.policySheet === undefined || f.policySheet === t.physicalSheet) &&
      t.classification ===
        (f.kind === "iso-cap-height-policy" ? "policy-gap" : "drawing"),
    "PDF instance needs its exported box and unchanged policy-gap classification",
  );
}
export function pdfFacts(ref) {
  return {
    backend: ref.backend,
    pdfjsVersion: ref.pdfjsVersion,
    page: ref.page,
  };
}
export function checkPdfCapture(v, archivePdf2 = false) {
  const old = archivePdf2 && v.format === "thermite-draw-source-crop/2.0";
  assert(
    old
      ? v.cropShape === undefined
      : v.format === PDF_INK_FORMAT && v.cropShape,
    "New PDF evidence requires v3 em+ink shape",
  );
  const p = v.pdf,
    c = v.capture;
  assert(
    p?.backend === "pdf.js" &&
      typeof p.pdfjsVersion === "string" &&
      /^\d+\.\d+\.\d+$/.test(p.pdfjsVersion) &&
      c?.implementation ===
        (old ? "pdfjs-source/1.0" : PDF_CAPTURE_IMPLEMENTATION) &&
      c.pdfjsVersion === p.pdfjsVersion &&
      typeof c.platform === "string" &&
      c.platform.length > 0 &&
      c.dpi === 300 &&
      c.useSystemFonts === false &&
      c.isEvalSupported === false &&
      c.externalResources === "deny",
    "PDF source verification requires the calibrated pdf.js capture environment",
  );
  assert(
    ["drawing", "policy-gap"].includes(v.classification),
    "PDF source verification requires the report classification",
  );
  checkPdfPage(p.page, v.sheet);
  checkPdfRegion(p.page, v.instanceBbox, v.sourceBbox, v.cropShape);
}
export function checkPdfIndexAttestation(row, v) {
  const ref = row?.sourceRender;
  assert(
    ref &&
      v.medium === "pdf" &&
      row.scope?.medium === "pdf" &&
      ref.medium === "pdf" &&
      row.physicalSheet === v.sheet &&
      row.classification === v.classification &&
      ref.pdf === v.sourcePath &&
      ref.pdfSha256 === v.sourceSha256 &&
      equal(pdfFacts(ref), v.pdf) &&
      equal(row.instanceBbox, v.instanceBbox) &&
      equal(row.sourceBbox, v.sourceBbox) &&
      equal(row.cropShape, v.cropShape) &&
      ["reportSha256", "token", "row", "markerId", "text"].every(
        (k) => row[k] === v[k],
      ) &&
      equal(row.scope, v.scope),
    "PDF archive index and signed source attestation differ",
  );
}
