import { Readable } from "node:stream";
import { runCli } from "../../cli/src/index.js";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeFileIntegrity } from "@thermite/compiler";
import {
  loadSchemaRegistry,
  createInMemoryCanonicalSchemaRegistry,
} from "@thermite/schema";
import { expect, it } from "vitest";
import {
  createAgentTools,
  serializeAgentToolReport,
  serializeAgentToolResult,
} from "../src/index.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
it("validates all six real info-only agent results and reports against published and bundled schemas", async () => {
  const registry = await loadSchemaRegistry();
  const bundled = createInMemoryCanonicalSchemaRegistry();
  const validators = [registry, bundled].map((r) => ({
    result: r.ajv.getSchema(
      "https://thermiteschematics.com/schemas/0.1/agent-tool-result.schema.json",
    ),
    report: r.ajv.getSchema(
      "https://thermiteschematics.com/schemas/0.1/agent-tool-report.schema.json",
    ),
    diagnostic: r.ajv.getSchema(
      "https://thermiteschematics.com/schemas/0.1/diagnostic.schema.json",
    ),
  }));
  for (const v of validators)
    for (const validate of Object.values(v))
      expect(validate).toBeTypeOf("function");
  const scratch = await mkdtemp(join(tmpdir(), "thermite-info-contract-"));
  const project = join(scratch, "project");
  try {
    await cp(join(repository, "examples/machine-demo"), project, {
      recursive: true,
    });
    const sourcePath = "devices/equipment.json";
    const bytes = await readFile(join(project, sourcePath));
    const base = { format: "agent-tool-request/0.1", project } as const;
    const tools = createAgentTools();
    const requests = {
      validate: base,
      resolve: { ...base, target: { by: "designation", value: "K1" } },
      inspect: { ...base, selector: { by: "designation", value: "K1" } },
      query: {
        ...base,
        query: {
          operation: "net",
          selector: {
            by: "parts",
            deviceDesignation: "PLC1",
            terminalKey: "X11.1",
          },
        },
      },
      "create-view": {
        ...base,
        spec: {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "K1" },
          family: "control",
        },
      },
      "apply-source-patch": {
        ...base,
        patchFormat: "json-patch/0.1",
        dryRun: true,
        files: [
          {
            path: sourcePath,
            expectedIntegrity: computeFileIntegrity(bytes),
            operations: [
              {
                op: "test",
                path: "/objects/0/uid",
                value: JSON.parse(bytes.toString()).objects[0].uid,
              },
            ],
          },
        ],
      },
    } as const;
    for (const tool of Object.keys(requests) as (keyof typeof requests)[]) {
      const method =
        tool === "create-view"
          ? "createView"
          : tool === "apply-source-patch"
            ? "applySourcePatch"
            : tool;
      const outcome = await tools[method](requests[tool] as never);
      expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
      expect(outcome.diagnostics.map((d) => [d.code, d.severity])).toEqual([
        ["I304", "info"],
        ["I305", "info"],
      ]);
      if (!outcome.ok) throw Error(tool);
      let stdout = "",
        stderr = "";
      const exit = await runCli(
        ["node", "thermite", "agent", tool, "--input", "-"],
        {
          cwd: repository,
          stdout: { write: (text) => (stdout += text) },
          stderr: { write: (text) => (stderr += text) },
          agentStdin: Readable.from([
            Buffer.from(JSON.stringify(requests[tool])),
          ]),
        },
      );
      expect(exit, stderr).toBe(0);
      for (const v of validators) {
        expect(
          v.result!(JSON.parse(stdout)),
          JSON.stringify(v.result!.errors),
        ).toBe(true);
        expect(
          v.report!(JSON.parse(stderr)),
          JSON.stringify(v.report!.errors),
        ).toBe(true);
      }
      const result = JSON.parse(
        serializeAgentToolResult(tool, outcome.value as never),
      );
      const report = JSON.parse(
        serializeAgentToolReport(tool, outcome.diagnostics, null),
      );
      for (const v of validators) {
        expect(v.result!(result), JSON.stringify(v.result!.errors)).toBe(true);
        expect(v.result!({ ...result, diagnostics: outcome.diagnostics })).toBe(
          false,
        );
        expect(v.report!(report), JSON.stringify(v.report!.errors)).toBe(true);
        for (const d of report.diagnostics) expect(v.diagnostic!(d)).toBe(true);
        expect(
          v.report!({
            ...report,
            diagnostics: report.diagnostics.map((d: object) => ({
              ...d,
              severity: "notice",
            })),
          }),
        ).toBe(false);
      }
    }
    expect(await readFile(join(project, sourcePath))).toEqual(bytes);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
