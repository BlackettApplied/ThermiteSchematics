// Isolated, browser-free mutation acceptance. A green control is mandatory.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadavg } from "node:os";
import { parseArgs } from "node:util";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const { values: v } = parseArgs({
  options: {
    output: { type: "string" },
    list: { type: "boolean", default: false },
  },
});
assert(v.output, "Use --output <mutation-report.json>");
const root = fileURLToPath(new URL("../../", import.meta.url)),
  out = resolve(v.output);
await mkdir(join(root, "evals/out"), { recursive: true });
const copy = await mkdtemp(join(root, "evals/out/mutation-")),
  vectors = [],
  original = new Map();
process.on("exit", () => rmSync(copy, { recursive: true, force: true }));
const all = [
  "evals/draw/crop-geometry.test.mjs",
  "evals/draw/crop-source-policy.test.mjs",
  "evals/draw/crop-source-pixels.test.mjs",
  "evals/draw/crop-source.test.mjs",
  "evals/draw/crop-report.test.mjs",
  "evals/draw/crop-index.test.mjs",
  "evals/draw/capture.test.mjs",
  "evals/draw/repin-source-integration.test.mjs",
  "evals/draw/sheet-identities.test.mjs",
  "evals/draw/repin-drawing-bindings.test.mjs",
  "evals/draw/repin.test.mjs",
  "evals/draw/repin-succession.test.mjs",
  "scripts/stamp-drawing-crop.test.mjs",
  "evals/draw/crop-review.test.mjs",
  "evals/draw/crop-rename.test.mjs",
  "evals/draw/crop-baseline.test.mjs",
  "evals/draw/source-hashes.test.mjs",
  "evals/draw/crop-attempts.test.mjs",
  "evals/draw/repin-verification.test.mjs",
  "evals/draw/bind-exhaustion.test.mjs",
  "evals/draw/verification-io.test.mjs",
  "evals/draw/pdf-source-policy.test.mjs",
  "evals/draw/pdf-source.test.mjs",
  "evals/draw/pdf-load.test.mjs",
  "evals/draw/pdf-bind.test.mjs",
  "evals/draw/pdf-ink-operators.test.mjs",
  "evals/draw/pdf-ink-policy.test.mjs",
  "evals/draw/pdf-ink.test.mjs",
  "evals/draw/pdf-ink-archive.test.mjs",
  "evals/draw/utilisation.test.mjs",
  "evals/draw/continuation-labels.test.mjs",
  "evals/draw/pdf-painted.test.mjs",
  "evals/draw/retention.test.mjs",
  "evals/draw/output.test.mjs",
];
await mkdir(join(copy, "evals/out"), { recursive: true }); // Test fixtures rely on the ignored output root.
await cp(join(root, "evals/draw"), join(copy, "evals/draw"), {
  recursive: true,
});
await mkdir(join(copy, "scripts"));
for (const f of ["stamp-drawing-crop.mjs", "stamp-drawing-crop.test.mjs"])
  await cp(join(root, "scripts", f), join(copy, "scripts", f));
for (const p of ["node_modules", "packages"])
  await symlink(join(root, p), join(copy, p), "junction");
for (const p of ["package.json", "vitest.config.mjs"])
  await cp(join(root, p), join(copy, p));
