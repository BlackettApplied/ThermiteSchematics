import { readReportFile, reportFilename } from "./report-file.mjs";
import { renderCase } from "./run-case.mjs";
import {
  strictCoverageReason,
  policyStatusCounts,
  statusTable,
} from "./report-status.mjs";
import { SOURCE_HASH_FORMAT } from "./source-hashes.mjs";
import { CAPTURE_FORMAT, EVALS_VERSION } from "./version.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { archiveCaseFiles } from "./case-files.mjs";
import { finalizeOutput } from "./output.mjs";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
  mkdtemp,
} from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  command,
  pool,
  json,
  readJson,
  canonical,
  stopCommands,
} from "./support.mjs";
import { cases, verifyCorpus, contentSeal } from "./corpus.mjs";
import { assess, exitCode, summary } from "./assessment.mjs";
import { expectations } from "./expectations.mjs";
import { launch } from "./browser.mjs";
import { nativeTool } from "./pdf.mjs";
import { sweepResults, observation } from "./evaluate.mjs";
import { attachIdentities } from "./locators.mjs";
import { criteria } from "./criteria.mjs";
import { gallery } from "./gallery.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)),
  kit = join(root, "evals/draw");
const { values } = parseArgs({
  options: {
    checkpoint: { type: "string" },
    quick: { type: "boolean", default: false },
    "report-only": { type: "boolean", default: false },
    rev: { type: "string" },
    engine: { type: "string" },
    artifacts: { type: "boolean", default: false },
    pdfkit: { type: "boolean", default: false },
    compare: { type: "string" },
    case: { type: "string" },
  },
});
assert(
  values.checkpoint &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.checkpoint),
  "Use --checkpoint <portable-name>",
);
assert(!(values.rev && values.engine), "Use either --rev or --engine");
assert(
  !values.rev || values["report-only"],
  "Historical --rev requires --report-only",
);
const dest = join(root, "evals/out/draw", values.checkpoint);
await mkdir(dest, { recursive: true });
assert.equal(
  (await readdir(dest)).length,
  0,
  "Checkpoint already contains evidence; choose a fresh name",
);
const started = performance.now();
let browser,
  replay,
  engine = await realpath(resolve(values.engine ?? root));
const git = async (cwd, ...args) => {
  const r = await command(cwd, "git", args);
  if (r.code !== 0) throw Error(r.stderr);
  return r.stdout.trim();
};
const relativeEvidence = (p) => relative(dest, p).split("\\").join("/");
const rows = [],
  results = [];
