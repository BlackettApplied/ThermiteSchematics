import { resolve } from "node:path";

import {
  compileProject,
  lockProject,
  serializeIr,
  writeFileAtomically,
  type AtomicWriteOptions,
  type CompileResult,
} from "@thermite/compiler";
import {
  createQueryEngine,
  serializeQueryResult,
  type QueryCommandResult,
  type QueryError,
  type QueryResult,
  type TerminalSelector,
} from "@thermite/query";
import {
  createSchematicRenderer,
  type RenderFailure,
  type RenderOutcome,
  type RenderedSchematic,
  type SchematicFlow,
  type SchematicRenderer,
  type SchematicViewFamily,
  type SchematicViewRequest,
} from "@thermite/render";
import {
  DIAGNOSTIC_CATALOG,
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
} from "@thermite/schema";
import { Command, CommanderError, Option } from "commander";

import {
  runAgentCommand,
  type AgentInputStream,
  type AgentToolsFactory,
} from "./agent-command.js";
import {
  INIT_SYNTAX_MESSAGE,
  parseInitArguments,
  runInit,
  type InitAssetLocations,
  type InitFilesystemDependencies,
} from "./init.js";
import { renderHumanQueryResult } from "./query-renderer.js";
import {
  serializeRenderCommandReport,
  serializeRenderCommandResult,
} from "./render-command-serializer.js";
import { CLI_VERSION } from "./version.js";

export type {
  RenderCommandJsonResult,
  RenderCommandReport,
} from "./render-command-serializer.js";
export {
  DEFAULT_STARTER_PROJECT_NAME,
  DEFAULT_STARTER_REVISION,
  STARTER_DIRECTORY_PATHS,
  STARTER_NON_LOCK_TEMPLATE_PATHS,
  STARTER_OUTPUT_FILE_PATHS,
  STARTER_TEMPLATE_PATHS,
  DEFAULT_STARTER_IDENTITIES,
  buildStarterScaffold,
  createStarterLoadedProject,
  prepareStarterScaffoldFromAssets,
  type BuildStarterScaffoldOptions,
  type PreparedStarterScaffold,
  type ShippedCoreFilePath,
  type StarterAssetBytes,
  type StarterIdentities,
  type StarterNonLockTemplatePath,
  type StarterOutputFilePath,
  type StarterScaffoldValues,
  type StarterTemplatePath,
} from "./starter.js";
export {
  INIT_NON_EMPTY_MESSAGE,
  INIT_SUCCESS_MESSAGE,
  INIT_SYNTAX_MESSAGE,
  isValidInitText,
  parseInitArguments,
  runInit,
  type InitAssetLocations,
  type InitExitCode,
  type InitFailureCode,
  type InitFileHandle,
  type InitFileStatus,
  type InitFilesystemDependencies,
  type InitResult,
  type ParsedInitArguments,
  type RunInitOptions,
} from "./init.js";

export const CLI_PACKAGE_NAME = "@thermite/cli";

export type ValidateExitCode = 0 | 1 | 2;

export interface RunValidateOptions {
  strict?: boolean;
  json?: boolean;
  color?: boolean;
  cwd?: string;
}

export interface ValidateResult {
  diagnostics: Diagnostic[];
  exitCode: ValidateExitCode;
  output: string;
}

export interface RunLockOptions {
  check?: boolean;
  json?: boolean;
  color?: boolean;
  cwd?: string;
}

export interface LockResult extends ValidateResult {
  written: boolean;
}

export interface RunCompileOptions {
  output?: string;
  diagnosticsJson?: boolean;
  color?: boolean;
  cwd?: string;
  atomicWrite?: AtomicWriteOptions;
}

export interface CompileCliResult {
  diagnostics: Diagnostic[];
  exitCode: ValidateExitCode;
  stdout: string;
  stderr: string;
  written: boolean;
}

export type QueryCommandRequest =
  | {
      command: "inspect" | "neighbors" | "trace" | "cable";
      designation: string;
    }
  | { command: "net"; selector: TerminalSelector };

export interface QueryCommandReport {
  readonly diagnostics: readonly Diagnostic[];
  readonly error: QueryError | null;
}

export type QueryCompileProject = (
  inputPath: string | undefined,
  cwd: string,
) => Promise<CompileResult>;

export interface RunQueryOptions {
  project?: string;
  json?: boolean;
  color?: boolean;
  cwd?: string;
  compile?: QueryCompileProject;
}

