import { expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directoryBytes } from "./output.mjs";
import { readCheckpointReport } from "./report-file.mjs";

const caseId = "init-starter-left-to-right";
const packet = Buffer.of(0x7b, 0x22, 0xe2, 0x82); // Interrupted UTF-8 write.
vi.mock("./browser.mjs", () => ({
  launch: async () => ({ version: () => "synthetic", close: async () => {} }),
}));
vi.mock("./run-case.mjs", () => ({
  renderCase: async (spec, _index, { dest }) => {
    const dir = join(dest, spec.id);
    await mkdir(dir);
    await writeFile(join(dir, "packet.json"), packet);
    return { case: spec.id, ok: false, rows: [], sheets: [] };
  },
}));

it("finalizes a failed archive checkpoint with its loose evidence and exit 2", async () => {
  const out = fileURLToPath(new URL("../out/draw/", import.meta.url));
  await mkdir(out, { recursive: true });
  const dest = await mkdtemp(join(out, "case-archive-test-"));
  const { argv, exitCode } = process;
  try {
    process.argv = [
      ...argv.slice(0, 2),
      "--checkpoint",
      basename(dest),
      "--report-only",
      "--case",
      caseId,
    ];
    await import("./run.mjs");
    expect(process.exitCode).toBe(2);
    const { value: report } = await readCheckpointReport(dest);
    expect(report.exitCode).toBe(2);
    expect(
      report.results.filter((r) => r.status === "infrastructure-error"),
    ).toEqual([expect.objectContaining({ id: "harness/case-archive" })]);
    expect(await readFile(join(dest, "summary.md"), "utf8")).toContain(
      "harness/case-archive: **infrastructure-error**",
    );
    const cost = JSON.parse(await readFile(join(dest, "cost.json"), "utf8"));
    expect(cost.outputBytes).toBe(await directoryBytes(dest));
    expect(await readFile(join(dest, caseId, "packet.json"))).toEqual(packet);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    await rm(dest, { recursive: true, force: true });
  }
});
