// Opt-in PDF calibration, not a C1 or signed evidence migration.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { pdfCalibration } from "./pdf-calibration.mjs";
import { pinnedSource } from "./source-hashes.mjs";
import { readCropSource } from "./crop-source.mjs";
import {
  capturePdfCrop,
  preparePdfCrop,
  pdfCaptureEnvironment,
} from "./pdf-source.mjs";
import { instanceCropRow } from "./crop-index.mjs";
import {
  cropHeader,
  verificationFact,
  checkIndexedEntries,
} from "./crop-report.mjs";
import { captureAttempts } from "./crop-attempts.mjs";
import { hash } from "./support.mjs";
const { values: v } = parseArgs({
  options: {
    report: { type: "string" },
    output: { type: "string" },
    samples: { type: "string" },
  },
});
assert(
  v.report && v.output,
  "Use --report <retained-summary.json> --output <pdf-audit.json>",
);
if (v.samples) await mkdir(resolve(v.samples));
const c = await pdfCalibration(v.report),
  results = [];
for (const [i, t] of c.samples.entries()) {
  const ref = pinnedSource(c.report, t),
    row = {
      scope: t.scope,
      physicalSheet: t.physicalSheet,
      text: t.facts.text,
      instanceBbox: t.bbox,
      sourceBbox: t.bbox,
      sourceRender: {
        medium: "pdf",
        pdf: ref.path,
        pdfSha256: ref.sha256,
        backend: ref.backend,
        pdfjsVersion: ref.pdfjsVersion,
        page: ref.page,
      },
    },
    source = await readCropSource(c.root, row);
  const prepared = await preparePdfCrop(source.bytes, row),
    png = await capturePdfCrop(source.bytes, prepared),
    indexed = instanceCropRow(
      {
        t,
        reportSha256: c.calibrationSha256,
        sourceRef: ref,
        headerLines: cropHeader(t),
        cropShape: prepared.cropShape,
      },
      `evals/out/draw-samples/pdf-calibration/${i}.png`,
      png,
      prepared.sourceBbox,
      source.bytes,
    );
  indexed.headerPixels = 0;
  if (v.samples)
    await writeFile(join(resolve(v.samples), `${i}.png`), png, { flag: "wx" });
  const file = {
    summarySha256: c.calibrationSha256,
    entries: [
      {
        action: "new-defect",
        to: { markerId: t.markerId, scope: t.scope },
        instances: [t.token],
        crop: { path: indexed.path, sha256: hash(png) },
      },
    ],
  };
  checkIndexedEntries(
    file,
    { format: "thermite-draw-crop-index/3.0", crops: [indexed] },
    new Map([[c.calibrationSha256, c.report]]),
  );
  const trials = [];
  for (let repeat = 1; repeat <= 3; repeat++) {
    const attempts = [],
      references = new Map();
    try {
      const selectedAttempt = await captureAttempts(
        png,
        0,
        () => capturePdfCrop(source.bytes, indexed),
        references,
        attempts,
      );
      trials.push({ repeat, selectedAttempt, attempts, status: "pass" });
    } catch (error) {
      trials.push({
        repeat,
        attempts,
        status: "refused",
        reason: error.message,
      });
    }
  }
  results.push({
    row: t.row,
    token: t.token,
    classification: t.classification,
    sourceSha256: source.sha,
    evidenceSha256: hash(png),
    pdf: ref,
    association: c.associated.get(t.row),
    verification: verificationFact(indexed, source.sha),
    trials,
  });
  if (i % 20 === 0) process.stdout.write(`${i + 1}/${c.samples.length}\n`);
}
const data = {
  format: "thermite-draw-pdf-calibration/1.0",
  applyTarget: false,
  originalReportSha256: c.originalSha256,
  calibrationReportSha256: c.calibrationSha256,
  capture: pdfCaptureEnvironment(),
  rows: results.length,
  comparisons: results.reduce((n, r) => n + r.trials.length, 0),
  refusals: results.flatMap((r) => r.trials).filter((t) => t.status !== "pass")
    .length,
  results,
};
await writeFile(resolve(v.output), JSON.stringify(data, null, 2) + "\n", {
  flag: "wx",
});
console.log(JSON.stringify({ ...data, results: undefined }));
assert(
  data.rows === 238 && data.refusals === 0,
  "PDF audit requires all 238 rows and zero false refusals",
);