export interface QueryCliResult {
  diagnostics: Diagnostic[];
  error: QueryError | null;
  exitCode: ValidateExitCode;
  stdout: string;
  stderr: string;
}

export type RenderCompileProject = (
  inputPath: string | undefined,
  cwd: string,
) => Promise<CompileResult>;

export interface RunRenderOptions {
  family: SchematicViewFamily;
  flow?: SchematicFlow;
  project?: string;
  output?: string;
  json?: boolean;
  color?: boolean;
  cwd?: string;
  compile?: RenderCompileProject;
  createRenderer?: () => SchematicRenderer;
  atomicWrite?: AtomicWriteOptions;
}

interface ViewRequestOptions {
  power?: boolean;
  actuation?: boolean;
  to?: string;
  conductors?: boolean;
  loads?: boolean;
  includePower?: boolean;
  flow?: SchematicFlow;
}

export interface RunViewOptions extends ViewRequestOptions {
  project?: string;
  output?: string;
  json?: boolean;
  color?: boolean;
  cwd?: string;
  compile?: RenderCompileProject;
  createRenderer?: () => SchematicRenderer;
  atomicWrite?: AtomicWriteOptions;
}

export interface RenderCliResult {
  diagnostics: Diagnostic[];
  error: RenderFailure | null;
  exitCode: ValidateExitCode;
  stdout: string;
  stderr: string;
  written: boolean;
}

export interface CliWritable {
  isTTY?: boolean;
  write(text: string): unknown;
}

export interface RunCliOptions {
  stdout?: CliWritable;
  stderr?: CliWritable;
  cwd?: string;
  agentStdin?: AgentInputStream;
  agentCreateTools?: AgentToolsFactory;
  // Test seam for a successful compile result with a deliberately corrupted IR.
  queryCompileProject?: QueryCompileProject;
  // Test seams for render compiler and renderer boundary failures.
  renderCompileProject?: RenderCompileProject;
  renderCreateRenderer?: () => SchematicRenderer;
  renderAtomicWrite?: AtomicWriteOptions;
  // Test seams for the closed init filesystem and packaged-asset boundaries.
  initFilesystem?: InitFilesystemDependencies;
  initAssetLocations?: InitAssetLocations;
}

interface QueryFlags {
  project?: string;
  json?: boolean;
}

interface RenderFlags {
  family: SchematicViewFamily;
  flow: SchematicFlow;
  project?: string;
  output?: string;
  json?: boolean;
}

interface ViewFlags {
  power?: boolean;
  actuation?: boolean;
  to?: string;
  conductors?: boolean;
  loads?: boolean;
  includePower?: boolean;
  flow: SchematicFlow;
  project?: string;
  output?: string;
  json?: boolean;
}

interface AgentFlags {
  input: string;
}

const ANSI_RED = "\u001b[31m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_RESET = "\u001b[0m";

function exitCodeFor(
  diagnostics: readonly Diagnostic[],
  strict: boolean,
  toolFailure: boolean,
): ValidateExitCode {
  if (toolFailure) {
    return 2;
  }

  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" ||
      (strict && diagnostic.severity === "warning"),
  )
    ? 1
    : 0;
}