async function source(file) {
  if (!original.has(file))
    original.set(file, await readFile(join(root, file), "utf8"));
  return original.get(file);
}
function add(id, file, from, to, tests = all) {
  assert(original.get(file).includes(from), "Missing mutation anchor: " + id);
  vectors.push({ id, file, from, to, tests });
}
function calls(file, name) {
  const s = original.get(file),
    ast = ts.createSourceFile(
      file,
      s,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    out = [];
  function walk(n) {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === name)
      out.push({
        text: n.getText(ast),
        condition: n.arguments[0]?.getText(ast),
        message: n.arguments[1]?.getText(ast),
      });
    ts.forEachChild(n, walk);
  }
  walk(ast);
  return out;
}
for (const [name, tests] of [
  [
    "crop-source-policy",
    [
      "evals/draw/crop-source-policy.test.mjs",
      "evals/draw/pdf-source-policy.test.mjs",
    ],
  ],
  ["crop-source-pixels", ["evals/draw/crop-source-pixels.test.mjs"]],
  ["crop-source", ["evals/draw/crop-source.test.mjs"]],
  [
    "crop-report",
    [
      "evals/draw/crop-report.test.mjs",
      "evals/draw/crop-review.test.mjs",
      "evals/draw/crop-rename.test.mjs",
      "evals/draw/pdf-source-policy.test.mjs",
      "evals/draw/pdf-ink-archive.test.mjs",
    ],
  ],
  ["crop-index", ["evals/draw/crop-index.test.mjs"]],
  [
    "source-hashes",
    [
      "evals/draw/source-hashes.test.mjs",
      "evals/draw/pdf-source-policy.test.mjs",
      "evals/draw/pdf-ink-archive.test.mjs",
    ],
  ],
  ["pdf-source-policy", ["evals/draw/pdf-source-policy.test.mjs"]],
  ["pdf-source", ["evals/draw/pdf-source.test.mjs"]],
  ["pdf-ink", ["evals/draw/pdf-ink.test.mjs"]],
  ["pdf-ink-operators", ["evals/draw/pdf-ink-operators.test.mjs"]],
  ["pdf-glyph-metrics", ["evals/draw/pdf-ink.test.mjs"]],
  ["pdf-ink-policy", ["evals/draw/pdf-ink-policy.test.mjs"]],
  [
    "crop-attempts",
    [
      "evals/draw/crop-attempts.test.mjs",
      "evals/draw/pdf-ink-archive.test.mjs",
    ],
  ],
  ["repin-record-verification", ["evals/draw/repin-verification.test.mjs"]],
  ["verification-io", ["evals/draw/verification-io.test.mjs"]],
]) {
  const file = `evals/draw/${name}.mjs`;
  await source(file);
  for (const [n, a] of calls(file, "assert").entries())
    add(
      `${name}/assert-${n} ${a.message ?? ""}`,
      file,
      a.text,
      `assert(true, ${a.message ?? "undefined"})`,
      tests,
    );
  if (name === "crop-report")
    for (const [n, a] of calls(file, "same").entries())
      add(`report-field-${n}`, file, a.text, "undefined", tests);
}
const g = "evals/draw/crop-geometry.mjs";
await source(g);
for (const [id, s] of [
  ["left", "box.x >= cropBbox.x - 0.001"],
  ["top", "box.y >= cropBbox.y - 0.001"],
  ["right", "box.x + box.w <= cropBbox.x + cropBbox.w + 0.001"],
  ["bottom", "box.y + box.h <= cropBbox.y + cropBbox.h + 0.001"],
  ["width", "box.w >= 0"],
  ["height", "box.h >= 0"],
  ["crop-width", "cropBbox.w > 0"],
  ["crop-height", "cropBbox.h > 0"],
])
  add("geometry-" + id, g, s, "true", [all[0]]);
add(
  "geometry-finite",
  g,
  original.get(g).match(/\[\s*box\.x,[\s\S]*?\]\.every\(Number.isFinite\)/)[0],
  "true",
  [all[0]],
);
async function edit(id, file, from, to, tests = all) {
  await source(file);
  add(id, file, from, to, tests);
}
await edit(
  "report-contains",
  "evals/draw/crop-report.mjs",
  "assertCropContainsInstance({ bbox: c.instanceBbox }, c.sourceBbox);",
  "",
  ["evals/draw/crop-report.test.mjs"],
);
const b = "evals/draw/repin-drawing-bindings.mjs";
await edit(
  "bind-containment",
  b,
  "assertCropContainsInstance({ bbox: row.instanceBbox }, row.sourceBbox);",
  "",
  [all[1]],
);
await edit("bind-cropless", b, "assertNoCroplessFacts(file);", "", [all[1]]);
await edit(
  "bind-discard-typed-source",
  b,
  "delete entry.sourceVerification;",
  "",
  [all[1]],
);
const coverage = calls(b, "assert").find((a) =>
  a.message?.includes("exactly cover"),
);
add("bind-exact-coverage", b, coverage.condition, "true", [all[1]]);
const run = "evals/draw/run.mjs";
await edit(
  "runner-HTML-index",
  run,
  "html: svgLocators(htmlSvgs[s.number - 1], ir, s.view, tables)",
  "html: svgLocators(s.svg, ir, s.view, tables)",
  ["evals/draw/sheet-identities.test.mjs"],
);
await source(run);
const runSource = original.get(run),
  runAst = ts.createSourceFile(
    run,
    runSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ),
  boxes = [];
function boxInitializers(n) {
  if (
    ts.isVariableDeclaration(n) &&
    n.name.getText(runAst) === "box" &&
    n.initializer?.getText(runAst).includes("cropBox(")
  )
    boxes.push(n.initializer.getText(runAst));
  ts.forEachChild(n, boxInitializers);
}
boxInitializers(runAst);
assert(boxes.length === 2);
for (const [i, box] of boxes.entries())
  add("capture-canonical-box-" + i, run, box, box.slice(10, -1), [
    "evals/draw/capture.test.mjs",
  ]);
