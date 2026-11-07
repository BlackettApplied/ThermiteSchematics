#!/usr/bin/env bun
// Port of GI's shim. Audit failures go out of band, never onto CLI streams.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  writeSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, diff } from "./eval-snapshot.mjs";
import { fileState, sealEntry } from "./eval-audit.mjs";
import { secretValues, redactSecrets } from "./eval-auth.mjs";
const real = fileURLToPath(new URL("./thermite.real.mjs", import.meta.url)),
  runtime = dirname(real);
const project = process.env.THERMITE_EVAL_PROJECT,
  log = process.env.THERMITE_EVAL_LOG;
const marker =
  process.env.THERMITE_EVAL_ERRORS ??
  join(dirname(project ?? runtime), "shim-errors.jsonl");
function auditFailure(stage, error) {
  try {
    appendFileSync(
      marker,
      JSON.stringify({
        kind: "shim-error",
        stage,
        code: error?.code ?? "AUDIT",
        time: Date.now(),
      }) + "\n",
    );
  } catch {
    /* Runner also detects missing/truncated audit. */
  }
}
const queuedAt = Date.now();
let lockOwned = false;
if (project && log) {
  while (!lockOwned) {
    try {
      const fd = openSync(log + ".lock", "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      closeSync(fd);
      lockOwned = true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        auditFailure("lock", error);
        break;
      }
      try {
        const owner = JSON.parse(readFileSync(log + ".lock", "utf8"));
        try {
          process.kill(owner.pid, 0);
        } catch (dead) {
          if (dead.code === "ESRCH") {
            let reaper;
            try {
              reaper = openSync(log + ".reaper", "wx");
              const current = JSON.parse(readFileSync(log + ".lock", "utf8"));
              try {
                process.kill(current.pid, 0);
              } catch (check) {
                if (check.code === "ESRCH") unlinkSync(log + ".lock");
              }
            } catch {
            } finally {
              if (reaper !== undefined) {
                closeSync(reaper);
                try {
                  unlinkSync(log + ".reaper");
                } catch {}
              }
            }
            continue;
          }
        }
      } catch {}
      if (Date.now() - queuedAt > 120000) {
        auditFailure("lock-timeout", error);
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
} else auditFailure("configuration", { code: "MISSING_AUDIT_ENV" });
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
try {
  if (log && existsSync(log + ".state.json"))
    previous = JSON.parse(readFileSync(log + ".state.json", "utf8"));
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
const capture = join(dirname(marker), `.capture-${process.pid}`);
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
try {
  child = spawn(
    process.execPath,
    ["--preload", join(runtime, "eval-observe.mjs"), real, ...argv],
    {
      stdio: [stdin === null ? "inherit" : "pipe", "inherit", "inherit"],
      env: { ...process.env, THERMITE_EVAL_CAPTURE: capture },
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
}
const commandEnded = Date.now();
try {
  const out = readFileSync(capture + ".out"),
    err = readFileSync(capture + ".err");
  stdout.push(out);
  stderr.push(err);
  const counts = JSON.parse(readFileSync(capture + ".counts", "utf8"));
  stdoutBytes = counts.stdout;
  stderrBytes = counts.stderr;
  closedStdout = /EPIPE/.test(err.toString());
} catch (error) {
  auditFailure("observation", error);
} finally {
  for (const ext of [".out", ".err", ".counts"])
    try {
      rmSync(capture + ext, { force: true });
    } catch {}
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
  const values = secretValues(process.env);
  const sanitize = (value) =>
    JSON.parse(redactSecrets(JSON.stringify(value), values));
  const entry = sealEntry(
    sanitize({
      queuedAt,
      started,
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
  appendFileSync(log, JSON.stringify(entry) + "\n");
  writeFileSync(
    log + ".state.json",
    JSON.stringify({ snapshot: sanitize(after), lastHash: entry.entryHash }),
  );
} catch (error) {
  auditFailure("logging", error);
} finally {
  if (lockOwned)
    try {
      if (JSON.parse(readFileSync(log + ".lock", "utf8")).pid === process.pid)
        unlinkSync(log + ".lock");
    } catch (error) {
      auditFailure("unlock", error);
    }
  for (const [signal, handler] of handlers)
    process.removeListener(signal, handler);
}
if (result.signal ?? receivedSignal)
  process.kill(process.pid, result.signal ?? receivedSignal);
else process.exitCode = result.status ?? 2;
