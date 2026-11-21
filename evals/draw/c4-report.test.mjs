import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { hash, canonical } from "./support.mjs";
import {
  encodedReportBytes,
  parseReportBytes,
  readReportFile,
  writeReportFile,
} from "./report-file.mjs";
import { strictJsonFile } from "./repin-io.mjs";
import { finalizeOutput, directoryBytes } from "./output.mjs";
import { failureArticle } from "./gallery.mjs";
import { cliFixture } from "./repin-cli-fixture.mjs";
import { loadRepinInputs } from "./repin-io.mjs";
it("S2 official inventory accepts raw/gzip reports and binds the chosen container", async () => {
  const c = await cliFixture();
  try {
    const rawPath = join(c.out, "report.json"),
      raw = await readFile(rawPath),
      gz = gzipSync(raw),
      gzipPath = join(c.out, "report.json.gz");
    await writeFile(gzipPath, gz);
    const inputs = await loadRepinInputs({
      root: c.root,
      reportPath: gzipPath,
      baselinePaths: [rawPath],
      specs: c.context.specs,
    });
    expect(inputs.report).toEqual(c.context.report);
    expect(inputs.reportSha256).toBe(hash(gz));
    expect(inputs.baselines.get(hash(raw))).toEqual(c.context.report);
    expect(hash(raw)).not.toBe(hash(gz));
    for (const [name, path] of [
      ["raw", rawPath],
      ["gzip", gzipPath],
    ]) {
      const result = c.run(
        "--report",
        path,
        "--inventory",
        join(c.out, name + "-inventory.json"),
      );
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    }
  } finally {
    await c.cleanup();
  }
});
it("S2 report container preserves every canonical row byte and binds exact stored bytes", async () => {
  const report = {
    format: "test",
    results: [
      {
        id: "a",
        status: "fail",
        evidence: { findings: [{ kind: "unicode", text: "λ" }] },
      },
    ],
  };
  const raw = encodedReportBytes(report, true),
    gz = encodedReportBytes(report);
  expect(gunzipSync(gz)).toEqual(raw);
  expect(encodedReportBytes(report)).toEqual(gz);
  expect(parseReportBytes(raw)).toEqual(canonical(report));
  expect(parseReportBytes(gz)).toEqual(canonical(report));
  const dir = await mkdtemp(join(tmpdir(), "report-container-"));
  try {
    await writeFile(join(dir, "summary.json"), raw);
    await writeReportFile(dir, report);
    await expect(access(join(dir, "summary.json"))).rejects.toThrow();
    expect(await readReportFile(join(dir, "summary.json.gz"))).toEqual({
      value: canonical(report),
      sha256: hash(gz),
    });
    // Signed decisions and ordinary strict JSON do not silently gain compressed-input support.
    await expect(
      strictJsonFile(join(dir, "summary.json.gz")),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each([
  ["duplicate keys", Buffer.from('{"results":[],"results":[]}')],
  ["invalid UTF8", Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125])],
])("S2 refuses %s in both raw and gzip report containers", (_name, raw) => {
  expect(() => parseReportBytes(raw)).toThrow();
  expect(() => parseReportBytes(gzipSync(raw))).toThrow();
});
it("S2 refuses corrupted and truncated compressed reports", () => {
  const gz = encodedReportBytes({ results: [] });
  expect(() => parseReportBytes(gz.subarray(0, -4))).toThrow();
  const bad = Buffer.from(gz);
  bad[bad.length - 8] ^= 1;
  expect(() => parseReportBytes(bad)).toThrow();
});
it("S2 cost counts the compressed report physically, without changing the cap or observations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "report-cost-"));
  try {
    const report = {
      exitCode: 1,
      results: [
        {
          id: "a",
          dq: "DQ-01",
          status: "fail",
          evidence: { findings: [{ text: "same ".repeat(10000) }] },
        },
      ],
    };
    const x = await finalizeOutput(dir, report);
    expect(x.report).toEqual(report);
    expect(x.cost.outputBytes).toBe(await directoryBytes(dir));
    expect(x.cost.budgetBytes).toBe(100000000);
    expect(
      (await readReportFile(join(dir, "summary.json.gz"))).value.results,
    ).toEqual(report.results);
    expect((await readFile(join(dir, "summary.json.gz"))).length).toBeLessThan(
      1000,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("S2 gallery labels boxed SVG evidence truthfully, links it, and displays bounds/scope/summary", () => {
  const r = {
    id: "row<&",
    status: "fail",
    scope: "SVG only; no HTML/PDF certification",
    evidence: {
      svg: "case/sheet-001.svg",
      summary: "Native note <source>",
      findings: [{ kind: "defect", bbox: { x: 1, y: 2, w: 3, h: 4 } }],
    },
  };
  const html = failureArticle(r);
  expect(html).toContain("Boxed finding");
  expect(html).toContain('href="case/sheet-001.svg"');
  expect(html).toContain("no automatic crop: output budget");
  expect(html).toContain("Measured bbox (mm)");
  expect(html).toContain("SVG only; no HTML/PDF certification");
  expect(html).toContain("Native note &lt;source>");
  expect(html).not.toContain("clipped or off-sheet");
  expect(html).not.toContain("Sheet-level finding");
});