for (const file of ["run.mjs", "crop-source.mjs"]) {
  await edit(
    "isolated-context-" + file,
    "evals/draw/" + file,
    "browser.newContext(drawingContextOptions)",
    "browser.newContext({})",
    ["evals/draw/capture.test.mjs"],
  );
}
const browser = "evals/draw/browser.mjs";
await edit("capture-offline", browser, "offline: true", "offline: false", [
  "evals/draw/capture.test.mjs",
]);
await edit(
  "capture-service-workers",
  browser,
  'serviceWorkers: "block"',
  'serviceWorkers: "allow"',
  ["evals/draw/capture.test.mjs"],
);
await edit(
  "capture-page-scripts",
  browser,
  "javaScriptEnabled: false",
  "javaScriptEnabled: true",
  ["evals/draw/capture.test.mjs"],
);
const src = "evals/draw/crop-source.mjs";
await edit(
  "source-contains",
  src,
  "assertCropContainsInstance({ bbox: row.instanceBbox }, row.sourceBbox);",
  "",
  [all[3]],
);
await edit(
  "source-root-containment",
  src,
  "const target = await within(resolve(sourceRoot, path), sourceRoot, {\n    existing: true,\n  });",
  "const target = resolve(sourceRoot,path);",
  [all[3]],
);
await edit(
  "source-canonical-region",
  src,
  "const b = canonical(row.sourceBbox);",
  "const b = row.sourceBbox;",
  [all[3]],
);
const policy = "evals/draw/crop-source-policy.mjs";
for (const [id, from, to] of [
  ["known-pr", "historical.has(file.pr) &&", ""],
  [
    "loop",
    "for (const { entry } of refs) checkSourceVerification(entry, archivePdf2);",
    "",
  ],
  [
    "contains",
    "assertCropContainsInstance({ bbox: v.instanceBbox }, v.sourceBbox);",
    "",
  ],
  ["exact-hash", "historical.get(file.pr) === sha", "historical.has(file.pr)"],
])
  await edit("source-policy-" + id, policy, from, to, [all[1]]);
const io = "evals/draw/repin-io.mjs";
await source(io);
await edit(
  "preview-requires-source",
  io,
  original.get(io).match(/checkSourceReferences\(file\.value,[\s\S]*?\);/)[0],
  "",
  ["evals/draw/repin-source-integration.test.mjs"],
);
await edit(
  "preview-report-binding",
  io,
  "checkReportedSources(file.value, reports);",
  "undefined;",
  ["evals/draw/repin.test.mjs"],
);
const record = "evals/draw/repin-record.mjs";
await source(record);
await edit(
  "record-requires-source",
  record,
  original
    .get(record)
    .match(/const sourceVerification = checkSourceReferences\([\s\S]*?\);/)[0],
  'const sourceVerification = "disabled";',
  ["evals/draw/repin-source-integration.test.mjs"],
);
await edit(
  "receipt-source-binding",
  "evals/draw/repin-record-crosscheck.mjs",
  "sourceVerification: x.sourceVerification,",
  "",
  ["evals/draw/repin-source-integration.test.mjs"],
);
const stamp = "scripts/stamp-drawing-crop.mjs";
for (const [id, from, to] of [
  [
    "contains",
    "assertCropContainsInstance(geometry?.instance, geometry?.cropBbox);",
    "",
  ],
  ["cli-instance", "values.instance &&", ""],
  ["cli-bbox", 'values["source-bbox"]', "true"],
])
  await edit("stamper-" + id, stamp, from, to, [
    "scripts/stamp-drawing-crop.test.mjs",
  ]);
