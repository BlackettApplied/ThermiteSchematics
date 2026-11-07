import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { initializeAlphaProject } from "../src/alpha-init.js";
const execFile = promisify(callback);
it("packet warnings exit 0 normally and 1 with --strict, with separate diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-coverage-cli-"));
  try {
    const project = join(root, "project");
    await initializeAlphaProject(project, {});
    const input = join(project, "packet.json");
    await writeFile(
      input,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "circuit-view-request/0.1",
            title: "Supply only",
            groups: [
              {
                id: "supply",
                conductors: [],
                functions: [
                  {
                    device: { by: "designation", value: "PS1" },
                    key: "dc_output",
                  },
                ],
              },
            ],
          },
          { format: "documentation-view-request/0.1", kind: "bom" },
        ],
      }),
    );
    const cabinets = join(root, "cabinets");
    await initializeAlphaProject(cabinets, { template: "cabinets" });
    const reports = join(cabinets, "reports.json");
    await writeFile(
      reports,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
      }),
    );
    const exempt = await execFile(process.execPath, [
      resolve("thermite.mjs"),
      "packet",
      "--project",
      cabinets,
      "--input",
      reports,
      "--strict",
      "--json",
    ]);
    expect(JSON.parse(exempt.stdout).coverage).not.toHaveProperty(
      "diagnostics",
    );
    expect(
      JSON.parse(exempt.stderr).diagnostics.some((d: any) => d.code === "W906"),
    ).toBe(false);
    for (const strict of [false, true]) {
      let result: { stdout: string; stderr: string; code?: number };
      try {
        result = {
          ...(await execFile(
            process.execPath,
            [
              resolve("thermite.mjs"),
              "packet",
              "--project",
              project,
              "--input",
              input,
              ...(strict ? ["--strict"] : []),
            ],
            { maxBuffer: 10 * 1024 * 1024 },
          )),
          code: 0,
        };
      } catch (error) {
        result = error as typeof result;
      }
      expect(result.code).toBe(strict ? 1 : 0);
      if (strict) expect(result.stdout).toBe("");
      else expect(result.stdout).toContain("<!doctype html>");
      const report = JSON.parse(result.stderr);
      expect(report.error).toBeNull();
      expect(
        report.diagnostics.filter((d: any) => d.code === "W906"),
      ).toHaveLength(1);
    }
    const output = join(project, "strict.html");
    await expect(
      execFile(process.execPath, [
        resolve("thermite.mjs"),
        "packet",
        "--project",
        project,
        "--input",
        input,
        "--strict",
        "-o",
        output,
      ]),
    ).rejects.toMatchObject({ code: 1, stdout: "" });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    for (const args of [
      ["view", "PS1", "--loads"],
      ["report", "bom"],
      ["report", "bom", "-o", join(project, "bom.csv")],
    ])
      await expect(
        execFile(process.execPath, [
          resolve("thermite.mjs"),
          ...args,
          "--project",
          project,
          "--strict",
        ]),
      ).rejects.toMatchObject({ code: 2 });
    const single = await execFile(process.execPath, [
      resolve("thermite.mjs"),
      "view",
      "K1",
      "--actuation",
      "--project",
      resolve("examples/motor-starter"),
      "--json",
    ]);
    expect(JSON.parse(single.stdout).coverage).not.toHaveProperty(
      "diagnostics",
    );
    expect(
      JSON.parse(single.stderr).diagnostics.some((d: any) => d.code === "W906"),
    ).toBe(false);
    await expect(
      execFile(process.execPath, [
        resolve("thermite.mjs"),
        "view",
        "PLC1",
        "--power",
        "--project",
        project,
        "--json",
      ]),
    ).rejects.toSatisfy((error: any) => {
      const report = JSON.parse(error.stderr);
      expect(report.error.message).not.toContain("Packet view[");
      expect(report.error.reason).toBe("root-not-accepted");
      return true;
    });
    // Complete drawing coverage is clean; L0's deferred AC feed still warns.
    await writeFile(
      input,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "PS1" },
            intent: { kind: "loads" },
          },
          { format: "documentation-view-request/0.1", kind: "bom" },
        ],
      }),
    );
    const fullArgs = [
      resolve("thermite.mjs"),
      "packet",
      "--project",
      project,
      "--input",
      input,
    ];
    const r = await execFile(process.execPath, fullArgs, {
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(
      JSON.parse(r.stderr).diagnostics.filter((d: any) => d.code === "W906"),
    ).toEqual([]);
    await expect(
      execFile(process.execPath, [...fullArgs, "--strict"], {
        maxBuffer: 10 * 1024 * 1024,
      }),
    ).rejects.toSatisfy((error: any) => {
      expect(error.code).toBe(1);
      expect(error.stdout).toBe("");
      expect(
        JSON.parse(error.stderr).diagnostics.map((d: any) => d.code),
      ).toEqual(["W905"]);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
