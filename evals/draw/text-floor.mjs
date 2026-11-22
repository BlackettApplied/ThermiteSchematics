// Standalone literal all-text floor census; deliberately not a strict criterion.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { browserPath } from "./chromium-path.mjs";
import { deliveredTextRuns, domFunctions } from "./text-floor-dom.mjs";
import { textSource, attributePdfRuns } from "./text-floor-source.mjs";
import { pdfFloorRuns } from "./text-floor-pdf.mjs";
export const belowFloor = (run) => run.emMm < 2.5 - 0.000001;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function browserFloorRuns(page, bytes) {
  await page.setContent(bytes.toString(), { waitUntil: "load" });
  await page.evaluate(async () => document.fonts.ready);
  const helpers = Object.fromEntries(
    Object.entries(domFunctions).map(([key, fn]) => [key, fn.toString()]),
  );
  const runs = await page.evaluate(
    ({ main, helpers }) => {
      const h = Object.fromEntries(
        Object.entries(helpers).map(([key, body]) => [
          key,
          new Function(`return (${body});`)(),
        ]),
      );
      return new Function("h", `return (${main})(h);`)(h);
    },
    { main: deliveredTextRuns.toString(), helpers },
  );
  return runs.map((run) => ({
    ...run,
    ...textSource(run),
  }));
}
async function readSource(path) {
  const bytes = await readFile(path);
  return {
    bytes,
    decoded: path.endsWith(".gz") ? gunzipSync(bytes) : bytes,
    sha256: hash(bytes),
  };
}
function totals(runs) {
  const byRoleAndSize = {};
  for (const run of runs) {
    const key = `${run.role} | ${run.emMm.toFixed(6)} mm`;
    const row = (byRoleAndSize[key] ??= { runs: 0, below: 0, sourceSites: [] });
    row.runs++;
    row.below += Number(belowFloor(run));
    if (!row.sourceSites.includes(run.sourceSite))
      row.sourceSites.push(run.sourceSite);
  }
  return {
    runs: runs.length,
    below: runs.filter(belowFloor).length,
    minimumMm: Math.min(...runs.map((r) => r.emMm)),
    byRoleAndSize,
  };
}
async function censusCase(capture, output, pins, page, id) {
  const rows = pins.filter((p) => p.case === id),
    svg = [],
    sources = [];
  for (const pin of rows) {
    const src = await readSource(join(capture, pin.svg.path));
    assert.equal(src.sha256, pin.svg.sha256, "SVG source hash mismatch");
    const runs = await browserFloorRuns(page, src.decoded);
    assert(runs.length, "Empty SVG census");
    svg.push(...runs);
    sources.push({ medium: "svg", sheet: pin.sheet, sha256: src.sha256 });
  }
  const h = await readSource(join(capture, rows[0].html.path));
  // Current compact retention hashes the uncompressed delivered HTML.
  assert(
    [hash(h.bytes), hash(h.decoded)].includes(rows[0].html.sha256),
    "HTML source hash mismatch",
  );
  const html = await browserFloorRuns(page, h.decoded);
  const p = await readSource(join(capture, rows[0].pdf.path));
  assert.equal(p.sha256, rows[0].pdf.sha256, "PDF source hash mismatch");
  const pdf = attributePdfRuns(await pdfFloorRuns(p.decoded), svg);
  const media = { svg, html, pdf };
  const result = {
    case: id,
    sheets: rows.length,
    sources: [
      ...sources,
      { medium: "html", sha256: hash(h.decoded) },
      { medium: "pdf", sha256: p.sha256 },
    ],
    media: Object.fromEntries(
      Object.entries(media).map(([k, v]) => [k, totals(v)]),
    ),
  };
  const compressed = gzipSync(JSON.stringify({ case: id, media }) + "\n", {
    level: 9,
  });
  assert(compressed.length <= 5_000_000, "Receipt exceeds 5 MB");
  await writeFile(join(output, id + ".runs.json.gz"), compressed);

  return result;
}
export async function censusCapture(capture, output) {
  await mkdir(output, { recursive: true });
  const report = JSON.parse(
    (
      await readSource(join(capture, "summary.json.gz")).catch(() =>
        readSource(join(capture, "summary.json")),
      )
    ).decoded,
  );
  const pins = report.sourceHashes.sheets;
  const cases = [...new Set(pins.map((p) => p.case))],
    summary = [];
  const browser = await chromium.launch({
    executablePath: await browserPath(),
    headless: true,
  });
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: "block",
    javaScriptEnabled: false,
    viewport: { width: 1800, height: 1800 },
  });
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  await page.emulateMedia({ media: "print" });
  try {
    for (const id of cases) {
      const result = await censusCase(capture, output, pins, page, id);
      summary.push(result);
      await writeFile(
        join(output, "summary.json"),
        JSON.stringify(
          {
            method:
              "literal vertical physical em; print-media DOM CTM; native PDF.js content stream font transforms; 1e-6 mm numerical tolerance; no role exemptions",
            capture,
            cases: summary,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        id,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(result.media).map(([k, v]) => [
              k,
              { runs: v.runs, below: v.below, minimumMm: v.minimumMm },
            ]),
          ),
        ),
      );
    }
  } finally {
    await browser.close();
  }
  return summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: { capture: { type: "string" }, output: { type: "string" } },
  });
  assert(
    values.capture && values.output,
    "Use --capture <strict capture> --output <fresh census directory>",
  );
  const result = await censusCapture(
    resolve(values.capture),
    resolve(values.output),
  );
  if (result.some((c) => Object.values(c.media).some((m) => m.below)))
    process.exitCode = 1;
}
