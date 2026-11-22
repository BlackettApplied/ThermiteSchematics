// Explicit gate backend. Published evidence and signed bind captures never use it.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import {
  drawingContextOptions,
  launch,
  displaySheet,
  screenshotCrop,
} from "./browser.mjs";
import { readCropSource } from "./crop-source.mjs";
import { checkPdfPage, pdfPageMetadata } from "./pdf-source-policy.mjs";
import { loadPdfBytes, renderPdf, PDFJS_VERSION } from "./pdf.mjs";
import { GATE_MODE, GATE_ARGS } from "./paired-raster-plan.mjs";

export async function gateSource(root, report, region) {
  const pins = report.sourceHashes;
  assert(
    pins?.format === "thermite-draw-sources/1.0" && Array.isArray(pins.sheets),
    "Missing source pins",
  );
  const sheets = pins.sheets.filter(
    (s) => s.case === region.case && s.sheet === region.sheet,
  );
  const ref = sheets[0]?.[region.medium];
  assert(
    sheets.length === 1 && /^[a-f0-9]{64}$/.test(ref?.sha256 ?? ""),
    "Missing or ambiguous source pin",
  );
  const expected =
    region.medium === "svg"
      ? [`${region.case}/sheet-${String(region.sheet).padStart(3, "0")}.svg`]
      : region.medium === "html"
        ? [`${region.case}/packet.html`, `${region.case}/packet.html.gz`]
        : [`${region.case}/packet.pdf`];
  assert(expected.includes(ref.path), "Source pin differs from case and sheet");
  const row = {
    scope: { case: region.case, medium: region.medium },
    sourceRender: {
      medium: region.medium,
      [region.medium]: ref.path,
      [region.medium + "Sha256"]: ref.sha256,
    },
  };
  return { ...(await readCropSource(root, row)), ref };
}

async function pdfRegion(source, region) {
  assert(
    source.ref.backend === "pdf.js" &&
      source.ref.pdfjsVersion === PDFJS_VERSION,
    "PDF backend/version differs",
  );
  checkPdfPage(source.ref.page, region.sheet);
  const document = await loadPdfBytes(source.bytes);
  try {
    const page = await document.getPage(region.sheet);
    assert(
      equal(pdfPageMetadata(page), source.ref.page),
      "PDF physical page differs",
    );
    const b = region.box,
      p = source.ref.page;
    assert(
      b.x + b.w <= p.widthMm + 0.001 && b.y + b.h <= p.heightMm + 0.001,
      "PDF crop outside page",
    );
    const png = (await renderPdf(page, 300, b)).toBuffer("image/png");
    document.assertNoExternalResources();
    return png;
  } finally {
    await document.loadingTask.destroy();
  }
}

async function browserRegion(page, source, region) {
  const selector =
    region.medium === "html" ? `#sheet-${region.sheet}>svg` : "body>svg";
  if (region.medium === "html") {
    await page.setContent(source.text);
    await page.evaluate(() => document.fonts.ready);
  } else await displaySheet(page, source.text);
  const size = await page.evaluate((selector) => {
    const v = document.querySelector(selector)?.viewBox.baseVal;
    return v && { w: v.width, h: v.height };
  }, selector);
  assert(
    size &&
      region.box.x + region.box.w <= size.w + 0.001 &&
      region.box.y + region.box.h <= size.h + 0.001,
    "SVG/HTML crop outside sheet",
  );
  return screenshotCrop(page, region.box, undefined, selector);
}

export async function captureGateRegion(root, report, region) {
  const source = await gateSource(root, report, region);
  // A fresh browser and print context for each side of every region.
  const browser = await launch([...GATE_ARGS]);
  try {
    const context = await browser.newContext(drawingContextOptions),
      page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    const pdf = region.medium === "pdf";
    const png = pdf
      ? await pdfRegion(source, region)
      : await browserRegion(page, source, region);
    return {
      png,
      sourceSha256: source.sha,
      capture: {
        mode: GATE_MODE,
        browser: browser.version(),
        args: [...GATE_ARGS],
        context: drawingContextOptions,
        backend: pdf ? "pdf.js" : "chromium",
        ...(pdf ? { pdfjsVersion: PDFJS_VERSION } : {}),
        dpi: 300,
      },
    };
  } finally {
    await browser.close();
  }
}
