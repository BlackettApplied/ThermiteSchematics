import { readReportFile } from "./report-file.mjs";
// Build evidence with report-owned instance geometry. No sign-off or cause is written.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { strictJsonFile, within } from "./repin-io.mjs";
import { json, canonical, hash } from "./support.mjs";
import { pipelineCrops, cropPlans, instanceCropRow } from "./crop-index.mjs";
import { assertSourceBytes } from "./source-hashes.mjs";
const { values: v } = parseArgs({
  options: {
    report: { type: "string" },
    "source-root": { type: "string" },
    baseline: { type: "string", multiple: true },
    decisions: { type: "string" },
    output: { type: "string" },
    index: { type: "string" },
    samples: { type: "string" },
  },
});
assert(
  v.report && v.index,
  "Use --report <summary.json> --index <index.json> [--decisions <unsigned.json> --output <prepared.json> --samples <directory>]",
);
const root = fileURLToPath(new URL("../../", import.meta.url)),
  reports = new Map(),
  contexts = new Map(),
  roots = new Map();
for (const path of [v.report, ...(v.baseline ?? [])]) {
  const r = await readReportFile(resolve(path));
  reports.set(r.sha256, r.value);
  roots.set(r.sha256, dirname(resolve(path)));
  contexts.set(r.sha256, {
    role: path === v.report ? "report" : "baseline",
    path,
    sha256: r.sha256,
  });
}
const current = await readReportFile(resolve(v.report));
if (v["source-root"]) roots.set(current.sha256, resolve(v["source-root"]));
if (!v.decisions) {
  const rows = pipelineCrops(current.value, current.sha256);
  const out = await within(resolve(v.index), join(root, "evals/out"));
  await writeFile(
    out,
    json({
      format: "thermite-draw-pipeline-crops/1.0",
      reportSha256: current.sha256,
      crops: rows,
    }),
    { flag: "wx" },
  );
  process.stdout.write(
    `Indexed ${rows.length} pipeline crops, ${rows.filter((c) => !c.supported).length} unsupported PDF crops.\n`,
  );
} else {
  assert(
    v.output && v.samples,
    "Decision crops require --output and --samples",
  );
  const file = await strictJsonFile(resolve(v.decisions));
  assert(
    file.value.summarySha256 === current.sha256,
    "Draft/report hash mismatch",
  );
  assert(
    file.value.entries.every(
      (e) => e.reviewed === false && !e.signOff?.kind && !e.signOff?.by,
    ),
    "Build crops before sign-off",
  );
  const draft = structuredClone(file.value),
    plans = cropPlans(draft, reports, contexts),
    rows = [];
  await mkdir(join(root, "evals/out/draw-samples"), { recursive: true });
  const samples = resolve(v.samples);
  const samplesRoot = join(root, "evals/out/draw-samples");
  await within(samples, samplesRoot);
  await mkdir(samples);
  await within(samples, samplesRoot, { existing: true });
  const { stampInstanceDrawingCrop } =
    await import("../../scripts/stamp-drawing-crop.mjs");
  let browser;
  try {
    for (const plan of plans) {
      const sourceRoot = roots.get(plan.reportSha256),
        sourceRef = plan.sourceRef;
      const source = await readFile(
        await within(join(sourceRoot, sourceRef.path), sourceRoot, {
          existing: true,
        }),
      );
      assertSourceBytes(source, sourceRef);
      const { launch, cropBox } = await import("./browser.mjs");
      const { readCropSource, captureSourceCrop } =
        await import("./crop-source.mjs");
      const medium = plan.t.scope.medium;
      let row = {
        scope: plan.t.scope,
        physicalSheet: plan.t.physicalSheet,
        sourceRender: {
          medium,
          [medium]: sourceRef.path,
          [medium + "Sha256"]: sourceRef.sha256,
          ...(medium === "pdf"
            ? {
                backend: sourceRef.backend,
                pdfjsVersion: sourceRef.pdfjsVersion,
                page: sourceRef.page,
              }
            : {}),
        },
        instanceBbox: plan.t.bbox,
        text: plan.t.facts.text,
      };
      const sourceData = await readCropSource(sourceRoot, row),
        { text } = sourceData;
      let box = plan.sourceBbox;
      if (medium === "pdf") {
        row = await (
          await import("./pdf-source.mjs")
        ).preparePdfCrop(sourceData.bytes, row);
        box = row.sourceBbox;
        plan.cropShape = row.cropShape;
      }
      if (!box) {
        const { parseHTML } = await import("linkedom");
        const doc = parseHTML(text).document;
        const svg =
          medium === "html"
            ? doc.querySelector(`#sheet-${plan.t.physicalSheet}>svg`)
            : doc.querySelector("svg");
        assert(svg, "Source physical sheet is missing");
        const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
        box = canonical(cropBox(plan.t.bbox, vb[2], vb[3]));
      }
      let raw;
      if (medium === "pdf") {
        const { capturePdfCrop } = await import("./pdf-source.mjs");
        raw = await capturePdfCrop(sourceData.bytes, {
          ...row,
          sourceBbox: box,
        });
      } else {
        if (!browser) browser = await launch();
        raw = await captureSourceCrop(browser, text, {
          ...row,
          sourceBbox: box,
        });
      }
      const bytes = await stampInstanceDrawingCrop(
        raw,
        plan.headerLines,
        { bbox: plan.t.bbox },
        box,
      );
      const path = relative(root, join(samples, plan.name))
        .split("\\")
        .join("/");
      await writeFile(join(root, path), bytes, { flag: "wx" });
      Object.assign(plan.crop, { path, sha256: hash(bytes) });
      rows.push(instanceCropRow(plan, path, bytes, box, source));
    }
  } finally {
    await browser?.close();
  }
  await writeFile(
    await within(resolve(v.index), join(root, "evals/out")),
    json({
      format: rows.some((r) => r.scope.medium === "pdf")
        ? "thermite-draw-crop-index/3.0"
        : "thermite-draw-crop-index/2.0",
      crops: rows,
    }),
    { flag: "wx" },
  );
  await writeFile(
    await within(resolve(v.output), join(root, "evals/out")),
    json(draft),
    { flag: "wx" },
  );
  process.stdout.write(
    `Prepared ${rows.length} crops and an unreviewed draft.\n`,
  );
}
