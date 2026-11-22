// Browser work is explicit at bind time; unit tests use decoded synthetic rasters.
import {
  PDF_CAPTURE_IMPLEMENTATION,
  checkPdfRegion,
} from "./pdf-source-policy.mjs";
import { verificationFact } from "./crop-report.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { gunzipSync } from "node:zlib";
import { within } from "./repin-io.mjs";
import { hash, json, canonical } from "./support.mjs";
import { assertCropContainsInstance } from "./crop-geometry.mjs";
import { drawingHash } from "./png-ink.mjs";
import {
  captureAttempts,
  MAX_SOURCE_ATTEMPTS,
  CAPTURE_IMPLEMENTATION,
} from "./crop-attempts.mjs";
import { SOURCE_TOLERANCE } from "./crop-source-pixels.mjs";

export async function readCropSource(sourceRoot, row) {
  const r = row.sourceRender,
    medium = r?.medium;
  assert(
    ["svg", "html", "pdf"].includes(medium) && medium === row.scope?.medium,
    "Source render must name the cited SVG/HTML/PDF medium",
  );
  const path = r[medium],
    sha = r[medium + "Sha256"];
  assert(
    typeof path === "string" &&
      !isAbsolute(path) &&
      !path.split(/[\\/]/).includes(".."),
    "Source render path must be relative without traversal",
  );
  if (medium === "pdf")
    assert(
      path === `${row.scope.case}/packet.pdf`,
      "PDF source must name the delivered case/packet.pdf, never an SVG/HTML substitute",
    );
  const target = await within(resolve(sourceRoot, path), sourceRoot, {
    existing: true,
  });
  const bytes = await readFile(target);
  assert(hash(bytes) === sha, "Source render hash differs from index");
  return {
    bytes,
    text:
      medium === "pdf"
        ? undefined
        : (path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"),
    sha,
  };
}
export async function renderSourceCrop(page, text, row) {
  const { openSheet, screenshotCrop } = await import("./browser.mjs");
  const html = row.scope.medium === "html";
  if (html) {
    await page.setContent(text);
    await page.evaluate(() => document.fonts.ready);
  } else await openSheet(page, text);
  const selector = html ? `#sheet-${row.physicalSheet}>svg` : "body>svg";
  const size = await page.evaluate((sel) => {
    const v = document.querySelector(sel)?.viewBox.baseVal;
    return v && { w: v.width, h: v.height };
  }, selector);
  const b = canonical(row.sourceBbox);
  assert(
    size &&
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.w <= size.w + 0.001 &&
      b.y + b.h <= size.h + 0.001,
    "Source crop is outside the physical sheet",
  );
  return screenshotCrop(page, b, undefined, selector);
}
export async function captureSourceCrop(browser, text, row) {
  const { drawingContextOptions } = await import("./browser.mjs");
  const context = await browser.newContext(drawingContextOptions);
  try {
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    return await renderSourceCrop(page, text, row);
  } finally {
    await context.close();
  }
}
export async function verifyCropSources(sourceRoot, index, crops) {
  const refusals = [],
    audit = [],
    references = new Map(),
    proofs = new Map(),
    rasters = new Map();
  if (!index.crops.length) return proofs;
  assert(
    sourceRoot,
    "Supply --source-root <checkpoint> to verify crop pixels with Chromium (SVG/HTML) or pdf.js (PDF); no source checks are skipped",
  );
  const { launch, drawingLaunchArgs, drawingContextOptions } =
    await import("./browser.mjs");
  let browser;
  try {
    for (const row of index.crops) {
      const attempts = [],
        record = { crop: row.path, attempts };
      audit.push(record);
      try {
        assertCropContainsInstance({ bbox: row.instanceBbox }, row.sourceBbox);
        assert(
          Number.isSafeInteger(row.physicalSheet) && row.physicalSheet > 0,
          "Source crop requires a positive physicalSheet",
        );
        const source = await readCropSource(
          sourceRoot instanceof Map
            ? sourceRoot.get(row.reportSha256)
            : sourceRoot,
          row,
        );
        const isPdf = row.scope.medium === "pdf";
        if (isPdf)
          checkPdfRegion(
            row.sourceRender.page,
            row.instanceBbox,
            row.sourceBbox,
            row.cropShape,
          );
        const crop = crops.get(row.path),
          header = row.headerPixels ?? 0;
        const key = json([
          source.sha,
          row.scope.medium,
          row.physicalSheet,
          canonical(row.sourceBbox),
          isPdf ? PDF_CAPTURE_IMPLEMENTATION : CAPTURE_IMPLEMENTATION,
          ...(isPdf
            ? [
                row.sourceRender.page,
                row.sourceRender.backend,
                row.sourceRender.pdfjsVersion,
                row.cropShape,
                row.text,
                row.instanceBbox,
              ]
            : []),
          drawingHash(crop, header),
        ]);
        if (!isPdf && !browser) browser = await launch();
        if (!rasters.has(key)) rasters.set(key, []);
        const cache = rasters.get(key);
        const selectedAttempt = await captureAttempts(
          crop,
          header,
          async (n) => {
            if (!cache[n - 1]) {
              if (isPdf) {
                const { capturePdfCrop } = await import("./pdf-source.mjs");
                cache[n - 1] = await capturePdfCrop(source.bytes, row);
              } else
                cache[n - 1] = await captureSourceCrop(
                  browser,
                  source.text,
                  row,
                );
            }
            return cache[n - 1];
          },
          references,
          attempts,
        );
        proofs.set(row.path, {
          ...verificationFact(row, source.sha),
          capture: isPdf
            ? (await import("./pdf-source.mjs")).pdfCaptureEnvironment()
            : {
                implementation: CAPTURE_IMPLEMENTATION,
                browser: browser.version(),
                platform: `${process.platform}-${process.arch}`,
                args: [...drawingLaunchArgs],
                deviceScaleFactor: drawingContextOptions.deviceScaleFactor,
              },
          maxAttempts: MAX_SOURCE_ATTEMPTS,
          limits: { ...SOURCE_TOLERANCE },
          selectedAttempt,
          attempts,
        });
      } catch (error) {
        record.reason = error.message;
        refusals.push({ crop: row.path, reason: error.message });
      }
    }
  } finally {
    try {
      await browser?.close();
    } catch (error) {
      refusals.push({ crop: "capture", reason: error.message });
    }
  }
  if (refusals.length) {
    const error = new Error(
      "Source verification refused " +
        refusals.length +
        " crop(s):\n" +
        refusals.map((r) => r.crop + ": " + r.reason).join("\n"),
    );
    error.audit = audit;
    error.references = references;
    throw error;
  }
  proofs.references = references;
  proofs.audit = audit;
  return proofs;
}