let interrupted = false;
const onSignal = () => {
  interrupted = true;
  stopCommands();
  void browser?.close();
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
let metadata,
  assessment = { drift: [] };
try {
  const corpus = await verifyCorpus(root, kit),
    corpusHash = corpus.seal;
  const reseal = await command(root, process.execPath, [
    join(kit, "seal.mjs"),
    "--output",
    join(dest, "corpus-seal.json"),
  ]);
  if (reseal.code !== 0) throw Error(reseal.stderr);
  if (corpus.changedFiles.length || corpus.inventoryChanged)
    process.stdout.write(
      `Corpus drift recorded: ${corpus.changedFiles.length} tracked inputs; checkpoint seal ${corpusHash}\n`,
    );
  if (
    !values["report-only"] &&
    `${process.platform}-${process.arch}` !== "darwin-arm64"
  )
    throw Error(
      "Strict drawing markers are calibrated on darwin-arm64. Use --report-only for portable measurement; browser-free check tests support Linux/Windows/macOS.",
    );
  if (values.rev) {
    const commit = await git(
      root,
      "rev-parse",
      "--verify",
      `${values.rev}^{commit}`,
    );
    replay = await mkdtemp(join(tmpdir(), "thermite-draw-replay-"));
    const add = await command(root, "git", [
      "worktree",
      "add",
      "--detach",
      replay,
      commit,
    ]);
    if (add.code !== 0) throw Error(add.stderr);
    engine = replay;
    for (const args of [
      ["install", "--frozen-lockfile"],
      ["run", "build"],
    ]) {
      process.stdout.write(`Historical engine: bun ${args.join(" ")}\n`);
      const r = await command(engine, process.execPath, args, 180000);
      await writeFile(join(dest, `replay-${args[0]}.log`), r.stdout + r.stderr);
      if (r.code !== 0)
        throw Error(`Historical ${args[0]} failed; see replay log`);
    }
  }
  await access(join(engine, "packages/cli/dist/alpha.js"));
  browser = await launch();
  const native = values.pdfkit ? await nativeTool(root) : null;
  const compiler = await import(
    pathToFileURL(join(engine, "packages/compiler/dist/index.js")).href
  );
  const query = await import(
    pathToFileURL(join(engine, "packages/query/dist/index.js")).href
  );
  // Explicit engine capability selects the historical print policy. Never
  // infer source identifiers from the report cell that is being measured.
  const identifierPolicy = {
    projection: typeof query.printedPort === "function" ? "authored" : "legacy",
    relationIdentity:
      typeof query.relationPrintIdentity === "function" ? "authored" : "legacy",
  };
  // Sheet SVGs in packet JSON carry only font family references. Apply the
  // built CLI's deterministic font delivery step before measuring standalone SVGs.
  let deliverSvg = (svg) => svg;
  try {
    const delivery = join(engine, "packages/cli/dist/printable-font.js");
    await access(delivery);
    deliverSvg = (await import(pathToFileURL(delivery).href))
      .embedPrintableFont;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const specs = cases(values.quick).filter(
    (c) => !values.case || c.id === values.case,
  );
  assert(specs.length, "Requested case is not in this corpus/subset");
  let comparison;
  if (values.compare) {
    const priorPath = resolve(values.compare),
      prior = (await readReportFile(priorPath)).value;
    const priorHash =
      prior.corpus?.contentHashVersion === 1
        ? prior.corpusSha256
        : contentSeal(
            await readJson(join(dirname(priorPath), "corpus-seal.json")),
          );
    comparison = {
      sameCorpus: priorHash === corpusHash,
      warning:
        priorHash === corpusHash
          ? null
          : "Different corpus seals: results are not a paired comparison",
    };
  }
  metadata = {
    format: CAPTURE_FORMAT,
    evalsVersion: EVALS_VERSION,
    evals: {
      commit: await git(root, "rev-parse", "HEAD"),
      dirty:
        (await git(root, "status", "--porcelain", "--", "evals/draw")).length >
        0,
    },
    mode: values["report-only"] ? "replay" : "strict",
    subset: values.case ? "selected" : values.quick ? "quick" : "full",
    corpusSha256: corpusHash,
    corpus: {
      contentHashVersion: 1,
      base: corpus.actual.base,
      referenceSha256: corpus.reference,
      changedFiles: corpus.changedFiles,
      inventoryChanged: corpus.inventoryChanged,
    },
    ...(comparison ? { comparison } : {}),
    artifacts: values.artifacts,
    engine: {
      commit: await git(engine, "rev-parse", "HEAD"),
      dirty:
        (
          await git(
            engine,
            "status",
            "--porcelain",
            "--",
            "packages",
            "libraries",
            "scripts",
            "thermite.mjs",
            "package.json",
            "bun.lock",
          )
        ).length > 0,
    },
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    browser: browser.version(),
    raster: { fullDpi: 96, cropDpi: 300, pdfjs: true, pdfkit: !!native },
    cases: specs.map((c) => c.id),
    criteria,
    sweepCells: values.quick || values.case ? 0 : 36,
    deferred: ["D packets: E2 outputs pending; not scored"],
    checkers: await readCheckers(kit),
  };
  metadata.checkerSha256 = checkerManifestHash(metadata.checkers);
  const cli = (args) =>
    command(engine, process.execPath, [join(engine, "thermite.mjs"), ...args]);
  const rendered = await pool(specs, (c, index) =>
    renderCase(c, index, {
      isInterrupted: () => interrupted,
      specs,
      dest,
      values,
      root,
      engine,
      cli,
      browser,
      native,
      compiler,
      query,
      identifierPolicy,
      deliverSvg,
      relativeEvidence,
    }),
  );
  results.push(...rendered);
  rows.push(
    ...rendered.flatMap((r) => r.rows),
    ...sweepResults(specs, rendered),
  );
  // Sweep observations are appended above; give their request-level failures identities.
  for (const row of rows.filter((r) => r.id.endsWith("/flow-comparison")))
    attachIdentities(
      [row],
      new Map(),
      {},
      {},
      specs.find((c) => c.id === row.case).project,
    );
  assessment = assess(rows, expectations, new Set(specs.map((c) => c.id)), {
    allCases: new Set(cases().map((c) => c.id)),
    caseStates: Object.fromEntries(
      rendered.map((r) => [
        r.case,
        {
          status: r.ok ? "rendered" : r.error ? "refused" : "infrastructure",
          sheets: r.sheets.map((s) => s.number),
          ...(r.instrumentation ? { instrumentation: r.instrumentation } : {}),
        },
      ]),
    ),
  });
} catch (error) {
  rows.push({
    id: "harness/infrastructure",
    status: "infrastructure-error",
    reason: error.message.replaceAll(root, "<evals>"),
  });
} finally {
  await browser?.close().catch(() => {});
  if (replay) {
    const r = await command(root, "git", [
      "worktree",
      "remove",
      "--force",
      replay,
    ]);
    if (r.code !== 0)
      rows.push({
        id: "cleanup/infrastructure",
        status: "infrastructure-error",
        reason: r.stderr,
      });
    await rm(replay, { recursive: true, force: true });
  }
}
process.removeListener("SIGINT", onSignal);
process.removeListener("SIGTERM", onSignal);
if (interrupted)
  rows.push({
    id: "harness/interrupted",
    status: "infrastructure-error",
    reason: "Interrupted; temporary worktree cleaned",
  });
for (const [dq] of Object.entries(criteria))
  if (!rows.some((r) => r.dq === dq))
    rows.push({
      id: `harness/${dq}/unmeasured`,
      dq,
      status: "not-implemented",
      reason:
        "Infrastructure prevented measurement; see the infrastructure-error observation.",
    });
if (!values.artifacts) {
  try {
    await archiveCaseFiles(dest);
  } catch (error) {
    rows.push({
      id: "harness/case-archive",
      status: "infrastructure-error",
      reason: error.message.replaceAll(root, "<evals>"),
    });
  }
}
for (const row of rows.filter((r) => r.status === "infrastructure-error"))
  process.stderr.write(`${row.id}: ${row.reason}\n`);
let code = exitCode(rows, values["report-only"]);
const counts = summary(rows);
const policyCounts = policyStatusCounts(rows);
const coverageReason = strictCoverageReason(rows, values["report-only"]);
const report = {
  ...metadata,
  sourceHashes: {
    format: SOURCE_HASH_FORMAT,
    sheets: results.flatMap((r) => r.sourceHashes ?? []),
  },
  exitCode: code,
  exitReason: coverageReason,
  summary: counts,
  policySummary: policyCounts,
  ...assessment,
  results: rows,
};
await gallery(dest, results, rows, reportFilename(values.artifacts));
await writeFile(
  join(dest, "summary.md"),
  [
    `# Drawing checkpoint ${values.checkpoint}`,
    "",
    `Mode: ${values["report-only"] ? "report-only" : "strict"}; exit ${code}. Full findings and rounded measurements: [JSON](${reportFilename(values.artifacts)}). [Gallery](gallery.html). [Reviewer form](reviewer-form.json).`,
    "",
    ...statusTable(counts),
    ...(coverageReason ? ["", `Reason: ${coverageReason}`] : []),
    "",
    "## Drift within marker bands",
    "",
    ...assessment.drift.map(
      (d) =>
        `- ${d.marker}: ${JSON.stringify(d.changes)}${d.partialScope ? " (partial selected scope)" : ""}${d.withinBand ? "" : " (band violation; fails above)"}`,
    ),
    "",
    "## ISO cap-height policy gaps (separate from geometry)",
    "",
    JSON.stringify(policyCounts),
    "",
    "## Observations",
    "",
    ...rows
      .filter(
        (r) =>
          !["pass", "manual", "not-applicable", "not-implemented"].includes(
            r.status,
          ),
      )
      .map(
        (r) =>
          `- ${r.id}: **${r.status}** ${r.reason ?? r.evidence?.findings?.[0]?.kind ?? ""}${r.evidence?.crop ? ` ([300 dpi crop](${r.evidence.crop}))` : ""}`,
      ),
    "",
  ].join("\n"),
);
const elapsedSeconds = (performance.now() - started) / 1000;
// Timing is deliberately outside deterministic report JSON.
await writeFile(
  join(dest, "timing.json"),
  json({
    elapsedSeconds,
    subset: values.case ? "selected" : values.quick ? "quick" : "full",
    cases: results.length,
    sheets: results.reduce((n, r) => n + r.sheets.length, 0),
  }),
);
const finalized = await finalizeOutput(dest, report, values.artifacts);
code = finalized.report.exitCode;
const { outputBytes, budgetBytes } = finalized.cost;
const headroomBytes = budgetBytes === null ? "n/a" : budgetBytes - outputBytes;
process.stdout.write(
  `${JSON.stringify(counts)}\nWall time ${elapsedSeconds.toFixed(2)} s; exit ${code}; outputBytes=${outputBytes}; budgetBytes=${budgetBytes ?? "unlimited"}; headroomBytes=${headroomBytes}; ${relative(root, dest)}/${reportFilename(values.artifacts)}\n`,
);
process.exitCode = code;
