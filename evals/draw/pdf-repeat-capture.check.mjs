// Ten separate processes: full PDF preparation and fresh verification each time.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compareRepeats } from "./repeat-capture-stats.mjs";
const { values: v } = parseArgs({
  options: { report: { type: "string" }, output: { type: "string" } },
});
assert(
  v.report && v.output,
  "Use --report <summary.json> --output <pdf-repeats.json>",
);
const directory = join(
  dirname(resolve(v.output)),
  basename(v.output) + ".captures",
);
await mkdir(directory);
const launches = [];
for (let run = 1; run <= 10; run++) {
  const output = join(directory, `launch-${run}.json`),
    samples = join(directory, `launch-${run}`),
    p = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("pdf-evidence.check.mjs", import.meta.url)),
        "--report",
        resolve(v.report),
        "--output",
        output,
        "--samples",
        samples,
      ],
      { encoding: "utf8" },
    );
  assert(
    p.status === 0,
    "PDF repeat launch failed: " + p.stderr + "\n" + p.stdout,
  );
  const data = JSON.parse(await readFile(output));
  assert(
    data.rows === 238 && data.comparisons >= 714 && data.refusals === 0,
    "Incomplete PDF repeat launch",
  );
  launches.push(data);
  console.log(
    `PDF process launch ${run}/10: ${data.rows} rows, ${data.comparisons} comparisons`,
  );
}
const results = [];
for (const [i, row] of launches[0].results.entries()) {
  assert(
    launches.every(
      (d) =>
        d.results[i].row === row.row &&
        d.originalReportSha256 === launches[0].originalReportSha256 &&
        d.calibrationReportSha256 === launches[0].calibrationReportSha256,
    ),
    "PDF repeat identity differs",
  );
  const samples = await Promise.all(
    launches.map((_, n) =>
      readFile(join(directory, `launch-${n + 1}`, `${i}.png`)),
    ),
  );
  results.push({
    row: row.row,
    cropShape: row.verification.cropShape,
    ...compareRepeats(samples),
  });
}
const data = {
  format: "thermite-draw-pdf-repeats/1.0",
  applyTarget: false,
  originalReportSha256: launches[0].originalReportSha256,
  calibrationReportSha256: launches[0].calibrationReportSha256,
  capture: launches[0].capture,
  processLaunches: 10,
  rows: results.length,
  comparisons: launches.reduce((n, d) => n + d.comparisons, 0),
  nonidentical: results.filter((r) => r.variants > 1).length,
  refusals: results.filter((r) => !r.withinBindLimits).length,
  results,
};
await writeFile(resolve(v.output), JSON.stringify(data, null, 2) + "\n", {
  flag: "wx",
});
console.log(JSON.stringify({ ...data, results: undefined }));
assert(
  !data.refusals,
  "PDF cross-process repeat noise exceeds unchanged limits",
);
