import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// Parse --engine before importing any checker or engine module.
const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    checkpoint: { type: "string" },
    engine: { type: "string" },
    "report-only": { type: "boolean", default: false },
    conflicts: { type: "string", default: "100" },
    samples: { type: "string", default: "5" },
  },
});
assert(
  values.checkpoint &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.checkpoint),
  "Use --checkpoint <portable-name>",
);
process.env.THERMITE_EVAL_ENGINE = await realpath(
  resolve(values.engine ?? root),
);
const { engineRoot } = await import("./engine/engine.mjs");
const { oracle } = await import("./engine/oracle.mjs");
const { validation } = await import("./engine/validation.mjs");
const { diagnostics, actionabilityMetric } =
  await import("./engine/diagnostics.mjs");
const { contracts } = await import("./engine/contracts.mjs");
const { determinism } = await import("./engine/determinism.mjs");
const { perf } = await import("./engine/perf.mjs");
const { verifyCorpus } = await import("./engine/provenance.mjs");
const { exitCode } = await import("./engine/assessment.mjs");
const { json, version, sha256, portable } =
  await import("./engine/support.mjs");
const conflicts = Number(values.conflicts),
  samples = Number(values.samples);
assert(Number.isInteger(conflicts) && conflicts >= 1 && conflicts <= 1000);
assert(Number.isInteger(samples) && samples >= 1 && samples <= 100);
const destination = join(root, "evals/out", values.checkpoint);
await mkdir(destination, { recursive: true });
assert.equal(
  (await readdir(destination)).length,
  0,
  "Checkpoint already contains evidence; choose a new name",
);
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
assert.equal(
  await realpath(git(engineRoot, "rev-parse", "--show-toplevel")),
  engineRoot,
  "--engine must be a checkout root with its own Git identity",
);
const corpus = await verifyCorpus();
const checkers = await Promise.all(
  [
    "run.mjs",
    ...(await readdir(join(root, "evals/engine")))
      .filter((name) => name.endsWith(".mjs"))
      .sort()
      .map((name) => `engine/${name}`),
  ].map(async (path) => ({
    path,
    sha256: sha256(await readFile(join(root, "evals", path))),
  })),
);
const metadata = {
  format: "thermite-engine-eval/1.0",
  evalsVersion: version,
  checkpoint: values.checkpoint,
  mode: values["report-only"] ? "replay" : "strict",
  reportOnly: values["report-only"],
  engine: {
    commit: git(engineRoot, "rev-parse", "HEAD"),
    dirty:
      git(
        engineRoot,
        "status",
        "--porcelain",
        "--",
        "packages",
        "libraries",
        "scripts",
        "thermite.mjs",
        "package.json",
        "bun.lock",
      ).length > 0,
  },
  evals: {
    commit: git(root, "rev-parse", "HEAD"),
    dirty:
      git(root, "status", "--porcelain", "--", "evals", "vitest.config.mjs")
        .length > 0,
    manifestSha256: corpus.sha256,
    checkers,
  },
  runtime: `Bun ${Bun.version}`,
  platform: `${process.platform}-${process.arch}`,
  conflicts,
  samples,
  corpus,
};
const results = {};
for (const [name, run] of Object.entries({
  oracle,
  "P-validation": validation,
  "P-diag": diagnostics,
  "P-contract": () => contracts({ conflicts }),
  "P-determinism": determinism,
  "P-perf": () => perf(samples),
})) {
  process.stdout.write(`${name}…\n`);
  try {
    results[name] = await run();
  } catch (error) {
    results[name] = [
      {
        id: `${name}/harness`,
        status:
          error.code === "ERR_ASSERTION" ? "fail" : "infrastructure-error",
        failure: error.message,
      },
    ];
  }
  await writeFile(
    join(destination, "summary.json"),
    json(portable({ ...metadata, results })),
  );
}
const counts = (rows) =>
  Object.fromEntries(
    [
      "pass",
      "xfail",
      "xpass",
      "fail",
      "not-overlapped",
      "infrastructure-error",
    ].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );
const summary = Object.fromEntries(
  Object.entries(results).map(([name, rows]) => [name, counts(rows)]),
);
summary["P-diag"].actionability = actionabilityMetric(results["P-diag"]);
const code = exitCode(results, values["report-only"]);
await writeFile(
  join(destination, "summary.json"),
  json(portable({ ...metadata, exitCode: code, summary, results })),
);
const lines = [
  `# Engine checkpoint ${values.checkpoint}`,
  "",
  `Evals v${version}; mode: ${metadata.mode}; ${metadata.runtime}; ${metadata.platform}.`,
  `Engine ${metadata.engine.commit} (dirty: ${metadata.engine.dirty}); evals ${metadata.evals.commit} (dirty: ${metadata.evals.dirty}).`,
  "",
  "| Probe | Pass | Expected fail | Stale marker (xpass) | Fail | Not overlapped | Infrastructure |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...Object.entries(summary).map(
    ([name, c]) =>
      `| ${name} | ${c.pass} | ${c.xfail} | ${c.xpass} | ${c.fail} | ${c["not-overlapped"]} | ${c["infrastructure-error"]} |`,
  ),
  "",
];
const rate = summary["P-diag"].actionability;
lines.push(
  `P-diag actionable: ${rate.actionable}/${rate.total} (${rate.percentage.toFixed(2)}%).`,
  "",
);
for (const row of results["P-perf"].filter((r) => r.status === "pass"))
  lines.push(
    `${row.id}: warm median of ${samples}, compile ${row.evidence.compileMedianMs.toFixed(2)} ms; packet ${row.evidence.packetMedianMs.toFixed(2)} ms (${row.evidence.sheets} sheets). Informational timing.`,
    "",
  );
for (const [suite, rows] of Object.entries(results)) {
  lines.push(
    `## ${suite} observations`,
    "",
    "| Case | Status | Gap / failure |",
    "| --- | --- | --- |",
  );
  for (const row of rows)
    lines.push(
      `| ${row.id} | ${row.status} | ${[row.failure, row.gap && `${row.gap.owner}: ${row.gap.reason}`].filter(Boolean).join("; ").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
    );
  lines.push("");
}
lines.push(
  "Strict mode fails on every xpass (stale expectation: retire marker), unexpected failure, or round without overlap. Replay mode preserves all statuses and still fails on infrastructure errors. Expected gaps are evidence, not awarded scores.",
  "",
);
await writeFile(join(destination, "summary.md"), portable(lines.join("\n")));
process.stdout.write(json(summary));
process.exitCode = code;