await edit(
  "bind-carries-computed-source",
  "evals/draw/repin-bind-crops.mjs",
  "entry.sourceVerification = proofs.get(crop.path);",
  "entry.sourceVerification = undefined;",
  ["evals/draw/repin-drawing-bindings.test.mjs"],
);
await edit(
  "source-metadata-allowed",
  "evals/draw/repin-policy.mjs",
  '"sourceVerification",',
  "",
  ["evals/draw/repin-succession.test.mjs"],
);
await edit(
  "pixels-header-validates",
  "evals/draw/crop-source-pixels.mjs",
  "drawingHash(cropBytes, headerPixels);",
  "",
  [all[2]],
);
await edit(
  "bind-report-callsite",
  "evals/draw/repin-bind-crops.mjs",
  "checkIndexedEntries(file.value, index.value, reports, contexts);",
  "undefined;",
  ["evals/draw/repin-drawing-bindings.test.mjs"],
);
const stampCheck = "evals/draw/crop-stamp-check.mjs";
await source(stampCheck);
const headerGuard = calls(stampCheck, "assert").find((a) =>
  a.message?.includes("Stamped header pixels"),
);
add(
  "stamp-header-pixels",
  stampCheck,
  headerGuard.text,
  `assert(true, ${headerGuard.message})`,
  ["scripts/stamp-drawing-crop.test.mjs"],
);
await edit(
  "bind-stamp-check-callsite",
  "evals/draw/repin-bind-crops.mjs",
  "await verifyStampHeaders(index.value, crops);",
  "",
  ["evals/draw/repin-drawing-bindings.test.mjs"],
);
await edit(
  "preview-stamp-check-callsite",
  "evals/draw/repin-io.mjs",
  "await verifyStampHeaders({ crops: headerRows }, cropBytes);",
  "",
  ["evals/draw/repin-drawing-bindings.test.mjs"],
);
await edit(
  "mixed-rename-changed-text-only",
  "evals/draw/crop-report.mjs",
  "if (renameTextChanged(pair, a, b)) changed.push(pair);",
  "changed.push(pair);",
  ["evals/draw/crop-review.test.mjs"],
);
await edit(
  "builder-pinned-source-callsite",
  "evals/draw/repin-crop-index.mjs",
  "assertSourceBytes(source, sourceRef);",
  "",
  ["evals/draw/repin-source-integration.test.mjs"],
);
await edit(
  "capture-source-SVG-bytes",
  "evals/draw/source-hashes.mjs",
  "hash(await readFile(join(directory, svgFile)))",
  "hash(html)",
  ["evals/draw/source-hashes.test.mjs"],
);
await edit(
  "capture-source-HTML-bytes",
  "evals/draw/source-hashes.mjs",
  "sha256: hash(html)",
  'sha256: hash("unbound")',
  ["evals/draw/source-hashes.test.mjs"],
);
await edit(
  "capture-source-runner-callsite",
  "evals/draw/run.mjs",
  "sourceHashes: await captureSources(",
  "unboundSourceHashes: await captureSources(",
  ["evals/draw/capture.test.mjs"],
);
await edit(
  "header-fitting",
  "scripts/stamp-drawing-crop.mjs",
  "(HEADER_FONT_PIXELS * available) / width,",
  "HEADER_FONT_PIXELS,",
  ["scripts/stamp-drawing-crop.test.mjs"],
);
await edit(
  "rename-literal-map",
  "evals/draw/repin-mappings.mjs",
  "equal(pair[field], { from: a, to: b })",
  "true",
  ["evals/draw/crop-rename.test.mjs"],
);
await edit(
  "rename-unused-map",
  "evals/draw/repin-mappings.mjs",
  "pair[field] === undefined",
  "true",
  ["evals/draw/crop-rename.test.mjs"],
);
await edit(
  "header-floor",
  "scripts/stamp-drawing-crop.mjs",
  "pixels >= MIN_HEADER_FONT_PIXELS",
  "true",
  ["scripts/stamp-drawing-crop.test.mjs"],
);
for (const [id, file, call, tests] of [
  [
    "bind-capture-label",
    "evals/draw/repin-drawing-bindings.mjs",
    "checkIndexCapture",
    ["evals/draw/crop-source-policy.test.mjs"],
  ],
  [
    "report-capture-label",
    "evals/draw/crop-report.mjs",
    "checkIndexCapture",
    ["evals/draw/crop-report.test.mjs"],
  ],
  [
    "record-capture-label",
    "evals/draw/repin-record-crops.mjs",
    "checkIndexCapture",
    ["evals/draw/repin-verification.test.mjs"],
  ],
  [
    "pdf-builder-capture",
    "evals/draw/repin-crop-index.mjs",
    "capturePdfCrop",
    ["evals/draw/pdf-bind.test.mjs"],
  ],
  [
    "pdf-source-capture",
    "evals/draw/crop-source.mjs",
    "capturePdfCrop",
    ["evals/draw/pdf-source.test.mjs"],
  ],
  [
    "pdf-capture-policy",
    "evals/draw/crop-attempts.mjs",
    "checkPdfCapture",
    ["evals/draw/pdf-source-policy.test.mjs"],
  ],
  [
    "pdf-report-kind",
    "evals/draw/source-hashes.mjs",
    "checkPdfInstance",
    ["evals/draw/pdf-source-policy.test.mjs"],
  ],
  [
    "pdf-report-page",
    "evals/draw/source-hashes.mjs",
    "checkPdfPage",
    ["evals/draw/pdf-source-policy.test.mjs"],
  ],
  [
    "pdf-capture-region",
    "evals/draw/pdf-source.mjs",
    "checkPdfRegion",
    ["evals/draw/pdf-source.test.mjs"],
  ],
  [
    "pdf-resource-refusal",
    "evals/draw/pdf-source.mjs",
    "document.assertNoExternalResources",
    ["evals/draw/pdf-source.test.mjs"],
  ],
  [
    "pdf-archive-association",
    "evals/draw/repin-record-verification.mjs",
    "checkPdfIndexAttestation",
    ["evals/draw/pdf-bind.test.mjs"],
  ],
  [
    "v2-policy-attempts",
    "evals/draw/crop-source-policy.mjs",
    "checkAttempts(v, archivePdf2)",
    ["evals/draw/crop-attempts.test.mjs"],
  ],
  [
    "v2-integer-stats",
    "evals/draw/crop-attempts.mjs",
    "checkAttemptStats(a.stats)",
    ["evals/draw/crop-attempts.test.mjs"],
  ],
  [
    "v2-recompute-attempts",
    "evals/draw/crop-attempts.mjs",
    "checkAttempts(v, archivePdf2)",
    ["evals/draw/crop-attempts.test.mjs"],
  ],
  [
    "record-reference-pixels",
    "evals/draw/repin-record-verification.mjs",
    "verifyAttemptPixels",
    ["evals/draw/repin-verification.test.mjs"],
  ],
  [
    "preview-reference-pixels",
    "evals/draw/repin-io.mjs",
    "verifyDrawingAttempts",
    ["evals/draw/repin.test.mjs"],
  ],
]) {
  await source(file);
  const name = call.split("(")[0],
    found = calls(file, name).filter(
      (x) => !call.includes("(") || x.text === call,
    );
  assert(found.length === 1, "Expected one guard call: " + id);
  add(id, file, found[0].text + ";", "undefined;", tests);
}
await edit(
  "retry-cap",
  "evals/draw/crop-attempts.mjs",
  "n <= MAX_SOURCE_ATTEMPTS",
  "n <= 4",
  ["evals/draw/crop-attempts.test.mjs"],
);
await edit(
  "builder-fresh-source",
  "evals/draw/repin-crop-index.mjs",
  "await captureSourceCrop(browser, text,",
  "await bogusPipelineCopy(browser, text,",
  ["evals/draw/capture.test.mjs"],
);
for (const [label, condition] of [
  ["channel", "maximum > SOURCE_TOLERANCE.channel"],
  ["fraction", "changed / pixels > SOURCE_TOLERANCE.fraction"],
  ["mean", "absoluteError / pixels > SOURCE_TOLERANCE.mean"],
])
  await edit(
    "retry-numeric-" + label,
    "evals/draw/crop-source-pixels.mjs",
    condition,
    "false",
    ["evals/draw/crop-attempts.test.mjs"],
  );
