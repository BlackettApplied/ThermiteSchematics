#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createAjv2020, parseJson } from "@thermite/schema";

const terminalSuccess = new Set(["completed", "needs-evidence"]);
const artifactNames = [
  "worker.stdout.jsonl",
  "worker.stderr.log",
  "result.json",
  "type.json",
  "research.md",
];
const now = () => new Date().toISOString();
const validateCandidate = createAjv2020().compile(
  readStrictJson(
    fileURLToPath(new URL("./candidate.schema.json", import.meta.url)),
  ),
);

function readStrictJson(path) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    readFileSync(path),
  );
  const parsed = parseJson(text, path);
  if (parsed.diagnostics.length)
    throw new Error(
      parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
    );
  if (parsed.value === undefined) throw new Error("No JSON value");
  return parsed.value;
}

export function parseArgs(args) {
  const options = {
    claude: 1,
    codex: 1,
    timeoutMinutes: 25,
    dryRun: false,
    resume: false,
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--resume") options.resume = true;
    else if (
      [
        "--batch",
        "--claude",
        "--codex",
        "--timeout-minutes",
        "--limits-file",
      ].includes(flag)
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${flag}`);
      if (flag === "--batch") options.batch = value;
      else if (flag === "--limits-file") options.limitsFile = value;
      else
        options[
          flag === "--timeout-minutes" ? "timeoutMinutes" : flag.slice(2)
        ] = Number(value);
    } else if (flag === "--help") options.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (options.help) return options;
  if (!options.batch || !isAbsolute(options.batch))
    throw new Error("--batch requires an absolute directory path");
  for (const backend of ["claude", "codex"]) {
    if (!Number.isSafeInteger(options[backend]) || options[backend] < 0)
      throw new Error(`--${backend} must be a nonnegative integer`);
  }
  if (options.limitsFile && !isAbsolute(options.limitsFile))
    throw new Error("--limits-file requires an absolute JSON file path");
  if (options.claude + options.codex === 0 && !options.limitsFile)
    throw new Error("At least one backend must have a positive process count");
  if (
    !Number.isFinite(options.timeoutMinutes) ||
    options.timeoutMinutes <= 0 ||
    options.timeoutMinutes > 1440
  )
    throw new Error(
      "--timeout-minutes must be greater than zero and at most 1440",
    );
  return options;
}

function readLimits(path) {
  const limits = JSON.parse(readFileSync(path, "utf8"));
  if (
    !limits ||
    typeof limits !== "object" ||
    Array.isArray(limits) ||
    Object.keys(limits).some((key) => !["claude", "codex"].includes(key)) ||
    ["claude", "codex"].some(
      (backend) =>
        !Number.isSafeInteger(limits[backend]) || limits[backend] < 0,
    )
  )
    throw new Error(
      "Limits must contain claude and codex nonnegative integer process counts",
    );
  return { claude: limits.claude, codex: limits.codex };
}

function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function acquireLock(batch) {
  const path = join(batch, ".runner.lock.json");
  const lock = { pid: process.pid, token: randomUUID(), startedAt: now() };
  function create() {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(lock)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  try {
    create();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Only one contender may reclaim a dead runner's lock at a time.
    const recoveryPath = join(batch, ".runner.lock.recovery");
    let recovery;
    try {
      recovery = openSync(recoveryPath, "wx", 0o600);
    } catch (recoveryError) {
      if (recoveryError.code === "EEXIST")
        throw new Error(
          "Runner lock recovery is already in progress; inspect .runner.lock.recovery before retrying",
        );
      throw recoveryError;
    }
    try {
      if (existsSync(path)) {
        let previous;
        try {
          previous = JSON.parse(readFileSync(path, "utf8"));
        } catch {
          throw new Error(
            "Unreadable runner lock; inspect .runner.lock.json before removing it",
          );
        }
        if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0)
          throw new Error(
            "Invalid runner lock PID; inspect .runner.lock.json before removing it",
          );
        if (alive(previous.pid))
          throw new Error(`Batch has an active runner (PID ${previous.pid})`);
        unlinkSync(path);
      }
      create();
    } finally {
      closeSync(recovery);
      unlinkSync(recoveryPath);
    }
  }
  return () => {
    if (
      existsSync(path) &&
      JSON.parse(readFileSync(path, "utf8")).token === lock.token
    )
      unlinkSync(path);
  };
}

function readQueue(batch) {
  const bytes = readFileSync(join(batch, "queue.json"));
  const queue = JSON.parse(bytes.toString("utf8"));
  if (
    queue.format !== "thermite-component-queue/0.1" ||
    !Array.isArray(queue.jobs)
  )
    throw new Error("Invalid component queue format");
  const ids = new Set();
  const directories = new Set();
  for (const job of queue.jobs) {
    if (!job || typeof job.id !== "string" || !job.id || ids.has(job.id))
      throw new Error("Queue job IDs must be nonempty and unique");
    if (!["claude", "codex"].includes(job.backend))
      throw new Error(`Unknown backend for ${job.id}`);
    for (const key of ["directory", "promptFile"]) {
      if (typeof job[key] !== "string" || !isAbsolute(job[key]))
        throw new Error(`${job.id}: ${key} must be absolute`);
    }
    if (
      !statSync(job.directory).isDirectory() ||
      !statSync(job.promptFile).isFile()
    )
      throw new Error(`${job.id}: missing job directory or prompt file`);
    const directory = realpathSync(job.directory);
    if (directories.has(directory))
      throw new Error(`Jobs cannot share a working directory: ${directory}`);
    if (
      !Array.isArray(job.command) ||
      !job.command.length ||
      job.command.some(
        (arg) => typeof arg !== "string" || arg.includes("\0"),
      ) ||
      !job.command[0]
    )
      throw new Error(`${job.id}: command must be a nonempty argv array`);
    ids.add(job.id);
    directories.add(directory);
  }
  return {
    queue,
    integrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
  };
}

function tail(path, limit = 128 * 1024) {
  if (!existsSync(path)) return "";
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    const buffer = Buffer.alloc(Math.min(size, limit));
    readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const limited =
  /\b429\b|rate[ _-]?limit|usage[ _-]?limit|too many requests|(?:insufficient|exceeded|exhausted)[ _-]?quota|quota[^\n]{0,80}(?:exceeded|exhausted|limit)|(?:you.ve hit|reached|exceeded)[^\n]{0,30}(?:usage )?limit/i;

export function terminalOutcome(stdout) {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      const failed =
        event.type === "turn.failed" ||
        event.type === "error" ||
        (event.type === "result" &&
          (event.is_error === true ||
            event.error != null ||
            /^error(?:_|$)/.test(event.subtype ?? ""))) ||
        (event.type == null && event.error != null);
      const completed =
        event.type === "turn.completed" ||
        (event.type === "result" &&
          (event.is_error === false || event.subtype === "success"));
      if (failed || completed)
        return {
          state: failed ? "failed" : "completed",
          diagnostic: failed
            ? `Backend error event: ${line.slice(0, 2000)}`
            : null,
          rateLimited: failed && limited.test(line),
        };
    } catch {
      // Worker streams are retained verbatim; non-JSON progress is not an error.
    }
  }
  return null;
}

export function rateLimitDiagnostic(stdout, stderr, exitCode) {
  const outcome = terminalOutcome(stdout);
  if (outcome) return outcome.rateLimited ? outcome.diagnostic : null;
  if (exitCode !== 0 && limited.test(stderr))
    return `Backend stderr: ${stderr.trim().slice(-2000)}`;
  return null;
}

function inspectResult(job) {
  const diagnostics = [];
  let result;
  try {
    result = readStrictJson(join(job.directory, "result.json"));
  } catch (error) {
    diagnostics.push(`result.json cannot be read as JSON: ${error.message}`);
  }
  if (result) {
    if (!validateCandidate(result))
      diagnostics.push(
        ...validateCandidate.errors.map(
          (error) =>
            `result.json${error.instancePath || "/"}: ${error.message} ${JSON.stringify(error.params)}`,
        ),
      );
    if (result.sourcePartId !== job.id)
      diagnostics.push(
        "result.json sourcePartId does not match the queued job ID",
      );
    if (result.decision === "candidate") {
      try {
        const type = readStrictJson(join(job.directory, "type.json"));
        if (!type || typeof type !== "object" || Array.isArray(type))
          throw new Error("expected a JSON object");
      } catch (error) {
        diagnostics.push(`type.json is not usable: ${error.message}`);
      }
    }
  } else if (diagnostics.length === 0)
    diagnostics.push("result.json must contain an object");
  try {
    if (
      !new TextDecoder("utf-8", { fatal: true })
        .decode(readFileSync(join(job.directory, "research.md")))
        .trim()
    )
      throw new Error("file is empty");
  } catch (error) {
    diagnostics.push(`research.md is not usable: ${error.message}`);
  }
  return {
    usable: diagnostics.length === 0,
    decision: result?.decision ?? null,
    diagnostics,
    resultFile: join(job.directory, "result.json"),
  };
}

function archivePrevious(job, previousAttempt) {
  const present = artifactNames.filter((name) =>
    existsSync(join(job.directory, name)),
  );
  if (!present.length) return null;
  const destination = join(
    job.directory,
    "attempts",
    `${String(previousAttempt).padStart(4, "0")}-${randomUUID()}`,
  );
  mkdirSync(destination, { recursive: true });
  for (const name of present)
    renameSync(join(job.directory, name), join(destination, name));
  return destination;
}

function groupAlive(pid) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function runJob(job, record, options, save, control) {
  const archive = archivePrevious(job, record.attempts.length);
  if (archive && record.attempts.length)
    record.attempts.at(-1).archiveDirectory = archive;
  const attempt = {
    number: record.attempts.length + 1,
    state: "running",
    pid: null,
    startedAt: now(),
    endedAt: null,
    exitCode: null,
    signal: null,
    result: null,
    backendOutcome: null,
    diagnostics: [],
    stdoutFile: join(job.directory, "worker.stdout.jsonl"),
    stderrFile: join(job.directory, "worker.stderr.log"),
  };
  record.attempts.push(attempt);
  Object.assign(record, attempt);
  const update = (fields) => {
    Object.assign(attempt, fields);
    Object.assign(record, fields);
    save();
  };
  save();
  let child;
  let timedOut = false;
  let stopped = false;
  let killTimer;
  let timeout;
  const fds = [];
  const stop = (reason) => {
    if (reason === "timed-out") timedOut = true;
    else stopped = true;
    if (!child?.pid) return;
    signalGroup(child.pid, "SIGTERM");
    killTimer ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), 1500);
  };
  control.cancel = stop;
  try {
    fds.push(openSync(job.promptFile, "r"));
    fds.push(openSync(attempt.stdoutFile, "w", 0o600));
    fds.push(openSync(attempt.stderrFile, "w", 0o600));
    child = spawn(job.command[0], job.command.slice(1), {
      cwd: job.directory,
      shell: false,
      detached: process.platform !== "win32",
      stdio: fds,
    });
    const completion = new Promise((resolveCompletion) => {
      child.once("error", (error) =>
        resolveCompletion({ code: null, signal: null, error: error.message }),
      );
      child.once("close", (code, signal) =>
        resolveCompletion({ code, signal }),
      );
    });
    update({ pid: child.pid ?? null });
    for (const fd of fds.splice(0)) closeSync(fd);
    timeout = setTimeout(
      () => stop("timed-out"),
      options.timeoutMinutes * 60_000,
    );
    const outcome = await completion;
    clearTimeout(timeout);
    // A worker may have exited while leaving its own descendants behind.
    if (child.pid && groupAlive(child.pid)) {
      signalGroup(child.pid, "SIGTERM");
      await delay(1000);
      signalGroup(child.pid, "SIGKILL");
    }
    clearTimeout(killTimer);
    const result = inspectResult(job);
    const stdout = tail(attempt.stdoutFile);
    const backendOutcome = terminalOutcome(stdout);
    const rateLimit = rateLimitDiagnostic(
      stdout,
      tail(attempt.stderrFile),
      outcome.code,
    );
    let state;
    if (stopped) state = "interrupted";
    else if (timedOut) state = "timed-out";
    else if (rateLimit) state = "rate-limited";
    else if (
      outcome.error ||
      outcome.code !== 0 ||
      backendOutcome?.state === "failed" ||
      !result.usable
    )
      state = "failed";
    else
      state = result.decision === "candidate" ? "completed" : "needs-evidence";
    update({
      state,
      endedAt: now(),
      exitCode: outcome.code,
      signal: outcome.signal,
      result,
      backendOutcome,
      diagnostics: [
        ...(outcome.error ? [outcome.error] : []),
        ...(rateLimit ? [rateLimit] : []),
        ...(!rateLimit && backendOutcome?.diagnostic
          ? [backendOutcome.diagnostic]
          : []),
        ...result.diagnostics,
      ],
    });
    return { state, rateLimit };
  } catch (error) {
    if (child?.pid) {
      signalGroup(child.pid, "SIGTERM");
      await delay(1000);
      signalGroup(child.pid, "SIGKILL");
    }
    update({
      state: stopped ? "interrupted" : "failed",
      endedAt: now(),
      diagnostics: [error.message],
    });
    return { state: record.state, rateLimit: null };
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    for (const fd of fds) closeSync(fd);
    control.cancel = null;
  }
}

export async function runBatch(options) {
  const batch = realpathSync(options.batch);
  const { queue, integrity } = readQueue(batch);
  let limits = options.limitsFile
    ? readLimits(options.limitsFile)
    : { claude: options.claude, codex: options.codex };
  if (options.dryRun) {
    const plan = {
      dryRun: true,
      batch,
      concurrency: limits,
      ...(options.limitsFile ? { limitsFile: options.limitsFile } : {}),
      timeoutMinutes: options.timeoutMinutes,
      automaticRetries: 0,
      jobs: queue.jobs,
    };
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  const unlock = acquireLock(batch);
  const statusPath = join(batch, "status.json");
  let status;
  const active = new Map();
  let interrupted = false;
  let receivedSignal;
  let wakeScheduler;
  const save = () => {
    status.updatedAt = now();
    atomicJson(statusPath, status);
  };
  const onSignal = (signal) => {
    interrupted = true;
    receivedSignal = signal;
    for (const control of active.values()) control.cancel?.("interrupted");
    wakeScheduler?.();
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  try {
    if (existsSync(statusPath)) {
      if (!options.resume)
        throw new Error(
          "Batch status already exists; use --resume to explicitly rerun unfinished jobs",
        );
      status = JSON.parse(readFileSync(statusPath, "utf8"));
      if (
        status.format !== "thermite-component-batch-status/0.1" ||
        status.queueIntegrity !== integrity ||
        !Array.isArray(status.jobs)
      )
        throw new Error(
          "Existing status does not match this queue; use a new batch directory",
        );
      for (const record of status.jobs) {
        if (
          record.state === "running" &&
          (alive(record.pid) || (record.pid && groupAlive(record.pid)))
        )
          throw new Error(
            `Job ${record.id} still has a live process (PID ${record.pid}); resume refused`,
          );
      }
      if (
        status.jobs.length !== queue.jobs.length ||
        status.jobs.some(
          (record, index) =>
            record.id !== queue.jobs[index].id ||
            !Array.isArray(record.attempts),
        )
      )
        throw new Error("Existing status has an inconsistent job inventory");
      for (const record of status.jobs) {
        if (record.state === "running") {
          const fields = {
            state: "interrupted",
            endedAt: now(),
            diagnostics: [
              "Previous runner stopped before recording a final outcome",
            ],
          };
          Object.assign(record, fields);
          if (record.attempts.length)
            Object.assign(record.attempts.at(-1), fields);
        }
      }
    } else {
      status = {
        format: "thermite-component-batch-status/0.1",
        queueIntegrity: integrity,
        createdAt: now(),
        jobs: queue.jobs.map((job) => ({
          id: job.id,
          backend: job.backend,
          directory: job.directory,
          state: "queued",
          attempts: [],
        })),
      };
    }
    status.runner = {
      pid: process.pid,
      startedAt: now(),
      endedAt: null,
      state: "running",
    };
    status.concurrency = limits;
    status.limitsFile = options.limitsFile
      ? { path: options.limitsFile, updatedAt: now(), warning: null }
      : null;
    status.timeoutMinutes = options.timeoutMinutes;
    status.automaticRetries = 0;
    status.pausedBackends = {};
    const pending = queue.jobs.filter(
      (job, index) => !terminalSuccess.has(status.jobs[index].state),
    );
    for (const job of pending)
      status.jobs.find((record) => record.id === job.id).state = "queued";
    save();
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    const counts = { claude: 0, codex: 0 };
    const records = new Map(status.jobs.map((record) => [record.id, record]));
    while (pending.length || active.size) {
      if (options.limitsFile && !interrupted) {
        try {
          const next = readLimits(options.limitsFile);
          if (
            next.claude !== limits.claude ||
            next.codex !== limits.codex ||
            status.limitsFile.warning
          ) {
            limits = next;
            status.concurrency = limits;
            status.limitsFile.updatedAt = now();
            status.limitsFile.warning = null;
            save();
          }
        } catch (error) {
          const message = `Ignoring invalid limits file; retaining last valid limits: ${error.message}`;
          if (status.limitsFile.warning?.message !== message) {
            status.limitsFile.warning = { message, at: now() };
            process.stderr.write(`library-batch: ${message}\n`);
            save();
          }
        }
      }
      if (!interrupted) {
        for (let index = 0; index < pending.length;) {
          const job = pending[index];
          if (
            status.pausedBackends[job.backend] ||
            counts[job.backend] >= limits[job.backend]
          ) {
            index++;
            continue;
          }
          pending.splice(index, 1);
          counts[job.backend]++;
          const control = {};
          active.set(job.id, control);
          control.promise = runJob(
            job,
            records.get(job.id),
            options,
            save,
            control,
          )
            .then((outcome) => {
              if (outcome.rateLimit)
                status.pausedBackends[job.backend] = {
                  jobId: job.id,
                  pausedAt: now(),
                  diagnostic: outcome.rateLimit,
                };
              save();
            })
            .finally(() => {
              counts[job.backend]--;
              active.delete(job.id);
            });
        }
      }
      const awaitingLimits =
        options.limitsFile &&
        !interrupted &&
        pending.some((job) => !status.pausedBackends[job.backend]);
      if (!active.size && !awaitingLimits) break;
      let reloadTimer;
      try {
        await Promise.race([
          ...[...active.values()].map((control) => control.promise),
          new Promise((resolveWake) => {
            wakeScheduler = resolveWake;
            if (options.limitsFile) reloadTimer = setTimeout(resolveWake, 500);
          }),
        ]);
      } finally {
        clearTimeout(reloadTimer);
        wakeScheduler = null;
      }
    }
    status.runner.endedAt = now();
    status.runner.state = interrupted
      ? "interrupted"
      : Object.keys(status.pausedBackends).length || pending.length
        ? "paused"
        : "finished";
    if (receivedSignal) status.runner.signal = receivedSignal;
    save();
    process.stdout.write(
      `${JSON.stringify({ batch, statusFile: statusPath, state: status.runner.state, counts: status.jobs.reduce((counts, record) => ({ ...counts, [record.state]: (counts[record.state] ?? 0) + 1 }), {}) }, null, 2)}\n`,
    );
    return interrupted
      ? receivedSignal === "SIGINT"
        ? 130
        : 143
      : status.jobs.every((record) => terminalSuccess.has(record.state))
        ? 0
        : 1;
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    if (active.size) {
      for (const control of active.values()) control.cancel?.("interrupted");
      await Promise.allSettled(
        [...active.values()].map((control) => control.promise),
      );
    }
    unlock();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help)
      process.stdout.write(
        "Usage: node scripts/library-batch/run.mjs --batch <absolute directory> [--claude <count>] [--codex <count>] [--limits-file <absolute JSON path>] [--timeout-minutes <minutes>] [--dry-run] [--resume]\nDefaults: one process per backend, 25 minutes per job, no automatic retries.\nA limits file overrides process counts and reloads every 500ms; decreases drain existing workers. Invalid edits retain the last valid limits. Backend rate-limit pauses still require an explicit resume.\nCompleted means candidate output is ready for review; it never means accepted or integrated.\n",
      );
    else process.exitCode = await runBatch(options);
  } catch (error) {
    process.stderr.write(`library-batch: ${error.message}\n`);
    process.exitCode = 2;
  }
}
