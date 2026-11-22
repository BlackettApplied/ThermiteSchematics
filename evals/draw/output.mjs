import { writeReportFile } from "./report-file.mjs";
import assert from "node:assert/strict";
import { summary } from "./assessment.mjs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { json } from "./support.mjs";
export async function directoryBytes(root, exclude = new Set()) {
  let size = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const path = join(root, entry.name);
    size += entry.isDirectory()
      ? await directoryBytes(path)
      : (await stat(path)).size;
  }
  return size;
}
export async function outputCost(root, artifacts = false, budget = 100000000) {
  const base = await directoryBytes(root, new Set(["cost.json"]));
  const data = {
    format: "thermite-draw-output-cost/1.0",
    outputBytes: base,
    budgetBytes: artifacts ? null : budget,
  };
  data.withinBudget = true;
  for (let i = 0; i < 32; i++) {
    data.outputBytes = base + Buffer.byteLength(json(data));
    data.withinBudget = artifacts || data.outputBytes <= data.budgetBytes;
    const bytes = json(data);
    if (data.outputBytes === base + Buffer.byteLength(bytes)) {
      await writeFile(join(root, "cost.json"), bytes);
      return data;
    }
  }
  assert.fail("Output cost did not converge");
}

export async function finalizeOutput(
  root,
  report,
  artifacts = false,
  budget = 100000000,
) {
  const write = (value) => writeReportFile(root, value, artifacts);
  await write(report);
  let cost = await outputCost(root, artifacts, budget);
  if (!cost.withinBudget) {
    const results = [
      ...report.results,
      {
        id: "harness/output-budget",
        status: "infrastructure-error",
        reason: `Default output ${cost.outputBytes} exceeds ${budget} byte budget`,
      },
    ];
    report = { ...report, exitCode: 2, summary: summary(results), results };
    await write(report);
    cost = await outputCost(root, artifacts, budget);
  }
  return { report, cost };
}
