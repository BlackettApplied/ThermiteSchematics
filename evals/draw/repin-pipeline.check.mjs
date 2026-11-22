import { parseReportBytes } from "./report-file.mjs";
// Browser-required protocol acceptance with a synthetic registry, never real approvals/apply.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  cp,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expectations } from "./expectations.mjs";
import { cases } from "./corpus.mjs";
import { instanceInventory, reassess } from "./repin-core.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { contains } from "./crop-index.mjs";
import { hash, json } from "./support.mjs";
const { values: v } = parseArgs({
  options: {
    report: { type: "string" },
    output: { type: "string" },
    capture: { type: "boolean", default: false },
  },
});
assert(
  v.report && v.output,
  "Use --report <fresh-C1/summary.json> --output <acceptance.json>",
);
const root = fileURLToPath(new URL("../../", import.meta.url)),
  kit = join(root, "evals/draw"),
  sourceRoot = dirname(resolve(v.report));
const raw = await readFile(resolve(v.report)),
  report = parseReportBytes(raw),
  inv = instanceInventory(report, hash(raw));
const candidates = expectations.markers
  .filter((m) => {
    const ts = inv.instances.filter((t) => t.markerId === m.id);
    return (
      ts.length &&
      ts.every(
        (t) =>
          t.scope.medium !== "pdf" &&
          t.bbox &&
          (v.capture
            ? !contains(
                t.bbox,
                report.results.find((r) => r.id === t.row)?.evidence?.cropBbox,
              )
            : t.facts.text &&
              contains(
                t.bbox,
                report.results.find((r) => r.id === t.row)?.evidence?.cropBbox,
              )),
      )
    );
  })
  .sort(
    (a, b) =>
      inv.instances.filter((t) => t.markerId === a.id).length -
      inv.instances.filter((t) => t.markerId === b.id).length,
  );
assert(
  candidates.length,
  "No eligible real crop marker available for synthetic delta",
);
let picked;
if (v.capture) {
  const kinds = new Map();
  for (const m of candidates) {
    const kind = inv.instances.find((t) => t.markerId === m.id).facts.kind;
    if (!kinds.has(kind)) kinds.set(kind, m);
  }
  picked = [...kinds.values()].slice(0, 8);
} else {
  const htmlCandidate = candidates.find((m) =>
    inv.instances.some((t) => t.markerId === m.id && t.scope.medium === "html"),
  );
  assert(htmlCandidate, "No actual HTML pipeline-crop marker available");
  picked = [candidates[0], htmlCandidate];
}
const removed = [...new Set(picked.map((m) => m.id))],
  registry = structuredClone(expectations);
registry.markers = registry.markers.filter((m) => !removed.includes(m.id));
const scratch = await mkdtemp(join(root, "evals/out/pipeline-accept-")),
  copyKit = join(scratch, "evals/draw"),
  out = join(scratch, "evals/out");
