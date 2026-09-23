import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  compileProject,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import type { AgentTools } from "@thermite/agent-tools";
import type {
  RenderFailure,
  RenderOutcome,
  RenderedSchematic,
  NormalizedSchematicView,
  SchematicRenderer,
  SchematicViewRequest,
} from "@thermite/render";
import type { ELK } from "elkjs/lib/elk-api.js";
import { normalizeDiagnosticFile, type Diagnostic } from "@thermite/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createSchematicRendererWithDependencies } from "../../render/src/renderer.js";
import {
  materializeTier2Project,
  type Tier2FixtureName,
} from "../../render/test/tier2-fixture.js";

import {
  formatHumanDiagnostics,
  runCli,
  runRender,
  runView,
  type RunCliOptions,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const motorProject = join(repositoryRoot, "examples", "motor-starter");
const motorManifest = join(motorProject, "system.json");
const rendererGoldenRoot = join(
  repositoryRoot,
  "packages",
  "render",
  "test",
  "goldens",
  "motor-starter",
);
const tier2GoldenRoot = join(
  repositoryRoot,
  "packages",
  "render",
  "test",
  "goldens",
  "tier2",
);
const ruleFixtureRoot = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "rules",
);
const cliModuleUrl = pathToFileURL(join(packageRoot, "dist", "index.js")).href;
const compilerModuleUrl = pathToFileURL(
  join(repositoryRoot, "packages", "compiler", "dist", "index.js"),
).href;
const temporaryRoots: string[] = [];

interface Invocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

let motorIr: ElectricalIr;

beforeAll(async () => {
  const compiled = await compileProject(motorProject);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  motorIr = compiled.ir;
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "thermite-schematics-render-cli-"));
  temporaryRoots.push(root);
  return root;
}