await edit(
  "cache-isolation",
  "evals/draw/crop-source.mjs",
  "const key = json([",
  'const key = \"shared\" || json([',
  ["evals/draw/crop-source.test.mjs"],
);
await edit(
  "reuse-first-attempt-raster",
  "evals/draw/crop-source.mjs",
  "return cache[n - 1];",
  "return cache[0];",
  ["evals/draw/crop-source.test.mjs"],
);
await edit(
  "pdf-pin-bytes",
  "evals/draw/source-hashes.mjs",
  "sha256: hash(pdfSource.bytes)",
  "sha256: hash(html)",
  ["evals/draw/source-hashes.test.mjs"],
);
await edit(
  "pdf-pin-page",
  "evals/draw/source-hashes.mjs",
  "pdfSource.pages.find((p) => p.number === sheet)",
  "pdfSource.pages[0]",
  ["evals/draw/source-hashes.test.mjs"],
);
await edit(
  "pdf-cache-page-metadata",
  "evals/draw/crop-source.mjs",
  `row.sourceRender.page,
                row.sourceRender.backend,
                row.sourceRender.pdfjsVersion,
                row.cropShape,
                row.text,
                row.instanceBbox,`,
  "undefined,",
  ["evals/draw/pdf-source.test.mjs"],
);
await edit(
  "bind-existing-output-preflight",
  "evals/draw/repin-bind-crops.mjs",
  "!outputExists,",
  "true,",
  ["evals/draw/bind-exhaustion.test.mjs"],
);
for (const [id, from, to] of [
  ["pdf-system-fonts", "useSystemFonts: false", "useSystemFonts: true"],
  ["pdf-eval", "isEvalSupported: false", "isEvalSupported: true"],
  ["pdf-worker-fetch", "useWorkerFetch: false", "useWorkerFetch: true"],
  [
    "pdf-external-resources",
    "BinaryDataFactory: DeniedPdfResources",
    "BinaryDataFactory: undefined",
  ],
  [
    "pdf-same-bytes",
    "data: new Uint8Array(bytes)",
    "data: new Uint8Array([0])",
  ],
])
  await edit(id, "evals/draw/pdf.mjs", from, to, [
    "evals/draw/pdf-load.test.mjs",
  ]);
