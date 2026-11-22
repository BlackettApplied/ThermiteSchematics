import { motorProject, run } from "./package-smoke-support.js";
import type { ApiResult } from "./package-smoke-support.js";
import { expect } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { motorDiagnostics } from "../../cli/test/motor-starter-diagnostics.js";

export function makeInstalledAgentCases(
  appliedPatchFile: { afterIntegrity: string } | undefined,
) {
  const installedAgentBase = {
    format: "agent-tool-request/0.1",
    project: motorProject,
  };

  const installedAgentCases = [
    {
      tool: "resolve",
      request: {
        ...installedAgentBase,
        target: { by: "designation", value: "K1" },
      },
    },
    {
      tool: "inspect",
      request: {
        ...installedAgentBase,
        selector: { by: "designation", value: "K1" },
      },
    },
    {
      tool: "query",
      request: {
        ...installedAgentBase,
        query: {
          operation: "neighbors",
          selector: { by: "designation", value: "K1" },
        },
      },
    },
    {
      tool: "validate",
      request: installedAgentBase,
    },
    {
      tool: "create-view",
      request: {
        ...installedAgentBase,
        spec: {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "designation", value: "K1" },
        },
      },
    },
    {
      tool: "apply-source-patch",
      request: {
        format: "agent-tool-request/0.1",
        project: "isolated-patch-project",
        patchFormat: "json-patch/0.1",
        dryRun: true,
        files: [
          {
            path: "source.json",
            expectedIntegrity: appliedPatchFile!.afterIntegrity,
            operations: [{ op: "test", path: "", value: { objects: [] } }],
          },
        ],
      },
    },
  ] as const;
  return installedAgentCases;
}

export function assertAgentValue(
  result: { value: unknown },
  entry: ReturnType<typeof makeInstalledAgentCases>[number],
  apiResult: ApiResult,
) {
  if (entry.tool === "resolve") {
    expect(result.value).toMatchObject({
      mode: "resolve",
      object: { designation: "K1" },
    });
  } else if (entry.tool === "inspect") {
    expect(result.value).toMatchObject({
      command: "inspect",
      object: { designation: "K1" },
    });
  } else if (entry.tool === "query") {
    expect(result.value).toMatchObject({
      command: "neighbors",
      device: { designation: "K1" },
    });
  } else if (entry.tool === "validate") {
    expect(result.value).toEqual({ valid: true });
  } else if (entry.tool === "create-view") {
    expect(result.value).toMatchObject({
      view: { family: "control", root: { designation: "K1" } },
      svg: apiResult.control.svg,
    });
  } else {
    expect(result.value).toMatchObject({
      dryRun: true,
      applied: false,
      atomicity: "per-file",
      files: [{ path: "source.json", changed: false }],
    });
  }
}

export async function assertAgentCommands(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
  const appliedPatchFile = apiResult.agentRuntime.apply.files[0] as
    { afterIntegrity: string } | undefined;

  expect(appliedPatchFile).toBeDefined();
  const installedAgentCases = makeInstalledAgentCases(appliedPatchFile);
  for (const [index, entry] of installedAgentCases.entries()) {
    const input = join(
      consumerDirectory,
      "agent-command-" + String(index) + ".json",
    );
    await writeFile(
      input,
      JSON.stringify(entry.request, undefined, 2) + "\n",
      "utf8",
    );
    const invocation = await run(
      process.execPath,
      [installedCli, "agent", entry.tool, "--input", input],
      consumerDirectory,
    );
    const result = JSON.parse(invocation.stdout) as {
      format: string;
      tool: string;
      value: unknown;
    };
    expect(result).toMatchObject({
      format: "agent-tool-result/0.1",
      tool: entry.tool,
    });
    expect(JSON.parse(invocation.stderr)).toEqual({
      format: "agent-tool-report/0.1",
      tool: entry.tool,
      diagnostics: entry.tool === "apply-source-patch" ? [] : motorDiagnostics,
      error: null,
    });
    expect(invocation.stdout + invocation.stderr).not.toContain(motorProject);

    assertAgentValue(result, entry, apiResult);
  }
}
