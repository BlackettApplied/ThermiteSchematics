import { compileProject } from "@thermite/compiler";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadSchemaRegistry } from "@thermite/schema";
import { expect, it } from "vitest";
import { formatHumanDiagnostics } from "../src/index.js";
const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

it("keeps info-only outcomes successful across compiler, query, rendering and documentation commands", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "thermite-info-cli-"));
  const project = join(scratch, "project");
  try {
    await cp(join(repository, "examples/machine-demo"), project, {
      recursive: true,
    });
    const registry = await loadSchemaRegistry();
    const diagnostic = registry.ajv.getSchema(
      "https://thermiteschematics.com/schemas/0.1/diagnostic.schema.json",
    )!;
    const packet = join(scratch, "packet.json"),
      continuity = join(scratch, "continuity.json");
    const snapshot = join(scratch, "snapshot.json");
    const compiled = await compileProject(project);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const sources = [
      ...compiled.ir.wires.map((w) => ({
        designation: w.designation,
        terminals: w.endpoints.map((e) => e.terminal),
      })),
      ...compiled.ir.cableConductors.map((c) => ({
        designation: `${compiled.ir.cables.find((d) => d.uid === c.cableUid)!.designation}/${c.id.conductorId}`,
        terminals: c.endpoints.map((e) => e.terminal),
      })),
    ];
    const drawingConductors = [
      ...new Set(
        compiled.ir.devices.map(
          (d) =>
            sources.find((c) => c.terminals.some((t) => t.deviceUid === d.uid))
              ?.designation,
        ),
      ),
    ];
    expect(drawingConductors).not.toContain(undefined);
    // Keep this an info-only packet: each device has an actual wiring appearance.
    await writeFile(
      packet,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        views: [
          { format: "documentation-view-request/0.1", kind: "io" },
          ...drawingConductors.map((designation) => ({
            format: "wiring-view-request/0.1",
            title: `Wiring ${designation}`,
            conductors: [designation],
          })),
        ],
      }),
    );
    await writeFile(
      continuity,
      JSON.stringify({
        format: "continuity-check-request/0.1",
        checks: [
          {
            id: "commons",
            reason: "Authored wire joins these terminals.",
            from: {
              by: "parts",
              deviceDesignation: "PLC1",
              terminalKey: "X11.1",
            },
            to: {
              by: "parts",
              deviceDesignation: "PLC1",
              terminalKey: "X11.2",
            },
          },
        ],
      }),
    );
    const cases = [
      ["validate", project],
      ["validate", project, "--strict"],
      ["validate", project, "--strict", "--json"],
      ["compile", project, "--diagnostics-json"],
      ["inspect", "K1", "--project", project, "--json"],
      ["neighbors", "K1", "--project", project, "--json"],
      ["trace", "K1", "--project", project, "--json"],
      [
        "net",
        "--device",
        "PLC1",
        "--terminal",
        "X11.1",
        "--project",
        project,
        "--json",
      ],
      ["cable", "CBL1", "--project", project, "--json"],
      ["render", "K1", "--family", "control", "--project", project, "--json"],
      ["view", "K1", "--actuation", "--project", project, "--json"],
      ["diagnostics", "--project", project],
      ["diagnostics", "--project", project, "--json"],
      ["report", "io", "--project", project, "--json"],
      ["report", "io", "--project", project, "-o", join(scratch, "io.csv")],
      ["snapshot", "--project", project, "-o", snapshot],
      ["review", "--project", project, "--before", snapshot, "--json"],
      ["continuity", "--project", project, "--input", continuity, "--json"],
      ["packet", "--project", project, "--input", packet, "--json"],
      ["packet", "--project", project, "--input", packet, "--json", "--strict"],
    ];
    for (const args of cases) {
      let output;
      try {
        output = await exec(
          process.execPath,
          [join(repository, "thermite.mjs"), ...args],
          { cwd: scratch, maxBuffer: 16 * 1024 * 1024 },
        );
      } catch (error) {
        throw new Error(`${args.join(" ")}: ${String(error)}`);
      }
      const { stdout, stderr } = output;
      expect(stdout).not.toBe("");
      if (args[0] === "validate") {
        expect(stderr).toBe("");
        if (args.includes("--json")) {
          const ds = JSON.parse(stdout);
          expect(ds.map((d: { code: string }) => d.code)).toEqual([
            "I304",
            "I305",
          ]);
          expect(ds.every(diagnostic)).toBe(true);
          expect(formatHumanDiagnostics(ds)).toContain(
            "I304 Voltage compatibility is unassessed",
          );
          expect(formatHumanDiagnostics(ds, true)).toContain(
            "\u001b[36mI304\u001b[0m",
          );
        } else
          expect(stdout).toContain("I304 Voltage compatibility is unassessed");
      } else {
        const report = JSON.parse(stderr),
          ds = Array.isArray(report) ? report : report.diagnostics;
        expect(ds.map((d: { code: string }) => [d.code, d.severity])).toEqual([
          ["I304", "info"],
          ["I305", "info"],
        ]);
        expect(ds.every(diagnostic)).toBe(true);
      }
      if (args[0] === "diagnostics" && args.includes("--json")) {
        const inventory = JSON.parse(stdout);
        expect(inventory.findings.length).toBeGreaterThan(0);
        expect(
          inventory.findings.every(
            (f: { severity: string }) => f.severity === "info",
          ),
        ).toBe(true);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
