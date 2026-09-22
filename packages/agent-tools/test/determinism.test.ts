import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  createAgentTools,
  serializeAgentToolReport,
  serializeAgentToolResult,
  type AgentTools,
} from "../src/index.js";
import { createMotorStarterPnpExperiment } from "../../render/test/motor-starter-pnp-fixture.js";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const agentToolsEntry = join(packageRoot, "dist", "index.js");

const READ_TOOL_ORDER = [
  "resolve",
  "inspect",
  "query",
  "validate",
  "create-view",
] as const;

type ReadToolName = (typeof READ_TOOL_ORDER)[number];

const BASE_REQUEST = {
  format: "agent-tool-request/0.1",
  project: ".",
} as const;

function fail(tool: ReadToolName): never {
  throw new Error(`The ${tool} determinism fixture unexpectedly failed.`);
}

async function serializedRead(
  tools: AgentTools,
  tool: ReadToolName,
): Promise<string> {
  switch (tool) {
    case "resolve": {
      const outcome = await tools.resolve({
        ...BASE_REQUEST,
        target: { by: "text", value: "LS1" },
      });
      if (!outcome.ok) return fail(tool);
      return (
        serializeAgentToolResult(tool, outcome.value) +
        serializeAgentToolReport(tool, outcome.diagnostics, null)
      );
    }
    case "inspect": {
      const outcome = await tools.inspect({
        ...BASE_REQUEST,
        selector: { by: "designation", value: "LS1" },
      });
      if (!outcome.ok) return fail(tool);
      return (
        serializeAgentToolResult(tool, outcome.value) +
        serializeAgentToolReport(tool, outcome.diagnostics, null)
      );
    }
    case "query": {
      const outcome = await tools.query({
        ...BASE_REQUEST,
        query: {
          operation: "net",
          selector: {
            by: "parts",
            deviceDesignation: "LS1",
            terminalKey: "14",
          },
        },
      });
      if (!outcome.ok) return fail(tool);
      return (
        serializeAgentToolResult(tool, outcome.value) +
        serializeAgentToolReport(tool, outcome.diagnostics, null)
      );
    }
    case "validate": {
      const outcome = await tools.validate(BASE_REQUEST);
      if (!outcome.ok) return fail(tool);
      return (
        serializeAgentToolResult(tool, outcome.value) +
        serializeAgentToolReport(tool, outcome.diagnostics, null)
      );
    }
    case "create-view": {
      const outcome = await tools.createView({
        ...BASE_REQUEST,
        spec: {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "LS1" },
          intent: {
            kind: "trace",
            to: { by: "designation", value: "PLC1" },
            includePower: true,
          },
          flow: "left-to-right",
        },
      });
      if (!outcome.ok) return fail(tool);
      return (
        serializeAgentToolResult(tool, outcome.value) +
        serializeAgentToolReport(tool, outcome.diagnostics, null)
      );
    }
  }
}

async function runSequentially(
  tools: AgentTools,
  order: readonly ReadToolName[],
): Promise<ReadonlyMap<ReadToolName, string>> {
  const results = new Map<ReadToolName, string>();
  for (const tool of order)
    results.set(tool, await serializedRead(tools, tool));
  return results;
}

function reverseJsonKeys(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    const members = value.map((member) => reverseJsonKeys(member));
    return parentKey === "objects" || parentKey === "aliases"
      ? members.reverse()
      : members;
  }
  if (typeof value !== "object" || value === null) return value;

  const result = Object.create(null) as Record<string, unknown>;
  const entries = Object.entries(value).reverse();
  for (const [key, member] of entries) {
    result[key] = reverseJsonKeys(member, key);
  }
  return result;
}

async function shuffleProjectSources(
  projectRoot: string,
  projectFiles: ReadonlyMap<string, Buffer>,
): Promise<void> {
  for (const [relativePath, bytes] of projectFiles) {
    if (
      !relativePath.endsWith(".json") ||
      relativePath === "electrical-system.lock.json"
    ) {
      continue;
    }
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    const shuffled = reverseJsonKeys(parsed);
    if (relativePath === "system.json") {
      const manifest = shuffled as { sources?: unknown[] };
      manifest.sources?.reverse();
    }
    await writeFile(
      join(projectRoot, relativePath),
      `${JSON.stringify(shuffled, undefined, 2)}\n`,
      "utf8",
    );
  }
}

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

