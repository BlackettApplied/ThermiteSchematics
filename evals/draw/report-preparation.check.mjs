// Real full-report acceptance and in-memory omission controls; never apply.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cases } from "./corpus.mjs";
import { loadRepinInputs } from "./repin-io.mjs";
import { reviewInventory, reassess } from "./repin-core.mjs";
import { hash, json } from "./support.mjs";

function recount(inputs, report) {
  const a = reassess(report, inputs.registry, inputs.specs);
  Object.assign(report, {
    results: a.rows,
    summary: a.summary,
    drift: a.drift,
    exitCode: a.exitCode,
  });
}
function refuses(name, inputs, mutate, pattern) {
  const probe = {
    ...inputs,
    report: structuredClone(inputs.report),
    baselines: new Map(
      [...inputs.baselines].map(([sha, r]) => [sha, structuredClone(r)]),
    ),
  };
  const detail = mutate(probe);
  try {
    reviewInventory(probe);
  } catch (error) {
    assert.match(error.message, pattern, name);
    return { name, detail, refused: true, reason: error.message };
  }
  assert.fail(`Accepted negative control: ${name}`);
}
function coverageControls(inputs) {
  const applicable = inputs.report.results.find(
    (r) => r.dq === "DQ-07" && !r.expectation && r.status === "pass",
  );
  const absent = inputs.report.results.find(
    (r) => r.dq === "DQ-07" && r.id.endsWith("/not-applicable"),
  );
  assert(applicable && absent, "Real report needs applicable and absent cases");
  return [
    refuses(
      "omit one applicable observation",
      inputs,
      (p) => {
        p.report.results = p.report.results.filter(
          (r) => r.id !== applicable.id,
        );
        return { omitted: [applicable.id], recount: false };
      },
      /Report (statuses|summary|drift) do not match|Report summary does not match|Missing check observation/,
    ),
    ...[applicable, absent].map((row) =>
      refuses(
        `omit ${row === absent ? "not-applicable" : "applicable"} case coverage with consistent counters`,
        inputs,
        (p) => {
          const omitted = p.report.results
            .filter(
              (r) => r.case === row.case && r.dq === "DQ-07" && !r.expectation,
            )
            .map((r) => r.id);
          p.report.results = p.report.results.filter(
            (r) => !omitted.includes(r.id),
          );
          recount(p, p.report);
          return { omitted, recount: true };
        },
        /Missing check observation: .*DQ-7/,
      ),
    ),
  ];
}
function summaryControls(inputs) {
  const controls = [];
  for (const status of ["not-applicable", "not-measured"])
    controls.push(
      refuses(
        `missing nonzero 5.3 ${status}`,
        inputs,
        (p) => {
          const baseline = [...p.baselines.values()][0];
          const row = baseline.results.find(
            (r) => r.status === "pass" && !r.classification,
          );
          assert(row);
          row.status = status;
          recount(p, baseline);
          assert(baseline.summary[row.dq][status] > 0);
          delete baseline.summary[row.dq][status];
          return { syntheticStatus: status, row: row.id };
        },
        /Report summary does not match observations/,
      ),
    );
  controls.push(
    refuses(
      "unknown baseline summary version",
      inputs,
      (p) => {
        [...p.baselines.values()][0].evalsVersion = "5.999";
      },
      /Unsupported report summary version/,
    ),
  );
  for (const status of ["not-applicable", "not-measured"])
    controls.push(
      refuses(
        `missing zero current ${status}`,
        inputs,
        (p) => {
          const dq = Object.keys(p.report.summary).find(
            (dq) => p.report.summary[dq][status] === 0,
          );
          assert(dq);
          delete p.report.summary[dq][status];
          return { dq, status };
        },
        /Report summary does not match observations/,
      ),
    );
  return controls;
}
const { values } = parseArgs({
  options: {
    report: { type: "string" },
    baseline: { type: "string" },
  },
});
assert(
  values.report && values.baseline,
  "Use --report <fresh-full.json> --baseline <5.3-full.json>",
);
const root = fileURLToPath(new URL("../../", import.meta.url));
const inputs = await loadRepinInputs({
  root,
  reportPath: resolve(values.report),
  baselinePaths: [resolve(values.baseline)],
  specs: cases(),
});
const baseline = [...inputs.baselines.values()][0];
assert.equal(baseline.evalsVersion, "5.3");
const before = json({ report: inputs.report, baseline });
const inventory = reviewInventory(inputs);
const controls = [...coverageControls(inputs), ...summaryControls(inputs)];
assert.equal(
  json({ report: inputs.report, baseline }),
  before,
  "Controls mutated inputs",
);
assert.equal(hash(await readFile(values.report)), inputs.reportSha256);
assert.equal(
  hash(await readFile(values.baseline)),
  [...inputs.baselines.keys()][0],
);
process.stdout.write(
  json({
    format: "thermite-draw-report-preparation-check/1.0",
    reportSha256: inputs.reportSha256,
    baselineSha256: [...inputs.baselines.keys()][0],
    cases: inputs.report.cases.length,
    instances: inventory.current.length,
    historicalBytesAndPinsUnchanged: true,
    controls,
  }),
);