function colorize(text: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${text}${ANSI_RESET}` : text;
}

export function formatHumanDiagnostics(
  diagnostics: readonly Diagnostic[],
  color = false,
): string {
  const lines: string[] = [];
  let previousFile: string | undefined;

  for (const diagnostic of diagnostics) {
    if (previousFile !== undefined && previousFile !== diagnostic.file) {
      lines.push("");
    }

    const location = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
    const severityColor =
      diagnostic.severity === "error" ? ANSI_RED : ANSI_YELLOW;
    lines.push(
      `${colorize(location, ANSI_CYAN, color)} ${colorize(diagnostic.code, severityColor, color)} ${diagnostic.message}`,
    );
    previousFile = diagnostic.file;
  }

  return lines.join("\n");
}

export async function runValidate(
  inputPath?: string,
  options: RunValidateOptions = {},
): Promise<ValidateResult> {
  const compiled = await compileProject(
    inputPath,
    resolve(options.cwd ?? process.cwd()),
  );
  const diagnostics = normalizeDiagnostics(compiled.diagnostics);
  const exitCode = exitCodeFor(
    diagnostics,
    options.strict === true,
    compiled.ok ? false : compiled.toolFailure,
  );
  const output = options.json
    ? JSON.stringify(diagnostics, undefined, 2)
    : formatHumanDiagnostics(diagnostics, options.color === true);

  return { diagnostics, exitCode, output };
}

function outputWriteDiagnostic(output: string, error: unknown): Diagnostic {
  const detail = error instanceof Error ? error.message : "unknown failure";
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Unable to write compile output ${JSON.stringify(output)} (${detail}).`,
    file: normalizeDiagnosticFile(output),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function compileDiagnosticOutput(
  diagnostics: readonly Diagnostic[],
  json: boolean,
  color: boolean,
): string {
  return json
    ? JSON.stringify(diagnostics, undefined, 2)
    : formatHumanDiagnostics(diagnostics, color);
}

export async function runCompile(
  inputPath?: string,
  options: RunCompileOptions = {},
): Promise<CompileCliResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const compiled = await compileProject(inputPath, cwd);
  let diagnostics = normalizeDiagnostics(compiled.diagnostics);

  if (!compiled.ok) {
    return {
      diagnostics,
      exitCode: exitCodeFor(diagnostics, false, compiled.toolFailure),
      stdout: "",
      stderr: compileDiagnosticOutput(
        diagnostics,
        options.diagnosticsJson === true,
        options.color === true,
      ),
      written: false,
    };
  }

  const serialized = serializeIr(compiled.ir);

  if (options.output !== undefined) {
    try {
      await writeFileAtomically(
        resolve(cwd, options.output),
        serialized,
        options.atomicWrite,
      );
    } catch (error) {
      diagnostics = normalizeDiagnostics([
        ...diagnostics,
        outputWriteDiagnostic(options.output, error),
      ]);
      return {
        diagnostics,
        exitCode: 2,
        stdout: "",
        stderr: compileDiagnosticOutput(
          diagnostics,
          options.diagnosticsJson === true,
          options.color === true,
        ),
        written: false,
      };
    }
  }

  return {
    diagnostics,
    exitCode: 0,
    stdout: options.output === undefined ? serialized : "",
    stderr: compileDiagnosticOutput(
      diagnostics,
      options.diagnosticsJson === true,
      options.color === true,
    ),
    written: options.output !== undefined,
  };
}

