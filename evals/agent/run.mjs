#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cp as copyAsync } from "node:fs/promises";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { evalVersion, harnessIdentity, pinCheckpoint } from "./checkpoint.mjs";
import { readRun } from "./records.mjs";
import { contributorCommandEnvironment } from "./contributor-commands.mjs";
import { fileState, fileStateAsync, auditErrors } from "./audit.mjs";
import { initAudit } from "./audit-files.mjs";
import { captureProcess } from "./process.mjs";
import { pinnedCliVersion } from "./cli-protocol.mjs";
import {
  preflightAuth,
  seedCodexAuth,
  secretValues,
  redactAgentOutput,
  redactSecrets,
  credentialKeys,
} from "./auth.mjs";
import {
  classifyAgent,
  isComplete,
  planAttempt,
  automaticInfra,
  automaticFailures,
  haltingInfra,
  batchHaltReason,
  runKey,
  runDirectoryName,
} from "./attempts.mjs";
import { evaluateChecker, CheckerInfrastructureError } from "./checker.mjs";
import { estimateCost } from "./cost.mjs";
import { snapshot, sha256 } from "./snapshot.mjs";
import { score } from "./score-log.mjs";
import { normalizeTranscript } from "./transcript.mjs";
import { visualBroker } from "./visual-capture.mjs";
import {
  conveyorMetrics,
  observeConveyorDelivery,
  phaseConveyorCalls,
} from "./conveyor-measurement.mjs";
import { copyConfinedTree, projectReader } from "./capture-files.mjs";
import {
  agents,
  agentConfiguration,
  launchCommand,
  shellCommand,
  freshEnvironment,
  assertIsolation,
} from "./launch.mjs";
import { cli, read, write, documents, uid } from "./task-support.mjs";
import {
  assertConfinedProjectPaths,
  snapshotScopeError,
} from "./source-files.mjs";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
    encoding: "utf8",
    maxBuffer: 64 << 20,
  }).trim();
const run = (cwd, ...args) =>
  execFileSync(process.execPath, args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    maxBuffer: 64 << 20,
  });
