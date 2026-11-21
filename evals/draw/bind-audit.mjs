import { parseReportBytes } from "./report-file.mjs";
// Opt-in, full pipeline-region audit of freshly prepared evidence and N=3 binding.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { launch } from "./browser.mjs";
import { pipelineCrops } from "./crop-index.mjs";
import { pdfFacts } from "./pdf-source-policy.mjs";
import { pinnedSource } from "./source-hashes.mjs";
import { readCropSource, captureSourceCrop } from "./crop-source.mjs";
import { captureAttempts } from "./crop-attempts.mjs";
import { sourcePixelStats, pixelRefusal } from "./crop-source-pixels.mjs";
import { hash } from "./support.mjs";
const { values: v } = parseArgs({
  options: { report: { type: "string" }, output: { type: "string" } },
});
assert(
  v.report && v.output,
  "Use --report <summary.json> --output <audit.json>",
);
const path = resolve(v.report),
  root = dirname(path),
  raw = await readFile(path),
  report = parseReportBytes(raw),
  rows = pipelineCrops(report, hash(raw));
assert(
  report.mode === "strict" && report.subset === "full",
  "Bind audit requires a full strict C1 report",
);
const browser = await launch(),
  results = [];
try {
  for (const [i, row] of rows.entries()) {
    if (!row.supported) {
      results.push({ ...row, status: "not-implemented" });
      continue;
    }
    const medium = row.scope.medium,
      ref = pinnedSource(report, row);
    row.sourceRender = {
      medium,
      [medium]: ref.path,
      [medium + "Sha256"]: ref.sha256,
      ...(medium === "pdf" ? pdfFacts(ref) : {}),
    };
    const source = await readCropSource(root, row),
      attempts = [],
      references = new Map();
    try {
      if (medium === "pdf")
        Object.assign(
          row,
          await (
            await import("./pdf-source.mjs")
          ).preparePdfCrop(source.bytes, row),
        );
      // This uses the builder's fresh capture operation, without inventing instance geometry.
      const capture =
        medium === "pdf"
          ? async () =>
              (await import("./pdf-source.mjs")).capturePdfCrop(
                source.bytes,
                row,
              )
          : () => captureSourceCrop(browser, source.text, row);
      const evidence = await capture();
      const pipelineStats =
        medium === "pdf"
          ? null
          : sourcePixelStats(
              await readFile(join(root, row.pipelineCrop)),
              evidence,
            );
      const selectedAttempt = await captureAttempts(
        evidence,
        0,
        capture,
        references,
        attempts,
      );
      results.push({
        ...row,
        status: "pass",
        evidenceSha256: hash(evidence),
        pipelineStats,
        pipelineRefusal: pipelineStats ? pixelRefusal(pipelineStats) : null,
        selectedAttempt,
        attempts,
      });
    } catch (error) {
      results.push({ ...row, status: "fail", reason: error.message, attempts });
    }
    if (i % 50 === 0) process.stdout.write(`${i + 1}/${rows.length}\n`);
  }
} finally {
  await browser.close();
}
const data = {
  format: "thermite-draw-fresh-bind-audit/1.0",
  reportSha256: hash(raw),
  supported: results.filter((r) => r.supported).length,
  unsupported: results.filter((r) => !r.supported).length,
  refusals: results.filter((r) => r.status === "fail").length,
  pipelineRefusals: results.filter((r) => r.pipelineRefusal).length,
  results,
};
await writeFile(resolve(v.output), JSON.stringify(data, null, 2) + "\n", {
  flag: "wx",
});
console.log(JSON.stringify({ ...data, results: undefined }));
assert(data.refusals === 0, "Fresh-source bind audit has false refusals");
