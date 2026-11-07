// Prepare pixel facts before an independent reviewer signs; never writes approvals.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { strictJsonFile, within, readReviewedCrop } from "./repin-io.mjs";
import { bindDrawingDraft } from "./repin-drawing-bindings.mjs";
import { json } from "./support.mjs";
const { values } = parseArgs({
  options: {
    decisions: { type: "string" },
    "crop-index": { type: "string" },
    output: { type: "string" },
  },
});
assert(
  values.decisions && values["crop-index"] && values.output,
  "Supply --decisions <unreviewed.json> --crop-index <index.json> --output <bound-draft.json>",
);
const root = fileURLToPath(new URL("../../", import.meta.url));
const file = await strictJsonFile(resolve(values.decisions)),
  index = await strictJsonFile(resolve(values["crop-index"]));
const crops = new Map();
for (const c of index.value.crops)
  crops.set(c.path, await readReviewedCrop(root, c));
const bound = bindDrawingDraft(file.value, index.value, crops);
await within(resolve(root, "evals/out"), root, { existing: true });
const output = await within(resolve(values.output), resolve(root, "evals/out"));
await writeFile(output, json(bound), { flag: "wx" });
process.stdout.write(
  `Bound drawing hashes from ${crops.size} crops; all entries remain unreviewed.\n`,
);
