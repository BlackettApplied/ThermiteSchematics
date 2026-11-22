// Apply reviewed mixed deltas to the existing registry. Never re-seed it.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cases, verifyCorpus } from "./corpus.mjs";
import {
  executeRepin,
  loadRepinInputs,
  writeInventory,
  writeDraft,
} from "./repin-io.mjs";
import { json } from "./support.mjs";
const drafting = process.argv[2] === "draft";
const { values } = parseArgs({
  args: process.argv.slice(drafting ? 3 : 2),
  options: {
    report: { type: "string" },
    decisions: { type: "string", multiple: true },
    baseline: { type: "string", multiple: true },
    preview: { type: "string" },
    apply: { type: "boolean", default: false },
    inventory: { type: "string" },
    output: { type: "string" },
    pr: { type: "string" },
    "baseline-sha": { type: "string" },
    survivor: { type: "string", multiple: true },
    superseded: { type: "string", multiple: true },
  },
});
const root = fileURLToPath(new URL("../../", import.meta.url));
if (drafting) {
  assert(
    values.inventory &&
      values.output &&
      !values.report &&
      !values.apply &&
      !values.preview &&
      !values.decisions &&
      !values.baseline,
    "Draft requires --inventory, --output and --pr; no apply inputs",
  );
  const draft = await writeDraft({
    root,
    inventoryPath: resolve(values.inventory),
    path: values.output,
    pr: values.pr,
    baselineSha256: values["baseline-sha"],
    survivors: (values.survivor ?? []).map((choice) => {
      assert(
        /^\d+:[a-f0-9]{64}$/.test(choice),
        "Use --survivor <retirement-index>:<current-instance-token>",
      );
      const [entryIndex, token] = choice.split(":");
      return { entryIndex: Number(entryIndex), token };
    }),
    superseded: (values.superseded ?? []).map((choice) => {
      assert(
        /^\d+:\d+$/.test(choice),
        "Use --superseded <retirement-index>:<successor-index>",
      );
      const [entryIndex, successor] = choice.split(":").map(Number);
      return { entryIndex, successor };
    }),
  });
  process.stdout.write(
    `Wrote ${draft.entries.length} unreviewed entries; no causes approved.\n`,
  );
} else {
  assert(values.report, "Supply --report <full-strict-summary.json>");
  assert(
    !values.output &&
      !values.pr &&
      !values["baseline-sha"] &&
      !values.superseded &&
      !values.survivor,
    "Draft-only flags require draft",
  );
  const inputs = await loadRepinInputs({
    root,
    reportPath: resolve(values.report),
    decisionPaths: (values.decisions ?? []).map((p) => resolve(p)),
    baselinePaths: (values.baseline ?? []).map((p) => resolve(p)),
    specs: cases(),
  });
  const seal = await verifyCorpus(
    root,
    fileURLToPath(new URL("./", import.meta.url)),
  );
  assert(
    inputs.report.corpusSha256 === seal.seal,
    "Report corpus seal is stale; run a fresh C1",
  );
  if (values.inventory) {
    assert(
      !values.apply && !values.preview && !values.decisions?.length,
      "Inventory does not apply decisions",
    );
    await writeInventory({ root, inputs, path: values.inventory });
    process.stdout.write("Inventory written; no decisions approved.\n");
  } else {
    const { receipt } = await executeRepin({
      root,
      inputs,
      previewPath: values.preview,
      apply: values.apply,
    });
    process.stdout.write(json(receipt));
  }
}
