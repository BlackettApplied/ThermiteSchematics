import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { comparison, operations, workloads } from "./measure.mjs";

export const write = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
export function validateBaseline(baseline) {
  assert.equal(baseline.format, "thermite-perf-baseline/1");
  assert.equal(baseline.measurement.rows.length, 4);
  for (const [name, views] of Object.entries(workloads)) {
    for (const operation of operations) {
      const rows = baseline.measurement.rows.filter(
        (r) => r.name === name && r.operation === operation,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].views, views);
      comparison(rows[0].baseMedianMs, rows[0].headMedianMs);
    }
  }
}
export function contextWarnings(baseline, machine, loads) {
  const warnings = [];
  if (baseline && JSON.stringify(baseline.machine) !== JSON.stringify(machine))
    warnings.push(
      "Historical context was measured on a different machine/runtime class; live base and head are measured together here.",
    );
  if (loads[0] > machine.logicalCpus * 0.5)
    warnings.push(
      `High load: 1-minute average ${loads[0].toFixed(2)} exceeds half of ${machine.logicalCpus} logical CPUs; expect timing noise.`,
    );
  return warnings;
}
export function printComparison(result, baseline, iteration) {
  for (const row of result.rows) {
    const pinned = baseline?.measurement.rows.find(
      (r) => r.name === row.name && r.operation === row.operation,
    );
    for (const [attempt, measurement] of row.measurements.entries())
      console.log(
        `${iteration + 1} ${row.name} ${row.operation} measurement ${attempt + 1}: base ${measurement.baseMedianMs.toFixed(2)} ms, head ${measurement.headMedianMs.toFixed(2)} ms, ${((measurement.ratio - 1) * 100).toFixed(1)}% ${measurement.pass ? "PASS" : "FAIL"}${pinned ? ` (historical ${pinned.baseMedianMs.toFixed(2)} ms)` : ""}`,
      );
    if (row.measurements.length > 1)
      console.log(
        `  Confirmed row: ${row.pass ? "PASS" : "FAIL"} (both measurements retained)`,
      );
  }
}
export function finish(report, values, started) {
  report.loadAfter = loadavg();
  report.elapsedMs = performance.now() - started;
  report.failedComparisons = report.comparisons.filter((r) => !r.pass).length;
  report.pass = report.failedComparisons === 0;
  if (values["self-check"])
    report.falsePositiveRate =
      report.failedComparisons / report.comparisons.length;
  if (values.output) write(values.output, report);
  if (values["record-baseline"]) {
    assert(
      report.pass,
      "Context self-comparison unstable; retain evidence and retry under quieter load",
    );
    write(values["record-baseline"], {
      format: "thermite-perf-baseline/1",
      revision: report.headRevision,
      createdAt: report.createdAt,
      machine: report.machine,
      loadBefore: report.loadBefore,
      loadAfter: report.loadAfter,
      measurement: report.comparisons[0],
    });
  }
  console.log(
    `${report.mode}: ${report.failedComparisons}/${report.comparisons.length} failed; ${(report.elapsedMs / 1000).toFixed(1)} s; load ${report.loadBefore.join("/")} -> ${report.loadAfter.join("/")}`,
  );
  if (!report.pass) process.exitCode = 1;
}
