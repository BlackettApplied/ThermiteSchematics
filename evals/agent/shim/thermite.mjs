#!/usr/bin/env bun
// Port of GI's shim. Audit failures go out of band, never onto CLI streams.
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  ftruncateSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, diff } from "./eval-snapshot.mjs";
import { bunConfig, fileState, sealEntry } from "./eval-audit.mjs";
import { secretValues, redactSecrets } from "./eval-auth.mjs";
import { projectReader } from "./eval-capture-files.mjs";
import { captureSuffixes, openAuditFile } from "./eval-audit-files.mjs";
const real = fileURLToPath(new URL("./thermite.real.mjs", import.meta.url)),
  runtime = dirname(real);
const project = process.env.THERMITE_EVAL_PROJECT,
  log = process.env.THERMITE_EVAL_LOG,
  marker =
    process.env.THERMITE_EVAL_ERRORS ??
    join(dirname(log ?? project ?? runtime), "shim-errors.jsonl");
let audit;
function auditWrite(path, data, append) {
  const fd = openAuditFile(
    audit,
    path,
    constants.O_WRONLY | (append ? constants.O_APPEND : 0),
  );
  try {
    if (!append) ftruncateSync(fd, 0);
    writeFileSync(fd, data);
  } finally {
    closeSync(fd);
  }
}
function auditFailure(stage, error) {
  try {
    auditWrite(
      marker,
      JSON.stringify({
        kind: "shim-error",
        stage,
        code: error?.code ?? "AUDIT",
        time: Date.now(),
      }) + "\n",
      true,
    );
  } catch {
    /* Runner also detects missing/truncated audit. */
  }
}
const queuedAt = Date.now();
try {
  audit = projectReader(
    dirname(log ?? marker),
    JSON.parse(process.env.THERMITE_EVAL_AUDIT_ROOT),
  );
  if (!project || !log) {
    auditFailure("configuration", { code: "MISSING_AUDIT_ENV" });
    process.exit(2);
  }
  while (!audit.tryLock()) {
    if (Date.now() - queuedAt > 120000) {
      auditFailure("lock-timeout", { code: "EAGAIN" });
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
} catch (error) {
  auditFailure("lock", error);
  process.exit(2);
}
const argv = process.argv.slice(2),
  i = argv.indexOf("--input"),
  inputArg =
    i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith("--input="))?.slice(8);
let stdin = null,
  request = null,
  previous = null,
  before = null,
  runtimeBefore = null;
try {
  if (inputArg === "-") {
    stdin = readFileSync(0);
    request = stdin.toString("utf8");
  } else if (inputArg) {
    try {
      request = readFileSync(resolve(inputArg), "utf8");
    } catch {}
  }
} catch (error) {
  auditFailure("stdin", error);
}
const started = Date.now();
const values = secretValues(process.env);
try {
  const state = audit.read(basename(log) + ".state.json");
  if (state.length) previous = JSON.parse(state);
  if (project)
    before = fileState(
      project,
      real,
      process.env,
      previous?.snapshot ?? previous,
    );
  runtimeBefore = snapshot(runtime, { documents: false }).hash;
} catch (error) {
  auditFailure("before-snapshot", error);
}
let stdoutBytes = 0,
  stderrBytes = 0,
  closedStdout = false,
  closedStderr = false;
const stdout = [],
  stderr = [];
let child,
  receivedSignal = null;
const capture = basename(log) + ".capture",
  captureFiles = captureSuffixes.map((suffix) => capture + suffix);
const captureDescriptors = [];
try {
  for (const path of captureFiles) {
    const fd = openAuditFile(audit, path);
    captureDescriptors.push(fd);
    ftruncateSync(fd, 0);
  }
} catch (error) {
  auditFailure("observation", error);
  for (const fd of captureDescriptors.splice(0)) closeSync(fd);
}
const handlers = new Map();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () => {
    receivedSignal = signal;
    child?.kill(signal);
  };
  handlers.set(signal, handler);
  process.on(signal, handler);
}
let result;
const commandStarted = Date.now();
try {
  child = spawn(
    process.execPath,
    [
      ...bunConfig(),
      ...(captureDescriptors.length
        ? ["--preload", join(runtime, "eval-observe.mjs")]
        : []),
      real,
      ...argv,
    ],
    {
      stdio: [
        stdin === null ? "inherit" : "pipe",
        "inherit",
        "inherit",
        ...captureDescriptors,
      ],
      env: process.env,
    },
  );
  if (stdin !== null) {
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  }
  result = await new Promise((res) => {
    child.on("error", (error) => res({ status: 2, error }));
    child.on("close", (status, signal) => res({ status, signal }));
  });
} catch (error) {
  result = { status: 2, error };
} finally {
  for (const fd of captureDescriptors) closeSync(fd);
}
const commandEnded = Date.now();
if (captureDescriptors.length)
  try {
    const [out, err, countBytes] = captureFiles.map((path) => audit.read(path));
    const counts = JSON.parse(countBytes);
    stdout.push(out);
    stderr.push(err);
    stdoutBytes = counts.stdout;
    stderrBytes = counts.stderr;
    closedStdout = /EPIPE/.test(err.toString());
  } catch (error) {
    auditFailure("observation", error);
  }

