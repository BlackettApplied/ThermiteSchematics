import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connectorIoFixture } from "../../compiler/test/connector-io-fixture.js";
const exec = promisify(execFile);

describe("connector I/O report CLI", () => {
  it("exports CSV and printable packet JSON through report io-ports", async () => {
    const f = await connectorIoFixture();
    try {
      const base = [
        resolve("thermite.mjs"),
        "report",
        "io-ports",
        "--project",
        f.root,
        "--device",
        "R1",
      ];
      const output = resolve(f.root, "io.csv");
      const run = await exec(process.execPath, [...base, "-o", output]);
      const csv = await readFile(output, "utf8");
      expect(csv).toContain('"Module / location"');
      expect(csv).toContain("CAP1.P");
      expect(
        JSON.parse(run.stderr).diagnostics.every(
          (d: { severity: string }) => d.severity !== "error",
        ),
      ).toBe(true);
      const packet = await exec(process.execPath, [...base, "--json"]);
      const result = JSON.parse(packet.stdout);
      expect(
        result.sheets.every(
          (s: { view: { kind: string } }) => s.view.kind === "io-ports",
        ),
      ).toBe(true);
      expect(
        result.sheets.map((s: { svg: string }) => s.svg).join(" "),
      ).toContain("X4");
    } finally {
      await f.dispose();
    }
  });
});
