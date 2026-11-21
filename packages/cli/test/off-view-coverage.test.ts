import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { access, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { p6Fixture, control } from "../../render/test/off-view-fixtures.js";

const execFile = promisify(callback);
it("off-view cards and reports retain W906 and strict refuses before stdout or files", async () => {
  const f = await p6Fixture();
  try {
    const input = join(f.root, "packet.json"),
      output = join(f.root, "strict.html");
    await writeFile(
      input,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        views: [
          control(),
          { format: "documentation-view-request/0.1", kind: "wires" },
        ],
      }),
    );
    const args = [
      resolve("thermite.mjs"),
      "packet",
      "--project",
      f.root,
      "--input",
      input,
    ];
    const normal = await execFile(process.execPath, args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(normal.stdout).toContain("Off-view at K1.A1");
    const report = JSON.parse(normal.stderr);
    expect(report.error).toBeNull();
    const warning = report.diagnostics.find((d: any) => d.code === "W906");
    expect(warning.devices.map((d: any) => d.designation)).toEqual(
      expect.arrayContaining(["H1", "R1"]),
    );
    for (const extra of [["--strict"], ["--strict", "-o", output]]) {
      await expect(
        execFile(process.execPath, [...args, ...extra], {
          maxBuffer: 10 * 1024 * 1024,
        }),
      ).rejects.toSatisfy((error: any) => {
        expect(error.code).toBe(1);
        expect(error.stdout).toBe("");
        expect(JSON.parse(error.stderr)).toEqual(report);
        return true;
      });
    }
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
}, 30000);
