import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(
      `${command} ${args.join(" ")} exited ${result.status ?? result.signal}`,
    );
    error.exitCode = result.status ?? 1;
    throw error;
  }
}
function warning(warn, message) {
  // Logging must not replace a check failure either (for example a closed pipe).
  try {
    warn(`Worktree cleanup warning: ${message}`);
  } catch {}
}
async function cleanup(
  temporary,
  checkout,
  attached,
  { run, remove, pause, warn },
) {
  let failure;
  if (attached) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        run("git", ["worktree", "remove", "--force", checkout]);
        failure = undefined;
        break;
      } catch (error) {
        failure = error;
        if (attempt < 2) await pause(200 * (attempt + 1));
      }
    }
    if (failure) warning(warn, failure.message ?? String(failure));
  }
  try {
    remove(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  } catch (error) {
    warning(warn, error.message ?? String(error));
  }
  if (failure) {
    try {
      // Retry only our registration after releasing its filesystem handles.
      // Repo-wide prune could remove another worktree's stale registration.
      run("git", ["worktree", "remove", "--force", checkout]);
    } catch (error) {
      warning(warn, error.message ?? String(error));
    }
  }
}

// Checks committed HEAD, not local modifications. The injected operations let
// tests exercise busy handles and cleanup failures without changing a checkout.
export async function checkWorktree({
  makeTemporary = () =>
    mkdtempSync(join(realpathSync.native(tmpdir()), "thermite-worktree-")),
  run = runCommand,
  remove = rmSync,
  pause = delay,
  warn = console.warn,
} = {}) {
  const temporary = makeTemporary(),
    checkout = join(temporary, "linked checkout");
  let attached = false;
  try {
    run("git", ["worktree", "add", "--detach", checkout, "HEAD"]);
    attached = true;
    run(process.execPath, ["install", "--frozen-lockfile"], checkout);
    run(process.execPath, ["run", "check"], checkout);
  } finally {
    try {
      await cleanup(temporary, checkout, attached, {
        run,
        remove,
        pause,
        warn,
      });
    } catch (error) {
      warning(warn, error.message ?? String(error));
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await checkWorktree();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
