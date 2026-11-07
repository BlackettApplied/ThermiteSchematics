// Shared helpers for project-guide.test.ts and its fact modules. They run the
// built CLI against temporary projects and record every diagnostic code and
// JSON word the runs exercise, so the test can prove the guide names nothing
// that no check touched.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
export const entry = join(repositoryRoot, "thermite.mjs");

// ---------------------------------------------------------------------------
// What the suite exercised

/**
 * Diagnostic codes printed by any run, and every key and short string value
 * of any JSON the suite wrote, sent or received. The guide's code and
 * vocabulary gates compare the guide against these.
 */
export const observed = {
  codes: new Set<string>(),
  words: new Set<string>(),
};
export function noteJson(value: unknown): void {
  if (typeof value === "string") {
    if (value.length > 200) return;
    observed.words.add(value);
    for (const part of value.split(":")) observed.words.add(part);
  } else if (Array.isArray(value)) value.forEach(noteJson);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      observed.words.add(key);
      noteJson(item);
    }
}
/** Records the codes and JSON in a run's output. */
export function noteOutput(text: string) {
  for (const m of text.matchAll(/"code":\s*"([A-Z]\d{3})"/g))
    observed.codes.add(m[1]!);
  for (const m of text.matchAll(/^\S+:\d+:\d+ ([A-Z]\d{3}) /gm))
    observed.codes.add(m[1]!);
  const candidates = text.trimStart().startsWith("{")
    ? [text, ...text.split("\n")]
    : text.split("\n");
  for (const candidate of candidates)
    if (candidate.trimStart().startsWith("{"))
      try {
        noteJson(JSON.parse(candidate));
      } catch {
        // Not a JSON document; only its codes count.
      }
}

// ---------------------------------------------------------------------------
// Processes

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
/**
 * Child processes the suite runs at once (`GUIDE_PROCESSES` overrides it).
 * Facts and blocks run concurrently; this bounds the machine load they add.
 */
const PROCESS_LIMIT = Number(process.env.GUIDE_PROCESSES) || 4;
let running = 0;
const queued: (() => void)[] = [];
export async function withProcessSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < PROCESS_LIMIT) running += 1;
  else await new Promise<void>((start) => queued.push(start));
  try {
    return await work();
  } finally {
    const next = queued.shift();
    if (next) next();
    else running -= 1;
  }
}
/** Every process the suite started; `GUIDE_PROFILE=<file>` saves them. */
export const launches: {
  args: readonly string[];
  ms: number;
  /** Start, in ms since the suite loaded. */
  at: number;
}[] = [];
const loaded = performance.now();
export function exec(
  args: readonly string[],
  cwd: string,
  input = "",
): Promise<Run> {
  return withProcessSlot(
    () =>
      new Promise((resolveRun, reject) => {
        const started = performance.now();
        const child = spawn(process.execPath, args, { cwd });
        const stdout: Buffer[] = [],
          stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", (code, signal) => {
          launches.push({
            args: args[0] === entry ? args.slice(1) : args,
            ms: performance.now() - started,
            at: started - loaded,
          });
          resolveRun({
            code: code ?? (signal ? 128 : -1),
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        });
        child.stdin.end(input);
      }),
  );
}
/** Runs `thermite <args>` in `cwd` and records the codes and JSON it prints. */
export async function thermite(
  args: readonly string[],
  cwd: string,
  input?: string,
): Promise<Run> {
  const run = await exec([entry, ...args], cwd, input);
  noteOutput(run.stdout);
  noteOutput(run.stderr);
  return run;
}
export const describeRun = (args: readonly string[], run: Run) =>
  `thermite ${args.join(" ")} exited ${run.code}\nstdout: ${run.stdout.slice(0, 600)}\nstderr: ${run.stderr}`;
/** Runs and requires exit 0. */
export async function ok(args: readonly string[], cwd: string, input?: string) {
  const run = await thermite(args, cwd, input);
  expect(run.code, describeRun(args, run)).toBe(0);
  return run;
}
/**
 * Runs and requires a failure carrying `code` (and `message`, when given)
 * anywhere in stdout or stderr. `exit` defaults to 1, an authored failure.
 */
export async function rejected(
  args: readonly string[],
  cwd: string,
  code: string,
  message?: string,
  exit = 1,
  input?: string,
) {
  const run = await thermite(args, cwd, input);
  const output = run.stdout + run.stderr;
  expect(run.code, describeRun(args, run)).toBe(exit);
  expect(output, describeRun(args, run)).toContain(code);
  if (message !== undefined)
    expect(output, describeRun(args, run)).toContain(message);
  return run;
}
/** Maps `fn` over `items`, running at most `limit` at once, in input order. */
export async function parallel<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = 4,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!, index);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Files

