#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cp as copyAsync } from "node:fs/promises";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { evalVersion, harnessIdentity, pinCheckpoint } from "./checkpoint.mjs";
import { readRun } from "./records.mjs";
import { fileState, fileStateAsync, auditErrors } from "./audit.mjs";
import { captureProcess } from "./process.mjs";
import { pinnedCliVersion } from "./cli-protocol.mjs";
import {
  preflightAuth,
  seedCodexAuth,
  refreshCodexAuth,
  secretValues,
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
import {
  agents,
  agentConfiguration,
  launchCommand,
  shellCommand,
  freshEnvironment,
  assertIsolation,
} from "./launch.mjs";
import { cli, read, write, documents, uid } from "./task-support.mjs";
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
export async function prepareContext({
  engine = root,
  commit = "HEAD",
  context,
  destination,
}) {
  const pinned = git(engine, "rev-parse", `${commit}^{commit}`),
    build = join(destination, "build");
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
      await extractSafeZipArchive(
        readFileSync(candidates[0]),
        join(destination, "engine"),
      );
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
      cpSync(build, join(destination, "engine"), {
        recursive: true,
        dereference: true,
        filter: (p) => basename(p) !== ".git",
      });
    }
    return { path: join(destination, "engine"), commit: pinned };
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
}) {
  const outputs = {},
    binaryOutputs = [];
  for (const name of [
    "drawings",
    "issue.md",
    "review-notes.md",
    "requirement-matrix.json",
    "friction.md",
  ]) {
    const path = join(project, name);
    if (!existsSync(path)) continue;
    if (name === "drawings")
      for (const file of readdirSync(path).sort()) {
        if (!/\.(json|csv|html|svg|pdf)$/.test(file)) continue;
        if (file.endsWith(".pdf")) {
          outputs[`drawings/${file}`] = readFileSync(join(path, file)).toString(
            "base64",
          );
          binaryOutputs.push(`drawings/${file}`);
        } else
          outputs[`drawings/${file}`] = readFileSync(join(path, file), "utf8");
      }
    else outputs[name] = readFileSync(path, "utf8");
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
    format: "thermite-blinded-judge/1.1",
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
    live = join(work, "evidence"),
    audit = join(work, "audit");
  mkdirSync(live);
  mkdirSync(audit);
  let authSeed,
    env,
    manifest,
    task,
    initial,
    runtimeBefore,
    secretList = [];
  const runStarted = Date.now();
  const save = (file, value) =>
    write(
      join(live, file),
      JSON.parse(redactSecrets(JSON.stringify(value), secretList)),
    );
  try {
    await copyAsync(prepared.path, runtime, {
      recursive: true,
      dereference: true,
    });
    installShim(runtime);
    task = read(join(taskDir, "task.json"));
    identity.task = task.id;
    identity.runKey = runKey(identity);
    env = {
      ...freshEnvironment(join(work, "isolated"), process.env, { engineRoots }),
      THERMITE_EVAL_PROJECT: project,
      THERMITE_EVAL_LOG: join(audit, "shim.jsonl"),
      THERMITE_EVAL_ERRORS: join(audit, "shim-errors.jsonl"),
      THERMITE_EVAL_PHASE: "setup",
    };
    for (const [key, value] of Object.entries(env))
      if (!credentialKeys.includes(key))
        assert(
          !engineRoots.some((p) => value.includes(p)),
          `Checkout path leaked through ${key}`,
        );
    if (agent === "codex") {
      authSeed = seedCodexAuth(env, codexAuth);
      if (codexAuth) {
        delete env.CODEX_API_KEY;
        delete env.OPENAI_API_KEY;
      }
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
    const isolation = assertIsolation(project, env, {
      claudeLoader: agent === "claude",
      codexAuth: !!authSeed,
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
    if (existsSync(env.THERMITE_EVAL_ERRORS)) rmSync(env.THERMITE_EVAL_ERRORS);
    env.THERMITE_EVAL_PHASE = "agent";
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
    const started = Date.now();
    let execution = { exit: 0, stdout: "", stderr: "" };
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
      execution = await capturedAgent(
        [process.execPath, join(here, "reference-worker.mjs"), workerContext],
        ctx,
        timeoutMs,
      );
    } else execution = await capturedAgent(command, ctx, timeoutMs);
    secretList = [...new Set([...secretList, ...secretValues(env)])];
    execution.stdout = redactSecrets(execution.stdout, secretList);
    execution.stderr = redactSecrets(execution.stderr, secretList);
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
      ended = Date.now(),
      beforeFlush = snapshot(project);
    if (batchControl && batchHaltReason(classification)) {
      batchControl.stopped = true;
      batchControl.reason = batchHaltReason(classification);
    }
    env.THERMITE_EVAL_PHASE = "flush";
    const validation = cli(ctx, "validate", ".", "--json");
    writeFileSync(
      join(live, "validate.stdout"),
      redactSecrets(validation.stdout, secretList),
    );
    writeFileSync(
      join(live, "validate.stderr"),
      redactSecrets(validation.stderr, secretList),
    );
    const final = fileState(project, join(runtime, "thermite.real.mjs"), env),
      calls = parseCalls(env.THERMITE_EVAL_LOG);
    final.sourceFiles = documents(project).map((doc) => doc.path);
    const shimErrors = existsSync(env.THERMITE_EVAL_ERRORS)
      ? parseCalls(env.THERMITE_EVAL_ERRORS)
      : [];
    let head;
    try {
      head = read(env.THERMITE_EVAL_LOG + ".state.json").lastHash;
    } catch {
      shimErrors.push({ kind: "shim-error", stage: "missing-head" });
    }
    shimErrors.push(...auditErrors(calls, head));
    if (!calls.some((call) => call.phase === "flush"))
      shimErrors.push({ kind: "shim-error", stage: "missing-flush" });
    ctx.initial = initial;
    ctx.final = final;
    ctx.calls = calls;
    ctx.validationDiagnostics = validationDiagnostics(validation);
    ctx.thermite = join(runtime, "thermite.real.mjs");
    const paths = [
      ...new Set([
        ...documents(project).map((d) => d.path),
        ...(initial.sourceFiles ?? []),
        "system.json",
        "presentation.json",
        ...Object.keys(final.documents).filter((p) =>
          p.startsWith("libraries/"),
        ),
      ]),
    ];
    git(project, "add", "--intent-to-add", ".");
    ctx.sourceDiff = git(project, "diff", "--no-ext-diff", "--", ...paths);
    ctx.metrics = score({
      calls,
      initial,
      final,
      transcript: execution.stdout,
      context,
      engineRoots,
    });
    // Let queued operator signals run after synchronous CLI flush work.
    await new Promise((resolve) => setImmediate(resolve));
    let outcome =
      stoppingSignal ||
      [
        "infrastructure-failure",
        "halted-infra",
        "needs-adjudication",
        "interrupted",
        "not-started",
      ].includes(classification.status)
        ? {
            pass: false,
            agentFailure: stoppingSignal
              ? "operator-interruption"
              : classification.reason,
          }
        : await evaluateTask(taskDir, ctx);
    outcome = JSON.parse(redactSecrets(JSON.stringify(outcome), secretList));
    if (classification.taskFailure)
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
    const runtimeAfter = snapshot(runtime, { documents: false }).hash;
    const metrics = score({
      calls,
      initial,
      final,
      runtimeBefore,
      runtimeAfter,
      transcript: execution.stdout,
      context,
      engineRoots,
      guideBytes: readFileSync(join(project, "AGENTS.md")).length,
      guideFiles: [join(project, "AGENTS.md"), join(runtime, "README.md")],
      expectedWarnings: outcome.expectedWarnings ?? task.expectedWarnings,
      actualWarnings:
        outcome.actualWarnings ??
        ctx.validationDiagnostics.filter((d) => d.severity === "warning"),
      requiredTopics: task.requiredTopics,
      allowedUnused: task.allowedUnused,
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
      : [
            "infrastructure-failure",
            "halted-infra",
            "needs-adjudication",
            "interrupted",
            "not-started",
          ].includes(classification.status)
        ? classification.status
        : outcome.error?.kind === "checker-error"
          ? "checker-error"
          : shimErrors.length
            ? "infrastructure-failure"
            : classification.status;
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
      agentFailure: classification.reason,
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
      taskHash: sha256(readFileSync(join(taskDir, "task.json"))),
      taskTreeHash: snapshot(taskDir, { documents: false }).hash,
      ...runIdentity,
      checkerTaskTreeHash: snapshot(taskDir, { documents: false }).hash,
      initialProjectHash: initial.hash,
      logHash: sha256(readFileSync(env.THERMITE_EVAL_LOG)),
      auditHead: head,
      workspace: keep || status === "checker-error" ? work : null,
    };
    if (status === "checker-error")
      save("recheck.json", {
        taskDir,
        tasksRoot,
        project,
        runtime,
        initial,
        final,
        calls,
        sourceDiff: ctx.sourceDiff,
        validationDiagnostics: ctx.validationDiagnostics,
        context,
        engineRoots,
        keep,
      });
    save("before-flush.json", beforeFlush);
    save("final.json", final);
    save("score.json", metrics);
    save("check.json", outcome);
    save("shim-errors.json", shimErrors);
    cpSync(env.THERMITE_EVAL_LOG, join(live, "shim.jsonl"));
    if (task.rubric)
      save(
        "judge-packet.json",
        judgePacket({
          finalMessage: normalized.finalMessage,
          sourceDiff: ctx.sourceDiff,
          project,
          runtime,
          task,
        }),
      );
    cpSync(project, join(live, "project"), { recursive: true });
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
      workspace: keep ? work : null,
    };
    save("infrastructure-failure.json", {
      status: manifest.status,
      message: manifest.infrastructureError,
    });
    save("manifest.json", manifest);
    if (existsSync(project))
      cpSync(project, join(live, "project"), { recursive: true });
    return manifest;
  } finally {
    if (authSeed)
      try {
        const refresh = refreshCodexAuth(authSeed, env);
        if (manifest) {
          manifest.authRefresh = refresh;
          save("manifest.json", manifest);
        }
      } catch (error) {
        if (manifest) {
          manifest.status = "infrastructure-failure";
          manifest.infrastructureKind = "authentication";
          manifest.infrastructureError = redactSecrets(
            error.message,
            secretList,
          );
          save("manifest.json", manifest);
        }
      }
    if (manifest?.status === "checker-error" && !keep)
      rmSync(join(work, "isolated"), { recursive: true, force: true });
    if (existsSync(live)) cpSync(live, evidence, { recursive: true });
    if (!keep && manifest?.status !== "checker-error")
      rmSync(work, { recursive: true, force: true });
  }
}
export async function recheckRun({ evidence, forceRecheck = false }) {
  const original = read(join(evidence, "manifest.json"));
  assert(
    original.status === "checker-error",
    "Only a checker error can be rechecked",
  );
  assert(
    original.workspace && existsSync(original.workspace),
    "Kept checker workspace is missing; never rerun the agent automatically",
  );
  const pending = read(join(evidence, "recheck.json"));
  const checkerTaskTreeHash = snapshot(pending.taskDir, {
    documents: false,
  }).hash;
  assert(
    forceRecheck ||
      checkerTaskTreeHash ===
        (original.checkerTaskTreeHash ?? original.taskTreeHash),
    "Task directory changed; use --force-recheck to authorize and record the new checker inputs",
  );
  const stored = read(join(evidence, "recheck.json")),
    task = read(join(stored.taskDir, "task.json")),
    revision = (original.checkerRechecks ?? 0) + 1,
    work = original.workspace,
    live = join(work, `recheck-${revision}`);
  mkdirSync(live);
  assert(
    snapshot(stored.project).hash === stored.final.hash,
    "Kept agent sources changed; refusing recheck",
  );
  const ctx = {
    ...stored,
    task,
    evidence: live,
    env: freshEnvironment(join(work, `recheck-config-${revision}`), {}, {}),
    thermite: join(stored.runtime, "thermite.real.mjs"),
    metrics: original.metrics,
  };
  const outcome = await evaluateTask(stored.taskDir, ctx);
  const metrics = score({
    calls: stored.calls,
    initial: stored.initial,
    final: stored.final,
    runtimeBefore: original.runtimeHash.before,
    runtimeAfter: snapshot(stored.runtime, { documents: false }).hash,
    transcript: readFileSync(join(evidence, "transcript.jsonl"), "utf8"),
    context: stored.context,
    engineRoots: stored.engineRoots,
    guideBytes: readFileSync(join(stored.project, "AGENTS.md")).length,
    guideFiles: [
      join(stored.project, "AGENTS.md"),
      join(stored.runtime, "README.md"),
    ],
    expectedWarnings: outcome.expectedWarnings ?? task.expectedWarnings,
    actualWarnings:
      outcome.actualWarnings ??
      stored.validationDiagnostics.filter((d) => d.severity === "warning"),
    requiredTopics: task.requiredTopics,
    allowedUnused: task.allowedUnused,
    preserveSource: task.preserveSource,
    undocumentedShapes: task.undocumentedShapes,
    wallTimeMs: original.timings.wallTimeMs,
  });
  if (original.agent === "reference") metrics.usage.partial = false;
  if (original.agentFailure) {
    outcome.pass = false;
    outcome.agentFailure = original.agentFailure;
  }
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
    checkerHarnessHash: snapshot(here, { documents: false }).hash,
    checkerHash: harnessIdentity({ tasksDir: stored.tasksRoot }).checkerHash,
    checkerTaskTreeHash,
    forceRecheck: forceRecheck || original.forceRecheck || false,
    checkerRecheckHistory: [
      ...(original.checkerRecheckHistory ?? []),
      {
        revision,
        forced: forceRecheck,
        taskTreeHash: checkerTaskTreeHash,
        harnessHash: snapshot(here, { documents: false }).hash,
      },
    ],
  };
  write(
    join(evidence, `checker-history-${String(revision).padStart(3, "0")}.json`),
    original,
  );
  cpSync(live, evidence, { recursive: true });
  if (task.rubric)
    write(
      join(evidence, "judge-packet.json"),
      judgePacket({
        finalMessage: metrics.finalMessage,
        sourceDiff: ctx.sourceDiff,
        project: ctx.project,
        runtime: ctx.runtime,
        task,
      }),
    );
  write(join(evidence, "check.json"), outcome);
  write(join(evidence, "score.json"), metrics);
  if (result.status !== "checker-error" && !stored.keep) {
    result.workspace = null;
    rmSync(work, { recursive: true, force: true });
  }
  write(join(evidence, "manifest.json"), result);
  return result;
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
async function authOnly(values) {
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
      seed = seedCodexAuth(env, values["codex-auth"]);
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
  } finally {
    if (seed) refreshCodexAuth(seed, env);
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
  if (values["check-auth"]) {
    await authOnly(values);
    return;
  }
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
    concurrency = Number(values.concurrency),
    timeoutMs = Number(values.timeout) * 1000;
  assert(Number.isSafeInteger(seed) && seed > 0);
  assert([1, 2].includes(concurrency));
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0);
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
  const destination = join(root, "evals/out/agent", values.checkpoint);
  mkdirSync(destination, { recursive: true });
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
          evidence: join(
            base,
            `attempt-${String(prior.at(-1).attempt).padStart(3, "0")}`,
          ),
        });
      const attempt = action.attempt;
      process.stdout.write(`${task} (attempt ${attempt})…\n`);
      return runAttempts({
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
