import { parseReportBytes } from "./report-file.mjs";
// GPU-disabled comparison for gates only; does not replace either report's PNGs.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  pairedRegions,
  compareSamples,
  GATE_MODE,
} from "./paired-raster-plan.mjs";
import {
  checkSampleCount,
  evaluateEnvelope,
} from "./paired-raster-envelope.mjs";
import { captureGateRegion } from "./paired-raster-capture.mjs";
import { hash } from "./support.mjs";

export async function compareCapturedPair(
  baseRoot,
  baseReport,
  region,
  paired,
  N = 10,
) {
  checkSampleCount(N);
  const self = [];
  if (!compareSamples(...paired).byteIdentical)
    for (let i = 0; i < N; i++)
      self.push(await captureGateRegion(baseRoot, baseReport, region));
  return {
    ...region,
    ...evaluateEnvelope(...paired, self, N),
    baseSourceSha256: paired[0].sourceSha256,
    headSourceSha256: paired[1].sourceSha256,
  };
}

async function compareRegion(paths, reports, region, N) {
  const paired = [];
  for (let side = 0; side < 2; side++)
    paired.push(
      await captureGateRegion(dirname(paths[side]), reports[side], region),
    );
  return compareCapturedPair(dirname(paths[0]), reports[0], region, paired, N);
}

export async function compareReports(basePath, headPath, output, N = 10) {
  checkSampleCount(N);
  const paths = [basePath, headPath].map((p) => resolve(p));
  const raw = await Promise.all(paths.map((p) => readFile(p))),
    reports = raw.map((b) => parseReportBytes(b));
  const regions = pairedRegions(...reports),
    results = [];
  // Never overwrite a previous gate receipt or write into an input capture.
  if (output) {
    assert(
      !paths.includes(resolve(output)),
      "Output would overwrite an input report",
    );
    await access(output).then(
      () => {
        throw Error("Output already exists");
      },
      (e) => {
        if (e.code !== "ENOENT") throw e;
      },
    );
  }
  for (const region of regions)
    results.push(await compareRegion(paths, reports, region, N));
  const data = {
    format: "thermite-draw-paired-raster/1.1",
    mode: GATE_MODE,
    base: { report: paths[0], sha256: hash(raw[0]) },
    head: { report: paths[1], sha256: hash(raw[1]) },
    requestedN: N,
    regions: results.length,
    pass: results.every((r) => r.pass),
    byteIdentical: results.every((r) => r.byteIdentical),
    results,
  };
  if (output) {
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, JSON.stringify(data, null, 2) + "\n", {
      flag: "wx",
    });
  }
  return data;
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      base: { type: "string" },
      head: { type: "string" },
      output: { type: "string" },
      samples: { type: "string", default: "10" },
    },
  });
  assert(
    v.base && v.head && v.output,
    "Use --base <strict.json> --head <strict.json> --output <gate.json>",
  );
  const data = await compareReports(
    v.base,
    v.head,
    v.output,
    Number(v.samples),
  );
  process.stdout.write(
    JSON.stringify({
      mode: data.mode,
      regions: data.regions,
      byteIdentical: data.byteIdentical,
      pass: data.pass,
    }) + "\n",
  );
  process.exitCode = data.pass ? 0 : 1;
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href)
  main().catch((error) => {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 2;
  });