export const integrity = (bytes: Uint8Array) =>
  `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
export async function hashTree(root: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const walk = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else
        hashes.set(
          relative(root, path).split(sep).join("/"),
          integrity(await readFile(path)),
        );
    }
  };
  await walk(root);
  return new Map([...hashes].sort(([a], [b]) => a.localeCompare(b)));
}
export const changedPaths = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
) =>
  [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
export const readJson = async (path: string) =>
  JSON.parse(await readFile(path, "utf8"));
/** Writes pretty JSON, creating parent directories, and records its words. */
export async function writeJson(path: string, value: unknown) {
  noteJson(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
/** Edits a JSON file in place; `edit` mutates the parsed value. */
export async function editJson(path: string, edit: (value: any) => void) {
  const value = await readJson(path);
  edit(value);
  await writeJson(path, value);
  return value;
}
async function noteJsonFiles(path: string): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const name of await readdir(path))
      await noteJsonFiles(join(path, name));
  } else if (path.endsWith(".json")) noteJson(await readJson(path));
}

// ---------------------------------------------------------------------------
// Projects

export type Template = "starter" | "cabinets";
export const TEMPLATE_FLAGS: Record<Template, readonly string[]> = {
  starter: [],
  cabinets: ["--template", "cabinets"],
};
export const TEMPLATES = Object.keys(TEMPLATE_FLAGS) as Template[];

/** Shared state; project-guide.test.ts fills it in `beforeAll`. */
export const ctx = {
  /** The suite's temporary root. */
  work: "",
  /** Initialized templates. Never write here; copy with `freshProject`. */
  pristine: {} as Record<Template, string>,
  /** Every designation in each template's source. */
  designations: {} as Record<Template, Set<string>>,
  /** Device designations in each template's source. */
  devices: {} as Record<Template, Set<string>>,
  /** The common schema's UID pattern. */
  uidPattern: /$^/,
  tree: undefined as unknown as CliTree,
};
/**
 * Creates the temporary root, initializes each template once from this
 * checkout, and parses the CLI tree.
 */
export async function setUpSuite() {
  ctx.work = await mkdtemp(
    join(realpathSync.native(tmpdir()), "thermite-guide-"),
  );
  await mkdir(join(ctx.work, "pristine"));
  for (const template of TEMPLATES) {
    const args = ["init", template, ...TEMPLATE_FLAGS[template]];
    const run = await thermite(args, join(ctx.work, "pristine"));
    if (run.code !== 0) throw new Error(describeRun(args, run));
    const project = join(ctx.work, "pristine", template);
    ctx.pristine[template] = project;
    await noteJsonFiles(project);
    const manifest = await readJson(join(project, "system.json"));
    const objects = (
      await Promise.all(
        manifest.sources.map((s: string) => readJson(join(project, s))),
      )
    ).flatMap((file: any) => file.objects);
    ctx.designations[template] = new Set(
      objects.map((o: any) => o.designation).filter(Boolean),
    );
    ctx.devices[template] = new Set(
      objects
        .filter((o: any) => o.kind === "device")
        .map((o: any) => o.designation),
    );
  }
  const common = await readJson(
    join(repositoryRoot, "packages/schema/schemas/common.schema.json"),
  );
  ctx.uidPattern = new RegExp(common.$defs.uid.pattern);
  ctx.tree = await buildTree(ctx.work);
}
export async function tearDownSuite() {
  if (process.env.GUIDE_PROFILE)
    await writeFile(process.env.GUIDE_PROFILE, JSON.stringify(launches));
  if (ctx.work) await rm(ctx.work, { recursive: true, force: true });
}
let directories = 0;
/** A new empty directory under the suite's temporary root. */
export async function scratch(name = "scratch"): Promise<string> {
  // Shared fixture keys contain ':'; Windows directory names cannot. The
  // counter preserves uniqueness even when readable labels sanitize alike.
  const label = name.replace(/[^a-zA-Z0-9_-]/gu, "-");
  const directory = join(ctx.work, `${label}-${(directories += 1)}`);
  await mkdir(directory, { recursive: true });
  return directory;
}
/** A private copy of an initialized template. */
export async function freshProject(template: Template): Promise<string> {
  return copyProject(ctx.pristine[template], template);
}
/** A private copy of `project`, for a check that writes. */
export async function copyProject(
  project: string,
  name = "copy",
): Promise<string> {
  const copy = join(await scratch(name), "project");
  await cp(project, copy, { recursive: true });
  return copy;
}

// ---------------------------------------------------------------------------
// Shared work. Facts run concurrently and many read the same fixture or
// output, so each is built or run once.

const memo = new Map<string, Promise<unknown>>();
/**
 * Runs `work` once per key; every caller shares the result, or the failure.
 * Never mutate a shared result.
 */
export function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (!memo.has(key)) memo.set(key, work());
  return memo.get(key) as Promise<T>;
}
const sealed = new Map<string, Map<string, string>>();
/**
 * A project that `build` creates once and every check named `name` shares.
 * Checks only read it: a check that writes takes `copyProject`. Run commands
 * with `-o` outside it, and send packets on stdin. `sharedProjectsUnchanged`
 * proves at the end that nothing wrote here.
 */
export function sharedProject(
  name: string,
  build: (project: string) => Promise<void>,
): Promise<string> {
  return once(`project:${name}`, async () => {
    const project = join(await scratch(`shared-${name}`), "project");
    await mkdir(project, { recursive: true });
    await build(project);
    sealed.set(project, await hashTree(project));
    return project;
  });
}
export async function sharedProjectsUnchanged() {
  for (const [project, hashes] of sealed)
    expect(await hashTree(project), project).toEqual(hashes);
}
/**
 * Builds a project in a new directory. `copy` maps project paths to
 * repository-relative files or directories; `json` maps project paths to
 * values to write. Every JSON file it places is recorded as exercised.
 */
export async function makeProject(spec: {
  readonly copy?: Readonly<Record<string, string>>;
  readonly json?: Readonly<Record<string, unknown>>;
  readonly name?: string;
}): Promise<string> {
  const project = join(await scratch(spec.name ?? "fixture"), "project");
  await mkdir(project, { recursive: true });
  for (const [target, source] of Object.entries(spec.copy ?? {})) {
    await cp(join(repositoryRoot, source), join(project, target), {
      recursive: true,
    });
    await noteJsonFiles(join(project, target));
  }
  for (const [target, value] of Object.entries(spec.json ?? {}))
    await writeJson(join(project, target), value);
  return project;
}
/** `thermite lock .` then `thermite validate .`, both required to pass. */
export async function lockAndValidate(project: string) {
  await ok(["lock", "."], project);
  return ok(["validate", "."], project);
}
/**
 * Runs `thermite packet --input - --json` with `request` on stdin, so it never
 * writes in `project` unless `args` has `-o`. `json` is the parsed result on
 * success.
 */
export async function packet(
  project: string,
  request: unknown,
  args: readonly string[] = ["--json"],
): Promise<Run & { readonly json?: any; readonly args: string[] }> {
  noteJson(request);
  const all = ["packet", "--input", "-", ...args];
  const run = await thermite(all, project, JSON.stringify(request));
  return {
    ...run,
    args: all,
    ...(run.code === 0 && args.includes("--json")
      ? { json: JSON.parse(run.stdout) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Agent tools

export interface AgentRun extends Run {
  readonly report: any;
  readonly result?: any;
}
/**
 * Runs an agent tool on stdin and enforces the guide's stream contract. Every
 * dry run, passing or failing, must leave the project's bytes unchanged.
 */
export async function agent(
  tool: string,
  request: unknown,
  project: string,
): Promise<AgentRun> {
  noteJson(request);
  const dryRun =
    tool === "apply-source-patch" &&
    (request as { dryRun?: unknown }).dryRun === true;
  const before = dryRun ? await hashTree(project) : undefined;
  const run = await thermite(
    ["agent", tool, "--input", "-"],
    project,
    JSON.stringify(request),
  );
  if (before !== undefined)
    expect(await hashTree(project), "a dry run changes no bytes").toEqual(
      before,
    );
  return agentOutcome(tool, run);
}
/**
 * `thermite agent <tool> --input <input>` in this worker, through the CLI's
 * own `runAgentCommand`, with `stdin` as the text `-` reads.
 */
export async function agentCommandHere(
  tool: string,
  input: string,
  project: string,
  stdin = "",
): Promise<Run> {
  const { runAgentCommand } = await import("../../dist/agent-command.js");
  const run = await runAgentCommand(tool as never, input, {
    cwd: project,
    stdin: (async function* () {
      yield Buffer.from(stdin);
    })(),
  });
  noteOutput(run.stdout);
  noteOutput(run.stderr);
  return { code: run.exitCode, stdout: run.stdout, stderr: run.stderr };
}
/**
 * `agent` in this worker, without a process: for the further request forms a
 * sentence lists beside the forms it runs through the CLI. Read-only tools.
 */
export async function agentHere(
  tool: string,
  request: unknown,
  project: string,
): Promise<AgentRun> {
  noteJson(request);
  return agentOutcome(
    tool,
    await agentCommandHere(tool, "-", project, JSON.stringify(request)),
  );
}
function agentOutcome(tool: string, run: Run): AgentRun {
  const report = JSON.parse(run.stderr);
  expect(report, "stderr always carries the report").toMatchObject({
    format: "agent-tool-report/0.1",
    tool,
  });
  if (run.code !== 0) {
    expect(run.stdout, "stdout carries the result on success only").toBe("");
    return { ...run, report };
  }
  const result = JSON.parse(run.stdout);
  expect(result).toMatchObject({ format: "agent-tool-result/0.1", tool });
  return { ...run, report, result };
}
export const request = (fields: Record<string, unknown>) => ({
  format: "agent-tool-request/0.1",
  project: ".",
  ...fields,
});
export async function patchRequest(
  project: string,
  path: string,
  operations: unknown[],
  dryRun = true,
) {
  return request({
    patchFormat: "json-patch/0.1",
    dryRun,
    files: [
      {
        path,
        expectedIntegrity: integrity(await readFile(join(project, path))),
        operations,
      },
    ],
  });
}
export const codesOf = (run: AgentRun) => [
  ...(run.report.error ? [run.report.error.code] : []),
  ...run.report.diagnostics.map((d: { code: string }) => d.code),
];

// ---------------------------------------------------------------------------
// Facts

/**
 * One or more consecutive whole sentences of the guide, quoted exactly
 * (whitespace-insensitive), and a check that makes them true at runtime.
 * Advisory clauses inside a checked sentence may stay unexecuted.
 */
export interface Fact {
  readonly claim: string;
  readonly check: () => Promise<void>;
}
/** A section's facts and its sentences that no check can execute. */
export interface FactModule {
  readonly facts: readonly Fact[];
  /**
   * Exact sentence -> why it is not executed. Adding a sentence here is a
   * reviewed change that the pull request must justify.
   */
  readonly unexecuted: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// The real CLI tree, parsed from --help

export interface OptionSpec {
  readonly flags: readonly string[];
  readonly takesValue: boolean;
  readonly choices?: readonly string[];
  readonly description: string;
}
export interface HelpSpec {
  readonly usage: string;
  readonly options: readonly OptionSpec[];
  readonly commands: readonly string[];
  readonly existing: readonly string[];
}
export interface CliTree {
  readonly root: HelpSpec;
  readonly alpha: readonly string[];
  readonly commands: ReadonlyMap<string, HelpSpec>;
  readonly tools: ReadonlyMap<string, HelpSpec>;
}
export function parseHelp(text: string): HelpSpec {
  const usage = /^Usage: (.*)$/m.exec(text)?.[1] ?? "";
  const raw: { head: string; description: string }[] = [];
  const commands: string[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    if (/^[A-Z][A-Za-z ]*:$/.test(line)) {
      section = line.slice(0, -1);
      continue;
    }
    if (line.trim() === "") {
      section = section === "Options" || section === "Commands" ? "" : section;
      continue;
    }
    if (section === "Options") {
      const option = /^ {2}(-\S.*?)(?: {2,}(.*))?$/.exec(line);
      if (option) raw.push({ head: option[1]!, description: option[2] ?? "" });
      else if (/^ {4,}\S/.test(line) && raw.length > 0)
        raw.at(-1)!.description += ` ${line.trim()}`;
    } else if (section === "Commands") {
      const command = /^ {2}(\S+)/.exec(line);
      if (command) commands.push(command[1]!);
    }
  }
  const options = raw.map(({ head, description }) => {
    const values = /<[^>]*>|\[[^\]]*\]/;
    const choiceList = /choices: ((?:"[^"]*"(?:, )?)+)/.exec(description)?.[1];
    return {
      flags:
        head.replace(new RegExp(values, "g"), "").match(/--?[\w-]+/g) ?? [],
      takesValue: values.test(head),
      ...(choiceList
        ? { choices: [...choiceList.matchAll(/"([^"]*)"/g)].map((m) => m[1]!) }
        : {}),
      description,
    };
  });
  const existing =
    /^Existing commands: (.*)\.$/m
      .exec(text)?.[1]
      ?.split(",")
      .map((name) => name.trim()) ?? [];
  return { usage, options, commands, existing };
}
export async function buildTree(cwd: string): Promise<CliTree> {
  const help = async (args: string[]) => {
    const run = await thermite([...args, "--help"], cwd);
    if (run.code !== 0 || !run.stdout.startsWith("Usage:"))
      throw new Error(describeRun([...args, "--help"], run));
    return parseHelp(run.stdout);
  };
  const root = await help([]);
  const alpha = root.commands.filter((name) => name !== "help");
  const names = [...alpha, ...root.existing];
  const commands = new Map(
    await Promise.all(names.map(async (n) => [n, await help([n])] as const)),
  );
  const toolNames = commands.get("agent")!.commands.filter((n) => n !== "help");
  const tools = new Map(
    await Promise.all(
      toolNames.map(async (n) => [n, await help(["agent", n])] as const),
    ),
  );
  return { root, alpha, commands, tools };
}
