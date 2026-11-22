// Explicitly report-only: this entry point never feeds strict assessment/pins.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readReportFile } from "./report-file.mjs";
import { readCheckpointCaseFiles } from "./case-files.mjs";
import {
  launch,
  drawingLaunchArgs,
  drawingContextOptions,
} from "./browser.mjs";
import { json } from "./support.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { EVALS_VERSION } from "./version.mjs";
import { measureExposureCase } from "./navigation-exposure-capture.mjs";
const { values } = parseArgs({
  options: { capture: { type: "string" }, out: { type: "string" } },
});
assert(
  values.capture && values.out,
  "Use --capture <strict checkpoint> --out <new JSON>",
);
const directory = resolve(values.capture),
  report = await readReportFile(join(directory, "summary.json.gz")),
  readCaseFile = await readCheckpointCaseFiles(directory),
  rows = [],
  sources = [];
let browser, context;
try {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  const page = await context.newPage();
  assert.equal(
    browser.version(),
    report.value.browser,
    "Exposure must use the capture's Chromium build",
  );
  for (const id of report.value.cases) {
    rows.push(
      ...(await measureExposureCase(
        readCaseFile,
        id,
        report.value,
        page,
        sources,
      )),
    );
    console.log(id);
  }
} finally {
  await context?.close();
  await browser?.close();
}
const counts = {};
for (const r of rows) {
  counts[r.owner] ??= {};
  counts[r.owner][r.assessment] = (counts[r.owner][r.assessment] ?? 0) + 1;
}
const result = {
  format: "navigation-exposure/1",
  evalsVersion: EVALS_VERSION,
  checkerSha256: checkerManifestHash(
    await readCheckers(dirname(fileURLToPath(import.meta.url))),
  ),
  engine: report.value.engine,
  reportSha256: report.sha256,
  browser: report.value.browser,
  arguments: drawingLaunchArgs,
  strict: false,
  repinNow: false,
  scope:
    "Native source/request selection plus measured SVG only; HTML/PDF are not independently certified.",
  counts,
  rows,
  sources,
};
const bytes = Buffer.from(json(result));
assert(
  bytes.length <= 5000000,
  "Exposure receipt exceeds 5 MB; stop rather than omit rows",
);
await writeFile(resolve(values.out), bytes, { flag: "wx" });
if (rows.some((r) => r.assessment === "infrastructure-error"))
  process.exitCode = 2;
console.log(json({ counts, bytes: bytes.length }));
