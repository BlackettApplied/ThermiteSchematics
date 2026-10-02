import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, documentationCsv } from "@thermite/query";
const temporary: string[] = [];
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject(resolve("examples/report-filtering"));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});
afterEach(async () => {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
});
async function project() {
  const root = await mkdtemp(join(tmpdir(), "thermite-report-filter-"));
  temporary.push(root);
  const p = join(root, "project");
  await cp(resolve("examples/report-filtering"), p, { recursive: true });
  return p;
}
function run(
  args: string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["thermite.mjs", ...args], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 2, stdout, stderr }));
    child.stdin.end(input);
  });
}
describe("CLI report filter requests", () => {
  it.each(["file", "stdin"])(
    "exports matching CSV and selection metadata through %s",
    async (transport) => {
      const p = await project(),
        out = join(p, "filtered.csv"),
        filter = { devices: ["PLC1"] };
      await writeFile(join(p, "filter.json"), JSON.stringify(filter));
      const r = await run(
        [
          "report",
          "wires",
          "--project",
          p,
          "--filter",
          transport === "stdin" ? "-" : join(p, "filter.json"),
          "-o",
          out,
        ],
        transport === "stdin" ? JSON.stringify(filter) : undefined,
      );
      expect(r.code).toBe(0);
      const table = buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind: "wires",
        filter,
      });
      expect(await readFile(out, "utf8")).toBe(documentationCsv(table));
      const report = JSON.parse(r.stderr);
      expect(report.selection).toEqual(table.selection);
      expect(report.diagnostics).toHaveLength(7);
    },
  );
  it("uses the same filter for printable and JSON packet reports", async () => {
    const p = await project(),
      input = join(p, "main.filter.json"),
      out = join(p, "filtered.json");
    const r = await run([
      "report",
      "network",
      "--project",
      p,
      "--filter",
      input,
      "--json",
      "-o",
      out,
    ]);
    expect(r.code).toBe(0);
    const packet = JSON.parse(await readFile(out, "utf8"));
    expect(packet.documentationSelections).toHaveLength(1);
    expect(packet.documentationSelections[0].view).toBe(1);
    expect(packet.sheets[0].svg).toContain("NET1");
    expect(packet.sheets[0].svg).not.toContain("NET2");
    expect(packet.sheets[0].svg).toContain("DOC1.IN");
  });
  it("rejects malformed/unknown filters and mixed legacy selectors without writing output", async () => {
    const p = await project(),
      input = join(p, "filter.json"),
      out = join(p, "filtered.csv");
    for (const filter of [
      { devices: ["Missing"] },
      { devices: [] },
      { typo: ["PLC1"] },
    ]) {
      await writeFile(input, JSON.stringify(filter));
      const r = await run([
        "report",
        "bom",
        "--project",
        p,
        "--filter",
        input,
        "-o",
        out,
      ]);
      expect(r.code).not.toBe(0);
      await expect(readFile(out)).rejects.toThrow();
    }
    await writeFile(input, JSON.stringify({ devices: ["PLC1"] }));
    const r = await run([
      "report",
      "io",
      "--project",
      p,
      "--device",
      "PLC1",
      "--filter",
      input,
      "-o",
      out,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("either device or filter");
    await expect(readFile(out)).rejects.toThrow();
  });
  it("preserves the source-output guard for filtered reports", async () => {
    const p = await project(),
      source = join(p, "source.json"),
      before = await readFile(source, "utf8");
    const r = await run([
      "report",
      "network",
      "--project",
      p,
      "--filter",
      join(p, "main.filter.json"),
      "--json",
      "-o",
      source,
    ]);
    expect(r.code).not.toBe(0);
    expect(await readFile(source, "utf8")).toBe(before);
  });
});
