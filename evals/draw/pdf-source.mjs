// Each capture opens a new PDF document from the same buffer that was hash-checked.
import assert from "node:assert/strict";
import { hash, canonical } from "./support.mjs";
import { isDeepStrictEqual as equal } from "node:util";
import { loadPdfBytes, renderPdf, PDFJS_VERSION } from "./pdf.mjs";
import {
  pdfPageMetadata,
  checkPdfPage,
  checkPdfRegion,
  PDF_CAPTURE_IMPLEMENTATION,
} from "./pdf-source-policy.mjs";
export function pdfCaptureEnvironment() {
  return {
    implementation: PDF_CAPTURE_IMPLEMENTATION,
    pdfjsVersion: PDFJS_VERSION,
    platform: `${process.platform}-${process.arch}`,
    dpi: 300,
    useSystemFonts: false,
    isEvalSupported: false,
    externalResources: "deny",
  };
}
import { derivePdfInk } from "./pdf-ink.mjs";
async function withPdfPage(bytes, row, usePage) {
  const ref = row.sourceRender;
  assert(
    row.scope.medium === "pdf" &&
      ref?.medium === "pdf" &&
      ref.backend === "pdf.js" &&
      ref.pdfjsVersion === PDFJS_VERSION,
    "PDF source requires the pinned pdf.js medium, backend and installed version",
  );
  assert(hash(bytes) === ref.pdfSha256, "PDF source bytes differ from pin");
  assert(
    bytes.subarray(0, 5).toString() === "%PDF-",
    "PDF source bytes are not a PDF",
  );
  checkPdfPage(ref.page, row.physicalSheet);
  const document = await loadPdfBytes(bytes);
  try {
    assert(
      row.physicalSheet <= document.numPages,
      "PDF physical page is missing",
    );
    const page = await document.getPage(row.physicalSheet);
    assert(
      equal(pdfPageMetadata(page), ref.page),
      "Actual PDF page size, bounds or rotation differs from pin",
    );
    try {
      return await usePage(page, document);
    } finally {
      document.assertNoExternalResources();
    }
  } finally {
    await document.loadingTask.destroy();
  }
}

export async function preparePdfCrop(bytes, row) {
  return withPdfPage(bytes, row, async (page, document) => ({
    ...row,
    ...(await derivePdfInk(page, document, row)),
  }));
}
export async function capturePdfCrop(bytes, row) {
  assert(row.cropShape, "New PDF capture requires em+ink cropShape");
  checkPdfRegion(
    row.sourceRender.page,
    row.instanceBbox,
    row.sourceBbox,
    row.cropShape,
  );
  return withPdfPage(bytes, row, async (page, document) => {
    const expected = await derivePdfInk(page, document, row);
    assert(
      equal(expected.cropShape, row.cropShape) &&
        equal(expected.sourceBbox, canonical(row.sourceBbox)),
      "PDF ink shape differs from independently derived pinned-source geometry",
    );
    const box = canonical(row.sourceBbox);
    return (await renderPdf(page, 300, box)).toBuffer("image/png");
  });
}
