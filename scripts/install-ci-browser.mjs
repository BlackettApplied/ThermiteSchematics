import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const CLI = "node_modules/playwright-core/cli.js";
const ARGS = [CLI, "install", "--with-deps", "--no-shell", "chromium"];
const APT_FILE = "/etc/apt/apt.conf.d/99thermite-timeouts";
// DPkg::Lock::Timeout lets a retry wait for a just-killed apt/dpkg process to
// release its lock instead of failing immediately (#562 review).
const APT_CONF =
  'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\nDPkg::Lock::Timeout "120";\n';
const SOURCES = [
  "/etc/apt/sources.list.d/ubuntu.sources",
  "/etc/apt/sources.list",
];
const REWRITE =
  "s#(https?)://[a-z0-9.-]+\\.archive\\.ubuntu\\.com/ubuntu#\\1://archive.ubuntu.com/ubuntu#g";
const APT_LOCKS = [
  "/var/lib/dpkg/lock-frontend",
  "/var/lib/dpkg/lock",
  "/var/cache/apt/archives/lock",
  "/var/lib/apt/lists/lock",
];
export const PROBE_GRACE_MS = 2_000;
// Worst case: 3 * (240s + 30s) + (5s + 10s) + 2 * (120s + 2s) = 1069s
// < 1200s (20 min).
export const INSTALL_BUDGET = Object.freeze({
  stepTimeoutSeconds: 20 * 60,
  attempts: 3,
  attemptTimeoutSeconds: 240,
  killAfterSeconds: 30,
  backoffBaseSeconds: 5,
  lockWaitSeconds: 120,
  lockPollSeconds: 5,
});

export function worstCaseSeconds(b = INSTALL_BUDGET) {
  const retries = b.attempts - 1;
  const backoff = (b.backoffBaseSeconds * b.attempts * retries) / 2;
  const lockWait =
    b.lockWaitSeconds > 0
      ? retries * (b.lockWaitSeconds + PROBE_GRACE_MS / 1_000)
      : 0;
  return (
    b.attempts * (b.attemptTimeoutSeconds + b.killAfterSeconds) +
    backoff +
    lockWait
  );
}

const fmt = (r) => (r.error ? r.error.message : `exit ${r.status ?? r.signal}`);
const stderrText = (r) =>
  typeof r.stderr === "string"
    ? r.stderr.trim()
    : Buffer.isBuffer(r.stderr)
      ? r.stderr.toString("utf8").trim()
      : "";
const probeSeconds = (ms) =>
  `${(ms / 1_000).toFixed(3).replace(/\.?0+$/, "")}s`;
const probeFailure = (r, err) => {
  const base = r.error
    ? r.error.message
    : r.signal
      ? `signal ${r.signal}`
      : r.status === 124 || r.status === 137
        ? `timed out (exit ${r.status})`
        : `exit ${r.status}`;
  return err ? `${base}: ${err}` : base;
};
// Enforce the deadline inside sudo so SIGKILL reaches the elevated fuser child;
// keep an outer SIGKILL backstop in case sudo itself hangs.
const runLockProbe = (run, locks, remaining) =>
  run(
    "sudo",
    [
      "-n",
      "timeout",
      "--signal=KILL",
      probeSeconds(remaining),
      "fuser",
      "-s",
      ...locks,
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
      timeout: remaining + PROBE_GRACE_MS,
      killSignal: "SIGKILL",
    },
  );

async function waitForAptLocks(run, pause, hasFile, log, now, b) {
  const locks = APT_LOCKS.filter((f) => hasFile(f));
  if (!locks.length) return;
  const start = now();
  const deadline = start + b.lockWaitSeconds * 1_000;
  const elapsed = () => Math.round((now() - start) / 1_000);
  let sawInUse = false;
  while (true) {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) {
      if (sawInUse)
        log(
          `Warning: apt/dpkg lock files still in use after ${elapsed()}s; proceeding with retry.`,
        );
      return;
    }
    const res = runLockProbe(run, locks, remaining);
    const err = stderrText(res);
    if (
      res.error ||
      res.signal ||
      (res.status !== 0 && res.status !== 1) ||
      (res.status === 1 && err)
    ) {
      log(
        `Warning: apt/dpkg lock file check failed (${probeFailure(res, err)}); continuing.`,
      );
      return;
    }
    if (res.status === 1) {
      if (sawInUse)
        log(`apt/dpkg lock files no longer in use after ${elapsed()}s.`);
      return;
    }
    if (!sawInUse) {
      sawInUse = true;
      log(
        `apt/dpkg lock files in use; waiting up to ${b.lockWaitSeconds}s for them to clear...`,
      );
    }
    const left = Math.floor(deadline - now());
    if (left <= 0) {
      log(
        `Warning: apt/dpkg lock files still in use after ${elapsed()}s; proceeding with retry.`,
      );
      return;
    }
    await pause(Math.min(b.lockPollSeconds * 1_000, left));
  }
}

export async function installCiBrowser(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const execPath = opts.execPath ?? process.execPath;
  const run = opts.run ?? spawnSync;
  const pause = opts.pause ?? delay;
  const hasFile = opts.hasFile ?? existsSync;
  const log = opts.log ?? ((msg) => process.stderr.write(`${msg}\n`));
  const now = opts.now ?? (() => performance.now());
  const b = INSTALL_BUDGET;
  const linux = platform === "linux";
  const inherit = { stdio: "inherit" };
  if (linux) {
    const io = { input: APT_CONF, stdio: ["pipe", "ignore", "inherit"] };
    const cfg = run("sudo", ["tee", APT_FILE], io);
    if (cfg.error || cfg.status !== 0)
      log(`Warning: apt timeout config failed (${fmt(cfg)}); continuing.`);
  }
  const cmd = linux ? "timeout" : execPath;
  const kill = `--kill-after=${b.killAfterSeconds}s`;
  const dur = `${b.attemptTimeoutSeconds}s`;
  const args = linux ? [kill, dur, execPath, ...ARGS] : ARGS;
  let last = "unknown error";
  for (let i = 1; i <= b.attempts; i++) {
    const res = run(cmd, args, inherit);
    if (!res.error && res.status === 0) return;
    last = fmt(res);
    log(`Browser install attempt ${i}/${b.attempts} failed: ${last}`);
    if (i < b.attempts) {
      if (linux && i === 1)
        for (const f of SOURCES)
          if (hasFile(f)) run("sudo", ["sed", "-i", "-E", REWRITE, f], inherit);
      await pause(b.backoffBaseSeconds * i * 1_000);
      if (linux) await waitForAptLocks(run, pause, hasFile, log, now, b);
    }
  }
  throw new Error(
    `Pinned Chromium install failed after ${b.attempts} attempts: ${last}`,
  );
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await installCiBrowser().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}