export function pinnedTypeScriptVersion(engine, commit) {
  try {
    const lock = git(
      engine,
      "--no-replace-objects",
      "cat-file",
      "blob",
      `${commit}:bun.lock`,
    );
    const resolved = Bun.JSONC.parse(lock)?.packages?.typescript?.[0];
    return typeof resolved === "string"
      ? (/^typescript@(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/.exec(
          resolved,
        )?.[1] ?? null)
      : null;
  } catch {
    return null;
  }
}
export async function prepareContext({
  engine = root,
  commit = "HEAD",
  context,
  destination,
}) {
  const pinned = git(engine, "rev-parse", `${commit}^{commit}`),
    build = join(destination, "build"),
    path = join(destination, "engine");
  git(engine, "worktree", "add", "--detach", build, pinned);
  try {
    if (context === "runtime") {
      run(build, "run", "package:pack", "--preview");
      const output = join(build, "release-out/runtime");
      const candidates = readdirSync(output).flatMap((d) =>
        readdirSync(join(output, d))
          .filter((f) => f.endsWith(".zip"))
          .map((f) => join(output, d, f)),
      );
      assert.equal(candidates.length, 1, "Expected exactly one packed runtime");
      const { extractSafeZipArchive } =
        await import("../../scripts/safe-zip-reader.mjs");
      await extractSafeZipArchive(readFileSync(candidates[0]), path);
    } else {
      // A detached worktree of the pinned commit; dependencies come from the local
      // frozen installation, and are rebuilt before any CLI evidence is trusted.
      cpSync(join(engine, "node_modules"), join(build, "node_modules"), {
        recursive: true,
      });
      assert.equal(
        sha256(readFileSync(join(engine, "bun.lock"))),
        sha256(readFileSync(join(build, "bun.lock"))),
        "Install dependencies for the selected commit before source evaluation",
      );
      run(build, "run", "build");
      cpSync(build, path, {
        recursive: true,
        dereference: true,
        filter: (p) => basename(p) !== ".git",
      });
    }
    return {
      path,
      commit: pinned,
      ...(context === "source" && {
        pinnedTypeScript: {
          version: pinnedTypeScriptVersion(engine, pinned),
          module: join(path, "node_modules/typescript/lib/typescript.js"),
        },
      }),
    };
  } finally {
    git(engine, "worktree", "remove", "--force", build);
  }
}
export function installShim(runtime) {
  renameSync(join(runtime, "thermite.mjs"), join(runtime, "thermite.real.mjs"));
  cpSync(join(here, "shim/thermite.mjs"), join(runtime, "thermite.mjs"));
  cpSync(join(here, "shim/observe.mjs"), join(runtime, "eval-observe.mjs"));
  cpSync(join(here, "snapshot.mjs"), join(runtime, "eval-snapshot.mjs"));
  cpSync(join(here, "process.mjs"), join(runtime, "eval-process.mjs"));
  cpSync(
    join(here, "capture-files.mjs"),
    join(runtime, "eval-capture-files.mjs"),
  );
  cpSync(join(here, "audit-files.mjs"), join(runtime, "eval-audit-files.mjs"));
  for (const [from, to] of [
    ["audit.mjs", "eval-audit.mjs"],
    ["auth.mjs", "eval-auth.mjs"],
  ])
    writeFileSync(
      join(runtime, to),
      readFileSync(join(here, from), "utf8")
        .replaceAll('"./snapshot.mjs"', '"./eval-snapshot.mjs"')
        .replaceAll('"./process.mjs"', '"./eval-process.mjs"'),
    );
}
async function copyRuntime(prepared, runtime, task) {
  await copyAsync(prepared, runtime, { recursive: true, dereference: true });
  installShim(runtime);
  if (task.contributor)
    rmSync(join(runtime, "evals/contributor"), {
      recursive: true,
      force: true,
    });
}
// Scratch in the harness home, outside a sandboxed agent's writable roots.
const protectedScratch = (prefix) =>
  realpathSync(mkdtempSync(join(homedir(), prefix)));
// The agent's runtime copy lives in its writable TMPDIR. Post-agent CLI calls
// run a copy made in protected scratch from the same prepared engine. Bun reads
// bunfig.toml and .env files from the project, so those calls name the
// harness's own config instead (see bunConfig in audit.mjs).
async function protectedRuntime(prepared, scratch, task) {
  const runtime = join(scratch, "runtime"),
    config = join(scratch, "bunfig.toml");
  await copyRuntime(prepared, runtime, task);
  writeFileSync(config, "env = false\n");
  return { runtime, config };
}
// The harness's pre-launch copy of the project's regular files. Git metadata
// and installed dependencies (a contributor checkout's) are never diffed.
function copyRegularFiles(from, to, rel = "") {
  for (const entry of readdirSync(join(from, rel), { withFileTypes: true })) {
    const path = rel ? join(rel, entry.name) : entry.name;
    if ([".git", "node_modules"].includes(entry.name)) continue;
    if (entry.isDirectory()) copyRegularFiles(from, to, path);
    else if (entry.isFile()) {
      mkdirSync(dirname(join(to, path)), { recursive: true });
      copyFileSync(join(from, path), join(to, path));
    }
  }
}
// Whether a regular file is at path; a file where a directory was is absence.
function fileAt(path) {
  try {
    return !!lstatSync(path, { throwIfNoEntry: false })?.isFile();
  } catch (error) {
    if (error.code === "ENOTDIR") return false;
    throw error;
  }
}
// The diff of selected project paths, from the pre-launch copy to their post-run
// bytes. `read` returns a path's bytes, null when absent, or throws to refuse
// it. Git never runs in the agent's repository, whose configuration and
// attributes can run programs; it compares copies in protected scratch with no
// configuration, attributes or repository.
export function selectedDiff({ before, scratch, paths, read }) {
  const work = join(scratch, "diff"),
    home = join(work, "home"),
    refused = [];
  rmSync(work, { recursive: true, force: true });
  for (const dir of ["old", "new", "home"])
    mkdirSync(join(work, dir), { recursive: true });
  const put = (side, path, bytes) => {
    mkdirSync(dirname(join(work, side, path)), { recursive: true });
    writeFileSync(join(work, side, path), bytes);
  };
  for (const path of [...new Set(paths)].sort()) {
    let bytes;
    try {
      bytes = read(path);
    } catch {
      refused.push(path);
      continue;
    }
    if (bytes) put("new", path, bytes);
    if (fileAt(join(before, path)))
      put("old", path, readFileSync(join(before, path)));
  }
  const result = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--",
      "old",
      "new",
    ],
    {
      cwd: work,
      encoding: "utf8",
      maxBuffer: 64 << 20,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: home,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
        GIT_CEILING_DIRECTORIES: scratch,
      },
    },
  );
  assert(
    !result.error && [0, 1].includes(result.status),
    `Source diff failed: ${result.error?.code ?? result.stderr}`,
  );
  // Label paths as the project's, as a diff in its repository would. Only
  // header lines name paths; hunks are left alone.
  let header = false,
    mode = null;
  const diff = result.stdout
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git ")) [header, mode] = [true, null];
      else if (line.startsWith("@@")) header = false;
      if (header && /^(?:new|deleted) file mode /.test(line))
        mode = line.split(" ")[0];
      return header ? relabel(line, mode) : line;
    })
    .join("\n")
    .trim();
  return [
    diff,
    ...refused.map((path) => `Refused (not an ordinary file): ${path}`),
  ]
    .filter(Boolean)
    .join("\n");
}
// A header path field is Git's a/ or b/ prefix, then the synthetic old/ or
// new/ directory, then the project path, possibly inside C-style quotes. Only
// that synthetic component is removed; quoting and spaces are kept.
const field = (text) => text.replace(/^("?[ab]\/)(?:old|new)\//, "$1");
// `mode` is the section's "new" or "deleted" file mode, which alone says
// whether a binary summary names /dev/null; a path can end in " and /dev/null".
function relabel(line, mode) {
  if (line.startsWith("diff --git ")) {
    // Without renames both fields name one path, so they are equally long.
    const rest = line.slice(11),
      half = (rest.length - 1) / 2;
    return `diff --git ${field(rest.slice(0, half))} ${field(rest.slice(half + 1))}`;
  }
  if (line.startsWith("--- ") || line.startsWith("+++ "))
    return line.slice(0, 4) + field(line.slice(4));
  const binary = /^Binary files (.*) differ$/.exec(line)?.[1];
  if (binary === undefined) return line;
  const empty = "/dev/null",
    half = (binary.length - 5) / 2;
  const [from, to] =
    mode === "new"
      ? [empty, binary.slice(empty.length + 5)]
      : mode === "deleted"
        ? [binary.slice(0, -empty.length - 5), empty]
        : [binary.slice(0, half), binary.slice(half + 5)];
  return `Binary files ${field(from)} and ${field(to)} differ`;
}
// Test seams for filesystem transitions that cannot otherwise be timed.
export const runHooks = {};
// Node offers no descriptor-relative, no-follow open on Windows.
const confinedPlatform = ["darwin", "linux"].includes(process.platform);
export const windowsUnavailable =
  "E2 agent runs and rechecks are unavailable on Windows: project files cannot be read there without following links";
const children = new Set();
let stoppingSignal = null;
function captureSetup(binary, args, options = {}) {
  return captureProcess(binary, args, {
    timeout: 120000,
    ...options,
    detached: process.platform !== "win32",
    onChild(child) {
      children.add(child);
      child.once("close", () => children.delete(child));
    },
  });
}
async function setupCommand(binary, args, options) {
  const r = await captureSetup(binary, args, options);
  if (r.error || r.status !== 0)
    throw Object.assign(
      new Error(
        `${binary}: ${r.error?.code ?? r.signal ?? r.status}\n${r.stderr}`,
      ),
      { stage: "setup" },
    );
  return r.stdout;
}
const setupCLI = (ctx, ...args) =>
  setupCommand(process.execPath, [ctx.thermite, ...args], {
    cwd: ctx.project,
    env: ctx.env,
  });
const setupGit = (cwd, ...args) =>
  setupCommand("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
  });
async function agentVersion(binary, options) {
  const result = await captureSetup(binary, ["--version"], options);
  return !result.error && result.status === 0
    ? result.stdout.trim() || null
    : null;
}
function killChild(child, signal = "SIGTERM") {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {}
}
process.once("exit", () => {
  for (const child of children) killChild(child, "SIGKILL");
});
async function loadModule(taskDir, name) {
  const href = pathToFileURL(join(taskDir, name)).href;
  return (
    await import(
      name === "check.mjs"
        ? href + "?taskTree=" + snapshot(taskDir, { documents: false }).hash
        : href
    )
  ).default;
}
async function evaluateTask(taskDir, ctx) {
  return evaluateChecker(async (context) => {
    let checker;
    try {
      checker = await loadModule(taskDir, "check.mjs");
    } catch (error) {
      throw new CheckerInfrastructureError(
        `Checker could not load: ${error.message}`,
      );
    }
    return checker(context);
  }, ctx);
}
function capturedAgent(command, ctx, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: ctx.project,
      env: ctx.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const stdout = [],
      stderr = [];
    let timedOut = false,
      killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
      killTimer = setTimeout(() => killChild(child, "SIGKILL"), 1000);
    }, timeoutMs);
    child.stdout.on("data", (b) => stdout.push(b));
    child.stderr.on("data", (b) => stderr.push(b));
    child.on("error", (error) => {
      clearTimeout(timer);
      children.delete(child);
      resolvePromise({
        exit: null,
        spawnError: error.code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
    child.on("close", async (exit, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      // A CLI can leave background tool children after its own exit.
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, 0);
          killChild(child);
          await new Promise((resolve) => setTimeout(resolve, 100));
          killChild(child, "SIGKILL");
        } catch {}
      }
      children.delete(child);
      resolvePromise({
        exit,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}
const identity =
  /\b(?:anthropic|openai|chatgpt|gpt(?:[- .]?\d[\w.-]*)?|claude(?:[- .]?(?:opus|sonnet|haiku|fable)(?:[- .]?\d[\w.-]*)?)?|codex(?:-\d[\w.-]*)?|(?:opus|sonnet|haiku|fable)(?:[- .]?\d[\w.-]*)?|gemini|deepseek|grok|llama|qwen|mistral|copilot|o[- ]?series|o[134](?:-(?:pro|mini|preview))(?:-(?:high|medium|low|xhigh|max))?|arm [AB])\b/gi;
export function judgePacket({
  finalMessage,
  sourceDiff,
  project,
  runtime,
  task,
  source,
  rootRefused = false,
}) {
  // The project is agent-written. Artifacts are read without following links,
  // through a reader whose root was pinned before the agent started; anything
  // else is listed as refused. `rootRefused` is a root loss the caller already
  // detected: the packet refuses the whole root without reading the project.
  assert(confinedPlatform, windowsUnavailable);
  const outputs = {},
    binaryOutputs = [],
    refusedOutputs = [];
  const take = (rel) => {
    try {
      return source.read(rel);
    } catch {
      refusedOutputs.push(rel);
    }
  };
  if (rootRefused) refusedOutputs.push(".");
  else
    try {
      for (const name of [
        "drawings",
        "issue.md",
        "review-notes.md",
        "requirement-matrix.json",
        "friction.md",
      ]) {
        if (!source.has(name)) continue;
        if (name !== "drawings") {
          const bytes = take(name);
          if (bytes) outputs[name] = bytes.toString("utf8");
          continue;
        }
        let files;
        try {
          files = source.list(name).sort();
        } catch {
          refusedOutputs.push(name);
          continue;
        }
        for (const file of files) {
          if (!/\.(json|csv|html|svg|pdf)$/.test(file)) continue;
          const rel = `drawings/${file}`,
            bytes = take(rel);
          if (!bytes) continue;
          outputs[rel] = file.endsWith(".pdf")
            ? bytes.toString("base64")
            : bytes.toString("utf8");
          if (file.endsWith(".pdf")) binaryOutputs.push(rel);
        }
      }
    } catch {
      // An entry that cannot be inspected, or a replaced root, refuses the
      // project as a whole.
      for (const key of Object.keys(outputs)) delete outputs[key];
      binaryOutputs.length = 0;
      refusedOutputs.splice(0, Infinity, ".");
    }
  const blindText = (text) =>
    text
      .replaceAll(project, "<project>")
      .replaceAll(runtime ?? project, "<runtime>")
      .replace(/(\bmodel[\s:="\']+)o[134]\b/gi, "$1<identity>")
      .replace(
        /\b\d+(?:\.\d+){1,3}\s*\((?:Claude Code|codex-cli)\)/gi,
        "<identity>",
      )
      .replace(
        /\b(?:claude|codex)\s+--version\s+(?:printed|returned|is)\s+v?\d+(?:\.\d+){1,3}/gi,
        "<identity>",
      )
      .replace(
        /\b(?:(?:codex(?:-cli)?|claude(?:[ -]+code)?)\s+(?:cli\s+)?(?:version\s+)?v?\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?)\b/gi,
        "<identity>",
      )
      .replace(/\bxhigh\b/gi, "<identity>")
      .replace(
        /\b(?:(thermite)\s+)?CLI\s+version\s+v?\d+(?:\.\d+){1,3}\b/gi,
        (text, engine) => (engine ? text : "<identity>"),
      )
      .replace(identity, "<identity>");
  const blind = (value) =>
    typeof value === "string"
      ? blindText(value)
      : Array.isArray(value)
        ? value.map(blind)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [blindText(k), blind(v)]),
            )
          : value;
  const packet = blind({
    format: "thermite-blinded-judge/1.2",
    finalMessage,
    sourceDiff,
    rubric: task.rubric,
    outputs: Object.fromEntries(
      Object.entries(outputs).filter(([k]) => !binaryOutputs.includes(k)),
    ),
  });
  // Base64 is opaque binary data, never a redaction target.
  for (const path of binaryOutputs)
    packet.outputs[blindText(path)] = outputs[path];
  packet.binaryOutputs = binaryOutputs.map(blindText);
  packet.refusedOutputs = refusedOutputs.map(blindText);
  return packet;
}
function parseCalls(path) {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch {
    return [];
  }
}
function validationDiagnostics(result) {
  for (const text of [result.stdout, result.stderr])
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value)) return value;
      if (value.diagnostics) return value.diagnostics;
    } catch {}
  return [];
}
// A sandboxed Codex agent, and any process it leaves running, can write /tmp
// and the system temporary directory, which hold its run directory and TMPDIR.
// Its final evidence archive must resolve outside them. Returns the canonical
// path, which every later archive write uses so a link cannot redirect it.
export function assertArchiveOutsideSandbox(archive) {
  const resolved = realpathSync(archive);
  const root = [tmpdir(), "/tmp", "/private/tmp"]
    .filter((path) => existsSync(path))
    .map((path) => realpathSync(path))
    .find((root) => resolved === root || resolved.startsWith(root + sep));
  assert(
    !root,
    `Evidence archive ${resolved} is under ${root}, which a sandboxed Codex agent can write; run Codex evals from a checkout outside temporary directories`,
  );
  return resolved;
}
function ownTemp(prefix) {
  return realpathSync(
    mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", prefix)),
  );
}
export async function runOne({
  taskDir,
  prepared,
  evidence,
  agent = "reference",
  model,
  effort,
  arm = "A",
  context = "source",
  seed = 1,
  attempt = 1,
  guide,
  printAgentCommand = false,
  engineRoots = [root],
  codexAuth,
  keep = false,
  forceRerun = false,
  automaticRetry = false,
  reopenInfra = null,
  reopenedHalt = false,
  infraRetryDelayMs = 0,
  batchControl,
  checkpointOverride = null,
  expectedIdentity,
  tasksRoot,
  timeoutMs = 900000,
}) {
  // Before any setup or evidence: Windows cannot confine post-run reads.
  assert(confinedPlatform, windowsUnavailable);
  const runIdentity = harnessIdentity({ tasksDir: tasksRoot });
  if (expectedIdentity)
    assert.deepEqual(
      runIdentity,
      expectedIdentity,
      "Harness/checker changed during checkpoint invocation",
    );
  const configuration = agentConfiguration({ agent, model, effort }),
    identity = {
      arm,
      context,
      task: basename(taskDir),
      agent,
      seed,
      ...configuration,
      reopenInfra,
      reopenedHalt,
      infraRetryDelayMs,
      checkpointOverride,
      ...runIdentity,
    };
  identity.runKey = runKey(identity);
  mkdirSync(evidence, { recursive: true });
  const work = ownTemp("thermite-agent-eval-"),
    runtime = join(work, "runtime"),
    project = join(work, "project"),
    // The run directory is the agent's TMPDIR and under /tmp, so a sandboxed
    // agent or a process it leaves behind can write it. Live evidence stays
    // in the harness home, outside the sandbox's writable roots.
    live = realpathSync(
      mkdtempSync(join(homedir(), ".thermite-agent-evidence-")),
    ),
    audit = join(work, "audit");
  initAudit(audit);
  let authSeeded,
    env,
    manifest,
    task,
    initial,
    runtimeBefore,
    finalMessage,
    rootRefused = false,
    guideBytes,
    scratch,
    source,
    auditSource,
    runtimeSource,
    workSource,
    archiveProject,
    secretList = [];
  const runStarted = Date.now();
  const save = (file, value) =>
    write(
      join(live, file),
      JSON.parse(redactSecrets(JSON.stringify(value), secretList)),
    );
  try {
    workSource = projectReader(work);
    task = read(join(taskDir, "task.json"));
    assert(
      !task.context || task.context === context,
      "Task requires --context source",
    );
    await copyRuntime(prepared.path, runtime, task);
    identity.task = task.id;
    identity.runKey = runKey(identity);
    auditSource = projectReader(audit);
    env = {
      ...freshEnvironment(join(work, "isolated"), process.env, { engineRoots }),
      THERMITE_EVAL_PROJECT: project,
      THERMITE_EVAL_LOG: join(audit, "shim.jsonl"),
      THERMITE_EVAL_ERRORS: join(audit, "shim-errors.jsonl"),
      THERMITE_EVAL_PHASE: "setup",
      THERMITE_EVAL_AUDIT_ROOT: JSON.stringify(auditSource.identity),
    };
    for (const [key, value] of Object.entries(env))
      if (!credentialKeys.includes(key))
        assert(
          !engineRoots.some((p) => value.includes(p)),
          `Checkout path leaked through ${key}`,
        );
    if (agent === "codex" && codexAuth) {
      delete env.CODEX_API_KEY;
      delete env.OPENAI_API_KEY;
    }
    secretList = secretValues(env);
    const ctx = {
      task,
      project,
      runtime,
      thermite: join(runtime, "thermite.mjs"),
      env,
      evidence: live,
    };
    if (["starter", "cabinets"].includes(task.template))
      await setupCLI(
        { ...ctx, project: work },
        "init",
        project,
        ...(task.template === "cabinets" ? ["--template", "cabinets"] : []),
      );
    else {
      await copyAsync(join(prepared.examples, task.template), project, {
        recursive: true,
      });
      const starter = join(work, "starter");
      await setupCLI(ctx, "init", starter);
      await copyAsync(join(starter, "libraries"), join(project, "libraries"), {
        recursive: true,
      });
      cpSync(join(starter, "AGENTS.md"), join(project, "AGENTS.md"));
      await setupCLI(ctx, "lock", project);
    }
    mkdirSync(join(project, "drawings"), { recursive: true });
    if (task.setup) {
      // A scorer-supplied setup hook can itself use synchronous CLI helpers.
      // Run it out of process so its work cannot block sibling exit handling.
      const setupContext = join(work, "setup-context.json");
      const { env: ignored, ...publicContext } = ctx;
      write(setupContext, {
        module: join(taskDir, task.setup),
        context: publicContext,
      });
      await setupCommand(
        process.execPath,
        [join(here, "reference-worker.mjs"), setupContext],
        { cwd: project, env },
      );
    }
    if (task.template === "cabinets") {
      const docs = documents(project),
        ids = new Map(
          docs.flatMap((doc) =>
            doc.objects.map((o) => [
              o.uid,
              uid(`${task.id}/${seed}/${o.designation}`),
            ]),
          ),
        );
      const rewrite = (value) =>
        typeof value === "string"
          ? (ids.get(value) ?? value)
          : Array.isArray(value)
            ? value.map(rewrite)
            : value && typeof value === "object"
              ? Object.fromEntries(
                  Object.entries(value).map(([k, v]) => [k, rewrite(v)]),
                )
              : value;
      for (const doc of docs)
        write(join(project, doc.path), rewrite({ objects: doc.objects }));
    }
    if (guide) cpSync(guide, join(project, "AGENTS.md"));
    if (agent === "claude") {
      assert(!existsSync(join(project, "CLAUDE.md")));
      writeFileSync(join(project, "CLAUDE.md"), "@AGENTS.md\n");
    }
    await setupGit(project, "init", "--quiet");
    await setupGit(project, "add", ".");
    await setupGit(
      project,
      "-c",
      "user.name=Eval",
      "-c",
      "user.email=eval@invalid",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "Task start",
    );
    if (agent === "codex")
      authSeeded = seedCodexAuth(env, codexAuth, { timeoutMs });
    const isolation = assertIsolation(project, env, {
      claudeLoader: agent === "claude",
      codexAuth: !!authSeeded,
    });
    const authentication =
      agent === "reference"
        ? { ok: true, agent, billing: "none" }
        : await preflightAuth(agent, env, { capture: captureSetup });
    secretList = secretValues(env);
    save("auth-status.json", authentication);
    initial = await fileStateAsync(
      project,
      join(runtime, "thermite.real.mjs"),
      env,
      undefined,
      captureSetup,
    );
    initial.sourceFiles = documents(project).map((doc) => doc.path);
    runtimeBefore = snapshot(runtime, { documents: false }).hash;
    save("initial.json", initial);
    writeFileSync(env.THERMITE_EVAL_LOG, "");
    write(env.THERMITE_EVAL_LOG + ".state.json", {
      snapshot: initial,
      lastHash: null,
    });
    writeFileSync(env.THERMITE_EVAL_ERRORS, "");
    env.THERMITE_EVAL_PHASE = "agent";
    if (task.contributor)
      Object.assign(env, contributorCommandEnvironment(ctx, join(work, "bin")));
    const prompt = `Thermite is at ${ctx.thermite}.\n\n${task.prompt.replaceAll("{{THERMITE}}", ctx.thermite)}`;
    const command =
      agent === "reference"
        ? null
        : launchCommand({ agent, project, runtime, prompt, model, effort });
    const cliVersion =
      agent === "reference"
        ? null
        : await agentVersion(agents[agent].binary, {
            env,
            encoding: "utf8",
          });
    if (printAgentCommand) {
      assert(command, "--print-agent-command requires an agent CLI");
      const environment = Object.fromEntries(
          Object.entries(env).filter(([key]) => !credentialKeys.includes(key)),
        ),
        keys = credentialKeys.filter((key) => env[key]);
      console.log(
        `cd ${shellCommand([project])} && ${shellCommand(["env", "-i", ...Object.entries(environment).map(([key, value]) => `${key}=${value}`)])} ${keys.map((key) => `${key}="$${key}"`).join(" ")} ${shellCommand(command)}`,
      );
      save("command.json", {
        ...configuration,
        environment,
        credentialKeys: keys,
        argv: command,
        cwd: project,
        isolation,
        authentication,
      });
      manifest = {
        ...identity,
        format: "thermite-agent-run/1.1",
        status: "command-only",
        task: task.id,
        arm,
        agent,
        seed,
        attempt,
        authentication,
        workspace: keep ? work : null,
      };
      save("manifest.json", manifest);
      return manifest;
    }
    if (!authentication.ok)
      throw Object.assign(new Error("Authentication pre-flight failed"), {
        stage: "authentication",
      });
    // Before launch: the harness's copy of the starting sources, and the project
    // root that every post-run read starts from.
    scratch = protectedScratch(".thermite-agent-protected-");
    const before = join(scratch, "before");
    copyRegularFiles(project, before);
    source = projectReader(project);
    runtimeSource = projectReader(runtime);
    // The guide the agent's CLI loads at launch.
    guideBytes = readFileSync(join(before, "AGENTS.md")).length;
    let started = Date.now();
    const conveyor = task.id === "D-conveyor";
    const delivery = conveyor
      ? observeConveyorDelivery(source, task.deliverables)
      : null;
    let execution = { exit: 0, stdout: "", stderr: "" };
    let agentEnded,
      captureRetries = 0;
    if (stoppingSignal || batchControl?.stopped) {
      execution = {
        exit: null,
        signal: stoppingSignal,
        stdout: "",
        stderr: "",
        notStarted: !stoppingSignal,
      };
    } else if (agent === "reference") {
      const workerContext = join(work, "reference-context.json");
      const { env: ignored, ...publicContext } = ctx;
      write(workerContext, {
        module: join(taskDir, task.reference ?? "reference.mjs"),
        context: publicContext,
      });
      started = Date.now();
      execution = await capturedAgent(
        [process.execPath, join(here, "reference-worker.mjs"), workerContext],
        ctx,
        timeoutMs,
      );
      agentEnded = Date.now();
    } else {
      const stopCapture = await visualBroker(
        task,
        project,
        live,
        delivery?.observe,
        { workspace: workSource, project: source },
      );
      try {
        started = Date.now();
        execution = await capturedAgent(command, ctx, timeoutMs);
      } finally {
        agentEnded = Date.now();
        captureRetries = (await stopCapture())?.retries ?? 0;
      }
    }
    execution.stdout = redactAgentOutput(execution.stdout, secretList);
    execution.stderr = redactAgentOutput(execution.stderr, secretList);
    writeFileSync(join(live, "transcript.jsonl"), execution.stdout);
    writeFileSync(join(live, "agent.stderr"), execution.stderr);
    const normalized = normalizeTranscript(execution.stdout, {
        agent,
        cliVersion,
      }),
      classification = classifyAgent(
        { ...execution, operatorSignal: stoppingSignal },
        normalized,
      ),
      ended = agentEnded ?? Date.now();
    // The agent has finished; record that before anything reads the project.
    finalMessage = normalized.finalMessage ?? null;
    if (batchControl && batchHaltReason(classification)) {
      batchControl.stopped = true;
      batchControl.reason = batchHaltReason(classification);
    }
    // Every project-dependent step below needs a directory at the root's
    // path; without one the run cannot be scored, though its judge packet
    // still records the refusal.
    let projectDirectory = false;
    try {
      projectDirectory = workSource.inspect("project").isDirectory();
    } catch {}
    if (!projectDirectory) {
      rootRefused = true;
      runHooks.afterRootLoss?.(project);
      throw new Error(
        "Project root is missing or no longer a directory after the agent exited; the run cannot be scored",
      );
    }
    const rootIntact = source.intact();
    rootRefused = !rootIntact;
    const stagedProject = rootIntact
      ? join(live, "project")
      : join(scratch, "empty-project");
    let projectRefusals = ["."];
    if (rootIntact) {
      archiveProject = stagedProject;
      projectRefusals = copyConfinedTree(source, stagedProject);
    } else mkdirSync(stagedProject);
    const beforeFlush = snapshot(stagedProject);
    const scopeError = snapshotScopeError(
      stagedProject,
      beforeFlush.documents["system.json"],
    );
    const scopeFailure =
      scopeError && !batchHaltReason(classification) && !execution.notStarted;
    const flushAudit = join(scratch, "audit"),
      auditInputErrors = [];
    initAudit(flushAudit);
    const flushSource = projectReader(flushAudit);
    const flushIdentity = flushSource.identity;
    flushSource.close();
    for (const file of [
      "shim.jsonl",
      "shim-errors.jsonl",
      "shim.jsonl.state.json",
    ])
      try {
        writeFileSync(join(flushAudit, file), auditSource.read(file));
      } catch {
        auditInputErrors.push({
          kind: "shim-error",
          stage: "audit-input",
          file,
        });
      }
    // From here on, CLI calls run with harness privileges: never from the
    // agent-writable runtime, never with the project's Bun config or .env
    // files, and only with environment values the harness selects.
    const trusted = scopeError
      ? null
      : await protectedRuntime(prepared.path, scratch, task);
    ctx.env = {
      ...freshEnvironment(
        join(scratch, "isolated"),
        { PATH: process.env.PATH, TERM: process.env.TERM },
        { engineRoots },
      ),
      THERMITE_EVAL_PROJECT: stagedProject,
      THERMITE_EVAL_LOG: join(flushAudit, "shim.jsonl"),
      THERMITE_EVAL_ERRORS: join(flushAudit, "shim-errors.jsonl"),
      THERMITE_EVAL_PHASE: "flush",
      THERMITE_EVAL_AUDIT_ROOT: JSON.stringify(flushIdentity),
      ...(trusted && { THERMITE_EVAL_BUN_CONFIG: trusted.config }),
    };
    ctx.originalProject = project;
    ctx.project = stagedProject;
    let final = { ...beforeFlush, schemaInvalidFiles: [] };
    ctx.validationDiagnostics = [];
    const flushStarted = Date.now();
    if (trusted) {
      ctx.thermite = join(trusted.runtime, "thermite.mjs");
      const validation = cli(ctx, "validate", ".", "--json");
      writeFileSync(
        join(live, "validate.stdout"),
        redactSecrets(validation.stdout, secretList),
      );
      writeFileSync(
        join(live, "validate.stderr"),
        redactSecrets(validation.stderr, secretList),
      );
      ctx.thermite = join(trusted.runtime, "thermite.real.mjs");
      ctx.validationDiagnostics = validationDiagnostics(validation);
      final = fileState(stagedProject, ctx.thermite, ctx.env);
    }
    const rawCalls = parseCalls(ctx.env.THERMITE_EVAL_LOG);
    const calls = conveyor
      ? phaseConveyorCalls(rawCalls, started, ended)
      : rawCalls;
    final.sourceFiles = documents(stagedProject).map((doc) => doc.path);
    const shimErrors = [
      ...auditInputErrors,
      ...parseCalls(ctx.env.THERMITE_EVAL_ERRORS),
    ];
    let head;
    try {
      head = read(ctx.env.THERMITE_EVAL_LOG + ".state.json").lastHash;
    } catch {
      shimErrors.push({ kind: "shim-error", stage: "missing-head" });
    }
    shimErrors.push(...auditErrors(rawCalls, head));
    if (
      trusted &&
      !rawCalls.some(
        (call) =>
          call.started >= flushStarted &&
          call.phase === "flush" &&
          JSON.stringify(call.argv) ===
            JSON.stringify(["validate", ".", "--json"]),
      )
    )
      shimErrors.push({ kind: "shim-error", stage: "missing-flush" });
    ctx.initial = initial;
    ctx.final = final;
    ctx.calls = calls;
    if (task.contributor) {
      // Contributor scoring still inspects the live Git worktree/install and
      // independently runs its submitted code. See the contributor boundary.
      assert(rootIntact, "Contributor project root was replaced");
      ctx.project = project;
      ctx.pinnedTypeScript = prepared.pinnedTypeScript;
    }
    const paths = [
      ...new Set([
        ...final.sourceFiles,
        ...(initial.sourceFiles ?? []),
        "system.json",
        "presentation.json",
        ...[initial, final].flatMap((state) =>
          Object.keys(state.documents).filter((p) =>
            p.startsWith("libraries/"),
          ),
        ),
      ]),
    ];
    ctx.sourceDiff = selectedDiff({
      before,
      scratch,
      paths,
      read(path) {
        if (
          !rootIntact ||
          projectRefusals.some(
            (refused) => path === refused || path.startsWith(refused + "/"),
          )
        )
          throw new Error("Project snapshot refused the selected path");
        const staged = join(stagedProject, path);
        return fileAt(staged) ? readFileSync(staged) : null;
      },
    });
    ctx.metrics = score({
      calls,
      initial,
      final,
      transcript: execution.stdout,
      context,
      engineRoots,
      allowedLibraryPaths: task.allowedLibraryPaths,
      guideCopy: task.guideCopy,
    });
    // Let queued operator signals run after synchronous CLI flush work.
    await new Promise((resolve) => setImmediate(resolve));
    const agentStopped = [
      "infrastructure-failure",
      "halted-infra",
      "needs-adjudication",
      "interrupted",
      "not-started",
    ].includes(classification.status);
    let outcome =
      stoppingSignal || (agentStopped && !scopeFailure)
        ? {
            pass: false,
            agentFailure: stoppingSignal
              ? "operator-interruption"
              : classification.reason,
          }
        : scopeFailure
          ? { pass: false, agentFailure: "snapshot-scope", message: scopeError }
          : await evaluateTask(taskDir, ctx);
    outcome = JSON.parse(redactSecrets(JSON.stringify(outcome), secretList));
    const independentlyChecked = outcome.pass;
    if (classification.taskFailure && !scopeFailure)
      outcome = {
        ...outcome,
        pass: false,
        agentFailure: classification.reason,
        warnings: classification.warnings ?? [],
        exitAfterCompletion: classification.exitAfterCompletion ?? false,
        retryAt: classification.retryAt ?? null,
      };
    assert.equal(
      harnessIdentity({ tasksDir: tasksRoot }).checkerHash,
      runIdentity.checkerHash,
      "Harness changed during run; result cannot be scored",
    );
    let runtimeAfter = null;
    try {
      runtimeAfter = snapshot(runtime, {
        documents: false,
        reader: runtimeSource,
      }).hash;
    } catch {}
    // An unreadable or replaced runtime is a change for V5.
    runtimeAfter ??= "refused";
    const metrics = score({
      calls,
      initial,
      final,
      runtimeBefore,
      runtimeAfter,
      transcript: execution.stdout,
      context,
      engineRoots,
      guideBytes,
      guideFiles: [join(project, "AGENTS.md"), join(runtime, "README.md")],
      expectedWarnings: outcome.expectedWarnings ?? task.expectedWarnings,
      actualWarnings:
        outcome.actualWarnings ??
        ctx.validationDiagnostics.filter((d) => d.severity === "warning"),
      requiredTopics: task.requiredTopics,
      taskOutcome: outcome,
      allowedUnused: task.allowedUnused,
      allowedLibraryPaths: task.allowedLibraryPaths,
      guideCopy: task.guideCopy,
      preserveSource: task.preserveSource,
      undocumentedShapes: task.undocumentedShapes,
      wallTimeMs: ended - started,
    });
    if (execution.signal || execution.timedOut) metrics.usage.partial = true;
    if (agent === "reference" && !execution.notStarted && !stoppingSignal)
      metrics.usage.partial = false;
    const prices = read(join(here, "prices.json")),
      u = metrics.usage;
    await new Promise((resolve) => setImmediate(resolve));
    const status = stoppingSignal
      ? "interrupted"
      : scopeFailure
        ? "task-failure"
        : agentStopped
          ? classification.status
          : outcome.error?.kind === "checker-error"
            ? "checker-error"
            : shimErrors.length
              ? "infrastructure-failure"
              : classification.status;
    if (delivery) {
      metrics.delivery = conveyorMetrics({
        ctx,
        outcome,
        independentlyChecked,
        candidates: delivery.candidates,
        captureRetries,
        started,
        ended,
        runStarted,
        status,
        timeoutMs,
        timedOut: execution.timedOut ?? false,
        violations: metrics.violations,
      });
      save("delivery-candidates.json", delivery.candidates);
    }
    manifest = {
      ...identity,
      format: "thermite-agent-run/1.1",
      evalVersion,
      commit: prepared.commit,
      arm,
      context,
      task: task.id,
      agent,
      seed,
      attempt,
      forceRerun,
      automaticRetry,
      status,
      promptHash: sha256(
        prompt.replaceAll(join(runtime, "thermite.mjs"), "{{THERMITE}}"),
      ),
      guideHash: initial.files["AGENTS.md"],
      runtimeHash: { before: runtimeBefore, after: runtimeAfter },
      timings: {
        started,
        ended,
        wallTimeMs: ended - started,
        totalWallTimeMs: Date.now() - runStarted,
      },
      usage: u,
      costEstimate: estimateCost(
        { ...normalized, usage: u },
        configuration.model,
        prices,
      ),
      cliVersions: { bun: Bun.version, agent: cliVersion },
      authentication,
      isolation,
      agentExit: execution.exit,
      agentSignal: execution.signal ?? null,
      agentFailure:
        status === "task-failure" ? "snapshot-scope" : classification.reason,
      warnings: classification.warnings ?? [],
      exitAfterCompletion: classification.exitAfterCompletion ?? false,
      retryAt: classification.retryAt ?? null,
      haltBatch: classification.haltBatch ?? false,
      terminalTemplate: normalized.terminalTemplate,
      infrastructureKind: ["infrastructure-failure", "halted-infra"].includes(
        status,
      )
        ? shimErrors.length
          ? "shim"
          : (classification.infrastructureKind ?? "harness")
        : null,
      retryCount: normalized.retryCount,
      retryEvents: normalized.retryEvents,
      completion: { successful: normalized.successfulCompletion },
      shimErrors,
      outcome,
      metrics,
      judgement: task.rubric ? "pending-two-judges" : "not-required",
      taskVersion: task.version,
      taskHash: sha256(readFileSync(join(taskDir, "task.json"))),
      taskTreeHash: snapshot(taskDir, { documents: false }).hash,
      ...runIdentity,
      checkerTaskTreeHash: snapshot(taskDir, { documents: false }).hash,
      initialProjectHash: initial.hash,
      logHash: sha256(readFileSync(ctx.env.THERMITE_EVAL_LOG)),
      auditHead: head,
      projectRefusals,
      workspace: keep || status === "checker-error" ? work : null,
    };
    if (status === "checker-error")
      save("recheck.json", {
        taskDir,
        tasksRoot,
        project,
        runtime,
        projectRoot: source.identity,
        workspaceRoot: workSource.identity,
        projectRefusals,
        guideBytes,
        initial,
        final,
        calls,
        sourceDiff: ctx.sourceDiff,
        validationDiagnostics: ctx.validationDiagnostics,
        context,
        engineRoots,
        keep,
        ...(delivery && {
          deliveryTiming: {
            candidates: delivery.candidates,
            captureRetries,
            started,
            ended,
            runStarted,
            timeoutMs,
            timedOut: execution.timedOut ?? false,
          },
        }),
      });
    save("before-flush.json", beforeFlush);
    save("final.json", final);
    save("score.json", metrics);
    save("check.json", outcome);
    save("shim-errors.json", shimErrors);
    cpSync(ctx.env.THERMITE_EVAL_LOG, join(live, "shim.jsonl"));
    if (task.rubric)
      save(
        "judge-packet.json",
        judgePacket({
          finalMessage: normalized.finalMessage,
          sourceDiff: ctx.sourceDiff,
          project,
          runtime,
          task,
          source,
          rootRefused: !rootIntact,
        }),
      );
    save("manifest.json", manifest);
    return manifest;
  } catch (error) {
    manifest = {
      ...identity,
      format: "thermite-agent-run/1.1",
      evalVersion,
      commit: prepared.commit,
      arm,
      context,
      task: task?.id ?? basename(taskDir),
      agent,
      seed,
      attempt,
      status: stoppingSignal ? "interrupted" : "infrastructure-failure",
      outcome: { pass: false },
      metrics: {
        violations: [],
        guideBytes: null,
        failedCalls: null,
        usage: { inputTokens: null },
      },
      timings: {
        started: runStarted,
        ended: Date.now(),
        wallTimeMs: Date.now() - runStarted,
      },
      infrastructureError: redactSecrets(error.message, secretList),
      stage: error.stage ?? "harness",
      infrastructureKind:
        error.stage === "authentication" ? "authentication" : "harness",
      ...(rootRefused && { projectRefusals: ["."] }),
      workspace: keep ? work : null,
    };
    // A rubric run whose agent finished but whose project root was lost or
    // replaced still publishes the whole-root refusal.
    if (task?.rubric && source && finalMessage !== undefined)
      try {
        // A detected loss stands even if the directory comes back later.
        if (rootRefused || !source.intact())
          save(
            "judge-packet.json",
            judgePacket({
              finalMessage,
              sourceDiff: null,
              project,
              runtime,
              task,
              source,
              rootRefused: true,
            }),
          );
      } catch {}
    save("infrastructure-failure.json", {
      status: manifest.status,
      message: manifest.infrastructureError,
    });
    save("manifest.json", manifest);
    if (!rootRefused && !archiveProject)
      try {
        // If setup failed before the project was pinned, no agent ran.
        source ??= projectReader(project);
        if (source.intact()) copyConfinedTree(source, join(live, "project"));
      } catch {}
    return manifest;
  } finally {
    try {
      auditSource?.close();
      source?.close();
      runtimeSource?.close();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
    try {
      if (!keep && manifest?.status === "checker-error")
        workSource?.remove("isolated");
      else if (!keep) workSource?.removeRoot();
    } catch (error) {
      if (manifest) {
        manifest.workspace = work;
        manifest.cleanupError = error.message;
        save("manifest.json", manifest);
      }
    } finally {
      workSource?.close();
      try {
        cpSync(live, evidence, { recursive: true });
      } finally {
        rmSync(live, { recursive: true, force: true });
      }
    }
  }
}
// `prepared` is the checkpoint's prepared context, read from the trusted
// archive; nothing the agent's run directory holds selects what runs here.
export async function recheckRun({ evidence, forceRecheck = false, prepared }) {
  assert(confinedPlatform, windowsUnavailable);
  assert(prepared?.path, "Recheck needs the checkpoint's prepared context");
  const original = read(join(evidence, "manifest.json"));
  assert(
    original.status === "checker-error",
    "Only a checker error can be rechecked",
  );
  assert(
    original.workspace && existsSync(original.workspace),
    "Kept checker workspace is missing; never rerun the agent automatically",
  );
  const stored = read(join(evidence, "recheck.json")),
    task = read(join(stored.taskDir, "task.json"));
  assert(
    stored.projectRoot &&
      stored.workspaceRoot &&
      Array.isArray(stored.projectRefusals) &&
      Number.isInteger(stored.guideBytes),
    "Recheck needs a confined project snapshot recorded since E2 1.20.5",
  );
  // Refuses a project root other than the one pinned before the agent started.
  const source = projectReader(stored.project, stored.projectRoot);
  let scratch;
  try {
    const checkerTaskTreeHash = snapshot(stored.taskDir, {
      documents: false,
    }).hash;
    assert(
      forceRecheck ||
        checkerTaskTreeHash ===
          (original.checkerTaskTreeHash ?? original.taskTreeHash),
      "Task directory changed; use --force-recheck to authorize and record the new checker inputs",
    );
    const revision = (original.checkerRechecks ?? 0) + 1,
      work = original.workspace;
    scratch = protectedScratch(".thermite-agent-recheck-");
    const stagedProject = join(scratch, "project");
    const refusals = copyConfinedTree(source, stagedProject);
    const current = snapshot(stagedProject);
    assert(
      current.hash === stored.final.hash &&
        JSON.stringify(refusals) === JSON.stringify(stored.projectRefusals),
      "Kept agent sources changed; refusing recheck",
    );
    assertConfinedProjectPaths(stagedProject, current.documents["system.json"]);
    const transcript = readFileSync(join(evidence, "transcript.jsonl"), "utf8");
    const promptVersion =
      original.taskVersion ??
      (original.taskHash ===
      sha256(readFileSync(join(stored.taskDir, "task.json")))
        ? task.version
        : null);
    // The checker's receipts, its configuration and the CLI it runs are staged
    // in protected scratch, never in the kept run directory, which a process
    // the agent left behind can still write.
    const live = join(scratch, "evidence");
    mkdirSync(live);
    const trusted = await protectedRuntime(prepared.path, scratch, task);
    const checker = harnessIdentity({ tasksDir: stored.tasksRoot });
    const calls = stored.deliveryTiming
      ? phaseConveyorCalls(
          stored.calls,
          stored.deliveryTiming.started,
          stored.deliveryTiming.ended,
        )
      : stored.calls;
    const ctx = {
      ...stored,
      calls,
      task,
      project: task.contributor ? stored.project : stagedProject,
      originalProject: stored.project,
      promptVersion,
      ...(task.contributor && { pinnedTypeScript: prepared.pinnedTypeScript }),
      evidence: live,
      captureEvidence: evidence,
      env: {
        ...freshEnvironment(join(scratch, "isolated"), {}, {}),
        THERMITE_EVAL_BUN_CONFIG: trusted.config,
      },
      thermite: join(trusted.runtime, "thermite.real.mjs"),
      metrics: score({
        calls,
        transcript,
        context: stored.context,
        engineRoots: stored.engineRoots,
        allowedLibraryPaths: task.allowedLibraryPaths,
      }),
    };
    const outcome = await evaluateTask(stored.taskDir, ctx);
    assert.equal(
      harnessIdentity({ tasksDir: stored.tasksRoot }).checkerHash,
      checker.checkerHash,
      "Harness changed during recheck; result cannot be scored",
    );
    const metrics = score({
      calls,
      initial: stored.initial,
      final: stored.final,
      runtimeBefore: original.runtimeHash.before,
      runtimeAfter: original.runtimeHash.after,
      transcript,
      context: stored.context,
      engineRoots: stored.engineRoots,
      guideBytes: stored.guideBytes,
      guideFiles: [
        join(stored.project, "AGENTS.md"),
        join(stored.runtime, "README.md"),
      ],
      expectedWarnings: outcome.expectedWarnings ?? task.expectedWarnings,
      actualWarnings:
        outcome.actualWarnings ??
        stored.validationDiagnostics.filter((d) => d.severity === "warning"),
      requiredTopics: task.requiredTopics,
      taskOutcome: outcome,
      allowedUnused: task.allowedUnused,
      allowedLibraryPaths: task.allowedLibraryPaths,
      guideCopy: task.guideCopy,
      preserveSource: task.preserveSource,
      undocumentedShapes: task.undocumentedShapes,
      wallTimeMs: original.timings.wallTimeMs,
    });
    if (original.agent === "reference") metrics.usage.partial = false;
    const independentlyChecked = outcome.pass;
    if (original.agentFailure) {
      outcome.pass = false;
      outcome.agentFailure = original.agentFailure;
    }
    if (stored.deliveryTiming)
      metrics.delivery = conveyorMetrics({
        ...stored.deliveryTiming,
        ctx,
        outcome,
        independentlyChecked,
        status:
          original.shimErrors?.length || outcome.error
            ? original.status
            : "complete",
        violations: metrics.violations,
        postAgentWallTimeMs: original.metrics.delivery?.postAgentWallTimeMs,
      });
    const result = {
      ...original,
      outcome,
      metrics,
      status:
        outcome.error?.kind === "checker-error"
          ? "checker-error"
          : original.shimErrors?.length
            ? "infrastructure-failure"
            : "complete",
      checkerRechecks: revision,
      checkerHarnessHash: checker.checkerHarnessHash,
      checkerHash: checker.checkerHash,
      checkerTaskTreeHash,
      forceRecheck: forceRecheck || original.forceRecheck || false,
      checkerRecheckHistory: [
        ...(original.checkerRecheckHistory ?? []),
        {
          revision,
          forced: forceRecheck,
          taskTreeHash: checkerTaskTreeHash,
          harnessHash: checker.checkerHarnessHash,
        },
      ],
    };
    write(
      join(
        evidence,
        `checker-history-${String(revision).padStart(3, "0")}.json`,
      ),
      original,
    );
    cpSync(live, evidence, { recursive: true });
    if (task.rubric)
      write(
        join(evidence, "judge-packet.json"),
        judgePacket({
          finalMessage: metrics.finalMessage,
          sourceDiff: ctx.sourceDiff,
          project: stored.project,
          runtime: stored.runtime,
          task,
          source,
        }),
      );
    write(join(evidence, "check.json"), outcome);
    write(join(evidence, "score.json"), metrics);
    if (result.status !== "checker-error" && !stored.keep) {
      result.workspace = null;
      let workspace;
      try {
        workspace = projectReader(work, stored.workspaceRoot);
        workspace.removeRoot();
      } catch (error) {
        result.workspace = work;
        result.cleanupError = error.message;
      } finally {
        workspace?.close();
      }
    }
    write(join(evidence, "manifest.json"), result);
    return result;
  } finally {
    try {
      source?.close();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  }
}
async function retryWait(ms, control) {
  const until = Date.now() + ms;
  while (!control.stopped && !stoppingSignal && Date.now() < until)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000, until - Date.now())),
    );
}
export async function runAttempts({
  prior = [],
  runAttempt,
  control = { stopped: false },
  forceRerun = false,
  retryDelayMs = 5000,
  reopenInfra = null,
  now = Date.now,
  wait = (ms) => retryWait(ms, control),
}) {
  const history = [...prior];
  let reopen = reopenInfra;
  for (;;) {
    const action = planAttempt(history, forceRerun, { reopenInfra: reopen });
    if (action.kind !== "run") {
      if (action.run?.status === "needs-adjudication") {
        control.stopped = true;
        control.reason = "needs-adjudication";
      }
      return {
        ...action.run,
        replayed: true,
        ...(action.kind === "exhausted" ? { retryExhausted: true } : {}),
      };
    }
    if (control.stopped || stoppingSignal) return history.at(-1);
    let automaticRetry = !reopen && automaticInfra(history.at(-1) ?? {});
    let delay = automaticRetry
      ? Math.max(
          retryDelayMs * 2 ** Math.max(0, automaticFailures(history) - 1),
          (history.at(-1).retryAt ?? now()) - now(),
        )
      : 0;
    // A historical quota-sized reset reopens instead of re-halting from disk.
    if (delay > 15 * 60000) {
      delay = 0;
      automaticRetry = false;
    }
    if (delay > 0) await wait(delay);
    if (control.stopped || stoppingSignal) return history.at(-1);
    const result = await runAttempt({
      attempt: action.attempt,
      forceRerun: action.forceRerun,
      automaticRetry,
      reopenInfra: action.reopenInfra,
      reopenedHalt: action.reopenedHalt,
      infraRetryDelayMs: delay,
    });
    reopen = null;
    history.push(result);
    if (batchHaltReason(result)) {
      if (haltingInfra(result)) result.status = "halted-infra";
      control.stopped = true;
      control.reason = batchHaltReason(result);
      return result;
    }
    if (!automaticInfra(result)) return result;
  }
}
export async function runBatch(tasks, { runTask, concurrency = 1 } = {}) {
  assert([1, 2].includes(concurrency));
  let cursor = 0;
  const results = [],
    control = { stopped: false, reason: null };
  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length && !stoppingSignal && !control.stopped) {
        const task = tasks[cursor++];
        try {
          const result = await runTask(task, control);
          if (!result) continue;
          if (
            result.status === "needs-adjudication" ||
            (!result.replayed && haltingInfra(result))
          ) {
            if (haltingInfra(result)) result.status = "halted-infra";
            control.stopped = true;
            control.reason = batchHaltReason(result);
          }
          results.push(result);
        } catch (error) {
          process.stderr.write(`${task}: checker-error: ${error.message}\n`);
          results.push({
            task,
            status: "checker-error",
            outcome: {
              pass: false,
              error: { kind: "checker-error", message: error.message },
            },
            metrics: { violations: [] },
          });
        }
      }
    }),
  );
  return results;
}
async function authOnly(values, timeoutMs) {
  assert(
    ["claude", "codex"].includes(values.agent),
    "--check-auth requires --agent claude|codex",
  );
  const work = ownTemp("thermite-auth-check-"),
    project = join(work, "project");
  mkdirSync(project);
  const env = freshEnvironment(join(work, "isolated"), process.env, {
    engineRoots: [root],
  });
  let seed;
  try {
    if (values.agent === "codex") {
      seed = seedCodexAuth(env, values["codex-auth"], { timeoutMs });
      if (values["codex-auth"]) {
        delete env.CODEX_API_KEY;
        delete env.OPENAI_API_KEY;
      }
    }
    assertIsolation(project, env, { codexAuth: !!seed });
    const status = await preflightAuth(values.agent, env, {
      capture: captureSetup,
    });
    console.log(JSON.stringify(status));
    if (!status.ok) process.exitCode = 1;
  } catch (error) {
    if (error.stage !== "authentication") throw error;
    console.error(error.message);
    console.log(
      JSON.stringify({
        ok: false,
        agent: values.agent,
        billing: "chatgpt-login",
        reason: "refresh-required",
      }),
    );
    process.exitCode = 1;
  } finally {
    if (!values.keep) rmSync(work, { recursive: true, force: true });
  }
}
async function main() {
  const started = Date.now();
  const { values } = parseArgs({
    options: {
      checkpoint: { type: "string" },
      task: { type: "string" },
      all: { type: "boolean" },
      agent: { type: "string", default: "reference" },
      model: { type: "string" },
      effort: { type: "string" },
      arm: { type: "string", default: "A" },
      guide: { type: "string" },
      context: { type: "string", default: "runtime" },
      engine: { type: "string", default: root },
      commit: { type: "string", default: "HEAD" },
      seed: { type: "string", default: "1" },
      concurrency: { type: "string", default: "1" },
      "tasks-dir": { type: "string", default: join(here, "tasks") },
      "print-agent-command": { type: "boolean", default: false },
      "check-auth": { type: "boolean", default: false },
      "codex-auth": { type: "string" },
      keep: { type: "boolean", default: false },
      "force-rerun": { type: "boolean", default: false },
      "force-recheck": { type: "boolean", default: false },
      "reopen-infra": { type: "string" },
      "allow-harness-mismatch": { type: "boolean", default: false },
      timeout: { type: "string", default: "900" },
    },
  });
  const timeoutMs = Number(values.timeout) * 1000;
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0);
  if (values["check-auth"]) {
    await authOnly(values, timeoutMs);
    return;
  }
  assert(confinedPlatform, windowsUnavailable);
  assert(
    values.checkpoint &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.checkpoint),
    "Use --checkpoint <portable-name>",
  );
  assert(["runtime", "source"].includes(values.context));
  assert(["reference", "claude", "codex"].includes(values.agent));
  const configuration = agentConfiguration({
    agent: values.agent,
    model: values.model,
    effort: values.effort,
  });
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(values.arm));
  assert(values.arm === "A" || values.guide, "Alternate arm requires --guide");
  const seed = Number(values.seed),
    concurrency = Number(values.concurrency);
  assert(Number.isSafeInteger(seed) && seed > 0);
  assert([1, 2].includes(concurrency));
  const tasksDir = resolve(values["tasks-dir"]);
  let tasks = values.all
    ? readdirSync(tasksDir)
        .filter((t) => existsSync(join(tasksDir, t, "task.json")))
        .sort()
    : [values.task];
  assert(
    tasks.length &&
      tasks.every(
        (t) =>
          t && basename(t) === t && existsSync(join(tasksDir, t, "task.json")),
      ),
    "Use a known task or --all",
  );
  const selectedKey = (task) =>
    runKey({
      context: values.context,
      task: read(join(tasksDir, task, "task.json")).id ?? task,
      agent: values.agent,
      seed,
      ...configuration,
    });
  if (values["reopen-infra"] && values["reopen-infra"] !== "all")
    assert(
      tasks.some((task) => selectedKey(task) === values["reopen-infra"]),
      "--reopen-infra must match a selected run key or all",
    );
  const requested = join(root, "evals/out/agent", values.checkpoint);
  mkdirSync(requested, { recursive: true });
  // Only the Codex sandbox has a write boundary; Claude runs as the harness
  // user and the reference agent launches nothing. Either way, archive to the
  // canonical path resolved now, never back through a link.
  const destination =
    values.agent === "codex"
      ? assertArchiveOutsideSandbox(requested)
      : realpathSync(requested);
  const preparation = join(destination, "context"),
    contextFile = join(preparation, "context.json"),
    commit = git(
      resolve(values.engine),
      "rev-parse",
      `${values.commit}^{commit}`,
    );
  let prepared,
    checkpointPin,
    checkpointOverride = null;
  const currentIdentity = harnessIdentity({ tasksDir });
  if (existsSync(contextFile)) {
    const prior = read(contextFile);
    assert(
      prior.commit === commit && prior.context === values.context,
      "Checkpoint context/commit mismatch",
    );
    checkpointPin = pinCheckpoint(prior, currentIdentity, {
      allowMismatch: values["allow-harness-mismatch"],
    });
    if (
      checkpointPin.identityOverrides.length >
      (prior.identityOverrides?.length ?? 0)
    )
      checkpointOverride = checkpointPin.identityOverrides.at(-1);
    prepared = prior.prepared;
    write(contextFile, { ...prior, ...checkpointPin });
  } else {
    mkdirSync(preparation, { recursive: true });
    prepared = await prepareContext({
      engine: resolve(values.engine),
      commit,
      context: values.context,
      destination: preparation,
    });
    const { extractSafeZipArchive } =
      await import("../../scripts/safe-zip-reader.mjs");
    await extractSafeZipArchive(
      execFileSync("git", ["archive", "--format=zip", commit, "examples"], {
        cwd: values.engine,
        maxBuffer: 64 << 20,
      }),
      join(preparation, "fixtures"),
    );
    prepared.examples = join(preparation, "fixtures/examples");
    checkpointPin = pinCheckpoint(null, currentIdentity);
    write(contextFile, {
      commit,
      context: values.context,
      prepared,
      ...checkpointPin,
    });
  }
  let batchCliVersion = null;
  const protocolWarnings = [];
  if (values.agent !== "reference") {
    const versionWork = ownTemp("thermite-cli-version-");
    try {
      const env = freshEnvironment(
        join(versionWork, "isolated"),
        { PATH: process.env.PATH },
        { engineRoots: [root] },
      );
      batchCliVersion = await agentVersion(agents[values.agent].binary, {
        env,
        cwd: versionWork,
      });
      if (!pinnedCliVersion(values.agent, batchCliVersion)) {
        protocolWarnings.push({
          code: "unpinned-cli-version",
          agent: values.agent,
          cliVersion: batchCliVersion,
        });
        process.stderr.write(
          `Warning: unpinned ${values.agent} CLI version ${batchCliVersion ?? "unknown"}; unknown terminal errors halt for adjudication.\n`,
        );
      }
    } finally {
      rmSync(versionWork, { recursive: true, force: true });
    }
  }
  // An unresolved record blocks every ordinary resume, including a different
  // task selection. Explicit reopen can probe those keys only; it is not an
  // adjudication and cannot authorize unrelated keys to spend more model time.
  const unresolved = readdirSync(destination, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "context")
    .flatMap((d) =>
      readdirSync(join(destination, d.name))
        .filter((name) => /^attempt-\d+$/.test(name))
        .map((name) => join(destination, d.name, name, "manifest.json"))
        .filter(existsSync)
        .map((path) => ({ path, run: readRun(path) })),
    )
    .filter(({ run }) => run.status === "needs-adjudication");
  if (unresolved.length) {
    process.stderr.write(
      `Unresolved adjudication blocks this checkpoint: ${unresolved.map(({ path }) => path).join(", ")}\n`,
    );
    if (!values["reopen-infra"]) {
      process.exitCode = 1;
      return;
    }
    tasks = tasks.filter(
      (task) =>
        unresolved.some(({ run }) => runKey(run) === selectedKey(task)) &&
        (values["reopen-infra"] === "all" ||
          values["reopen-infra"] === selectedKey(task)),
    );
    assert(
      tasks.length,
      "--reopen-infra must target an unresolved key until adjudication",
    );
  }
  const engineRoots = git(
    resolve(values.engine),
    "worktree",
    "list",
    "--porcelain",
  )
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9));
  const results = await runBatch(tasks, {
    concurrency,
    runTask: async (task, control) => {
      const base = join(
        destination,
        runDirectoryName({
          task,
          agent: values.agent,
          arm: values.arm,
          seed,
          ...configuration,
        }),
      );
      mkdirSync(base, { recursive: true });
      const prior = readdirSync(base)
        .filter((d) => /^attempt-\d+$/.test(d))
        .flatMap((d) => {
          const file = join(base, d, "manifest.json");
          return existsSync(file) ? [readRun(file)] : [];
        })
        .sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
      const requestedReopen = values["reopen-infra"];
      const reopenInfra =
        requestedReopen === "all" || requestedReopen === selectedKey(task)
          ? requestedReopen
          : null;
      const action = planAttempt(prior, values["force-rerun"], { reopenInfra });
      const complete = action.run;
      if (["skip", "exhausted", "adjudicate"].includes(action.kind)) {
        process.stdout.write(
          `${task}: attempt ${complete.attempt}, ${action.kind}${action.reason ? " (" + action.reason + ")" : ""}\n`,
        );
        return {
          ...complete,
          replayed: true,
          ...(action.kind === "exhausted" ? { retryExhausted: true } : {}),
        };
      }
      if (action.kind === "recheck")
        return recheckRun({
          forceRecheck: values["force-recheck"],
          prepared,
          evidence: join(
            base,
            `attempt-${String(prior.at(-1).attempt).padStart(3, "0")}`,
          ),
        });
      const attempt = action.attempt;
      process.stdout.write(`${task} (attempt ${attempt})…\n`);
      const result = await runAttempts({
        prior,
        control,
        reopenInfra,
        runAttempt: ({
          attempt,
          forceRerun,
          automaticRetry,
          reopenInfra,
          reopenedHalt,
          infraRetryDelayMs,
        }) =>
          runOne({
            taskDir: join(tasksDir, task),
            prepared,
            evidence: join(base, `attempt-${String(attempt).padStart(3, "0")}`),
            agent: values.agent,
            model: values.model,
            effort: values.effort,
            arm: values.arm,
            context: values.context,
            seed,
            attempt,
            guide: values.guide && resolve(values.guide),
            printAgentCommand: values["print-agent-command"],
            engineRoots,
            codexAuth: values["codex-auth"],
            keep: values.keep,
            forceRerun,
            automaticRetry,
            reopenInfra,
            reopenedHalt,
            infraRetryDelayMs,
            batchControl: control,
            checkpointOverride,
            expectedIdentity: currentIdentity,
            tasksRoot: tasksDir,
            timeoutMs,
          }),
        forceRerun: action.forceRerun,
      });
      if (result?.stage === "authentication" && !result.replayed)
        process.stderr.write(`${task}: ${result.infrastructureError}\n`);
      return result;
    },
  });
  write(join(destination, "checkpoint.json"), {
    format: "thermite-agent-checkpoint/1.1",
    ...checkpointPin,
    commit,
    agent: values.agent,
    ...configuration,
    batchCliVersion,
    protocolWarnings,
    timings: { started, ended: Date.now(), wallTimeMs: Date.now() - started },
    reopenInfra: values["reopen-infra"] ?? null,
    stopped:
      batchHaltReason(
        results.find(
          (r) =>
            r.status === "needs-adjudication" ||
            (!r.replayed && haltingInfra(r)),
        ),
      ) ?? stoppingSignal,
    results: results.map((r) => ({
      runKey: r.runKey,
      model: r.model,
      effort: r.effort,
      modelPin: r.modelPin,
      modelOverrides: r.modelOverrides,
      task: r.task,
      attempt: r.attempt,
      status: r.status,
      forceRerun: r.forceRerun ?? false,
      infrastructureKind: r.infrastructureKind ?? null,
      retryCount: r.retryCount ?? 0,
      retryExhausted: r.retryExhausted ?? false,
      reopenInfra: r.reopenInfra ?? null,
      reopenedHalt: r.reopenedHalt ?? false,
      warnings: r.warnings ?? [],
      checkpointOverride: r.checkpointOverride ?? null,
      pass: r.outcome?.pass,
      violations: r.metrics?.violations.length,
      attemptedWrites: r.metrics?.attemptedWrites?.length ?? 0,
    })),
  });
  if (
    !stoppingSignal &&
    results.some((r) =>
      r.status === "command-only"
        ? !r.authentication?.ok
        : !isComplete(r) || !r.outcome?.pass || r.metrics.violations.length,
    )
  )
    process.exitCode = 1;
  if (
    !stoppingSignal &&
    unresolved.some(({ path }) => readRun(path).status === "needs-adjudication")
  )
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      stoppingSignal = signal;
      for (const child of children) killChild(child, signal);
      process.exitCode = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal];
    });
  await main();
}