await mkdir(copyKit, { recursive: true });
await mkdir(out);
await mkdir(join(out, "draw-samples"));
await mkdir(join(scratch, "scripts"));
try {
  for (const f of await readdir(kit))
    if (f.endsWith(".mjs")) await cp(join(kit, f), join(copyKit, f));
  await cp(
    join(root, "scripts/stamp-drawing-crop.mjs"),
    join(scratch, "scripts/stamp-drawing-crop.mjs"),
  );
  await symlink(
    join(root, "node_modules"),
    join(scratch, "node_modules"),
    "junction",
  );
  await symlink(join(root, "packages"), join(scratch, "packages"), "junction");
  await writeFile(
    join(copyKit, "corpus.mjs"),
    `export const cases=()=>${JSON.stringify(cases())};export const verifyCorpus=async()=>({seal:${JSON.stringify(report.corpusSha256)}});`,
  );
  const text = serializeRegistry(registry);
  await writeFile(join(copyKit, "expectations.mjs"), text);
  const target = structuredClone(report);
  target.mode = "strict"; // The copied registry/report are explicitly synthetic.
  const assessed = reassess(target, registry, cases());
  Object.assign(target, {
    results: assessed.rows,
    summary: assessed.summary,
    drift: assessed.drift,
    exitCode: assessed.exitCode,
  });
  target.checkers = await readCheckers(copyKit);
  target.checkerSha256 = checkerManifestHash(target.checkers);
  const reportPath = join(out, "synthetic-report.json");
  await writeFile(reportPath, json(target));
  const log = [];
  const run = (tool, ...args) => {
    const r = spawnSync("bun", [join(copyKit, tool), ...args], {
      cwd: scratch,
      encoding: "utf8",
    });
    log.push({ tool, exit: r.status });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  run(
    "repin.mjs",
    "--report",
    reportPath,
    "--inventory",
    join(out, "inventory.json"),
  );
  run(
    "repin.mjs",
    "draft",
    "--inventory",
    join(out, "inventory.json"),
    "--pr",
    "#999",
    "--output",
    join(out, "draft.json"),
  );
  run(
    "repin-crop-index.mjs",
    "--report",
    reportPath,
    "--source-root",
    sourceRoot,
    "--decisions",
    join(out, "draft.json"),
    "--output",
    join(out, "prepared.json"),
    "--index",
    join(out, "index.json"),
    "--samples",
    join(out, "draw-samples/crops"),
  );
  const probes = [];
  const prepared = JSON.parse(await readFile(join(out, "prepared.json"))),
    sourceIndex = JSON.parse(await readFile(join(out, "index.json")));
  for (const [name, edit, message] of [
    [
      "false header with matching box",
      (d, i) => {
        i.crops[0].headerLines[3] = "Text false header";
      },
      "header differs",
    ],
    [
      "wrong sheet",
      (d, i) => {
        i.crops[0].physicalSheet += 1;
      },
      "physical sheet differs",
    ],
    [
      "wrong case",
      (d, i) => {
        i.crops[0].scope.case = "wrong-case";
      },
      "case/medium",
    ],
    [
      "wrong source case",
      (d, i) => {
        const r = i.crops[0].sourceRender;
        r[r.medium] = "wrong-case/sheet-001.svg";
      },
      "Source path",
    ],
    [
      "PDF entry with SVG row",
      (d, i) => {
        d.entries.find((e) => e.crop).to.scope.medium = "pdf";
      },
      "A PDF-scope entry cannot use SVG/HTML evidence",
    ],
  ]) {
    const d = structuredClone(prepared),
      i = structuredClone(sourceIndex);
    edit(d, i);
    await writeFile(join(out, "bad-draft.json"), json(d));
    await writeFile(join(out, "bad-index.json"), json(i));
    const r = spawnSync(
      "bun",
      [
        join(copyKit, "repin-bind-crops.mjs"),
        "--report",
        reportPath,
        "--source-root",
        sourceRoot,
        "--decisions",
        join(out, "bad-draft.json"),
        "--crop-index",
        join(out, "bad-index.json"),
        "--output",
        join(out, "must-not-exist.json"),
      ],
      { cwd: scratch, encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stderr);
    assert(r.stderr.includes(message), r.stderr);
    probes.push({ name, exit: r.status, reason: message });
  }
  if (v.capture) {
    const row = sourceIndex.crops.find(
      (c) => c.scope.medium === "svg" && c.text === "W-C11",
    );
    assert(row, "Capture acceptance needs the reviewer's W-C11 instance");
    const substituted = join(out, "substituted-sources");
    await mkdir(substituted);
    for (const c of sourceIndex.crops) {
      const rel = c.sourceRender[c.scope.medium],
        path = join(substituted, rel);
      await mkdir(dirname(path), { recursive: true });
      await cp(join(sourceRoot, rel), path);
    }
    const rel = row.sourceRender.svg,
      path = join(substituted, rel),
      original = await readFile(path, "utf8"),
      modified = original.replaceAll("W-C11", "W-C17");
    assert.notEqual(modified, original);
    await writeFile(path, modified);
    const badIndex = structuredClone(sourceIndex);
    for (const c of badIndex.crops)
      if (c.sourceRender.svg === rel) c.sourceRender.svgSha256 = hash(modified);
    await writeFile(join(out, "substituted-index.json"), json(badIndex));
    const bind = spawnSync(
      "bun",
      [
        join(copyKit, "repin-bind-crops.mjs"),
        "--report",
        reportPath,
        "--source-root",
        substituted,
        "--decisions",
        join(out, "prepared.json"),
        "--crop-index",
        join(out, "substituted-index.json"),
        "--output",
        join(out, "must-not-bind.json"),
      ],
      { cwd: scratch, encoding: "utf8" },
    );
    assert.equal(bind.status, 1, bind.stderr);
    assert(bind.stderr.includes("hash differs from C1 report"), bind.stderr);
    probes.push({
      name: "W-C11 to W-C17 substituted source folder and matching index hash",
      exit: bind.status,
      reason: "Source render hash differs from C1 report",
    });
    const build = spawnSync(
      "bun",
      [
        join(copyKit, "repin-crop-index.mjs"),
        "--report",
        reportPath,
        "--source-root",
        substituted,
        "--decisions",
        join(out, "draft.json"),
        "--output",
        join(out, "must-not-prepare.json"),
        "--index",
        join(out, "must-not-index.json"),
        "--samples",
        join(out, "draw-samples/substituted"),
      ],
      { cwd: scratch, encoding: "utf8" },
    );
    assert.equal(build.status, 1, build.stderr);
    assert(build.stderr.includes("hash differs from C1 report"), build.stderr);
    probes.push({
      name: "Substituted source folder at builder",
      exit: build.status,
      reason: "Source render hash differs from C1 report",
    });
  }
  run(
    "repin-bind-crops.mjs",
    "--report",
    reportPath,
    "--source-root",
    sourceRoot,
    "--decisions",
    join(out, "prepared.json"),
    "--crop-index",
    join(out, "index.json"),
    "--output",
    join(out, "bound.json"),
  );
  const bound = JSON.parse(await readFile(join(out, "bound.json")));
  // Explicit mock of independent review, in a non-shipping synthetic registry only.
  for (const e of bound.entries)
    Object.assign(e, {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic protocol test only, not a review",
      },
      causeClass: "synthetic-marker-omission",
      note: "Synthetic omission of one registry marker; real C1 pixels and tracked tool preparation.",
    });
  await writeFile(join(out, "mock-reviewed.json"), json(bound));
  const receipt = JSON.parse(
    run(
      "repin.mjs",
      "--report",
      reportPath,
      "--decisions",
      join(out, "mock-reviewed.json"),
      "--preview",
      join(out, "preview.mjs"),
    ),
  );
  assert.equal(receipt.expected.exitCode, 0);
  assert.deepEqual(receipt.expected.drift, []);
  const index = JSON.parse(await readFile(join(out, "index.json")));
  await writeFile(
    resolve(v.output),
    json({
      format: "thermite-draw-pipeline-acceptance/1.0",
      sourceReportSha256: hash(raw),
      synthetic: true,
      mockReview: true,
      removedMarkers: removed,
      kinds: picked.map(
        (m) => inv.instances.find((t) => t.markerId === m.id).facts.kind,
      ),
      entries: bound.entries.length,
      pipelineCrops: index.crops.filter((c) => c.capture === "pipeline").length,
      instanceCrops: index.crops.filter((c) => c.capture === "instance").length,
      steps: log,
      probes,
      outcomes: receipt.expected.outcomes,
      exitCode: receipt.expected.exitCode,
      drift: receipt.expected.drift,
    }),
  );
  process.stdout.write(
    "Tracked inventory → draft → crop index → bind → mock review → preview: exit 0, no drift. Shipping registry untouched.\n",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
