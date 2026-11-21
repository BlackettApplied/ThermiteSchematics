import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { PerfFailure } from "./errors.mjs";

export const git = (directory, ...args) =>
  execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();

function stop(child) {
  try {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* Already closed. */
    }
  }
}
export function cleanupResource(resource, root, runGit = git, remove = rmSync) {
  const failures = [];
  if (!resource.temporary) return failures;
  try {
    // Also try when add failed partway through creating its admin entry.
    runGit(root, "worktree", "remove", "--force", resource.basePath);
  } catch (error) {
    failures.push(error.message);
  } finally {
    try {
      remove(resource.temporary, {
        recursive: true,
        force: true,
        maxRetries: 5,
      });
    } catch (error) {
      failures.push(error.message);
    } finally {
      try {
        runGit(root, "worktree", "prune", "--expire=now");
      } catch (error) {
        failures.push(error.message);
      }
    }
  }
  return failures;
}
export function lifecycle(root) {
  const resource = {},
    children = new Set();
  let cleaned = false;
  const track = (child) => {
    children.add(child);
    child.once("close", () => children.delete(child));
  };
  const cleanup = () => {
    if (cleaned) return [];
    cleaned = true;
    for (const child of children) stop(child);
    return cleanupResource(resource, root);
  };
  const handlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [
      signal,
      () => {
        for (const error of cleanup()) console.error(`Perf cleanup: ${error}`);
        process.exit(signal === "SIGINT" ? 130 : 143);
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return {
    resource,
    track,
    cleanup,
    dispose: () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    },
  };
}
export async function command(directory, args, owner) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: directory,
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    });
    owner.track(child);
    let stderr = "";
    const timer = setTimeout(() => {
      stop(child);
      reject(new PerfFailure(`Timed out: bun ${args.join(" ")}`));
    }, 120000);
    child.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-8000);
      process.stderr.write(data);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}
