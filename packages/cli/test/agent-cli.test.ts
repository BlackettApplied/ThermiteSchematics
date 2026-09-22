import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentTools, type AgentTools } from "@thermite/agent-tools";
import { computeFileIntegrity } from "@thermite/compiler";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type RunCliOptions } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = join(packageRoot, "fixtures");
const motorProject = join(repositoryRoot, "examples", "motor-starter");
const unavailableShippedLibraryProject = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "shipped-library-unavailable",
);
const cliBin = join(packageRoot, "dist", "bin.js");
const temporaryRoots: string[] = [];
const ANSI_PATTERN = /\u001b\[/u;

interface Invocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type InputBytes = string | Uint8Array;
type Invoke = (
  args: readonly string[],
  input?: InputBytes,
  options?: Omit<RunCliOptions, "stdout" | "stderr" | "agentStdin">,
) => Promise<Invocation>;

const validateSuccessStdout = [
  "{",
  '  "format": "agent-tool-result/0.1",',
  '  "tool": "validate",',
  '  "value": {',
  '    "valid": true',
  "  }",
  "}",
  "",
].join("\n");

const validateSuccessStderr = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "validate",',
  '  "diagnostics": [],',
  '  "error": null',
  "}",
  "",
].join("\n");

const missingTargetReport = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "resolve",',
  '  "diagnostics": [],',
  '  "error": {',
  '    "code": "A001",',
  '    "message": "A001 Invalid resolve request at \\"/target\\": missing.",',
  '    "field": "/target",',
  '    "reason": "missing"',
  "  }",
  "}",
  "",
].join("\n");

const invalidJsonReport = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "resolve",',
  '  "diagnostics": [],',
  '  "error": {',
  '    "code": "A001",',
  '    "message": "A001 Invalid resolve request at \\"\\": invalid json.",',
  '    "field": "",',
  '    "reason": "invalid-json"',
  "  }",
  "}",
  "",
].join("\n");

const duplicateMemberReport = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "resolve",',
  '  "diagnostics": [],',
  '  "error": {',
  '    "code": "A001",',
  '    "message": "A001 Invalid resolve request at \\"/project\\": duplicate member.",',
  '    "field": "/project",',
  '    "reason": "duplicate-member"',
  "  }",
  "}",
  "",
].join("\n");

const deepAdditionalPropertyReport = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "validate",',
  '  "diagnostics": [],',
  '  "error": {',
  '    "code": "A001",',
  '    "message": "A001 Invalid validate request at \\"/extra\\": additional property.",',
  '    "field": "/extra",',
  '    "reason": "additional-property"',
  "  }",
  "}",
  "",
].join("\n");

const deepDuplicateMemberReport = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "validate",',
  '  "diagnostics": [],',
  '  "error": {',
  '    "code": "A001",',
  '    "message": "A001 Invalid validate request at \\"/project\\": duplicate member.",',
  '    "field": "/project",',
  '    "reason": "duplicate-member"',
  "  }",
  "}",
  "",
].join("\n");

const unreadableRequestReport = [
  "{",
  '  "format": "agent-tool-report/0.1",',
  '  "tool": "validate",',
  '  "diagnostics": [',
  "    {",
  '      "code": "E001",',
  '      "severity": "error",',
  '      "message": "Unable to read agent request \\"<request>\\" (request-read/ENOENT).",',
  '      "file": "<request>",',
  '      "line": 1,',
  '      "column": 1,',
  '      "jsonPointer": ""',
  "    }",
  "  ],",
  '  "error": null',
  "}",
  "",
].join("\n");

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

function fixture(name: string): string {
  return join(fixtureRoot, name);
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "thermite-schematics-agent-cli-"));
  temporaryRoots.push(root);
  return root;
}

function inputStream(input: InputBytes): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield input;
    },
  };
}

const invokeInProcess: Invoke = async (args, input, options = {}) => {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    ...options,
    cwd: options.cwd ?? repositoryRoot,
    ...(input === undefined ? {} : { agentStdin: inputStream(input) }),
    stdout: {
      isTTY: true,
      write: (text) => (stdout += text),
    },
    stderr: {
      isTTY: true,
      write: (text) => (stderr += text),
    },
  });
  return { exitCode, stdout, stderr };
};

