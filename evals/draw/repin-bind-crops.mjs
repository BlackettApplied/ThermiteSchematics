import { readReportFile } from "./report-file.mjs";
// Prepare pixel facts before an independent reviewer signs; never writes approvals.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, writeFile } from "node:fs/promises";
import { strictJsonFile, within, readReviewedCrop } from "./repin-io.mjs";
import {
  bindDrawingDraft,
  drawingReferences,
} from "./repin-drawing-bindings.mjs";
import { verifyCropSources } from "./crop-source.mjs";
import { checkIndexedEntries } from "./crop-report.mjs";
import { verifyStampHeaders } from "./crop-stamp-check.mjs";
import { json } from "./support.mjs";
import { writeVerification } from "./verification-io.mjs";
const { values } = parseArgs({
  options: {
    decisions: { type: "string" },
    report: { type: "string" },
    baseline: { type: "string", multiple: true },
    "crop-index": { type: "string" },
    output: { type: "string" },
    "source-root": { type: "string" },
  },
});
assert(
  values.decisions && values["crop-index"] && values.output,
  "Supply --decisions <unreviewed.json> --crop-index <index.json> --output <bound-draft.json>",
);
const root = fileURLToPath(new URL("../../", import.meta.url));
await within(resolve(root, "evals/out"), root, { existing: true });
const output = await within(resolve(values.output), resolve(root, "evals/out"));
const auditPath = output + ".audit.json";
const exists = (path) =>
  lstat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
const auditExists = await exists(auditPath),
  outputExists = await exists(output);
assert(
  !auditExists,
  `Bind audit already exists: "${auditPath}". Choose a fresh --output, or preserve then remove this audit after checking that no signed evidence depends on it. No captures were started.`,
);
assert(
  !outputExists,
  `Bound output already exists: "${output}". Choose a fresh --output; existing evidence is never overwritten. No captures were started.`,
);
const file = await strictJsonFile(resolve(values.decisions)),
  index = await strictJsonFile(resolve(values["crop-index"]));
const reports = new Map(),
  contexts = new Map(),
  roots = new Map();
if (
  drawingReferences(file.value).length ||
  file.value.entries.some((e) => e.action === "rename")
) {
  assert(values.report, "Cropped bindings require --report <summary.json>");
  for (const path of [values.report, ...(values.baseline ?? [])]) {
    const r = await readReportFile(resolve(path));
    reports.set(r.sha256, r.value);
    roots.set(r.sha256, dirname(resolve(path)));
    contexts.set(r.sha256, {
      role: path === values.report ? "report" : "baseline",
      path,
      sha256: r.sha256,
    });
  }
  if (values["source-root"])
    roots.set(file.value.summarySha256, resolve(values["source-root"]));
  checkIndexedEntries(file.value, index.value, reports, contexts);
}
const crops = new Map();
for (const c of index.value.crops)
  crops.set(c.path, await readReviewedCrop(root, c));
const bound = bindDrawingDraft(file.value, index.value, crops);
await verifyStampHeaders(index.value, crops);
let proofs;
try {
  proofs = await verifyCropSources(roots, index.value, crops);
} catch (error) {
  await writeVerification(root, error.references);
  await writeFile(
    auditPath,
    json({
      format: "thermite-draw-bind-audit/1.0",
      crops: error.audit ?? [],
      error: error.message,
    }),
    { flag: "wx" },
  );
  delete error.references;
  delete error.audit;
  throw error;
}
await writeVerification(root, proofs.references);
await writeFile(
  auditPath,
  json({ format: "thermite-draw-bind-audit/1.0", crops: proofs.audit ?? [] }),
  { flag: "wx" },
);
for (const { entry, crop } of drawingReferences(bound))
  entry.sourceVerification = proofs.get(crop.path);
await writeFile(output, json(bound), { flag: "wx" });
process.stdout.write(
  `Bound drawing hashes and verified source pixels from ${crops.size} crops; all entries remain unreviewed.\n`,
);