const freshProcessScript = `
import {
  createAgentTools,
  serializeAgentToolReport,
  serializeAgentToolResult,
} from ${JSON.stringify(pathToFileURL(agentToolsEntry).href)};

const cwd = process.argv.at(-1);
const tools = createAgentTools({ cwd });
const base = { format: "agent-tool-request/0.1", project: "." };
const cases = [
  ["resolve", () => tools.resolve({ ...base, target: { by: "text", value: "LS1" } })],
  ["inspect", () => tools.inspect({ ...base, selector: { by: "designation", value: "LS1" } })],
  ["query", () => tools.query({ ...base, query: { operation: "net", selector: { by: "parts", deviceDesignation: "LS1", terminalKey: "14" } } })],
  ["validate", () => tools.validate(base)],
  ["create-view", () => tools.createView({ ...base, spec: { format: "schematic-view-request/0.2", root: { by: "designation", value: "LS1" }, intent: { kind: "trace", to: { by: "designation", value: "PLC1" }, includePower: true }, flow: "left-to-right" } })],
];
const results = {};
for (const [tool, invoke] of cases) {
  const outcome = await invoke();
  if (!outcome.ok) throw new Error(tool + " failed");
  results[tool] = serializeAgentToolResult(tool, outcome.value) + serializeAgentToolReport(tool, outcome.diagnostics, null);
}
process.stdout.write(JSON.stringify(results));
`;

describe("D12 complete read-tool determinism", () => {
  it("is stable sequentially, concurrently, in reverse order, and after source/key shuffles", async () => {
    const experiment = await createMotorStarterPnpExperiment();
    try {
      const tools = createAgentTools({ cwd: experiment.projectRoot });
      const baseline = await runSequentially(tools, READ_TOOL_ORDER);
      const reversed = await runSequentially(
        tools,
        [...READ_TOOL_ORDER].reverse(),
      );
      const concurrent = new Map(
        await Promise.all(
          READ_TOOL_ORDER.map(
            async (tool) => [tool, await serializedRead(tools, tool)] as const,
          ),
        ),
      );

      expect(reversed).toEqual(baseline);
      expect(concurrent).toEqual(baseline);

      await shuffleProjectSources(
        experiment.projectRoot,
        experiment.baselineProjectFiles,
      );
      const shuffled = await runSequentially(tools, READ_TOOL_ORDER);
      expect(shuffled).toEqual(baseline);

      const allBytes = [...baseline.values(), ...shuffled.values()].join("");
      expect(allBytes).not.toContain(experiment.root);
      expect(allBytes).not.toContain(repositoryRoot);
      expect(allBytes).not.toContain(".thermite-schematics-stage-");
      expect(allBytes).not.toMatch(/\u001b\[/u);
    } finally {
      await experiment.cleanup();
    }
  });

  it(
    "is byte-identical in two fresh Node processes on the active platform",
    { timeout: 120_000 },
    async ({ skip }) => {
      const experiment = await createMotorStarterPnpExperiment();
      try {
        const runFresh = async (): Promise<string> => {
          const result = await execFileAsync(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              freshProcessScript,
              experiment.projectRoot,
            ],
            {
              cwd: repositoryRoot,
              encoding: "utf8",
              maxBuffer: 5 * 1024 * 1024,
              windowsHide: true,
            },
          );
          return result.stdout;
        };

        let first: string;
        let second: string;
        try {
          [first, second] = await Promise.all([runFresh(), runFresh()]);
        } catch (error) {
          if (isChildProcessDenied(error)) {
            skip("The execution sandbox denied fresh Node child processes.");
            return;
          }
          throw error;
        }

        expect(second).toBe(first);
        expect(first).not.toContain(experiment.root);
        expect(first).not.toContain(repositoryRoot);
        expect(first).not.toContain(".thermite-schematics-stage-");
        expect(JSON.parse(first)).toHaveProperty("create-view");
      } finally {
        await experiment.cleanup();
      }
    },
  );
});
