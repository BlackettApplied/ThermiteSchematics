import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputCost, directoryBytes } from "./output.mjs";
it("accounts for its own bytes and rejects an exceeded default budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "draw-output-"));
  try {
    await writeFile(join(root, "evidence.json"), "{}\n");
    const a = await outputCost(root);
    expect(a.outputBytes).toBe(await directoryBytes(root));
    expect(a.withinBudget).toBe(true);
    expect((await outputCost(root, false, 1)).withinBudget).toBe(false);
    expect((await outputCost(root, true, 1)).withinBudget).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
