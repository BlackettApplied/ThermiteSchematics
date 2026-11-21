import { parseReportBytes } from "./report-file.mjs";
// Opt-in browser check: compare every distinct raster across fresh launches.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  launch,
  drawingLaunchArgs,
  drawingContextOptions,
  screenshotCrop,
} from "./browser.mjs";
import { pipelineCrops } from "./crop-index.mjs";
import { readCropSource, renderSourceCrop } from "./crop-source.mjs";
import { pinnedSource } from "./source-hashes.mjs";
import { hash, json } from "./support.mjs";
import { compareRepeats } from "./repeat-capture-stats.mjs";

const { values: v } = parseArgs({
  options: {
    report: { type: "string" },
    output: { type: "string" },
    runs: { type: "string", default: "10" },
    case: { type: "string", multiple: true },
    "browser-arg": { type: "string", multiple: true },
    baseline: { type: "boolean", default: false },
    "fresh-page": { type: "boolean", default: false },
    "require-identical": { type: "boolean", default: false },
  },
});
assert(
  v.report && v.output,
  "Use --report <summary.json> --output <repeat.json>",
);
const runs = Number(v.runs);
assert(
  Number.isSafeInteger(runs) && runs >= 10,
  "Use at least 10 fresh launches",
);
const raw = await readFile(resolve(v.report)),
  report = parseReportBytes(raw),
  root = dirname(resolve(v.report)),
  selected = v.case ?? [
    "init-starter-left-to-right",
    "init-starter-top-to-bottom",
    "motor-starter-left-to-right",
    // Include the calibration's channel-delta and changed-fraction worst rows.
    "machine-demo-left-to-right",
    "machine-demo-top-to-bottom",
    "sweep-functional-symbols-a3-portrait-compact-left-to-right",
    "sweep-functional-symbols-letter-landscape-compact-left-to-right",
  ];
const rows = pipelineCrops(report, hash(raw)).filter(
  (r) =>
    r.supported &&
    ["svg", "html"].includes(r.scope.medium) &&
    selected.includes(r.scope.case),
);
for (const id of selected)
  assert(
    rows.some((r) => r.scope.case === id),
    `No SVG/HTML crops for ${id}`,
  );
const sources = await Promise.all(
  rows.map(async (row) => {
    const medium = row.scope.medium,
      ref = pinnedSource(report, row);
    row.sourceRender = {
      medium,
      [medium]: ref.path,
      [medium + "Sha256"]: ref.sha256,
    };
    return readCropSource(root, row);
  }),
);
const samples = rows.map(() => []),
  args = [
    ...(v.baseline ? [] : drawingLaunchArgs),
    ...(v["browser-arg"] ?? []),
  ];
let version;
for (let run = 0; run < runs; run++) {
  const browser = await launch(args);
  try {
    version = browser.version();
    const context = await browser.newContext(drawingContextOptions);
    let page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    for (const [i, row] of rows.entries()) {
      if (v["fresh-page"]) {
        await page.close();
        page = await context.newPage();
        await page.emulateMedia({ media: "print" });
      }
      samples[i].push(await renderSourceCrop(page, sources[i].text, row));
      // Capture the unchanged page too, covering the issue's same-page variants.
      const selector =
        row.scope.medium === "html"
          ? `#sheet-${row.physicalSheet}>svg`
          : "body>svg";
      samples[i].push(
        await screenshotCrop(page, row.sourceBbox, undefined, selector),
      );
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(
    `Fresh launch ${run + 1}/${runs}: ${rows.length} crops, twice each\n`,
  );
}
const results = rows.map((row, i) => ({
  ...row,
  ...compareRepeats(samples[i]),
}));
const data = {
  format: "thermite-draw-repeat-capture/1.0",
  reportSha256: hash(raw),
  platform: `${process.platform}-${process.arch}`,
  browser: version,
  browserArgs: args,
  freshPage: v["fresh-page"],
  context: drawingContextOptions,
  launches: runs,
  capturesPerCrop: runs * 2,
  crops: results.length,
  nonidentical: results.filter((r) => r.variants > 1).length,
  refusals: results.filter((r) => !r.withinBindLimits).length,
  results,
};
// Preserve fractional margins; the drawing report's 0.001 mm rounding is too
// coarse for pixel fractions and is not part of this measurement format.
await writeFile(resolve(v.output), JSON.stringify(data, null, 2) + "\n", {
  flag: "wx",
});
process.stdout.write(
  json({
    crops: data.crops,
    nonidentical: data.nonidentical,
    refusals: data.refusals,
  }),
);
assert(
  !data.refusals,
  "Repeat noise exceeds fixed bind limits; inspect output",
);
assert(
  !v["require-identical"] || !data.nonidentical,
  "PNG bytes differ; inspect output",
);