await edit(
  "pdf-canonical-raster-box",
  "evals/draw/pdf-source.mjs",
  "renderPdf(page, 300, box)",
  "renderPdf(page, 300, row.sourceBbox)",
  ["evals/draw/pdf-source.test.mjs"],
);
await edit(
  "pdf-runner-same-bytes",
  "evals/draw/run.mjs",
  "bytes: pdfBytes,",
  'bytes: Buffer.from("unbound"),',
  ["evals/draw/capture.test.mjs"],
);
await edit(
  "pdf-exact-instance-region",
  "evals/draw/crop-index.mjs",
  't.scope.medium === "pdf"\n            ? null',
  "false ? null",
  ["evals/draw/pdf-source-policy.test.mjs"],
);
await edit(
  "bind-stale-audit-preflight",
  "evals/draw/repin-bind-crops.mjs",
  "!auditExists,",
  "true,",
  ["evals/draw/bind-exhaustion.test.mjs"],
);
await edit(
  "record-hard-cap",
  "evals/draw/repin-record.mjs",
  "Math.min(RECORD_LIMIT, recordBudget(pin))",
  "recordBudget(pin)",
  ["evals/draw/repin-record-integrity.test.mjs"],
);
await source("evals/draw/crop-source.mjs");
const verifyAttemptsCall = calls(
  "evals/draw/crop-source.mjs",
  "captureAttempts",
);
assert(verifyAttemptsCall.length === 1);
add(
  "source-compares-pixels",
  "evals/draw/crop-source.mjs",
  verifyAttemptsCall[0].text,
  "1",
  ["evals/draw/crop-source.test.mjs"],
);
await edit(
  "structural-no-retry",
  "evals/draw/crop-attempts.mjs",
  "throw error;",
  "continue;",
  ["evals/draw/crop-attempts.test.mjs"],
);
await edit(
  "stop-first-pass",
  "evals/draw/crop-attempts.mjs",
  "if (!reason) return n;",
  "if (!reason) continue;",
  ["evals/draw/crop-attempts.test.mjs"],
);
await edit(
  "bind-retains-references",
  "evals/draw/repin-bind-crops.mjs",
  "await writeVerification(root, proofs.references);",
  "",
  ["evals/draw/bind-exhaustion.test.mjs"],
);
await edit(
  "bind-failure-audit",
  "evals/draw/repin-bind-crops.mjs",
  "crops: error.audit ?? [],",
  "crops: [],",
  ["evals/draw/bind-exhaustion.test.mjs"],
);
await edit(
  "pdf-ink-cache-shape",
  "evals/draw/crop-source.mjs",
  "row.cropShape,",
  "undefined,",
  ["evals/draw/pdf-source.test.mjs"],
);
await edit(
  "pdf-ink-independent-derivation",
  "evals/draw/pdf-source.mjs",
  "const expected = await derivePdfInk(page, document, row);",
  "const expected = row;",
  ["evals/draw/pdf-source.test.mjs"],
);
await edit(
  "pdf-builder-ink-shape",
  "evals/draw/repin-crop-index.mjs",
  "plan.cropShape = row.cropShape;",
  "plan.cropShape = undefined;",
  ["evals/draw/pdf-bind.test.mjs"],
);
await edit(
  "pdf-v2-archive-pin",
  "evals/draw/repin-record.mjs",
  'pin.recordSha256 === hash(files.get("record.json"))',
  "true",
  ["evals/draw/pdf-ink-archive.test.mjs"],
);
for (const [side, call] of [
  ["left", "Math.floor(x * 1000)"],
  ["top", "Math.floor(y * 1000)"],
  ["right", "Math.ceil(right * 1000)"],
  ["bottom", "Math.ceil(bottom * 1000)"],
])
  await edit(
    "pdf-ink-outward-" + side,
    "evals/draw/pdf-ink-policy.mjs",
    call,
    call.replace(/floor|ceil/, "round"),
    ["evals/draw/pdf-ink-policy.test.mjs"],
  );
await edit(
  "pdf-v2-manifest-binding",
  "evals/draw/repin-record.mjs",
  'json(record) === json(strictJsonBytes(files.get("record.json")))',
  "true",
  ["evals/draw/pdf-ink-archive.test.mjs"],
);
for (const [id, file, message] of [
  [
    "pdf-writer-index-version",
    "repin-record-write",
    "New PDF writer requires index 3.0",
  ],
  [
    "pdf-archive-index-version",
    "repin-record-crops",
    "New PDF archive requires index 3.0",
  ],
]) {
  const path = `evals/draw/${file}.mjs`;
  await source(path);
  const call = calls(path, "assert").find((a) => a.message?.includes(message));
  add(id, path, call.text, `assert(true, ${call.message})`, [
    "evals/draw/pdf-ink-archive.test.mjs",
  ]);
}
await edit(
  "pdf-archive-medium-dispatch",
  "evals/draw/repin-record-verification.mjs",
  `entry.sourceVerification.medium === "pdf" ||
      row?.scope?.medium === "pdf" ||
      row?.sourceRender?.medium === "pdf"`,
  'entry.sourceVerification.medium === "pdf"',
  ["evals/draw/pdf-ink-archive.test.mjs"],
);
for (const [id, from, to] of [
  [
    "original-bounds-eligibility",
    ".filter((s) => s.conductor || s.symbol || s.mark)",
    ".filter((s) => (s.conductor || s.symbol || s.mark) && s.bbox.x >= 20 && s.bbox.y >= 25 && s.bbox.y + s.bbox.h < g.height - 35)",
  ],
  ["painted-outline", "shape.paintedBbox ?? shape.bbox", "shape.bbox"],
  ["viewport", "shape.viewport", "undefined"],
  ["clip-paths", "...(shape.clips ?? [])", "...[]"],
  ["sheet", "[sheet, shape.viewport,", "[undefined, shape.viewport,"],
  ["left", "Math.max(box.x, clip.x)", "box.x"],
  ["top", "Math.max(box.y, clip.y)", "box.y"],
  ["right", "Math.min(box.x + box.w, clip.x + clip.w)", "box.x + box.w"],
  ["bottom", "Math.min(box.y + box.h, clip.y + clip.h)", "box.y + box.h"],
  [
    "range",
    "Math.min(1, (bbox.w * bbox.h) / area)",
    "(bbox.w * bbox.h) / area",
  ],
])
  await edit("utilisation-" + id, "evals/draw/utilisation.mjs", from, to, [
    "evals/draw/utilisation.test.mjs",
  ]);