const invokeSubprocess: Invoke = async (args, input) =>
  new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", rejectInvocation);
    child.once("close", (exitCode, signal) => {
      if (signal !== null || exitCode === null) {
        rejectInvocation(
          new Error("Agent CLI subprocess failed: " + String(signal)),
        );
      } else {
        resolveInvocation({ exitCode, stdout, stderr });
      }
    });
    child.stdin.end(input);
  });

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

function expectNoAnsi(invocations: readonly Invocation[]): void {
  for (const invocation of invocations) {
    expect(invocation.stdout).not.toMatch(ANSI_PATTERN);
    expect(invocation.stderr).not.toMatch(ANSI_PATTERN);
  }
}

async function writeJsonRequest(
  root: string,
  name: string,
  value: unknown,
): Promise<string> {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(value, undefined, 2) + "\n", "utf8");
  return path;
}

async function exerciseTransportContract(
  invoke: Invoke,
  root: string,
): Promise<void> {
  const base = {
    format: "agent-tool-request/0.1",
  };
  const successInput = JSON.stringify({
    ...base,
    project: fixture("valid project"),
  });
  const warningInput = await writeJsonRequest(root, "warning.json", {
    ...base,
    project: fixture("unmatched glob"),
  });
  const expectedInput = await writeJsonRequest(root, "expected.json", {
    ...base,
    project: ".",
  });
  const toolInput = await writeJsonRequest(root, "tool.json", {
    ...base,
    project: fixture("missing manifest"),
  });
  const duplicateInput = join(root, "duplicate.json");
  await writeFile(
    duplicateInput,
    '{"format":"agent-tool-request/0.1","project":".","project":"other"}\n',
    "utf8",
  );
  const unreadableInput = join(root, "not-present.json");

  const success = await invoke(
    ["agent", "validate", "--input", "-"],
    successInput,
  );
  const warning = await invoke(["agent", "validate", "--input", warningInput]);
  const expected = await invoke(["agent", "resolve", "--input", expectedInput]);
  const tool = await invoke(["agent", "validate", "--input", toolInput]);
  const malformed = await invoke(
    ["agent", "resolve", "--input", "-"],
    '{"format":',
  );
  const invalidUtf8 = await invoke(
    ["agent", "resolve", "--input", "-"],
    Uint8Array.from([0xc3, 0x28]),
  );
  const duplicate = await invoke([
    "agent",
    "resolve",
    "--input",
    duplicateInput,
  ]);
  const unreadable = await invoke([
    "agent",
    "validate",
    "--input",
    unreadableInput,
  ]);
  const usage = await invoke(["agent", "resolve"]);
  const help = await invoke(["agent", "resolve", "--help"]);

  expect(success).toEqual({
    exitCode: 0,
    stdout: validateSuccessStdout,
    stderr: validateSuccessStderr,
  });

  expect(warning.exitCode).toBe(0);
  expect(warning.stdout).toBe(validateSuccessStdout);
  expect(JSON.parse(warning.stderr)).toMatchObject({
    format: "agent-tool-report/0.1",
    tool: "validate",
    diagnostics: [{ code: "W901", severity: "warning" }],
    error: null,
  });
  expect(warning.stderr.endsWith("\n")).toBe(true);
  expect(warning.stderr).not.toContain("\r");

  expect(expected).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: missingTargetReport,
  });
  expect(malformed).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: invalidJsonReport,
  });
  expect(invalidUtf8).toEqual(malformed);
  expect(duplicate).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: duplicateMemberReport,
  });
  expect(unreadable).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: unreadableRequestReport,
  });
  expect(unreadable.stderr).not.toContain(unreadableInput);

  expect(tool.exitCode).toBe(2);
  expect(tool.stdout).toBe("");
  expect(JSON.parse(tool.stderr)).toMatchObject({
    format: "agent-tool-report/0.1",
    tool: "validate",
    diagnostics: [
      {
        code: "E001",
        message: "Agent validate tool failure (compile/E001).",
      },
    ],
    error: null,
  });
  expect(tool.stderr).not.toContain(fixture("missing manifest"));

  expect(usage.exitCode).toBe(2);
  expect(usage.stdout).toBe("");
  expect(usage.stderr).toContain(
    "required option '--input <file|->' not specified",
  );
  expect(() => JSON.parse(usage.stderr)).toThrow();

  expect(help.exitCode).toBe(0);
  expect(help.stdout).toContain("Usage: thermite agent resolve [options]");
  expect(help.stdout).toContain("--input <file|->");
  expect(help.stderr).toBe("");

  const invocations = [
    success,
    warning,
    expected,
    tool,
    malformed,
    invalidUtf8,
    duplicate,
    unreadable,
    usage,
    help,
  ];
  expectNoAnsi(invocations);
  for (const failure of [
    expected,
    tool,
    malformed,
    invalidUtf8,
    duplicate,
    unreadable,
    usage,
  ]) {
    expect(failure.stdout).toBe("");
  }
}

