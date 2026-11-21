// Compare the public renderer across the drawing corpus and narrow wire-field fixtures.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { cases, prepare } from "../evals/draw/corpus.mjs";
import { command, canonical } from "../evals/draw/support.mjs";
import { conveyorRequest } from "../packages/render/test/packet-navigation-review-fixture.ts";
import { repeatRequest } from "../packages/render/test/wire-column-search-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    "base-engine": { type: "string" },
    "base-checkpoint": { type: "string" },
    "head-checkpoint": { type: "string" },
  },
});
assert(values["base-engine"], "Use --base-engine <built base checkout>");
const baseRoot = resolve(values["base-engine"]);
const flows = ["left-to-right", "top-to-bottom"];

async function engine(checkout) {
  const [{ compileProject }, { renderSchematicPacket }, rev] =
    await Promise.all([
      import(pathToFileURL(join(checkout, "packages/compiler/dist/index.js"))),
      import(pathToFileURL(join(checkout, "packages/render/dist/index.js"))),
      command(checkout, "git", ["rev-parse", "HEAD"]),
    ]);
  assert.equal(rev.code, 0);
  return { compileProject, renderSchematicPacket, commit: rev.stdout.trim() };
}

function requestsFor(c, request) {
  const variants = [
    ["a4-portrait-same", "a4", "portrait", request.layout],
    ["a4-landscape-same", "a4", "landscape", request.layout],
    ["letter-portrait-compact", "letter", "portrait", "compact"],
    ["a4-portrait-compact", "a4", "portrait", "compact"],
  ];
  const requests = variants.map(([id, size, orientation, layout]) => ({
    id: `${c.id}/${id}`,
    request: {
      ...request,
      ...(layout ? { layout } : {}),
      page: { ...request.page, size, orientation },
    },
  }));
  const distinct = new Map();
  for (const entry of requests) {
    const key = JSON.stringify(canonical(entry.request));
    if (!distinct.has(key)) distinct.set(key, entry);
  }
  return [...distinct.values()];
}

function browserFixtures() {
  return flows.flatMap((flow) =>
    [
      ["conveyor-line", conveyorRequest()],
      ["machine-demo", repeatRequest(flow)],
    ].map(([name, request]) => ({
      id: `browser-${name}-${flow}`,
      project: `examples/${name}`,
      request: {
        ...request,
        layout: "standard",
        page: { size: "letter", orientation: "portrait" },
      },
      flow,
    })),
  );
}

async function assertStrictPair(engines) {
  const base = values["base-checkpoint"],
    head = values["head-checkpoint"];
  if (!base && !head) return;
  assert(base && head, "Supply both strict checkpoint summaries");
  const results = await Promise.all(
    [base, head].map(async (path) => {
      const bytes = await readFile(path);
      return JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes) : bytes);
    }),
  );
  const [old, current] = results;
  assert.deepEqual(
    results.map((r) => r.engine.commit),
    engines.map((e) => e.commit),
  );
  assert.deepEqual(old.cases, current.cases);
  assert.equal(old.cases.length, cases().length);
  assert.equal(old.corpusSha256, current.corpusSha256);
  assert.deepEqual(
    results.map((r) => r.sourceHashes.sheets.length),
    [746, 746],
  );
  const issued = (r) => new Set(r.sourceHashes.sheets.map((s) => s.case));
  assert.deepEqual(issued(old), issued(current));
  const unexpected = current.results.filter((r) =>
    ["fail", "xpass", "infrastructure-error"].includes(r.status),
  );
  assert.deepEqual(unexpected, [], "Unexpected strict head observations");
}

function result(output) {
  if (!output.ok) return { refusal: output.error };
  return {
    sheets: output.value.sheets.length,
    ...(output.value.sheets.length
      ? { views: output.value.sheets.map((s) => s.view) }
      : {}),
  };
}

async function compareFixture(c, directory, engines) {
  const { project, request } = await prepare(
    c,
    root,
    join(directory, c.id),
    (args) =>
      command(root, process.execPath, [join(root, "thermite.mjs"), ...args]),
  );
  const inputs = await Promise.all(
    engines.map((e) => e.compileProject(project)),
  );
  for (const i of inputs) {
    assert(i.ok, JSON.stringify(i.diagnostics));
  }
  const rows = [];
  for (const v of requestsFor(c, request)) {
    const [base, head] = await Promise.all(
      engines.map(async (e, index) => {
        const input = inputs[index];
        return result(
          await e.renderSchematicPacket(
            input.ir,
            v.request,
            input.presentation,
          ),
        );
      }),
    );
    const row = { id: v.id, base, head };
    console.log(JSON.stringify(row));
    rows.push(row);
  }
  return rows;
}

const directory = await mkdtemp(join(tmpdir(), "thermite-peer-fit-"));
try {
  const engines = await Promise.all([engine(baseRoot), engine(root)]);
  await assertStrictPair(engines);
  console.log(JSON.stringify({ commits: engines.map((e) => e.commit) }));
  const measurements = [];
  for (const c of [...cases(), ...browserFixtures()])
    measurements.push(...(await compareFixture(c, directory, engines)));
  const losses = measurements.filter((r) => r.base.sheets && r.head.refusal);
  assert.equal(measurements.length, 458);
  console.log(
    JSON.stringify({
      cases: measurements.length,
      basePositive: measurements.filter((r) => r.base.sheets).length,
      headPositive: measurements.filter((r) => r.head.sheets).length,
      positiveToRefusal: losses.map((r) => r.id),
    }),
  );
  assert.deepEqual(losses, [], "An issued base packet refused at head");
} finally {
  await rm(directory, { recursive: true, force: true });
}
