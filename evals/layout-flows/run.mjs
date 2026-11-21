import { parseArgs } from "node:util";
import { FLOW_SWEEP_USAGE } from "./usage.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { population, materialize, flowVariant } from "./inputs.mjs";
import { engine, treeHash } from "./engines.mjs";
import { compare, summary, sha256, regressed } from "./results.mjs";
import { renderPair } from "./paired.mjs";
import { command } from "../draw/support.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)),
  { values } = parseArgs({
    options: {
      base: { type: "string" },
      head: { type: "string", default: root },
      output: { type: "string" },
      jobs: { type: "string", default: "1" },
      case: { type: "string" },
      help: { type: "boolean" },
    },
  });
if (values.help) {
  process.stdout.write(FLOW_SWEEP_USAGE);
  process.exit(0);
}
assert(
  values.base && values.output,
  "Use --base <built checkout> --output <new directory>",
);
const jobs = Number(values.jobs);
assert(Number.isInteger(jobs) && jobs >= 1 && jobs <= 2, "Use one or two jobs");
const out = resolve(values.output);
await mkdir(out);
await mkdir(join(out, "inputs"));
await mkdir(join(out, "results"));
const before = await engine(resolve(values.base)),
  after = await engine(resolve(values.head)),
  specs = (await population(root)).filter(
    (s) => !values.case || s.id.includes(values.case),
  ),
  rows = [],
  compilations = { before: new Map(), after: new Map() };
assert(specs.length > 0, "No selected inputs");
const metadata = {
  format: "layout-flow-variants/1.0",
  base: before.metadata,
  head: after.metadata,
  jobs,
  subset: values.case ?? null,
  libraryExamples: specs.filter((s) => s.kind === "library").length,
  corpusRequests: specs.filter((s) => s.kind === "corpus").length,
  expected: specs.length * 2,
  pgrep: spawnSync("pgrep", ["-fl", "evals/draw/run.mjs"], { encoding: "utf8" })
    .stdout,
  disk: spawnSync("df", ["-h", "/"], { encoding: "utf8" }).stdout,
};
await writeFile(
  join(out, "metadata.json"),
  JSON.stringify(metadata, null, 2) + "\n",
);
const cli = async (args) =>
  command(before.root, process.execPath, [
    join(before.root, "thermite.mjs"),
    ...args,
  ]);
let next = 0,
  stopped = false,
  failure,
  writer = Promise.resolve();
async function checkpoint() {
  const bytes =
    JSON.stringify(
      {
        ...summary(rows, metadata.expected),
        fullPopulation: !values.case,
        subset: values.case ?? null,
      },
      null,
      2,
    ) + "\n";
  writer = writer.then(() => writeFile(join(out, "summary.json"), bytes));
  await writer;
}
async function persist(path, value) {
  const data = gzipSync(JSON.stringify(value), { mtime: 0 });
  assert(data.length <= 5_000_000, `Receipt exceeds cap: ${path}`);
  await writeFile(path, data);
}
async function run(spec) {
  const slug =
      spec.id.replace(/[^a-zA-Z0-9._-]/gu, "_") +
      "-" +
      sha256(spec.id).slice(0, 8),
    dest = join(out, "inputs", slug),
    prepared = await materialize(spec, root, dest, cli);
  for (const flow of ["left-to-right", "top-to-bottom"]) {
    if (stopped) return;
    const request = await flowVariant(
        spec,
        prepared.request,
        flow,
        root,
        join(dest, flow),
        cli,
      ),
      id = spec.id + "/" + flow,
      pair = await renderPair(
        { before, after },
        prepared.project,
        request,
        compilations,
      ),
      old = pair.before.outcome,
      current = pair.after.outcome,
      row = {
        id,
        kind: spec.kind,
        source: prepared.source,
        flow,
        inputSha256: {
          before: pair.before.inputSha256,
          after: pair.after.inputSha256,
        },
        before: old,
        after: current,
        ...compare(old, current),
      };
    await persist(join(out, "results", slug + "-" + flow + ".json.gz"), {
      inputs: { before: pair.before.input, after: pair.after.input },
      before: old,
      after: current,
    });
    rows.push(row);
    if (regressed(row)) stopped = true;
    await checkpoint();
    console.log(
      JSON.stringify({
        completed: rows.length,
        expected: metadata.expected,
        id,
        before: old.ok ? old.pages : old.code,
        after: current.ok ? current.pages : current.code,
        positiveToRefusal: row.positiveToRefusal,
        pageGrowth: row.pageGrowth,
        recovered: row.recovered,
        refusalCodeChanged: row.refusalCodeChanged,
      }),
    );
  }
}
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (!stopped) {
      const spec = specs[next++];
      if (!spec) return;
      try {
        await run(spec);
      } catch (error) {
        stopped = true;
        failure = { case: spec.id, message: String(error), stack: error.stack };
      }
    }
  }),
);
assert.equal(
  await treeHash(join(before.root, "packages/render/dist")),
  metadata.base.rendererDistSha256,
  "Base engine changed during sweep",
);
assert.equal(
  await treeHash(join(after.root, "packages/render/dist")),
  metadata.head.rendererDistSha256,
  "Head engine changed during sweep",
);
for (const [side, engine] of [
  ["base", before],
  ["head", after],
])
  for (const name of ["compiler", "schema"])
    assert.equal(
      await treeHash(join(engine.root, `packages/${name}/dist`)),
      metadata[side][`${name}DistSha256`],
      `${side} ${name} changed during sweep`,
    );
const result = {
  ...summary(rows, metadata.expected),
  fullPopulation: !values.case,
  subset: values.case ?? null,
};
await writeFile(
  join(out, "summary.json"),
  JSON.stringify(result, null, 2) + "\n",
);
if (failure)
  await writeFile(
    join(out, "ERROR.json"),
    JSON.stringify(failure, null, 2) + "\n",
  );
if (stopped && !failure)
  await writeFile(
    join(out, "STOP.json"),
    JSON.stringify(
      {
        reason:
          "positive-to-refusal, successful page growth or refusal-code change",
        cases: rows.filter(regressed),
      },
      null,
      2,
    ) + "\n",
  );
console.log(
  JSON.stringify({
    complete: result.complete,
    completed: result.completed,
    positiveToRefusal: result.positiveToRefusal,
    pageGrowth: result.pageGrowth,
    recovered: result.recovered,
    refusalCodeChanged: result.refusalCodeChanged,
    refusals: result.refusals.length,
  }),
);
process.exitCode = failure ? 2 : stopped ? 1 : 0;