try {
  const rawErr = Buffer.concat(stderr).toString("utf8"),
    rawOut = Buffer.concat(stdout).toString("utf8");
  let report = null,
    diagnostics = [];
  try {
    report = JSON.parse(rawErr);
    diagnostics = report?.diagnostics ?? [];
  } catch {}
  if (argv[0] === "validate")
    try {
      const parsed = JSON.parse(rawOut);
      if (Array.isArray(parsed)) diagnostics = parsed;
    } catch {}
  const after = snapshot(project);
  if (
    before &&
    Object.entries(after.files)
      .filter(([p]) => p.endsWith(".json"))
      .every(([p, h]) => before.files[p] === h) &&
    Object.keys(before.files)
      .filter((p) => p.endsWith(".json"))
      .every((p) => p in after.files)
  ) {
    after.schemaInvalidFiles = before.schemaInvalidFiles;
    after.invalidJsonFiles = before.invalidJsonFiles;
  } else {
    const validated = fileState(project, real, process.env, before);
    after.schemaInvalidFiles = validated.schemaInvalidFiles;
    after.invalidJsonFiles = validated.invalidJsonFiles;
  }
  let patchFiles = null;
  try {
    patchFiles = JSON.parse(rawOut)?.value?.files ?? null;
  } catch {}
  const sanitize = (value) =>
    JSON.parse(redactSecrets(JSON.stringify(value), values));
  const entry = sealEntry(
    sanitize({
      queuedAt,
      started,
      commandStarted,
      commandEnded,
      ended: Date.now(),
      phase: process.env.THERMITE_EVAL_PHASE ?? "agent",
      argv,
      request,
      stdinBase64: stdin
        ? redactSecrets(stdin.toString("utf8"), values) ===
          stdin.toString("utf8")
          ? stdin.toString("base64")
          : Buffer.from(redactSecrets(stdin.toString("utf8"), values)).toString(
              "base64",
            )
        : null,
      exit: result.status,
      signal: result.signal ?? receivedSignal,
      errorCode:
        report?.error?.code ??
        diagnostics.find((d) => d.severity === "error")?.code ??
        (result.status !== 0
          ? (/\b([AEQRT]\d{3})\b/.exec(rawErr + "\n" + rawOut)?.[1] ?? null)
          : null),
      spawnError: result.error?.code ?? null,
      stdoutBytes,
      stderrBytes,
      closedStdout,
      closedStderr,
      diagnostics,
      report,
      patchFiles,
      before,
      after,
      runtimeBefore,
      runtimeAfter: snapshot(runtime, { documents: false }).hash,
      directEditsSincePrevious: previous
        ? diff(previous.snapshot ?? previous, before)
        : [],
      editsByThisCall: diff(before, after),
    }),
    previous?.lastHash ?? null,
  );
  auditWrite(log, JSON.stringify(entry) + "\n", true);
  auditWrite(
    log + ".state.json",
    JSON.stringify({ snapshot: sanitize(after), lastHash: entry.entryHash }),
  );
} catch (error) {
  auditFailure("logging", error);
} finally {
  audit.close();
  for (const [signal, handler] of handlers)
    process.removeListener(signal, handler);
}
if (result.signal ?? receivedSignal)
  process.kill(process.pid, result.signal ?? receivedSignal);
else process.exitCode = result.status ?? 2;