await edit(
  "utilisation-partial-median",
  "evals/draw/evaluate.mjs",
  "geometries.some((g) => g.utilisationErrors?.length)",
  "false",
  ["evals/draw/utilisation.test.mjs"],
);

for (const [id, file, from, to] of [
  [
    "pdf-font-required",
    "continuation-labels",
    "!Number.isFinite(p.fontSize) || p.fontSize <= 0",
    "false",
  ],
  [
    "printed-wire-number",
    "continuation-labels",
    "w.properties?.label ?? w.designation",
    "w.designation",
  ],
  [
    "ambiguous-source",
    "continuation-labels",
    "selected.length !== 1",
    "selected.length === 0",
  ],
  [
    "literal-identity",
    "continuation-labels",
    "return body === expected.text;",
    "return body.includes(expected.text);",
  ],
  [
    "full-jumper-uid",
    "continuation-labels",
    "=== expected.uid",
    "=== expected.uid.slice(0,8)",
  ],
  [
    "reference-anywhere",
    "checks",
    "reference = referenceRow(rows, c.id)",
    "reference = rows[0]",
  ],
  [
    "identity-reference-anywhere",
    "continuation-labels",
    "const reference = referenceRow(rows, c.id);",
    "const reference = rows[0];",
  ],
  [
    "identity-above",
    "continuation-labels",
    "const parts = rows",
    "const parts = rows.slice(rows.indexOf(reference) + 1)",
  ],
  [
    "identity-below",
    "continuation-labels",
    "const parts = rows",
    "const parts = rows.slice(0, rows.indexOf(reference))",
  ],
  [
    "identity-split",
    "continuation-labels",
    'const body = parts.join("");',
    "const body = parts[0];",
  ],
  [
    "identity-split-order",
    "continuation-labels",
    'const body = parts.join("");',
    'const body = parts.reverse().join("");',
  ],
  [
    "reference-single",
    "continuation-labels",
    "refs.length === 1",
    "refs.length > 0",
  ],
  [
    "jumper-contract",
    "continuation-labels",
    'const jumper = parts.join("\\n");',
    'const jumper = parts.join("\\n").replace(/^JUMPER(?: ?\\(no designation\\))?(?: ?UID )?/, "JUMPER ");',
  ],
  [
    "pdf-text-envelope",
    "continuation-labels",
    "p.bbox.x >= b.x - 0.17",
    "true",
  ],
  [
    "link-ownership",
    "continuation-labels",
    "t.continuationLink === source.element",
    "true",
  ],
  [
    "physical-rows",
    "continuation-labels",
    "Math.abs(last.rowY - y) <= 0.17",
    "true",
  ],
  [
    "same-sheet-peer",
    "checks",
    "p !== source && p.id === c.id",
    "p.id === c.id",
  ],
  ["reciprocal-other", "checks", "r !== c &&", "true &&"],
  [
    "peer-grid",
    "checks",
    "zoneAt(targetGeometry, anchor)",
    "zoneAt(g, source.anchor)",
  ],
  ["missing-pdf-row", "continuation-labels", "if (!runs.length)", "if (false)"],
  [
    "pdf-actual-text",
    "continuation-labels",
    "renderedString: p.renderedString ?? p.text,",
    "renderedString: t.renderedString ?? t.text,",
  ],
  [
    "pdf-actual-size",
    "continuation-labels",
    "emBbox: p.bbox,",
    "emBbox: p.bbox, fontSize: t.fontSize,",
  ],
  [
    "pdf-proximity",
    "continuation-labels",
    ".filter((x) => x.dy < Math.max(0.8, x.t.fontSize * 0.65) && x.dx < 0.5)",
    ".filter(() => true)",
  ],
  [
    "medium-rows",
    "continuation-labels",
    "a.length === b.length && a.every((s, i) => s === b[i])",
    "true",
  ],
])
  await edit("continuation-" + id, "evals/draw/" + file + ".mjs", from, to, [
    "evals/draw/continuation-labels.test.mjs",
  ]);
