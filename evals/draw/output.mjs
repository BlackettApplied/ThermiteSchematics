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
  for (let i = 0; i < 8; i++) {
    data.outputBytes = base + Buffer.byteLength(json(data));
    data.withinBudget = artifacts || data.outputBytes <= data.budgetBytes;
  }
  await writeFile(join(root, "cost.json"), json(data));
  return data;
}
