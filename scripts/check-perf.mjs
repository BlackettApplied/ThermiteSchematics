import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  machineClass,
  measurePair,
  startWorker,
  sampleCounts,
} from "./perf-gate/measure.mjs";
import {
  buildEngine,
  prepareBase,
  resolveBaseRevision,
  verifyBase,
} from "./perf-gate/checkout.mjs";
import { git, lifecycle } from "./perf-gate/lifecycle.mjs";
import { PerfFailure } from "./perf-gate/errors.mjs";
import {
  contextWarnings,
  finish,
  printComparison,
  validateBaseline,
} from "./perf-gate/report.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export function options(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      "base-engine": { type: "string" },
      "base-rev": { type: "string" },
      "head-engine": { type: "string", default: root },
      baseline: {
        type: "string",
        default: join(root, "scripts/perf-baseline.json"),
      },
      output: { type: "string" },
      "self-check": { type: "string" },
      "record-baseline": { type: "string" },
      seed: { type: "string", default: "20261116" },
    },
  });
  const repetitions = values["self-check"] ? Number(values["self-check"]) : 1;
  assert(
    Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 100,
  );
  const seed = Number(values.seed);
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  assert(!(values["record-baseline"] && values["self-check"]));
  assert(
    !(
      values["base-engine"] &&
      (values["record-baseline"] || values["self-check"])
    ),
  );
  assert(
    !(
      values["base-rev"] &&
      (values["record-baseline"] || values["self-check"])
    ),
  );
  return { values, repetitions, seed };
}
async function pair(basePath, headPath, owner, seed) {
  const base = startWorker(basePath, "base", owner);
  const head = startWorker(headPath, "head", owner);
  try {
    return await measurePair(base, head, { seed });
  } finally {
    base.close();
    head.close();
  }
}
function newReport(values, headPath, machine, baseRevision, baseline) {
  const loads = loadavg();
  const warnings = contextWarnings(baseline, machine, loads);
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  return {
    format: "thermite-perf-gate/2",
    mode: values["record-baseline"]
      ? "baseline"
      : values["self-check"]
        ? "head-vs-head"
        : "gate",
    createdAt: new Date().toISOString(),
    machine,
    loadBefore: loads,
    warnings,
    headRevision: git(headPath, "rev-parse", "HEAD"),
    headStatus: git(headPath, "status", "--porcelain"),
    baseRevision,
    baseSelection:
      values["base-rev"] ??
      (values["self-check"] || values["record-baseline"]
        ? "head"
        : "merge-base HEAD origin/dev"),
    contextRevision: baseline?.revision ?? null,
    thresholdRatio: 1.2,
    samples: sampleCounts,
    comparisons: [],
  };
}
export async function main(args) {
  const started = performance.now();
  const { values, repetitions, seed } = options(args);
  const headPath = realpathSync(resolve(values["head-engine"]));
  const self = values["self-check"] || values["record-baseline"];
  const baseRevision = self
    ? git(headPath, "rev-parse", "HEAD")
    : resolveBaseRevision(headPath, values["base-rev"]);
  const baseline = values["record-baseline"]
    ? null
    : JSON.parse(readFileSync(values.baseline));
  if (baseline) validateBaseline(baseline);
  const report = newReport(
    values,
    headPath,
    machineClass(),
    baseRevision,
    baseline,
  );
  const owner = lifecycle(headPath);
  let primaryError;
  try {
    if (values["record-baseline"]) verifyBase(headPath, baseRevision);
    // Always rebuild, including a cached --base-engine. mtimes cannot prove
    // that ignored dist corresponds to the current source and build settings.
    console.log("Building head before timing…");
    await buildEngine(headPath, "head", owner);
    const basePath = await prepareBase(values, headPath, baseRevision, owner);
    for (let iteration = 0; iteration < repetitions; iteration++) {
      const result = await pair(
        basePath,
        headPath,
        owner,
        (seed + iteration) >>> 0,
      );
      report.comparisons.push(result);
      printComparison(result, baseline, iteration);
    }
    finish(report, values, started);
    return report;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const failures = owner.cleanup();
    owner.dispose();
    if (failures.length) {
      const message = `Perf cleanup: ${failures.join("; ")}`;
      if (primaryError) console.error(message);
      else throw new PerfFailure(message);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 2;
  });