async function invoke(
  args: readonly string[],
  options: Omit<RunCliOptions, "stdout" | "stderr"> = {},
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    ...options,
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

const compiledPresentation = Object.freeze({
  format: "project-presentation/0.1" as const,
  revision: "A",
  backgroundColor: "#ffffff",
  titleBlockLines: Object.freeze(["Motor starter reference"]),
});

function successfulCompile(diagnostics: Diagnostic[] = []): CompileResult {
  return {
    ok: true,
    diagnostics,
    ir: motorIr,
    presentation: compiledPresentation,
  };
}

function fakeRendered(request: SchematicViewRequest): RenderedSchematic {
  const designation =
    request.root.by === "designation" ? request.root.value : "K1";
  const flow = request.flow ?? "left-to-right";
  let view: NormalizedSchematicView;
  if (request.format === "schematic-view-request/0.1") {
    view = {
      format: "schematic-view/0.1",
      family: request.family,
      root: {
        deviceUid: motorIr.devices.find(
          (device) => device.designation === "K1",
        )!.uid,
        designation,
      },
      flow,
    };
  } else if (request.intent.kind === "trace") {
    const targetDesignation =
      request.intent.to.by === "designation" ? request.intent.to.value : "PLC1";
    view = {
      format: "schematic-view/0.2",
      family: "control",
      intent: "trace",
      root: {
        kind: "device",
        deviceUid: motorIr.devices.find(
          (device) => device.designation === "LS1",
        )!.uid,
        designation,
      },
      target: {
        deviceUid: motorIr.devices.find(
          (device) => device.designation === "PLC1",
        )!.uid,
        designation: targetDesignation,
      },
      includePower: request.intent.includePower,
      flow,
    };
  } else if (request.intent.kind === "conductors") {
    view = {
      format: "schematic-view/0.2",
      family: "control",
      intent: "conductors",
      root: {
        kind: "cable",
        cableUid: motorIr.cables.find((cable) => cable.designation === "CBL1")!
          .uid,
        designation,
      },
      flow,
    };
  } else {
    view = {
      format: "schematic-view/0.2",
      family: "control",
      intent: "loads",
      root: {
        kind: "device",
        deviceUid: motorIr.devices.find(
          (device) => device.designation === "PS1",
        )!.uid,
        designation,
      },
      flow,
    };
  }
  return {
    view,
    summary: {
      deviceUids: [],
      terminalIds: [],
      functionIds: [],
      conductiveElementIds: [],
      netIds: [],
      presentationNodeIds: [],
    },
    svg: '<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>\n',
  };
}

function rendererReturning(
  outcome:
    | RenderOutcome<RenderedSchematic>
    | ((request: SchematicViewRequest) => RenderOutcome<RenderedSchematic>),
): SchematicRenderer {
  return {
    render: async (_ir, request) =>
      typeof outcome === "function" ? outcome(request) : outcome,
  };
}

function report(
  diagnostics: readonly Diagnostic[],
  error: RenderFailure | null,
): string {
  return `${JSON.stringify({ diagnostics, error }, undefined, 2)}\n`;
}

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

function encodeUtf16(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

function semanticId(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${parts.map(encodeUtf16).join("--")}`;
}

async function invokeEvalSubprocess(script: string): Promise<Invocation> {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        cwd: repositoryRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", rejectInvocation);
    child.once("close", (exitCode, signal) => {
      if (signal !== null || exitCode === null) {
        rejectInvocation(new Error(`render eval subprocess failed: ${signal}`));
      } else {
        resolveInvocation({ exitCode, stdout, stderr });
      }
    });
  });
}

async function invokeCliSubprocess(
  args: readonly string[],
): Promise<Invocation> {
  const bin = join(packageRoot, "dist", "bin.js");
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
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
        rejectInvocation(new Error(`render CLI subprocess failed: ${signal}`));
      } else {
        resolveInvocation({ exitCode, stdout, stderr });
      }
    });
  });
}

describe("M5 Task 8 render orchestration and command surface", () => {
  it("fresh-compiles, constructs, and renders exactly once", async () => {
    let compileCalls = 0;
    let constructorCalls = 0;
    let renderCalls = 0;
    const result = await runRender("K1", {
      family: "control",
      flow: "top-to-bottom",
      project: motorProject,
      cwd: repositoryRoot,
      compile: async (inputPath, cwd) => {
        compileCalls += 1;
        expect(inputPath).toBe(motorProject);
        expect(cwd).toBe(repositoryRoot);
        return successfulCompile();
      },
      createRenderer: () => {
        constructorCalls += 1;
        return {
          render: async (ir, request, presentation) => {
            renderCalls += 1;
            expect(ir).toBe(motorIr);
            expect(presentation).toBe(compiledPresentation);
            expect(request).toEqual({
              format: "schematic-view-request/0.1",
              family: "control",
              root: { by: "designation", value: "K1" },
              flow: "top-to-bottom",
            });
            return { ok: true, value: fakeRendered(request) };
          },
        };
      },
    });

    expect({ compileCalls, constructorCalls, renderCalls }).toEqual({
      compileCalls: 1,
      constructorCalls: 1,
      renderCalls: 1,
    });
    expect(result).toEqual({
      diagnostics: [],
      error: null,
      exitCode: 0,
      stdout: fakeRendered({
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
        flow: "top-to-bottom",
      }).svg,
      stderr: "",
      written: false,
    });
  });

  it("uses left-to-right by default and serializes canonical inline JSON", async () => {
    const result = await invoke(
      ["render", "K1", "--family", "control", "--json"],
      {
        cwd: motorProject,
        renderCompileProject: async () => successfulCompile(),
        renderCreateRenderer: () =>
          rendererReturning((request) => ({
            ok: true,
            value: fakeRendered(request),
          })),
      },
    );
    const parsed = JSON.parse(result.stdout) as {
      command: string;
      view: { flow: string };
      artifact: { kind: string; mediaType: string; svg: string };
    };
    expect(result.exitCode).toBe(0);
    expect(parsed).toMatchObject({
      command: "render",
      view: { flow: "left-to-right" },
      artifact: { kind: "inline", mediaType: "image/svg+xml" },
    });
    expect(parsed.artifact.svg.endsWith("\n")).toBe(true);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.endsWith("\n\n")).toBe(false);
    expect(result.stderr).toBe(report([], null));
  });

  it("preserves path-with-spaces, quoted, and leading-hyphen operands", async () => {
    const observed: Array<{
      project: string | undefined;
      designation: string;
    }> = [];
    const project = join(repositoryRoot, "a project path with spaces");
    const options: Omit<RunCliOptions, "stdout" | "stderr"> = {
      cwd: repositoryRoot,
      renderCompileProject: async (inputPath) => {
        observed.push({ project: inputPath, designation: "" });
        return successfulCompile();
      },
      renderCreateRenderer: () =>
        rendererReturning((request) => {
          observed.at(-1)!.designation =
            request.root.by === "designation" ? request.root.value : "";
          return { ok: true, value: fakeRendered(request) };
        }),
    };
    const quoted = await invoke(
      ["render", "Panel K 1", "--family", "control", "--project", project],
      options,
    );
    const leading = await invoke(
      ["render", "--family", "control", "--project", project, "--", "-K1"],
      options,
    );

    expect(quoted.exitCode).toBe(0);
    expect(leading.exitCode).toBe(0);
    expect(observed).toEqual([
      { project, designation: "Panel K 1" },
      { project, designation: "-K1" },
    ]);
  });

  it.each(["left-to-right", "top-to-bottom"] as const)(
    "accepts the %s flow",
    async (flow) => {
      const result = await invoke(
        [
          "render",
          "K1",
          "--family",
          "control",
          "--flow",
          flow,
          "--project",
          motorProject,
          "--json",
        ],
        { cwd: repositoryRoot },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ view: { flow } });
      expect(result.stderr).toBe(report([], null));
    },
  );
});

const viewRequestCases = [
  {
    name: "power",
    args: ["view", "M1", "--flow", "top-to-bottom", "--power"],
    reorderedArgs: ["view", "--power", "M1", "--flow", "top-to-bottom"],
    request: {
      format: "schematic-view-request/0.1",
      family: "power",
      root: { by: "designation", value: "M1" },
      flow: "top-to-bottom",
    },
  },
  {
    name: "actuation",
    args: ["view", "K1", "--actuation"],
    reorderedArgs: ["view", "--actuation", "K1"],
    request: {
      format: "schematic-view-request/0.1",
      family: "control",
      root: { by: "designation", value: "K1" },
      flow: "left-to-right",
    },
  },
  {
    name: "trace without power",
    args: ["view", "LS1", "--to", "PLC1"],
    reorderedArgs: ["view", "--to", "PLC1", "LS1"],
    request: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
      flow: "left-to-right",
    },
  },
  {
    name: "trace with power",
    args: ["view", "LS1", "--include-power", "--to", "PLC1"],
    reorderedArgs: ["view", "--to", "PLC1", "LS1", "--include-power"],
    request: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      },
      flow: "left-to-right",
    },
  },
  {
    name: "conductors",
    args: ["view", "CBL1", "--conductors"],
    reorderedArgs: ["view", "--conductors", "CBL1"],
    request: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "CBL1" },
      intent: { kind: "conductors" },
      flow: "left-to-right",
    },
  },
  {
    name: "loads",
    args: ["view", "PS1", "--loads"],
    reorderedArgs: ["view", "--loads", "PS1"],
    request: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
      flow: "left-to-right",
    },
  },
] as const satisfies readonly {
  name: string;
  args: readonly string[];
  reorderedArgs: readonly string[];
  request: SchematicViewRequest;
}[];

describe("M6 Task 6 thin view request mapping", () => {
  it.each(viewRequestCases)(
    "maps $name flags exactly and independently of option order",
    async ({ args, reorderedArgs, request }) => {
      const observed: SchematicViewRequest[] = [];
      let compileCalls = 0;
      let constructorCalls = 0;
      const options = {
        renderCompileProject: async () => {
          compileCalls += 1;
          return successfulCompile();
        },
        renderCreateRenderer: () => {
          constructorCalls += 1;
          return rendererReturning((actual) => {
            observed.push(actual);
            return { ok: true, value: fakeRendered(actual) };
          });
        },
      };

      const [first, reordered] = await Promise.all([
        invoke(args, options),
        invoke(reorderedArgs, options),
      ]);

      expect(first).toEqual({
        exitCode: 0,
        stdout: fakeRendered(request).svg,
        stderr: "",
      });
      expect(reordered).toEqual(first);
      expect(observed).toEqual([request, request]);
      expect({ compileCalls, constructorCalls }).toEqual({
        compileCalls: 2,
        constructorCalls: 2,
      });
    },
  );

  it("serializes a view command discriminant and preserves exact operands", async () => {
    const project = join(repositoryRoot, "a project path with spaces");
    let observedProject: string | undefined;
    let observedRequest: SchematicViewRequest | undefined;
    const result = await invoke(
      [
        "view",
        "Panel LS 1",
        "--to",
        "Panel PLC 1",
        "--project",
        project,
        "--json",
      ],
      {
        renderCompileProject: async (inputPath) => {
          observedProject = inputPath;
          return successfulCompile();
        },
        renderCreateRenderer: () =>
          rendererReturning((request) => {
            observedRequest = request;
            return { ok: true, value: fakeRendered(request) };
          }),
      },
    );

    expect(observedProject).toBe(project);
    expect(observedRequest).toEqual({
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "Panel LS 1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "Panel PLC 1" },
        includePower: false,
      },
      flow: "left-to-right",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "view",
      artifact: { kind: "inline", mediaType: "image/svg+xml" },
    });
    expect(result.stderr).toBe(report([], null));
  });

  it("preserves leading-hyphen roots and target option values", async () => {
    const observedRequests: SchematicViewRequest[] = [];
    const options = {
      renderCompileProject: async () => successfulCompile(),
      renderCreateRenderer: () =>
        rendererReturning((request) => {
          observedRequests.push(request);
          return { ok: true, value: fakeRendered(request) };
        }),
    };
    const root = await invoke(["view", "--loads", "--", "-PS1"], options);
    const target = await invoke(["view", "LS1", "--to", "-PLC1"], options);
    expect(root.exitCode).toBe(0);
    expect(target.exitCode).toBe(0);
    expect(observedRequests[0]).toMatchObject({
      root: { by: "designation", value: "-PS1" },
    });
    expect(observedRequests[1]).toMatchObject({
      intent: {
        kind: "trace",
        to: { by: "designation", value: "-PLC1" },
        includePower: false,
      },
    });
  });
});

describe("M5 Task 8 atomic render output", () => {
  it("writes exact renderer bytes, replaces successfully, and leaves no temp file", async () => {
    const root = await temporaryRoot();
    const output = join(root, "diagram.svg");
    const expected = await readFile(
      join(rendererGoldenRoot, "k1-control-left-to-right.svg"),
    );
    await writeFile(output, Buffer.from([0, 1, 2, 3]));

    const result = await invoke([
      "render",
      "K1",
      "--family",
      "control",
      "--project",
      motorProject,
      "--output",
      output,
    ]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(await readFile(output)).toEqual(expected);
    expect(await readdir(root)).toEqual(["diagram.svg"]);
  });

  it("reports the user option but passes only the resolved target to the writer", async () => {
    const root = await temporaryRoot();
    const outputOption = "nested/../diagram.svg";
    const target = resolve(root, outputOption);
    const sentinel = Buffer.from("preserve existing bytes\n");
    await writeFile(target, sentinel);
    let writerDestination = "";
    let temporaryPath = "";

    const result = await runRender("K1", {
      family: "control",
      project: motorProject,
      output: outputOption,
      json: true,
      cwd: root,
      compile: async () => successfulCompile(),
      createRenderer: () =>
        rendererReturning((request) => ({
          ok: true,
          value: fakeRendered(request),
        })),
      atomicWrite: {
        temporaryPath: (destination) => {
          writerDestination = destination;
          temporaryPath = join(dirname(destination), ".forced-render.tmp");
          return temporaryPath;
        },
        operations: {
          open: async () => {
            throw new Error("injected write denial");
          },
          rename: async () => undefined,
          unlink: async () => undefined,
        },
      },
    });

    const diagnostic: Diagnostic = {
      code: "E001",
      severity: "error",
      message: `Unable to write render output ${JSON.stringify(outputOption)} (injected write denial).`,
      file: normalizeDiagnosticFile(outputOption),
      line: 1,
      column: 1,
      jsonPointer: "",
    };
    expect(writerDestination).toBe(target);
    expect(writerDestination).not.toBe(outputOption);
    expect(temporaryPath).toBe(join(root, ".forced-render.tmp"));
    expect(result).toEqual({
      diagnostics: [diagnostic],
      error: null,
      exitCode: 2,
      stdout: "",
      stderr: report([diagnostic], null),
      written: false,
    });
    expect(await readFile(target)).toEqual(sentinel);
    expect(await readdir(root)).toEqual(["diagram.svg"]);
  });

  it("returns file JSON with the exact user option and keeps SVG out of stdout", async () => {
    const root = await temporaryRoot();
    const outputOption = "rendered output.svg";
    const result = await invoke(
      [
        "render",
        "K1",
        "--family",
        "control",
        "--project",
        motorProject,
        "--output",
        outputOption,
        "--json",
      ],
      { cwd: root },
    );
    const parsed = JSON.parse(result.stdout) as {
      artifact: Record<string, unknown>;
    };
    expect(result.exitCode).toBe(0);
    expect(parsed.artifact).toEqual({
      kind: "file",
      mediaType: "image/svg+xml",
      output: outputOption,
      written: true,
    });
    expect(parsed.artifact).not.toHaveProperty("svg");
    expect(result.stderr).toBe(report([], null));
    expect(await readFile(join(root, outputOption))).toEqual(
      await readFile(join(rendererGoldenRoot, "k1-control-left-to-right.svg")),
    );
  });
});

describe("M6 Task 6 atomic view output", () => {
  it("writes exact renderer bytes and emits view file JSON", async () => {
    const root = await temporaryRoot();
    const outputOption = "ps1 loads.svg";
    const result = await invoke(
      [
        "view",
        "PS1",
        "--loads",
        "--project",
        motorProject,
        "--output",
        outputOption,
        "--json",
      ],
      { cwd: root },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "view",
      artifact: {
        kind: "file",
        mediaType: "image/svg+xml",
        output: outputOption,
        written: true,
      },
    });
    expect(result.stdout).not.toContain("<svg");
    expect(result.stderr).toBe(report([], null));
    expect(await readFile(join(root, outputOption))).toEqual(
      await readFile(join(rendererGoldenRoot, "ps1-loads-left-to-right.svg")),
    );
    expect(await readdir(root)).toEqual([outputOption]);
  });

  it("preserves a sentinel and leaves no temporary residue on write failure", async () => {
    const root = await temporaryRoot();
    const outputOption = "nested/../view.svg";
    const target = resolve(root, outputOption);
    const sentinel = Buffer.from("preserve view bytes\n");
    await writeFile(target, sentinel);
    let writerDestination = "";

    const result = await runView("PS1", {
      loads: true,
      output: outputOption,
      json: true,
      cwd: root,
      compile: async () => successfulCompile(),
      createRenderer: () =>
        rendererReturning((request) => ({
          ok: true,
          value: fakeRendered(request),
        })),
      atomicWrite: {
        temporaryPath: (destination) => {
          writerDestination = destination;
          return join(dirname(destination), ".forced-view.tmp");
        },
        operations: {
          open: async () => {
            throw new Error("injected view write denial");
          },
          rename: async () => undefined,
          unlink: async () => undefined,
        },
      },
    });

    const diagnostic: Diagnostic = {
      code: "E001",
      severity: "error",
      message: `Unable to write render output ${JSON.stringify(outputOption)} (injected view write denial).`,
      file: normalizeDiagnosticFile(outputOption),
      line: 1,
      column: 1,
      jsonPointer: "",
    };
    expect(writerDestination).toBe(target);
    expect(result).toEqual({
      diagnostics: [diagnostic],
      error: null,
      exitCode: 2,
      stdout: "",
      stderr: report([diagnostic], null),
      written: false,
    });
    expect(await readFile(target)).toEqual(sentinel);
    expect(await readdir(root)).toEqual(["view.svg"]);
  });
});

const warningDiagnostic: Diagnostic = {
  code: "W901",
  severity: "warning",
  message: 'Project source pattern "optional/*.json" matched no files.',
  file: "system.json",
  line: 5,
  column: 15,
  jsonPointer: "/sources/1",
};

const expectedFailures = [
  {
    code: "Q001",
    message: 'No project object has designation "UNKNOWN".',
    input: "UNKNOWN",
  },
  {
    code: "R001",
    message: "Invalid request: root is incompatible with the control family.",
    requestedFormat: { kind: "string", value: "schematic-view-request/0.1" },
    requestedRoot: {
      kind: "selector",
      by: "designation",
      value: "K1",
    },
    requestedFamily: { kind: "string", value: "control" },
    requestedFlow: { kind: "string", value: "left-to-right" },
    family: "control",
    deviceUid: "device-k1",
    root: "K1",
  },
  {
    code: "R002",
    message:
      "Incomplete control view: no input path reaches a required boundary.",
    family: "control",
    deviceUid: "device-k1",
    pathSide: "input",
    root: "K1",
  },
  {
    code: "R003",
    message:
      'Unsupported symbol mapping: function "coil" on type "test:type" has no valid control binding.',
    family: "control",
    deviceUid: "device-k1",
    typeId: "test:type",
    functionKey: "coil",
    root: "K1",
  },
  {
    code: "R004",
    message: "Invalid schematic layout: injected deterministic ambiguity.",
    family: "control",
    netId: "net:test",
    root: "K1",
  },
  {
    code: "R005",
    message:
      "Invalid render text: terminal terminal-0064--d800 field terminal.key contains unpaired-surrogate.",
    family: "control",
    ownerKind: "terminal",
    ownerId: "terminal-0064--d800",
    field: "terminal.key",
    reason: "unpaired-surrogate",
    root: "K1",
  },
] as const satisfies readonly RenderFailure[];

describe("M5 Task 8 render warnings, expected failures, and tool boundaries", () => {
  it("keeps warnings on stderr with success exit 0 in raw and JSON modes", async () => {
    const createRenderer = () =>
      rendererReturning((request) => ({
        ok: true as const,
        value: fakeRendered(request),
      }));
    const compile = async () => successfulCompile([warningDiagnostic]);
    const [human, json] = await Promise.all([
      invoke(["render", "K1", "--family", "control"], {
        renderCompileProject: compile,
        renderCreateRenderer: createRenderer,
      }),
      invoke(["render", "K1", "--family", "control", "--json"], {
        renderCompileProject: compile,
        renderCreateRenderer: createRenderer,
      }),
    ]);

    expect(human.exitCode).toBe(0);
    expect(human.stdout).toBe(
      fakeRendered({
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
        flow: "left-to-right",
      }).svg,
    );
    expect(human.stderr).toBe(
      `${formatHumanDiagnostics([warningDiagnostic])}\n`,
    );
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ command: "render" });
    expect(json.stderr).toBe(report([warningDiagnostic], null));
  });

  it.each(expectedFailures)(
    "emits exact $code human and JSON reports without partial artifacts",
    async (failure) => {
      const root = await temporaryRoot();
      const humanOutput = join(root, `${failure.code}.human.svg`);
      const jsonOutput = join(root, `${failure.code}.json.svg`);
      const createRenderer = () =>
        rendererReturning({ ok: false as const, error: failure });
      const compile = async () => successfulCompile([warningDiagnostic]);
      const [human, json] = await Promise.all([
        invoke(
          ["render", "K1", "--family", "control", "--output", humanOutput],
          {
            renderCompileProject: compile,
            renderCreateRenderer: createRenderer,
          },
        ),
        invoke(
          [
            "render",
            "K1",
            "--family",
            "control",
            "--output",
            jsonOutput,
            "--json",
          ],
          {
            renderCompileProject: compile,
            renderCreateRenderer: createRenderer,
          },
        ),
      ]);

      expect(human).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `${formatHumanDiagnostics([warningDiagnostic])}\n\n${failure.code} ${failure.message}\n`,
      });
      expect(json).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: report([warningDiagnostic], failure),
      });
      expect(await readdir(root)).toEqual([]);
      expect(human.stderr).not.toContain("<svg");
      expect(json.stderr).not.toContain("<svg");
    },
  );

  it(
    "locks the Tier 2 view CLI human and JSON R004 product bytes end to end",
    { timeout: 120_000 },
    async ({ skip }) => {
      const cases = [
        ["right-deep", "left-to-right", "right-deep-right", 351, 599],
        ["right-deep", "top-to-bottom", "right-deep-down", 351, 599],
        ["bridge", "left-to-right", "bridge-right", 340, 588],
        ["bridge", "top-to-bottom", "bridge-down", 340, 588],
      ] as const satisfies readonly (readonly [
        Tier2FixtureName,
        "left-to-right" | "top-to-bottom",
        string,
        number,
        number,
      ])[];
      const projects = {} as Record<Tier2FixtureName, string>;
      for (const fixture of ["right-deep", "bridge"] as const) {
        const fixtureRoot = await temporaryRoot();
        const project = await materializeTier2Project(fixtureRoot, fixture);
        const compiled = await compileProject(project);
        expect(
          compiled.ok,
          compiled.ok ? "" : JSON.stringify(compiled.diagnostics),
        ).toBe(true);
        if (!compiled.ok) {
          throw new Error(JSON.stringify(compiled.diagnostics));
        }
        expect(compiled.diagnostics).toEqual([]);
        projects[fixture] = project;
      }

      for (const [fixture, flow, goldenName, humanBytes, jsonBytes] of cases) {
        const project = projects[fixture];
        const outputRoot = await temporaryRoot();
        const golden = await readFile(
          join(tier2GoldenRoot, `${goldenName}.r004.json`),
          "utf8",
        );
        const parsed = JSON.parse(golden) as {
          diagnostics: [];
          error: RenderFailure;
        };
        const humanGolden = `R004 ${parsed.error.message}\n`;
        let first:
          { readonly human: Invocation; readonly json: Invocation } | undefined;
        for (const repeat of [1, 2] as const) {
          const humanOutput = join(
            outputRoot,
            `${goldenName}.${repeat}.human.svg`,
          );
          const jsonOutput = join(
            outputRoot,
            `${goldenName}.${repeat}.json.svg`,
          );
          let human: Invocation;
          let json: Invocation;
          try {
            [human, json] = await Promise.all([
              invokeCliSubprocess([
                "view",
                "LS1",
                "--to",
                "PLC1",
                "--flow",
                flow,
                "--project",
                project,
                "--output",
                humanOutput,
              ]),
              invokeCliSubprocess([
                "view",
                "LS1",
                "--to",
                "PLC1",
                "--flow",
                flow,
                "--project",
                project,
                "--output",
                jsonOutput,
                "--json",
              ]),
            ]);
          } catch (error) {
            if (isChildProcessDenied(error)) {
              skip("The execution sandbox denied child-process creation.");
              return;
            }
            throw error;
          }

          expect(human).toEqual({
            exitCode: 1,
            stdout: "",
            stderr: humanGolden,
          });
          expect(json).toEqual({ exitCode: 1, stdout: "", stderr: golden });
          expect(Buffer.from(human.stderr, "utf8")).toEqual(
            Buffer.from(humanGolden, "utf8"),
          );
          expect(Buffer.from(json.stderr, "utf8")).toEqual(
            Buffer.from(golden, "utf8"),
          );
          expect(Buffer.byteLength(human.stderr, "utf8")).toBe(humanBytes);
          expect(Buffer.byteLength(json.stderr, "utf8")).toBe(jsonBytes);
          await expect(readFile(humanOutput)).rejects.toThrow();
          await expect(readFile(jsonOutput)).rejects.toThrow();
          if (first === undefined) {
            first = { human, json };
          } else {
            expect({ human, json }).toEqual(first);
          }
        }
      }
    },
  );

  it("stops on authored compiler diagnostics without constructing a renderer", async () => {
    const project = join(ruleFixtureRoot, "invalid-cable-conductor");
    const diagnostics = JSON.parse(
      await readFile(join(project, "expected.json"), "utf8"),
    ) as Diagnostic[];
    let constructorCalls = 0;
    const [human, json] = await Promise.all([
      invoke(["render", "K1", "--family", "control", "--project", project], {
        renderCreateRenderer: () => {
          constructorCalls += 1;
          throw new Error("renderer must not be constructed");
        },
      }),
      invoke(
        ["render", "K1", "--family", "control", "--project", project, "--json"],
        {
          renderCreateRenderer: () => {
            constructorCalls += 1;
            throw new Error("renderer must not be constructed");
          },
        },
      ),
    ]);

    expect(constructorCalls).toBe(0);
    expect(human).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `${formatHumanDiagnostics(diagnostics)}\n`,
    });
    expect(json).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: report(diagnostics, null),
    });
  });

  it.each(["construction", "render"] as const)(
    "routes a thrown renderer %s invariant to E001/exit 2",
    async (stage) => {
      const root = await temporaryRoot();
      const output = join(root, "existing.svg");
      const sentinel = "keep this artifact\n";
      await writeFile(output, sentinel, "utf8");
      const createRenderer = (): SchematicRenderer => {
        if (stage === "construction") {
          throw new Error("injected catalog invariant");
        }
        return {
          render: async () => {
            throw new Error("injected layout invariant");
          },
        };
      };
      const detail =
        stage === "construction"
          ? "injected catalog invariant"
          : "injected layout invariant";
      const diagnostic: Diagnostic = {
        code: "E001",
        severity: "error",
        message: `Render tool failure (${detail}).`,
        file: normalizeDiagnosticFile(motorIr.project.source.file),
        line: 1,
        column: 1,
        jsonPointer: "",
      };
      const result = await invoke(
        ["render", "K1", "--family", "control", "--output", output, "--json"],
        {
          renderCompileProject: async () => successfulCompile(),
          renderCreateRenderer: createRenderer,
        },
      );

      expect(result).toEqual({
        exitCode: 2,
        stdout: "",
        stderr: report([diagnostic], null),
      });
      expect(result.stderr).not.toContain("R004");
      expect(await readFile(output, "utf8")).toBe(sentinel);
      expect(await readdir(root)).toEqual(["existing.svg"]);
    },
  );

  it("preserves a compiler tool-failure exit 2 and never constructs the renderer", async () => {
    const diagnostic: Diagnostic = {
      code: "E001",
      severity: "error",
      message: "Injected compiler tool failure.",
      file: "system.json",
      line: 1,
      column: 1,
      jsonPointer: "",
    };
    let constructorCalls = 0;
    const result = await invoke(
      ["render", "K1", "--family", "control", "--json"],
      {
        renderCompileProject: async () => ({
          ok: false,
          diagnostics: [diagnostic],
          toolFailure: true,
        }),
        renderCreateRenderer: () => {
          constructorCalls += 1;
          return rendererReturning({
            ok: true,
            value: fakeRendered({
              format: "schematic-view-request/0.1",
              family: "control",
              root: { by: "designation", value: "K1" },
            }),
          });
        },
      },
    );
    expect(constructorCalls).toBe(0);
    expect(result).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: report([diagnostic], null),
    });
  });
});

const viewRenderFailure = {
  code: "R002",
  family: "control",
  intent: "loads",
  deviceUid: "device-ps1",
  segment: "complete-load",
  message:
    "Incomplete loads view: the requested source has no complete renderable load.",
  root: "PS1",
} as const satisfies RenderFailure;

const authoredCompilerDiagnostic: Diagnostic = {
  code: "E200",
  severity: "error",
  message: "Injected authored compiler diagnostic.",
  file: "system.json",
  line: 2,
  column: 3,
  jsonPointer: "/objects/0",
};

describe("M6 Task 6 view streams, failures, and exit codes", () => {
  it("keeps warnings on stderr with success exit 0 in raw and JSON modes", async () => {
    const options = {
      renderCompileProject: async () => successfulCompile([warningDiagnostic]),
      renderCreateRenderer: () =>
        rendererReturning((request) => ({
          ok: true as const,
          value: fakeRendered(request),
        })),
    };
    const [raw, json] = await Promise.all([
      invoke(["view", "PS1", "--loads"], options),
      invoke(["view", "PS1", "--loads", "--json"], options),
    ]);

    expect(raw).toEqual({
      exitCode: 0,
      stdout: fakeRendered({
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
        flow: "left-to-right",
      }).svg,
      stderr: `${formatHumanDiagnostics([warningDiagnostic])}\n`,
    });
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ command: "view" });
    expect(json.stderr).toBe(report([warningDiagnostic], null));
  });

  it("routes expected query and render failures to exit 1 with no artifact", async () => {
    const root = await temporaryRoot();
    const output = join(root, "must-not-exist.svg");
    const [missingRoot, missingTarget, renderFailure, humanRenderFailure] =
      await Promise.all([
        invoke([
          "view",
          "UNKNOWN",
          "--loads",
          "--project",
          motorProject,
          "--json",
        ]),
        invoke([
          "view",
          "LS1",
          "--to",
          "UNKNOWN",
          "--project",
          motorProject,
          "--json",
        ]),
        invoke(["view", "PS1", "--loads", "--output", output, "--json"], {
          renderCompileProject: async () => successfulCompile(),
          renderCreateRenderer: () =>
            rendererReturning({ ok: false, error: viewRenderFailure }),
        }),
        invoke(["view", "PS1", "--loads"], {
          renderCompileProject: async () => successfulCompile(),
          renderCreateRenderer: () =>
            rendererReturning({ ok: false, error: viewRenderFailure }),
        }),
      ]);

    for (const result of [missingRoot, missingTarget]) {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        diagnostics: [],
        error: { code: "Q001", input: "UNKNOWN" },
      });
    }
    expect(renderFailure).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: report([], viewRenderFailure),
    });
    expect(humanRenderFailure).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `R002 ${viewRenderFailure.message}\n`,
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("splits ordinary compiler diagnostics at exit 1 from tool failures at exit 2", async () => {
    let constructorCalls = 0;
    const createRenderer = () => {
      constructorCalls += 1;
      throw new Error("renderer must not be constructed");
    };
    const [ordinaryHuman, ordinaryJson, toolJson] = await Promise.all([
      invoke(["view", "PS1", "--loads"], {
        renderCompileProject: async () => ({
          ok: false,
          diagnostics: [authoredCompilerDiagnostic],
          toolFailure: false,
        }),
        renderCreateRenderer: createRenderer,
      }),
      invoke(["view", "PS1", "--loads", "--json"], {
        renderCompileProject: async () => ({
          ok: false,
          diagnostics: [authoredCompilerDiagnostic],
          toolFailure: false,
        }),
        renderCreateRenderer: createRenderer,
      }),
      invoke(["view", "PS1", "--loads", "--json"], {
        renderCompileProject: async () => ({
          ok: false,
          diagnostics: [authoredCompilerDiagnostic],
          toolFailure: true,
        }),
        renderCreateRenderer: createRenderer,
      }),
    ]);

    expect(constructorCalls).toBe(0);
    expect(ordinaryHuman).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `${formatHumanDiagnostics([authoredCompilerDiagnostic])}\n`,
    });
    expect(ordinaryJson).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: report([authoredCompilerDiagnostic], null),
    });
    expect(toolJson).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: report([authoredCompilerDiagnostic], null),
    });
  });

  it("routes a thrown view renderer invariant to E001 and exit 2", async () => {
    const result = await invoke(["view", "PS1", "--loads", "--json"], {
      renderCompileProject: async () => successfulCompile(),
      renderCreateRenderer: () => ({
        render: async () => {
          throw new Error("injected view invariant");
        },
      }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      diagnostics: [
        {
          code: "E001",
          message: "Render tool failure (injected view invariant).",
        },
      ],
      error: null,
    });
  });
});

describe("M5 Task 8 Commander boundary", () => {
  it.each([
    [["render", "K1"], "required option '--family <family>' not specified"],
    [
      ["render", "K1", "--family", "invalid"],
      "Allowed choices are control, power",
    ],
    [
      ["render", "K1", "--family", "control", "--flow", "diagonal"],
      "Allowed choices are left-to-right, top-to-bottom",
    ],
    [
      ["render", "--family", "control"],
      "missing required argument 'designation'",
    ],
    [["render", "K1", "EXTRA", "--family", "control"], "too many arguments"],
    [
      ["render", "K1", "--family", "control", "--strict"],
      "unknown option '--strict'",
    ],
    [
      ["render", "K1", "--family", "control", "--power"],
      "unknown option '--power'",
    ],
    [
      ["render", "K1", "--family", "control", "--theme", "dark"],
      "unknown option '--theme'",
    ],
  ] as const)(
    "rejects usage before compilation: thermite %s",
    async (args, message) => {
      let compileCalls = 0;
      const result = await invoke([...args, "--json"], {
        renderCompileProject: async () => {
          compileCalls += 1;
          throw new Error("compile must not run");
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
      expect(result.stderr.trimStart().startsWith("error:")).toBe(true);
      expect(() => JSON.parse(result.stderr)).toThrow();
      expect(compileCalls).toBe(0);
    },
  );

  it("keeps render help and global version outside JSON with exit 0", async () => {
    let compileCalls = 0;
    const options = {
      renderCompileProject: async () => {
        compileCalls += 1;
        throw new Error("compile must not run");
      },
    };
    const [help, version] = await Promise.all([
      invoke(["render", "--help"], options),
      invoke(["--version"], options),
    ]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain(
      "Usage: thermite render [options] <designation>",
    );
    expect(help.stdout).toContain("--family <family>");
    expect(help.stderr).toBe("");
    expect(version).toEqual({ exitCode: 0, stdout: "0.2.0\n", stderr: "" });
    expect(compileCalls).toBe(0);
  });
});

describe("M6 Task 6 Commander view boundary", () => {
  it.each([
    [["view", "PS1", "--json"], "exactly one view intent is required"],
    [
      ["view", "PS1", "--loads", "--power", "--json"],
      "exactly one view intent is required",
    ],
    [
      ["view", "PS1", "--loads", "--include-power", "--json"],
      "option '--include-power' is only valid with '--to <designation>'",
    ],
    [["view", "LS1", "--to"], "option '--to <designation>' argument missing"],
    [
      ["view", "PS1", "--loads", "--flow", "diagonal", "--json"],
      "Allowed choices are left-to-right, top-to-bottom",
    ],
    [["view", "--loads", "--json"], "missing required argument 'designation'"],
    [["view", "PS1", "EXTRA", "--loads", "--json"], "too many arguments"],
    [
      ["view", "PS1", "--loads", "--family", "control", "--json"],
      "unknown option '--family'",
    ],
  ] as const)(
    "keeps usage failure human-formatted before action: thermite %s",
    async (args, message) => {
      let compileCalls = 0;
      const result = await invoke(args, {
        renderCompileProject: async () => {
          compileCalls += 1;
          throw new Error("compile must not run");
        },
      });

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
      expect(result.stderr.trimStart().startsWith("error:")).toBe(true);
      expect(() => JSON.parse(result.stderr)).toThrow();
      expect(compileCalls).toBe(0);
    },
  );

  it("shows the exact view grammar without compiling", async () => {
    let compileCalls = 0;
    const result = await invoke(["view", "--help"], {
      renderCompileProject: async () => {
        compileCalls += 1;
        throw new Error("compile must not run");
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: thermite view [options] <designation>",
    );
    for (const option of [
      "--power",
      "--actuation",
      "--to <designation>",
      "--conductors",
      "--loads",
      "--include-power",
      "--flow <flow>",
      "--project <path>",
      "-o, --output <file>",
      "--json",
    ]) {
      expect(result.stdout).toContain(option);
    }
    expect(result.stderr).toBe("");
    expect(compileCalls).toBe(0);
  });
});

const identityFixtures = [
  {
    ownerKind: "cable-conductor",
    prefix: "cable-conductor",
    parts: (value: string) => ["cable-uid", value],
    field: "cable.conductor.id",
  },
  {
    ownerKind: "terminal",
    prefix: "terminal",
    parts: (value: string) => ["device-uid", value],
    field: "terminal.key",
  },
  {
    ownerKind: "function",
    prefix: "function",
    parts: (value: string) => ["device-uid", value],
    field: "function.key",
  },
] as const;

describe("M5 Task 8 R005 raw-code-unit command boundaries", () => {
  it.each([
    {
      name: "collapsed-rail device designation",
      mutate(ir: ElectricalIr) {
        const device = ir.devices.find(
          ({ designation }) => designation === "PS1",
        )!;
        device.designation = "PS1\ud800";
        ir.indexes.objectRefByDesignation.find(
          ({ value }) => value.kind === "device" && value.uid === device.uid,
        )!.key = device.designation;
        return {
          ownerKind: "device",
          ownerId: semanticId("device", [device.uid]),
          field: "device.designation",
          reason: "unpaired-surrogate",
        } as const;
      },
    },
    {
      name: "shadowed wire designation",
      mutate(ir: ElectricalIr) {
        const wire = ir.wires.find(
          ({ designation }) => designation === "W-CTL-007",
        )!;
        wire.designation = "WIRE\ufffe";
        wire.properties = { ...wire.properties, label: "VISIBLE-WIRE" };
        ir.indexes.objectRefByDesignation.find(
          ({ value }) => value.kind === "wire" && value.uid === wire.uid,
        )!.key = wire.designation;
        return {
          ownerKind: "wire",
          ownerId: semanticId("wire", [wire.uid]),
          field: "wire.designation",
          reason: "xml-illegal-code-point",
        } as const;
      },
    },
  ])("returns exit 1/no artifact for $name before ELK", async ({ mutate }) => {
    const root = await temporaryRoot();
    const output = join(root, "diagram.svg");
    const ir = structuredClone(motorIr);
    const expected = mutate(ir);
    const knownLayoutOptions = vi.fn(async () => []);
    const layout = vi.fn(async () => {
      throw new Error("layout must not be called");
    });
    const result = await invoke(
      ["render", "K1", "--family", "control", "--output", output],
      {
        renderCompileProject: async () => ({
          ok: true,
          diagnostics: [],
          ir,
        }),
        renderCreateRenderer: () =>
          createSchematicRendererWithDependencies({
            layoutEngine: {
              knownLayoutOptions,
              layout,
            } as unknown as ELK,
          }),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `R005 Invalid render text: ${expected.ownerKind} ${expected.ownerId} field ${expected.field} contains ${expected.reason}.\n`,
    );
    expect(knownLayoutOptions).not.toHaveBeenCalled();
    expect(layout).not.toHaveBeenCalled();
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(root)).toEqual([]);
  });

  it.each(identityFixtures)(
    "preserves pairwise-distinct $ownerKind IDs and exact R005 owner IDs",
    async (fixture) => {
      const values = ["\ud800", "\udc00", "\ufffd"];
      const ids = values.map((value) =>
        semanticId(fixture.prefix, fixture.parts(value)),
      );
      expect(new Set(ids).size).toBe(3);

      for (const [index, value] of values.entries()) {
        const ownerId = ids[index]!;
        const illegal = value !== "\ufffd";
        const outcome: RenderOutcome<RenderedSchematic> = illegal
          ? {
              ok: false,
              error: {
                code: "R005",
                message: `Invalid render text: ${fixture.ownerKind} ${ownerId} field ${fixture.field} contains unpaired-surrogate.`,
                family: "control",
                ownerKind: fixture.ownerKind,
                ownerId,
                field: fixture.field,
                reason: "unpaired-surrogate",
                root: "K1",
              },
            }
          : {
              ok: true,
              value: {
                ...fakeRendered({
                  format: "schematic-view-request/0.1",
                  family: "control",
                  root: { by: "designation", value: "K1" },
                }),
                svg: `<svg><g id="${ownerId}"/></svg>\n`,
              },
            };
        const result = await invoke(
          ["render", "K1", "--family", "control", "--json"],
          {
            renderCompileProject: async () => successfulCompile(),
            renderCreateRenderer: () => rendererReturning(outcome),
          },
        );

        expect(result.exitCode).toBe(illegal ? 1 : 0);
        if (illegal) {
          expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr)).toMatchObject({
            diagnostics: [],
            error: {
              code: "R005",
              ownerKind: fixture.ownerKind,
              ownerId,
              field: fixture.field,
              reason: "unpaired-surrogate",
            },
          });
          expect(result.stderr).not.toContain(value);
        } else {
          expect(JSON.parse(result.stdout)).toMatchObject({
            artifact: { kind: "inline", svg: expect.stringContaining(ownerId) },
          });
          expect(result.stderr).toBe(report([], null));
        }
      }
    },
  );

  it.each([
    ["\ud800", "unpaired-surrogate"],
    ["\ufffe", "xml-illegal-code-point"],
  ] as const)(
    "returns exact safe device.type R005 for %j without creating or replacing output",
    async (value, reason) => {
      const root = await temporaryRoot();
      const absent = join(root, "absent.svg");
      const existing = join(root, "existing.svg");
      const sentinel = Buffer.from([0, 0x45, 0x53, 0xff, 0x0a]);
      await writeFile(existing, sentinel);
      const deviceUid = motorIr.devices.find(
        (device) => device.designation === "K1",
      )!.uid;
      const ownerId = semanticId("device", [deviceUid]);
      const error = {
        code: "R005",
        message: `Invalid render text: device ${ownerId} field device.type contains ${reason}.`,
        family: "control",
        ownerKind: "device",
        ownerId,
        field: "device.type",
        reason,
        root: "K1",
      } as const satisfies RenderFailure;
      const options = {
        renderCompileProject: async () => successfulCompile(),
        renderCreateRenderer: () =>
          rendererReturning({ ok: false as const, error }),
      };
      const [human, json] = await Promise.all([
        invoke(
          ["render", "K1", "--family", "control", "--output", absent],
          options,
        ),
        invoke(
          [
            "render",
            "K1",
            "--family",
            "control",
            "--output",
            existing,
            "--json",
          ],
          options,
        ),
      ]);

      expect(human).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `R005 ${error.message}\n`,
      });
      expect(json).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: report([], error),
      });
      expect(human.stderr).not.toContain(value);
      expect(json.stderr).not.toContain(value);
      await expect(readFile(absent)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(existing)).toEqual(sentinel);
      expect(await readdir(root)).toEqual(["existing.svg"]);
    },
  );
});

describe("M6 Task 6 view subprocess stream and exit matrix", () => {
  it(
    "preserves every D9 row in a fresh process",
    { timeout: 120_000 },
    async ({ skip }) => {
      const root = await temporaryRoot();
      const rawOutput = join(root, "raw-view.svg");
      const jsonOutput = join(root, "json-view.svg");
      const sentinelOutput = join(root, "sentinel.svg");
      const sentinel = "preserve subprocess sentinel\n";
      await writeFile(sentinelOutput, sentinel, "utf8");
      const script = `
        import { compileProject } from ${JSON.stringify(compilerModuleUrl)};
        import { runCli } from ${JSON.stringify(cliModuleUrl)};
        const compiled = await compileProject(${JSON.stringify(motorProject)});
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
        const warning = ${JSON.stringify(warningDiagnostic)};
        const authoredError = ${JSON.stringify(authoredCompilerDiagnostic)};
        const renderFailure = ${JSON.stringify(viewRenderFailure)};
        const queryFailure = { code: "Q001", message: 'No project object has designation "UNKNOWN".', input: "UNKNOWN" };
        const rootDevice = compiled.ir.devices.find(({ designation }) => designation === "PS1");
        if (!rootDevice) throw new Error("PS1 fixture missing");
        const rendered = {
          view: {
            format: "schematic-view/0.2",
            family: "control",
            intent: "loads",
            root: { kind: "device", deviceUid: rootDevice.uid, designation: "PS1" },
            flow: "left-to-right",
          },
          summary: { deviceUids: [], terminalIds: [], functionIds: [], conductiveElementIds: [], netIds: [], presentationNodeIds: [] },
          svg: '<svg data-subprocess-view="true"></svg>\\n',
        };
        const invoke = async (args, overrides = {}) => {
          let stdout = "";
          let stderr = "";
          const exitCode = await runCli(["node", "thermite", ...args], {
            cwd: ${JSON.stringify(root)},
            stdout: { write: (text) => (stdout += text) },
            stderr: { write: (text) => (stderr += text) },
            renderCompileProject: async () => compiled,
            renderCreateRenderer: () => ({ render: async () => ({ ok: true, value: rendered }) }),
            ...overrides,
          });
          return { exitCode, stdout, stderr };
        };
        const warningCompile = async () => ({ ...compiled, diagnostics: [warning] });
        const results = {};
        results.rawInline = await invoke(["view", "PS1", "--loads"], { renderCompileProject: warningCompile });
        results.rawFile = await invoke(["view", "PS1", "--loads", "--output", ${JSON.stringify(rawOutput)}]);
        results.jsonInline = await invoke(["view", "PS1", "--loads", "--json"], { renderCompileProject: warningCompile });
        results.jsonFile = await invoke(["view", "PS1", "--loads", "--output", ${JSON.stringify(jsonOutput)}, "--json"]);
        results.compilerDiagnostic = await invoke(["view", "PS1", "--loads", "--json"], {
          renderCompileProject: async () => ({ ok: false, diagnostics: [authoredError], toolFailure: false }),
        });
        results.renderFailure = await invoke(["view", "PS1", "--loads", "--json"], {
          renderCreateRenderer: () => ({ render: async () => ({ ok: false, error: renderFailure }) }),
        });
        results.queryFailure = await invoke(["view", "UNKNOWN", "--loads", "--json"], {
          renderCreateRenderer: () => ({ render: async () => ({ ok: false, error: queryFailure }) }),
        });
        results.compilerToolFailure = await invoke(["view", "PS1", "--loads", "--json"], {
          renderCompileProject: async () => ({ ok: false, diagnostics: [authoredError], toolFailure: true }),
        });
        let usageCompileCalls = 0;
        results.usageFailure = await invoke(["view", "PS1", "--json"], {
          renderCompileProject: async () => {
            usageCompileCalls += 1;
            throw new Error("usage must not compile");
          },
        });
        results.internalFailure = await invoke(["view", "PS1", "--loads", "--json"], {
          renderCreateRenderer: () => ({ render: async () => { throw new Error("fresh-process invariant"); } }),
        });
        results.writeFailure = await invoke(["view", "PS1", "--loads", "--output", ${JSON.stringify(sentinelOutput)}, "--json"], {
          renderAtomicWrite: {
            temporaryPath: () => ${JSON.stringify(join(root, ".forced-view.tmp"))},
            operations: {
              open: async () => { throw new Error("fresh-process write denial"); },
              rename: async () => undefined,
              unlink: async () => undefined,
            },
          },
        });
        process.stdout.write(JSON.stringify({ results, usageCompileCalls }));
      `;

      let subprocess: Invocation;
      try {
        subprocess = await invokeEvalSubprocess(script);
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip("The execution sandbox denied child-process creation.");
          return;
        }
        throw error;
      }

      expect(subprocess).toMatchObject({ exitCode: 0, stderr: "" });
      const { results, usageCompileCalls } = JSON.parse(subprocess.stdout) as {
        results: Record<string, Invocation>;
        usageCompileCalls: number;
      };
      expect(results.rawInline).toEqual({
        exitCode: 0,
        stdout: '<svg data-subprocess-view="true"></svg>\n',
        stderr: `${formatHumanDiagnostics([warningDiagnostic])}\n`,
      });
      expect(results.rawFile).toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      expect(await readFile(rawOutput, "utf8")).toBe(
        '<svg data-subprocess-view="true"></svg>\n',
      );
      expect(results.jsonInline!.exitCode).toBe(0);
      expect(JSON.parse(results.jsonInline!.stdout)).toMatchObject({
        command: "view",
        artifact: {
          kind: "inline",
          mediaType: "image/svg+xml",
          svg: '<svg data-subprocess-view="true"></svg>\n',
        },
      });
      expect(results.jsonInline!.stderr).toBe(
        report([warningDiagnostic], null),
      );
      expect(results.jsonFile!.exitCode).toBe(0);
      expect(JSON.parse(results.jsonFile!.stdout)).toMatchObject({
        command: "view",
        artifact: {
          kind: "file",
          mediaType: "image/svg+xml",
          output: jsonOutput,
          written: true,
        },
      });
      expect(results.jsonFile!.stderr).toBe(report([], null));
      expect(await readFile(jsonOutput, "utf8")).toBe(
        '<svg data-subprocess-view="true"></svg>\n',
      );
      expect(results.compilerDiagnostic).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: report([authoredCompilerDiagnostic], null),
      });
      expect(results.renderFailure).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: report([], viewRenderFailure),
      });
      expect(results.queryFailure!.exitCode).toBe(1);
      expect(results.queryFailure!.stdout).toBe("");
      expect(JSON.parse(results.queryFailure!.stderr)).toMatchObject({
        diagnostics: [],
        error: { code: "Q001", input: "UNKNOWN" },
      });
      expect(results.compilerToolFailure).toEqual({
        exitCode: 2,
        stdout: "",
        stderr: report([authoredCompilerDiagnostic], null),
      });
      expect(results.usageFailure!.exitCode).toBe(2);
      expect(results.usageFailure!.stdout).toBe("");
      expect(results.usageFailure!.stderr).toContain(
        "error: exactly one view intent is required",
      );
      expect(() => JSON.parse(results.usageFailure!.stderr)).toThrow();
      expect(usageCompileCalls).toBe(0);
      for (const name of ["internalFailure", "writeFailure"] as const) {
        expect(results[name]!.exitCode).toBe(2);
        expect(results[name]!.stdout).toBe("");
        expect(JSON.parse(results[name]!.stderr)).toMatchObject({
          diagnostics: [{ code: "E001" }],
          error: null,
        });
      }
      expect(await readFile(sentinelOutput, "utf8")).toBe(sentinel);
      expect((await readdir(root)).sort()).toEqual([
        "json-view.svg",
        "raw-view.svg",
        "sentinel.svg",
      ]);
    },
  );
});

describe("M5 Task 8 subprocess boundaries", () => {
  it(
    "preserves every Q/R stream shape and raw-code-unit identity in a fresh process",
    { timeout: 120_000 },
    async ({ skip }) => {
      const script = `
        import { compileProject } from ${JSON.stringify(compilerModuleUrl)};
        import { runCli } from ${JSON.stringify(cliModuleUrl)};
        const compiled = await compileProject(${JSON.stringify(motorProject)});
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
        const failures = ${JSON.stringify(expectedFailures)};
        const encode = (value) => {
          let result = "";
          for (let index = 0; index < value.length; index += 1) {
            result += value.charCodeAt(index).toString(16).padStart(4, "0");
          }
          return result;
        };
        const semanticId = (prefix, parts) =>
          prefix + "-" + parts.map(encode).join("--");
        const identity = [
          ["cable-conductor", "cable.conductor.id", ["cable-uid"]],
          ["terminal", "terminal.key", ["device-uid"]],
          ["function", "function.key", ["device-uid"]],
        ].flatMap(([ownerKind, field, head]) =>
          ["\\ud800", "\\udc00", "\\ufffd"].map((escaped) => {
            const value = JSON.parse('"' + escaped + '"');
            return {
              ownerKind,
              field,
              value,
              ownerId: semanticId(ownerKind, [...head, value]),
            };
          }),
        );
        const results = [];
        for (const error of failures) {
          for (const json of [false, true]) {
            let stdout = "";
            let stderr = "";
            const exitCode = await runCli(
              ["node", "thermite", "render", "K1", "--family", "control", ...(json ? ["--json"] : [])],
              {
                stdout: { write: (text) => (stdout += text) },
                stderr: { write: (text) => (stderr += text) },
                renderCompileProject: async () => compiled,
                renderCreateRenderer: () => ({
                  render: async () => ({ ok: false, error }),
                }),
              },
            );
            results.push({ kind: "failure", code: error.code, json, exitCode, stdout, stderr });
          }
        }
        for (const fixture of identity) {
          const illegal = fixture.value !== "�";
          const error = {
            code: "R005",
            message: "Invalid render text: " + fixture.ownerKind + " " + fixture.ownerId + " field " + fixture.field + " contains unpaired-surrogate.",
            family: "control",
            ownerKind: fixture.ownerKind,
            ownerId: fixture.ownerId,
            field: fixture.field,
            reason: "unpaired-surrogate",
            root: "K1",
          };
          let stdout = "";
          let stderr = "";
          const exitCode = await runCli(
            ["node", "thermite", "render", "K1", "--family", "control", "--json"],
            {
              stdout: { write: (text) => (stdout += text) },
              stderr: { write: (text) => (stderr += text) },
              renderCompileProject: async () => compiled,
              renderCreateRenderer: () => ({
                render: async () => illegal
                  ? { ok: false, error }
                  : {
                      ok: true,
                      value: {
                        view: { format: "schematic-view/0.1", family: "control", root: { deviceUid: "device", designation: "K1" }, flow: "left-to-right" },
                        summary: { deviceUids: [], terminalIds: [], functionIds: [], conductiveElementIds: [], netIds: [], presentationNodeIds: [] },
                        svg: '<svg><g id="' + fixture.ownerId + '"/></svg>\\n',
                      },
                    },
              }),
            },
          );
          results.push({ kind: "identity", ...fixture, illegal, exitCode, stdout, stderr });
        }
        process.stdout.write(JSON.stringify(results));
      `;
      let subprocess: Invocation;
      try {
        subprocess = await invokeEvalSubprocess(script);
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip("The execution sandbox denied child-process creation.");
          return;
        }
        throw error;
      }

      expect(subprocess.exitCode).toBe(0);
      expect(subprocess.stderr).toBe("");
      const results = JSON.parse(subprocess.stdout) as Array<{
        kind: "failure" | "identity";
        code?: string;
        json?: boolean;
        ownerKind?: string;
        ownerId?: string;
        field?: string;
        illegal?: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
      }>;
      const failureResults = results.filter(({ kind }) => kind === "failure");
      expect(failureResults).toHaveLength(expectedFailures.length * 2);
      for (const result of failureResults) {
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        if (result.json) {
          expect(JSON.parse(result.stderr)).toMatchObject({
            diagnostics: [],
            error: { code: result.code },
          });
        } else {
          expect(result.stderr).toMatch(new RegExp(`^${result.code} `));
          expect(result.stderr.endsWith("\n")).toBe(true);
        }
      }
      const identityResults = results.filter(({ kind }) => kind === "identity");
      expect(identityResults).toHaveLength(identityFixtures.length * 3);
      for (const fixture of identityFixtures) {
        const ids = identityResults
          .filter(({ ownerKind }) => ownerKind === fixture.ownerKind)
          .map(({ ownerId }) => ownerId);
        expect(new Set(ids).size).toBe(3);
      }
      for (const result of identityResults) {
        expect(result.exitCode).toBe(result.illegal ? 1 : 0);
        if (result.illegal) {
          expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr)).toMatchObject({
            error: {
              code: "R005",
              ownerKind: result.ownerKind,
              ownerId: result.ownerId,
              field: result.field,
            },
          });
        } else {
          expect(JSON.parse(result.stdout)).toMatchObject({
            artifact: { svg: expect.stringContaining(result.ownerId) },
          });
        }
      }
    },
  );

  it(
    "preserves compiler failures and end-of-options parsing in fresh processes",
    { timeout: 120_000 },
    async ({ skip }) => {
      let compilerFailure: Invocation;
      let endOfOptions: Invocation;
      try {
        compilerFailure = await invokeCliSubprocess([
          "render",
          "K1",
          "--family",
          "control",
          "--project",
          join(ruleFixtureRoot, "invalid-cable-conductor"),
          "--json",
        ]);
        const script = `
          import { compileProject } from ${JSON.stringify(compilerModuleUrl)};
          import { runCli } from ${JSON.stringify(cliModuleUrl)};
          const compiled = await compileProject(${JSON.stringify(motorProject)});
          if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
          process.exitCode = await runCli(
            ["node", "thermite", "render", "--family", "control", "--json", "--", "-K1"],
            {
              renderCompileProject: async () => compiled,
              renderCreateRenderer: () => ({
                render: async (_ir, request) => ({
                  ok: false,
                  error: { code: "Q001", message: "No project object has designation \\\"-K1\\\".", input: request.root.value },
                }),
              }),
            },
          );
        `;
        endOfOptions = await invokeEvalSubprocess(script);
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip("The execution sandbox denied child-process creation.");
          return;
        }
        throw error;
      }

      expect(compilerFailure.exitCode).toBe(1);
      expect(compilerFailure.stdout).toBe("");
      expect(JSON.parse(compilerFailure.stderr)).toMatchObject({
        diagnostics: [{ code: "E200" }],
        error: null,
      });
      expect(endOfOptions.exitCode).toBe(1);
      expect(endOfOptions.stdout).toBe("");
      expect(JSON.parse(endOfOptions.stderr)).toMatchObject({
        diagnostics: [],
        error: { code: "Q001", input: "-K1" },
      });
    },
  );
});

describe("M8 Task 4 agent create-view R005 split-stream goldens", () => {
  const cases = [
    "project-empty",
    "view-single-line",
    "presentation-surrogate",
  ] as const;

  it.each(cases)("byte-compares both captured streams for %s", async (slug) => {
    const root = join(packageRoot, "test", "goldens", "m8-r005");
    const expectedStdout = await readFile(join(root, `${slug}.stdout.txt`));
    const expectedStderr = await readFile(join(root, `${slug}.stderr.json`));
    const report = JSON.parse(expectedStderr.toString("utf8")) as {
      error: RenderFailure;
    };
    const tools = {
      createView: async () => ({
        ok: false as const,
        diagnostics: [],
        error: report.error,
        failureClass: "expected" as const,
      }),
    } as unknown as AgentTools;
    const input = Buffer.from(
      `${JSON.stringify({
        format: "agent-tool-request/0.1",
        project: ".",
        spec: {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "K1" },
          family: "control",
        },
      })}\n`,
      "utf8",
    );
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(
      ["node", "thermite", "agent", "create-view", "--input", "-"],
      {
        agentCreateTools: () => tools,
        agentStdin: {
          async *[Symbol.asyncIterator]() {
            yield input;
          },
        },
        stdout: { write: (text) => (stdout += text) },
        stderr: { write: (text) => (stderr += text) },
      },
    );
    expect(exitCode).toBe(1);
    expect(Buffer.from(stdout, "utf8")).toEqual(expectedStdout);
    expect(Buffer.from(stderr, "utf8")).toEqual(expectedStderr);
    expect(expectedStdout.byteLength).toBe(0);
    expect(Object.keys(JSON.parse(stderr))).toEqual([
      "format",
      "tool",
      "diagnostics",
      "error",
    ]);
  });
});
