import { parseReportBytes } from "./report-file.mjs";
// Full-corpus evidence: compare pipeline PNGs without re-capturing or replacing them.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { launch, drawingContextOptions } from "./browser.mjs";
import { readCropSource, renderSourceCrop } from "./crop-source.mjs";
import {
  sourcePixelStats,
  compareSourcePixels,
} from "./crop-source-pixels.mjs";
import { pipelineCrops } from "./crop-index.mjs";
import { pinnedSource } from "./source-hashes.mjs";
import { hash, json } from "./support.mjs";
const { values: v } = parseArgs({
  options: {
    report: { type: "string" },
    output: { type: "string" },
    passes: { type: "string", default: "2" },
  },
});
if (!v.report || !v.output)
  throw Error("Use --report <summary.json> --output <audit.json> [--passes 2]");
const path = resolve(v.report),
  root = dirname(path),
  raw = await readFile(path),
  report = parseReportBytes(raw),
  rows = pipelineCrops(report, hash(raw));
const browser = await launch(),
  results = [],
  passes = Number(v.passes);
try {
  const context = await browser.newContext(drawingContextOptions),
    page = await context.newPage();
  await page.emulateMedia({ media: "print" });
  for (const [n, row] of rows.entries()) {
    if (!row.supported || row.scope.medium === "pdf") {
      results.push({
        ...row,
        supported: false,
        status: "not-in-this-audit",
        reason:
          row.scope.medium === "pdf"
            ? "Pipeline-PNG comparison covers SVG/HTML; use pdf-evidence.check.mjs for exported PDF instance boxes"
            : row.reason,
      });
      continue;
    }
    const medium = row.scope.medium,
      ref = pinnedSource(report, row);
    row.sourceRender = {
      medium,
      [medium]: ref.path,
      [medium + "Sha256"]: ref.sha256,
    };
    const input = await readFile(join(root, row.pipelineCrop)),
      source = await readCropSource(root, row),
      samples = [];
    let prior;
    for (let i = 0; i < passes; i++) {
      try {
        const raster = await renderSourceCrop(page, source.text, row),
          stats = sourcePixelStats(input, raster);
        let error;
        try {
          compareSourcePixels(input, raster);
        } catch (e) {
          error = e.message;
        }
        samples.push({
          ...stats,
          refusal: error,
          repeat: prior ? sourcePixelStats(prior, raster) : undefined,
        });
        prior = raster;
      } catch (e) {
        samples.push({ error: e.message });
      }
    }
    results.push({
      ...row,
      samples,
      status: samples.some((s) => s.error || s.refusal) ? "fail" : "pass",
    });
    if (n % 50 === 0) process.stdout.write(`${n + 1}/${rows.length}\n`);
  }
} finally {
  await browser.close();
}
const data = {
  format: "thermite-draw-crop-audit/1.0",
  reportSha256: hash(raw),
  rows: results.length,
  supported: results.filter((r) => r.supported).length,
  unsupported: results.filter((r) => !r.supported).length,
  refusals: results.filter((r) => r.status === "fail").length,
  results,
};
await writeFile(resolve(v.output), json(data), { flag: "wx" });
process.stdout.write(
  json({
    rows: data.rows,
    supported: data.supported,
    unsupported: data.unsupported,
    refusals: data.refusals,
  }),
);
