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
it("a forced budget refusal retains source pins and accounts for the final summary", async () => {
  const { finalizeOutput } = await import("./output.mjs"),
    { readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "draw-budget-"));
  try {
    const report = {
      exitCode: 0,
      sourceHashes: {
        format: "sources",
        sheets: [{ case: "one", sheet: 1, svg: { sha256: "a".repeat(64) } }],
      },
      results: [],
    };
    const done = await finalizeOutput(root, report, false, 1),
      written = (
        await (
          await import("./report-file.mjs")
        ).readReportFile(join(root, "summary.json.gz"))
      ).value;
    expect(written.sourceHashes).toEqual(report.sourceHashes);
    expect(written.exitCode).toBe(2);
    expect(written.results[0].id).toBe("harness/output-budget");
    expect(done.cost.outputBytes).toBe(await directoryBytes(root));
    expect(done.cost.withinBudget).toBe(false);
    expect(JSON.parse(await readFile(join(root, "cost.json"), "utf8"))).toEqual(
      done.cost,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("cost remains exact across its own byte-count and budget boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "draw-cost-boundary-"));
  try {
    for (const budget of [120, 121, 122, 123, 124, 125, 126, 127, 128]) {
      const cost = await outputCost(root, false, budget),
        bytes = await directoryBytes(root);
      expect(cost.outputBytes).toBe(bytes);
      expect(cost.withinBudget).toBe(bytes <= budget);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