describe("M7 Task 7 thermite agent command namespace", () => {
  it("serializes the exact E032 diagnostics through the agent report transport", async () => {
    const diagnostics = [
      {
        code: "E032",
        severity: "error",
        message: 'Shipped library "unknown" at version "9.9.9" is unavailable.',
        file: "system.json",
        line: 1,
        column: 108,
        jsonPointer: "/libraries/0/name",
      },
      {
        code: "E032",
        severity: "error",
        message:
          'Shipped library "core" does not provide version "9.9.9"; available version is "0.1.0".',
        file: "system.json",
        line: 1,
        column: 162,
        jsonPointer: "/libraries/1/version",
      },
    ];
    const invocation = await invokeInProcess(
      ["agent", "validate", "--input", "-"],
      JSON.stringify({
        format: "agent-tool-request/0.1",
        project: unavailableShippedLibraryProject,
      }),
    );
    expect(invocation).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        JSON.stringify(
          {
            format: "agent-tool-report/0.1",
            tool: "validate",
            diagnostics,
            error: null,
          },
          undefined,
          2,
        ) + "\n",
    });
  });

  it("dispatches all six commands through production serializers", async () => {
    const root = await temporaryRoot();
    const patchProject = join(root, "patch-project");
    await mkdir(patchProject);
    const sourceBytes = JSON.stringify({ objects: [] }, undefined, 2) + "\n";
    await writeFile(
      join(patchProject, "system.json"),
      JSON.stringify(
        {
          format: "electrical-system/0.1",
          project: { name: "Agent CLI patch smoke" },
          sources: ["source.json"],
        },
        undefined,
        2,
      ) + "\n",
      "utf8",
    );
    await writeFile(join(patchProject, "source.json"), sourceBytes, "utf8");

    const base = {
      format: "agent-tool-request/0.1",
      project: motorProject,
    };
    const cases = [
      {
        tool: "resolve",
        request: {
          ...base,
          target: { by: "designation", value: "K1" },
        },
      },
      {
        tool: "inspect",
        request: {
          ...base,
          selector: { by: "designation", value: "K1" },
        },
      },
      {
        tool: "query",
        request: {
          ...base,
          query: {
            operation: "neighbors",
            selector: { by: "designation", value: "K1" },
          },
        },
      },
      {
        tool: "validate",
        request: base,
      },
      {
        tool: "create-view",
        request: {
          ...base,
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
          project: patchProject,
          patchFormat: "json-patch/0.1",
          dryRun: true,
          files: [
            {
              path: "source.json",
              expectedIntegrity: computeFileIntegrity(
                Buffer.from(sourceBytes, "utf8"),
              ),
              operations: [{ op: "test", path: "", value: { objects: [] } }],
            },
          ],
        },
      },
    ] as const;

    for (const [index, entry] of cases.entries()) {
      const input = await writeJsonRequest(
        root,
        "command-" + String(index) + ".json",
        entry.request,
      );
      const invocation = await invokeInProcess([
        "agent",
        entry.tool,
        "--input",
        input,
      ]);

      expect(invocation.exitCode).toBe(0);
      expect(JSON.parse(invocation.stdout)).toMatchObject({
        format: "agent-tool-result/0.1",
        tool: entry.tool,
      });
      expect(JSON.parse(invocation.stderr)).toEqual({
        format: "agent-tool-report/0.1",
        tool: entry.tool,
        diagnostics: [],
        error: null,
      });
      expect(invocation.stdout.endsWith("\n")).toBe(true);
      expect(invocation.stderr.endsWith("\n")).toBe(true);
      expect(invocation.stdout + invocation.stderr).not.toContain(root);
      expectNoAnsi([invocation]);
    }
  });

  it("covers success, warnings, expected/tool failures, parsing, I/O, usage, and help in process", async () => {
    await exerciseTransportContract(invokeInProcess, await temporaryRoot());
  });

  it("returns frozen Layer-1 bytes for 20,000-level valid JSON in process", async () => {
    const deep = "[".repeat(20_000) + "null" + "]".repeat(20_000);
    const invocation = await invokeInProcess(
      ["agent", "validate", "--input", "-"],
      `{"format":"agent-tool-request/0.1","project":".","extra":${deep}}`,
    );
    expect(invocation).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: deepAdditionalPropertyReport,
    });

    const duplicate = await invokeInProcess(
      ["agent", "validate", "--input", "-"],
      `{"format":"agent-tool-request/0.1","project":".","extra":${deep},"project":"other"}`,
    );
    expect(duplicate).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: deepDuplicateMemberReport,
    });
  });

  it("maps only failureClass and sanitizes an unexpected dispatch throw", async () => {
    const root = await temporaryRoot();
    const input = await writeJsonRequest(root, "validate.json", {
      format: "agent-tool-request/0.1",
      project: ".",
    });
    const e001Diagnostic = {
      code: "E001",
      severity: "error",
      message: "Expected failure text says tool failure.",
      file: "<project>",
      line: 1,
      column: 1,
      jsonPointer: "",
    } as const;

    const expected = await invokeInProcess(
      ["agent", "validate", "--input", input],
      undefined,
      {
        agentCreateTools: (options): AgentTools => ({
          ...createAgentTools(options),
          validate: async () => ({
            ok: false,
            diagnostics: [e001Diagnostic],
            error: null,
            failureClass: "expected",
          }),
        }),
      },
    );
    expect(expected.exitCode).toBe(1);
    expect(expected.stdout).toBe("");
    expect(JSON.parse(expected.stderr)).toMatchObject({
      diagnostics: [{ code: "E001" }],
      error: null,
    });

    const tool = await invokeInProcess(
      ["agent", "validate", "--input", input],
      undefined,
      {
        agentCreateTools: (options): AgentTools => ({
          ...createAgentTools(options),
          validate: async () => ({
            ok: false,
            diagnostics: [],
            error: {
              code: "A001",
              message: "A001 expected-looking error.",
              field: "",
              reason: "missing",
            },
            failureClass: "tool",
          }),
        }),
      },
    );
    expect(tool.exitCode).toBe(2);
    expect(tool.stdout).toBe("");
    expect(JSON.parse(tool.stderr)).toMatchObject({
      diagnostics: [],
      error: { code: "A001" },
    });

    const unexpected = await invokeInProcess(
      ["agent", "validate", "--input", input],
      undefined,
      {
        agentCreateTools: (options): AgentTools => ({
          ...createAgentTools(options),
          validate: async () => {
            const error = new Error("absolute C:/secret/path must not leak");
            Object.defineProperty(error, "code", { value: "ECLI" });
            throw error;
          },
        }),
      },
    );
    expect(unexpected).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: [
        "{",
        '  "format": "agent-tool-report/0.1",',
        '  "tool": "validate",',
        '  "diagnostics": [',
        "    {",
        '      "code": "E001",',
        '      "severity": "error",',
        '      "message": "Agent validate tool failure (unexpected/ECLI).",',
        '      "file": "<project>",',
        '      "line": 1,',
        '      "column": 1,',
        '      "jsonPointer": ""',
        "    }",
        "  ],",
        '  "error": null',
        "}",
        "",
      ].join("\n"),
    });
    expectNoAnsi([expected, tool, unexpected]);
  });

  it("proves the same split streams and exits in built subprocesses", async ({
    skip,
  }) => {
    try {
      await exerciseTransportContract(invokeSubprocess, await temporaryRoot());
    } catch (error) {
      if (isChildProcessDenied(error)) {
        skip("The execution sandbox denied agent CLI subprocess creation.");
        return;
      }
      throw error;
    }
  });
});
