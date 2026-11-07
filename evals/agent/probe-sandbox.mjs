#!/usr/bin/env bun
// Optional non-model Codex sandbox reproduction; never executes codex exec.
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  cpSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { installShim } from "./run.mjs";
import { freshEnvironment, assertIsolation } from "./launch.mjs";
import { sha256 } from "./snapshot.mjs";
import { write } from "./task-support.mjs";
const { values } = parseArgs({
  options: {
    runtime: { type: "string" },
    output: { type: "string", default: "evals/out/agent/sandbox-proof.json" },
  },
});
if (!values.runtime)
  throw new Error("Use --runtime <unshimmed runtime or built source copy>");
const work = realpathSync(
  mkdtempSync(
    process.platform === "win32"
      ? join(process.env.TEMP, "thermite-sandbox-")
      : "/tmp/thermite-sandbox-",
  ),
);
try {
  const runtime = join(work, "runtime"),
    project = join(work, "project");
  cpSync(resolve(values.runtime), runtime, {
    recursive: true,
    dereference: true,
  });
  installShim(runtime);
  const roots = execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9));
  const env = {
    ...freshEnvironment(join(work, "isolated"), process.env, {
      engineRoots: roots,
    }),
    THERMITE_EVAL_PROJECT: project,
    THERMITE_EVAL_LOG: join(work, "shim.jsonl"),
    THERMITE_EVAL_ERRORS: join(work, "shim-errors.jsonl"),
  };
  const initialized = spawnSync(
    "bun",
    [join(runtime, "thermite.real.mjs"), "init", project],
    { cwd: work, env, encoding: "utf8" },
  );
  if (initialized.status !== 0) throw new Error("Probe project init failed");
  assertIsolation(project, env);
  const command = (entry) => [
    "sandbox",
    "-P",
    ":workspace",
    "--",
    "bun",
    entry,
    "validate",
    ".",
  ];
  const run = (entry, custom = env) =>
    spawnSync("codex", command(entry), {
      cwd: project,
      env: custom,
      encoding: "utf8",
      timeout: 30000,
    });
  const direct = run(join(runtime, "thermite.real.mjs")),
    inside = run(join(runtime, "thermite.mjs"));
  const outsidePath =
    process.platform === "darwin"
      ? `/System/thermite-audit-${process.pid}`
      : `/proc/thermite-audit-${process.pid}`;
  const outside = run(join(runtime, "thermite.mjs"), {
    ...env,
    THERMITE_EVAL_LOG: outsidePath,
  });
  const summary = (r) => ({
    exit: r.status,
    stdoutSha256: sha256(r.stdout ?? ""),
    stderrSha256: sha256(r.stderr ?? ""),
    error: r.error?.code ?? null,
  });
  const errors = existsSync(env.THERMITE_EVAL_ERRORS)
    ? readFileSync(env.THERMITE_EVAL_ERRORS, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  const same = (r) =>
    r.status === direct.status &&
    r.stdout === direct.stdout &&
    r.stderr === direct.stderr;
  const result = {
    format: "thermite-sandbox-proof/1.0",
    modelCalls: 0,
    direct: summary(direct),
    inside: summary(inside),
    outside: summary(outside),
    insideLogWritten: existsSync(env.THERMITE_EVAL_LOG),
    loggingErrors: errors,
    environmentLeaksCheckout: roots.some((root) =>
      Object.entries(env)
        .filter(([key]) => !/KEY|TOKEN/.test(key))
        .some(([, v]) => v.includes(root)),
    ),
    pass:
      direct.status === 0 && same(inside) && same(outside) && errors.length > 0,
  };
  write(resolve(values.output), result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
