import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ir4 } from "./tranche4-fixtures.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";
import { archiveCaseFiles, readCheckpointCaseFiles } from "./case-files.mjs";
const state = vi.hoisted(() => ({ error: null }));
vi.mock("./browser.mjs", () => ({
  displaySheet: async () => {},
  evaluateSheetGeometry: async () => {
    throw state.error;
  },
}));
import { measureExposureCase } from "./navigation-exposure-capture.mjs";
const directories = [];
afterEach(async () => {
  for (const d of directories.splice(0))
    await rm(d, { recursive: true, force: true });
});
async function directory() {
  const d = await mkdtemp(join(tmpdir(), "check5-exposure-"));
  directories.push(d);
  await mkdir(join(d, "case"));
  return d;
}
it.each([{ error: { code: "R006" } }, { diagnostics: [{ code: "R006" }] }])(
  "CHECK5 real refusal envelopes remain not measured: %j",
  async (log) => {
    const d = await directory();
    await writeFile(join(d, "case/cli.log"), JSON.stringify(log));
    await archiveCaseFiles(d);
    const rows = await measureExposureCase(
      await readCheckpointCaseFiles(d),
      "case",
      { sourceHashes: { sheets: [] } },
      null,
      [],
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => r.assessment === "not-measured" && r.strict === false),
    ).toBe(true);
  },
);
it("CHECK5 an unknown no-sheet outcome refuses instead of becoming not applicable", async () => {
  const d = await directory();
  await writeFile(
    join(d, "case/cli.log"),
    JSON.stringify({ error: { code: "R999" } }),
  );
  const read = await readCheckpointCaseFiles(d);
  await expect(
    measureExposureCase(
      read,
      "case",
      { sourceHashes: { sheets: [] } },
      null,
      [],
    ),
  ).rejects.toThrow("bound R006");
});
async function measured() {
  const d = await directory(),
    svg = "<svg/>",
    packet = { sheets: [{ number: 1, view: { kind: "bom" } }] },
    report = {
      sourceHashes: {
        sheets: [
          {
            case: "case",
            sheet: 1,
            svg: { sha256: createHash("sha256").update(svg).digest("hex") },
          },
        ],
      },
    };
  for (const [name, value] of Object.entries({
    "packet.json": packet,
    "ir.json": ir4(),
    "request.json": { views: [] },
  }))
    await writeFile(join(d, "case", name), JSON.stringify(value));
  await writeFile(join(d, "case/sheet-001.svg"), svg);
  await archiveCaseFiles(d);
  return { read: await readCheckpointCaseFiles(d), report };
}
it("CHECK5 typed measurement failure retains explicit sheet evidence", async () => {
  const { read, report } = await measured();
  state.error = new IdentifierMeasurementError("cell unavailable");
  const rows = await measureExposureCase(read, "case", report, null, []);
  expect(
    rows.every(
      (r) =>
        r.sheet === 1 &&
        r.assessment === "infrastructure-error" &&
        r.failures.some(
          (f) => f.kind === "exposure-identifier-measurement-unavailable",
        ),
    ),
  ).toBe(true);
});
it("CHECK5 programming errors in exposure measurement propagate", async () => {
  const { read, report } = await measured();
  state.error = new TypeError("Identifier measurement-looking programming bug");
  await expect(
    measureExposureCase(read, "case", report, null, []),
  ).rejects.toBe(state.error);
});