for (const [id, file, from, to, tests] of [
  [
    "header-zone",
    "checks",
    "const header = referenceHeader(reference, c.id);",
    "const match=reference?.text.match(/\\/\\s*(\\d+)[. :/]([A-D][1-6])/); const header=match ? {page:Number(match[1]),zone:match[2]}:undefined;",
    ["continuation-labels"],
  ],
  [
    "clip-intersection",
    "pdf-clip-operators",
    "Math.max(a.x, b.x)",
    "a.x",
    ["pdf-painted"],
  ],
  [
    "clip-rectangle",
    "pdf-clip-operators",
    "p.length === 13",
    "true",
    ["pdf-painted"],
  ],
  [
    "painted-partial",
    "pdf-painted",
    "if (ink.every((g) => g.visible))",
    "if (true)",
    ["pdf-painted"],
  ],
  [
    "retention-svg",
    "retention",
    "for (const sheet of packet.sheets)",
    "for (const sheet of packet.sheets.slice(0,1))",
    ["retention"],
  ],
  [
    "retention-finally",
    "retention",
    "await compactCase(directory, artifacts);",
    "void directory;",
    ["retention"],
  ],
  [
    "budget-pins",
    "output",
    "report = { ...report, exitCode: 2, summary: summary(results), results };",
    "report = { ...report, sourceHashes:undefined, exitCode: 2, summary: summary(results), results };",
    ["output"],
  ],
  [
    "budget-cost",
    "output",
    "    cost = await outputCost(root, artifacts, budget);",
    "    void cost;",
    ["output"],
  ],
])
  await edit(
    "k154b-" + id,
    "evals/draw/" + file + ".mjs",
    from,
    to,
    tests.map((t) => "evals/draw/" + t + ".test.mjs"),
  );
// Deliberately harmless mutation must survive; it proves survivors are observable.
await edit(
  "benign-comment-control",
  "evals/draw/crop-source-pixels.mjs",
  "// A measured envelope",
  "// A harmless comment before a measured envelope",
  [all[2]],
);
if (v.list) {
  await writeFile(
    out,
    JSON.stringify(
      vectors.map(({ id, file, tests }) => ({ id, file, tests })),
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  await rm(copy, { recursive: true, force: true });
  console.log("Validated " + vectors.length + " mutation anchors");
  process.exit(0);
}
const before = loadavg(),
  start = performance.now(),
  results = [];
function executeTests(tests, label) {
  const report = join(copy, "evals/out/results.json");
  try {
    require("node:fs").unlinkSync(report);
  } catch {}
  const p = spawnSync(
    "bun",
    [
      join(copy, "node_modules/vitest/vitest.mjs"),
      "run",
      ...tests,
      "--maxWorkers=2",
      "--reporter=json",
      "--outputFile=" + report,
    ],
    {
      cwd: copy,
      encoding: "utf8",
      env: {
        ...process.env,
        THERMITE_DRAW_CHROMIUM: "/nonexistent/x",
        THERMITE_DRAW_PDFKIT: "0",
      },
    },
  );
  let data;
  try {
    data = JSON.parse(require("node:fs").readFileSync(report, "utf8"));
  } catch {}
  const failed = (data?.testResults ?? []).flatMap((r) =>
    (r.assertionResults ?? [])
      .filter((t) => t.status === "failed")
      .map((t) => ({
        test: t.fullName,
        message: t.failureMessages.join("\n").slice(0, 1600),
      })),
  );
  const brokenSuite = (data?.testResults ?? []).some(
    (r) => r.status === "failed" && !r.assertionResults?.length,
  );
  const status =
    p.status === 0 && data?.numPassedTests > 0
      ? "survived"
      : !brokenSuite && failed.length
        ? "killed"
        : "invalid";
  return {
    id: label,
    status,
    failed,
    exit: p.status,
    passed: data?.numPassedTests,
    stderr: status === "invalid" ? p.stderr.slice(-3000) : undefined,
  };
}
try {
  const control = executeTests(all, "unmodified-control");
  assert(
    control.status === "survived",
    "Mutation control must pass: " + JSON.stringify(control),
  );
  results.push(control);
  console.log("Green control: " + control.passed + " tests");
  for (const [n, m] of vectors.entries()) {
    await writeFile(
      join(copy, m.file),
      original.get(m.file).replace(m.from, m.to),
    );
    const r = executeTests(m.tests, m.id);
    results.push(r);
    console.log(`${n + 1}/${vectors.length} ${r.status}: ${m.id}`);
    await writeFile(join(copy, m.file), original.get(m.file));
  }
} finally {
  await rm(copy, { recursive: true, force: true });
}
const data = {
  total: vectors.length,
  killed: results.filter((r) => r.status === "killed").length,
  survived: results.filter(
    (r) => r.status === "survived" && r.id !== "unmodified-control",
  ).length,
  invalid: results.filter((r) => r.status === "invalid").length,
  seconds: (performance.now() - start) / 1000,
  loadBefore: before,
  loadAfter: loadavg(),
  results,
};
await writeFile(out, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...data, results: undefined }));
assert(!data.invalid, "Invalid mutation runs are not kills");
assert(
  results.find((r) => r.id === "benign-comment-control")?.status === "survived",
  "The harmless comment control must survive",
);
assert(
  results.every(
    (r) =>
      r.status === "killed" ||
      ["unmodified-control", "benign-comment-control"].includes(r.id),
  ),
  "Every behavioral mutant must be caught",
);