function queryToolFailureDiagnostic(
  sourceFile: string,
  error: unknown,
): Diagnostic {
  const detail = error instanceof Error ? error.message : "unknown failure";
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Query tool failure (${detail}).`,
    file: normalizeDiagnosticFile(sourceFile),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function serializeQueryReport(
  diagnostics: readonly Diagnostic[],
  error: QueryError | null,
): string {
  const report: QueryCommandReport = { diagnostics, error };
  return `${JSON.stringify(report, undefined, 2)}\n`;
}

function humanQueryStderr(
  diagnostics: readonly Diagnostic[],
  error: QueryError | null,
  color: boolean,
): string {
  const renderedDiagnostics = formatHumanDiagnostics(diagnostics, color);
  const renderedError = error === null ? "" : `${error.code} ${error.message}`;
  if (renderedDiagnostics !== "" && renderedError !== "") {
    return `${renderedDiagnostics}\n\n${renderedError}\n`;
  }
  const rendered = renderedDiagnostics || renderedError;
  return rendered === "" ? "" : `${rendered}\n`;
}

function executeQuery(
  request: QueryCommandRequest,
  ir: Extract<CompileResult, { ok: true }>["ir"],
): QueryResult<QueryCommandResult> {
  const engine = createQueryEngine(ir);
  if (request.command === "inspect") {
    return engine.inspect({
      by: "designation",
      value: request.designation,
    });
  }
  if (request.command === "neighbors") {
    return engine.neighbors({
      by: "designation",
      value: request.designation,
    });
  }
  if (request.command === "trace") {
    return engine.trace({
      by: "designation",
      value: request.designation,
    });
  }
  if (request.command === "cable") {
    return engine.cable({
      by: "designation",
      value: request.designation,
    });
  }
  if (request.command === "net") {
    return engine.net(request.selector);
  }
  throw new Error(`Unsupported query command ${request.command}.`);
}

export async function runQuery(
  request: QueryCommandRequest,
  options: RunQueryOptions = {},
): Promise<QueryCliResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const compile = options.compile ?? compileProject;
  const compiled = await compile(options.project, cwd);
  let diagnostics = normalizeDiagnostics(compiled.diagnostics);

  if (!compiled.ok) {
    return {
      diagnostics,
      error: null,
      exitCode: exitCodeFor(diagnostics, false, compiled.toolFailure),
      stdout: "",
      stderr:
        options.json === true
          ? serializeQueryReport(diagnostics, null)
          : humanQueryStderr(diagnostics, null, options.color === true),
    };
  }

  let outcome: QueryResult<QueryCommandResult>;
  try {
    outcome = executeQuery(request, compiled.ir);
  } catch (error) {
    diagnostics = normalizeDiagnostics([
      ...diagnostics,
      queryToolFailureDiagnostic(compiled.ir.project.source.file, error),
    ]);
    return {
      diagnostics,
      error: null,
      exitCode: 2,
      stdout: "",
      stderr:
        options.json === true
          ? serializeQueryReport(diagnostics, null)
          : humanQueryStderr(diagnostics, null, options.color === true),
    };
  }

  if (!outcome.ok) {
    return {
      diagnostics,
      error: outcome.error,
      exitCode: 1,
      stdout: "",
      stderr:
        options.json === true
          ? serializeQueryReport(diagnostics, outcome.error)
          : humanQueryStderr(
              diagnostics,
              outcome.error,
              options.color === true,
            ),
    };
  }

  return {
    diagnostics,
    error: null,
    exitCode: 0,
    stdout:
      options.json === true
        ? serializeQueryResult(outcome.value)
        : renderHumanQueryResult(outcome.value),
    stderr:
      options.json === true
        ? serializeQueryReport(diagnostics, null)
        : humanQueryStderr(diagnostics, null, options.color === true),
  };
}

function renderToolFailureDiagnostic(
  sourceFile: string,
  error: unknown,
): Diagnostic {
  const detail = error instanceof Error ? error.message : "unknown failure";
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Render tool failure (${detail}).`,
    file: normalizeDiagnosticFile(sourceFile),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function renderOutputWriteDiagnostic(
  output: string,
  error: unknown,
): Diagnostic {
  const detail = error instanceof Error ? error.message : "unknown failure";
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Unable to write render output ${JSON.stringify(output)} (${detail}).`,
    file: normalizeDiagnosticFile(output),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function humanRenderStderr(
  diagnostics: readonly Diagnostic[],
  error: RenderFailure | null,
  color: boolean,
): string {
  const renderedDiagnostics = formatHumanDiagnostics(diagnostics, color);
  const renderedError = error === null ? "" : `${error.code} ${error.message}`;
  if (renderedDiagnostics !== "" && renderedError !== "") {
    return `${renderedDiagnostics}\n\n${renderedError}\n`;
  }
  const rendered = renderedDiagnostics || renderedError;
  return rendered === "" ? "" : `${rendered}\n`;
}

function renderCommandStderr(
  diagnostics: readonly Diagnostic[],
  error: RenderFailure | null,
  json: boolean,
  color: boolean,
): string {
  return json
    ? serializeRenderCommandReport(diagnostics, error)
    : humanRenderStderr(diagnostics, error, color);
}

function viewFlagsError(flags: ViewRequestOptions): string | undefined {
  const primaryCount = [
    flags.power === true,
    flags.actuation === true,
    flags.to !== undefined,
    flags.conductors === true,
    flags.loads === true,
  ].filter(Boolean).length;

  if (primaryCount !== 1) {
    return "exactly one view intent is required: --power, --actuation, --to <designation>, --conductors, or --loads";
  }
  if (flags.includePower === true && flags.to === undefined) {
    return "option '--include-power' is only valid with '--to <designation>'";
  }
  return undefined;
}

function buildViewRequest(
  designation: string,
  options: ViewRequestOptions,
): SchematicViewRequest {
  const invalid = viewFlagsError(options);
  if (invalid !== undefined) {
    throw new Error(`Invalid view command options: ${invalid}.`);
  }

  const root = { by: "designation" as const, value: designation };
  const flow = options.flow ?? "left-to-right";
  if (options.power === true) {
    return {
      format: "schematic-view-request/0.1",
      family: "power",
      root,
      flow,
    };
  }
  if (options.actuation === true) {
    return {
      format: "schematic-view-request/0.1",
      family: "control",
      root,
      flow,
    };
  }
  if (options.to !== undefined) {
    return {
      format: "schematic-view-request/0.2",
      root,
      intent: {
        kind: "trace",
        to: { by: "designation", value: options.to },
        includePower: options.includePower === true,
      },
      flow,
    };
  }
  if (options.conductors === true) {
    return {
      format: "schematic-view-request/0.2",
      root,
      intent: { kind: "conductors" },
      flow,
    };
  }
  return {
    format: "schematic-view-request/0.2",
    root,
    intent: { kind: "loads" },
    flow,
  };
}

interface RunSchematicCommandOptions {
  readonly command: "render" | "view";
  readonly request: SchematicViewRequest;
  readonly project?: string;
  readonly output?: string;
  readonly json?: boolean;
  readonly color?: boolean;
  readonly cwd?: string;
  readonly compile?: RenderCompileProject;
  readonly createRenderer?: () => SchematicRenderer;
  readonly atomicWrite?: AtomicWriteOptions;
}

async function runSchematicCommand(
  options: RunSchematicCommandOptions,
): Promise<RenderCliResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const compile = options.compile ?? compileProject;
  const compiled = await compile(options.project, cwd);
  let diagnostics = normalizeDiagnostics(compiled.diagnostics);
  const json = options.json === true;
  const color = options.color === true;

  if (!compiled.ok) {
    return {
      diagnostics,
      error: null,
      exitCode: exitCodeFor(diagnostics, false, compiled.toolFailure),
      stdout: "",
      stderr: renderCommandStderr(diagnostics, null, json, color),
      written: false,
    };
  }

  let outcome: RenderOutcome<RenderedSchematic>;
  try {
    const renderer = (options.createRenderer ?? createSchematicRenderer)();
    outcome = await renderer.render(
      compiled.ir,
      options.request,
      compiled.presentation,
    );
  } catch (error) {
    diagnostics = normalizeDiagnostics([
      ...diagnostics,
      renderToolFailureDiagnostic(compiled.ir.project.source.file, error),
    ]);
    return {
      diagnostics,
      error: null,
      exitCode: 2,
      stdout: "",
      stderr: renderCommandStderr(diagnostics, null, json, color),
      written: false,
    };
  }

  if (!outcome.ok) {
    return {
      diagnostics,
      error: outcome.error,
      exitCode: 1,
      stdout: "",
      stderr: renderCommandStderr(diagnostics, outcome.error, json, color),
      written: false,
    };
  }

  if (options.output !== undefined) {
    try {
      await writeFileAtomically(
        resolve(cwd, options.output),
        outcome.value.svg,
        options.atomicWrite,
      );
    } catch (error) {
      diagnostics = normalizeDiagnostics([
        ...diagnostics,
        renderOutputWriteDiagnostic(options.output, error),
      ]);
      return {
        diagnostics,
        error: null,
        exitCode: 2,
        stdout: "",
        stderr: renderCommandStderr(diagnostics, null, json, color),
        written: false,
      };
    }
  }

  return {
    diagnostics,
    error: null,
    exitCode: 0,
    stdout: json
      ? serializeRenderCommandResult(
          options.command,
          outcome.value,
          options.output,
        )
      : options.output === undefined
        ? outcome.value.svg
        : "",
    stderr: renderCommandStderr(diagnostics, null, json, color),
    written: options.output !== undefined,
  };
}

export async function runRender(
  designation: string,
  options: RunRenderOptions,
): Promise<RenderCliResult> {
  return runSchematicCommand({
    command: "render",
    request: {
      format: "schematic-view-request/0.1",
      family: options.family,
      root: { by: "designation", value: designation },
      flow: options.flow ?? "left-to-right",
    },
    ...options,
  });
}

export async function runView(
  designation: string,
  options: RunViewOptions,
): Promise<RenderCliResult> {
  return runSchematicCommand({
    command: "view",
    request: buildViewRequest(designation, options),
    ...options,
  });
}

export async function runLock(
  inputPath?: string,
  options: RunLockOptions = {},
): Promise<LockResult> {
  const locked = await lockProject(
    inputPath,
    resolve(options.cwd ?? process.cwd()),
    { check: options.check === true },
  );
  const diagnostics = normalizeDiagnostics(locked.diagnostics);
  const exitCode = exitCodeFor(
    diagnostics,
    false,
    locked.ok ? false : locked.toolFailure,
  );
  const output = options.json
    ? JSON.stringify(diagnostics, undefined, 2)
    : formatHumanDiagnostics(diagnostics, options.color === true);

  return {
    diagnostics,
    exitCode,
    output,
    written: locked.ok && locked.written,
  };
}

export async function runCli(
  argv: readonly string[] = process.argv,
  options: RunCliOptions = {},
): Promise<ValidateExitCode> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const userArguments = argv.slice(2);
  if (userArguments[0] === "init") {
    const parsed = parseInitArguments(userArguments.slice(1));
    if (parsed.kind === "syntax-error") {
      stderr.write(INIT_SYNTAX_MESSAGE);
      return 2;
    }
    if (parsed.kind === "help") {
      let helpOutput = "";
      const initHelp = new Command()
        .name("thermite init")
        .description("initialize an agent-ready Thermite Schematics project")
        .option("--name <project-name>", "project name")
        .option("--revision <revision>", "project revision")
        .helpOption("--help", "display help for command")
        .configureOutput({
          writeOut: (text) => {
            helpOutput += text;
          },
          writeErr: (text) => {
            helpOutput += text;
          },
        })
        .exitOverride();
      initHelp.outputHelp();
      stdout.write(helpOutput);
      return 0;
    }
    const result = await runInit(parsed.name, parsed.revision, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.initFilesystem === undefined
        ? {}
        : { filesystem: options.initFilesystem }),
      ...(options.initAssetLocations === undefined
        ? {}
        : { assetLocations: options.initAssetLocations }),
    });
    if (result.stdout !== "") stdout.write(result.stdout);
    if (result.stderr !== "") stderr.write(result.stderr);
    return result.exitCode;
  }

  const program = new Command();
  let exitCode: ValidateExitCode = 0;

  program
    .name("thermite")
    .description("Thermite Schematics command-line tools")
    .version(CLI_VERSION)
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text),
    })
    .exitOverride();

  const runQueryAction = async (
    request: QueryCommandRequest,
    flags: QueryFlags,
  ): Promise<void> => {
    const result = await runQuery(request, {
      ...(flags.project === undefined ? {} : { project: flags.project }),
      json: flags.json === true,
      color: flags.json !== true && stderr.isTTY === true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.queryCompileProject === undefined
        ? {}
        : { compile: options.queryCompileProject }),
    });

    if (result.stdout !== "") {
      stdout.write(result.stdout);
    }
    if (result.stderr !== "") {
      stderr.write(result.stderr);
    }
    exitCode = result.exitCode;
  };

  program
    .command("init")
    .description("initialize an agent-ready Thermite Schematics project")
    .option("--name <project-name>", "project name")
    .option("--revision <revision>", "project revision")
    .helpOption("--help", "display help for command");

  const agentCommand = program
    .command("agent")
    .description("invoke deterministic agent tools with JSON requests");

  const agentCommands = [
    ["resolve", "resolve or search project objects"],
    ["inspect", "inspect one project object"],
    ["query", "execute a supported graph query"],
    ["validate", "validate an electrical-system project"],
    ["create-view", "create a schematic from a structured view request"],
    ["apply-source-patch", "validate and apply a guarded source patch"],
  ] as const;

  for (const [tool, description] of agentCommands) {
    const command = agentCommand
      .command(tool)
      .description(description)
      .requiredOption("--input <file|->", "request JSON file or '-' for stdin");

    command.action(async () => {
      const flags = command.opts<AgentFlags>();
      const result = await runAgentCommand(tool, flags.input, {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.agentStdin === undefined
          ? {}
          : { stdin: options.agentStdin }),
        ...(options.agentCreateTools === undefined
          ? {}
          : { createTools: options.agentCreateTools }),
      });

      if (result.stdout !== "") {
        stdout.write(result.stdout);
      }
      if (result.stderr !== "") {
        stderr.write(result.stderr);
      }
      exitCode = result.exitCode;
    });
  }

  const validateCommand = program
    .command("validate")
    .description("validate an electrical-system project")
    .argument("[path]", "project directory or direct manifest path")
    .option("--json", "emit diagnostics as JSON")
    .option("--strict", "treat warnings as validation failures");

  validateCommand.action(async (inputPath: string | undefined) => {
    const flags = validateCommand.opts<{ json?: boolean; strict?: boolean }>();
    const result = await runValidate(inputPath, {
      json: flags.json === true,
      strict: flags.strict === true,
      color: flags.json !== true && stdout.isTTY === true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });

    if (result.output !== "") {
      stdout.write(`${result.output}\n`);
    }

    exitCode = result.exitCode;
  });

  const lockCommand = program
    .command("lock")
    .description("create or verify the local-library lock")
    .argument("[path]", "project directory or direct manifest path")
    .option("--check", "verify the lock without writing")
    .option("--json", "emit diagnostics as JSON");

  lockCommand.action(async (inputPath: string | undefined) => {
    const flags = lockCommand.opts<{ check?: boolean; json?: boolean }>();
    const result = await runLock(inputPath, {
      check: flags.check === true,
      json: flags.json === true,
      color: flags.json !== true && stdout.isTTY === true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });

    if (result.output !== "") {
      stdout.write(`${result.output}\n`);
    }

    exitCode = result.exitCode;
  });

  const compileCommand = program
    .command("compile")
    .description("compile an electrical-system project to canonical IR")
    .argument("[path]", "project directory or direct manifest path")
    .option("-o, --output <file>", "atomically write IR to a file")
    .option("--diagnostics-json", "emit diagnostics as JSON on stderr");

  compileCommand.action(async (inputPath: string | undefined) => {
    const flags = compileCommand.opts<{
      output?: string;
      diagnosticsJson?: boolean;
    }>();
    const result = await runCompile(inputPath, {
      ...(flags.output === undefined ? {} : { output: flags.output }),
      diagnosticsJson: flags.diagnosticsJson === true,
      color: flags.diagnosticsJson !== true && (stderr.isTTY ?? false) === true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });

    if (result.stdout !== "") {
      stdout.write(result.stdout);
    }
    if (result.stderr !== "") {
      stderr.write(`${result.stderr}\n`);
    }

    exitCode = result.exitCode;
  });

  const renderCommand = program
    .command("render")
    .description("render a deterministic electrical schematic as SVG")
    .argument("<designation>", "exact canonical device designation")
    .addOption(
      new Option("--family <family>", "schematic view family")
        .choices(["control", "power"])
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--flow <flow>", "schematic flow direction")
        .choices(["left-to-right", "top-to-bottom"])
        .default("left-to-right"),
    )
    .option("--project <path>", "project directory or direct manifest path")
    .option("-o, --output <file>", "atomically write SVG to a file")
    .option("--json", "emit the render result and report as JSON");

  renderCommand.action(async (designation: string) => {
    const flags = renderCommand.opts<RenderFlags>();
    const result = await runRender(designation, {
      family: flags.family,
      flow: flags.flow,
      ...(flags.project === undefined ? {} : { project: flags.project }),
      ...(flags.output === undefined ? {} : { output: flags.output }),
      json: flags.json === true,
      color: flags.json !== true && stderr.isTTY === true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.renderCompileProject === undefined
        ? {}
        : { compile: options.renderCompileProject }),
      ...(options.renderCreateRenderer === undefined
        ? {}
        : { createRenderer: options.renderCreateRenderer }),
      ...(options.renderAtomicWrite === undefined
        ? {}
        : { atomicWrite: options.renderAtomicWrite }),
    });

    if (result.stdout !== "") {
      stdout.write(result.stdout);
    }
    if (result.stderr !== "") {
      stderr.write(result.stderr);
    }
    exitCode = result.exitCode;
  });

  const viewCommand = program
    .command("view")
    .description("render a deterministic demonstration view as SVG")
    .argument("<designation>", "exact canonical root designation")
    .option("--power", "render the legacy power view")
    .option("--actuation", "render the legacy control actuation view")
    .option("--to <designation>", "trace to an exact target designation")
    .option("--conductors", "render all authored cable conductors")
    .option("--loads", "render complete loads for a source")
    .option("--include-power", "include the trace root's declared power arms")
    .addOption(
      new Option("--flow <flow>", "schematic flow direction")
        .choices(["left-to-right", "top-to-bottom"])
        .default("left-to-right"),
    )
    .option("--project <path>", "project directory or direct manifest path")
    .option("-o, --output <file>", "atomically write SVG to a file")
    .option("--json", "emit the view result and report as JSON");

  viewCommand.hook("preAction", () => {
    const invalid = viewFlagsError(viewCommand.opts<ViewFlags>());
    if (invalid !== undefined) {
      viewCommand.error(`error: ${invalid}`);
    }
  });

  viewCommand.action(async (designation: string) => {
    const flags = viewCommand.opts<ViewFlags>();
    const result = await runView(designation, {
      power: flags.power === true,
      actuation: flags.actuation === true,
      ...(flags.to === undefined ? {} : { to: flags.to }),
      conductors: flags.conductors === true,
      loads: flags.loads === true,
      includePower: flags.includePower === true,
      flow: flags.flow,
      ...(flags.project === undefined ? {} : { project: flags.project }),
      ...(flags.output === undefined ? {} : { output: flags.output }),
      json: flags.json === true,
      color: flags.json !== true && stderr.isTTY === true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.renderCompileProject === undefined
        ? {}
        : { compile: options.renderCompileProject }),
      ...(options.renderCreateRenderer === undefined
        ? {}
        : { createRenderer: options.renderCreateRenderer }),
      ...(options.renderAtomicWrite === undefined
        ? {}
        : { atomicWrite: options.renderAtomicWrite }),
    });

    if (result.stdout !== "") {
      stdout.write(result.stdout);
    }
    if (result.stderr !== "") {
      stderr.write(result.stderr);
    }
    exitCode = result.exitCode;
  });

  const inspectCommand = program
    .command("inspect")
    .description("inspect a designated project object")
    .argument("<designation>", "canonical project object designation")
    .option("--project <path>", "project directory or direct manifest path")
    .option("--json", "emit the query result and report as JSON");

  inspectCommand.action(async (designation: string) => {
    await runQueryAction(
      { command: "inspect", designation },
      inspectCommand.opts<QueryFlags>(),
    );
  });

  const neighborsCommand = program
    .command("neighbors")
    .description("show immediate device neighbors")
    .argument("<designation>", "canonical device designation")
    .option("--project <path>", "project directory or direct manifest path")
    .option("--json", "emit the query result and report as JSON");

  neighborsCommand.action(async (designation: string) => {
    await runQueryAction(
      { command: "neighbors", designation },
      neighborsCommand.opts<QueryFlags>(),
    );
  });

  const traceCommand = program
    .command("trace")
    .description("trace conductive topology from a device")
    .argument("<designation>", "canonical device designation")
    .option("--project <path>", "project directory or direct manifest path")
    .option("--json", "emit the query result and report as JSON");

  traceCommand.action(async (designation: string) => {
    await runQueryAction(
      { command: "trace", designation },
      traceCommand.opts<QueryFlags>(),
    );
  });

  const netCommand = program
    .command("net")
    .description("show the derived net for a device terminal")
    .argument("[reference]", "dotted device-and-terminal reference")
    .option("--device <designation>", "exact device designation")
    .option("--terminal <key>", "exact terminal key")
    .option("--project <path>", "project directory or direct manifest path")
    .option("--json", "emit the query result and report as JSON");

  netCommand.action(async (reference: string | undefined) => {
    const flags = netCommand.opts<
      QueryFlags & { device?: string; terminal?: string }
    >();
    const hasReference = reference !== undefined;
    const hasDevice = flags.device !== undefined;
    const hasTerminal = flags.terminal !== undefined;
    const hasParts = hasDevice && hasTerminal;

    if (
      hasDevice !== hasTerminal ||
      (hasReference && (hasDevice || hasTerminal)) ||
      (!hasReference && !hasParts)
    ) {
      netCommand.error(
        "exactly one net addressing form is required: [reference] or --device with --terminal",
      );
    }

    const selector: TerminalSelector = hasReference
      ? { by: "display", value: reference }
      : {
          by: "parts",
          deviceDesignation: flags.device!,
          terminalKey: flags.terminal!,
        };
    await runQueryAction({ command: "net", selector }, flags);
  });

  const cableCommand = program
    .command("cable")
    .description("show cable conductor membership")
    .argument("<designation>", "canonical cable designation")
    .option("--project <path>", "project directory or direct manifest path")
    .option("--json", "emit the query result and report as JSON");

  cableCommand.action(async (designation: string) => {
    await runQueryAction(
      { command: "cable", designation },
      cableCommand.opts<QueryFlags>(),
    );
  });

  try {
    await program.parseAsync([...argv], { from: "node" });
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" ||
        error.code === "commander.version")
    ) {
      return 0;
    }

    return 2;
  }

  return exitCode;
}
