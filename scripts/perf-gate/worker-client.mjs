import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { correctnessFailure, PerfFailure } from "./errors.mjs";

function spawnWorker(engine, owner) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("worker.mjs", import.meta.url)), engine],
    {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  owner?.track(child);
  return child;
}
export function startWorker(engine, side, owner) {
  const child = spawnWorker(engine, owner);
  let pending,
    stderr = "",
    failure;
  const reject = (error) => {
    failure = error;
    pending?.reject(error);
    pending = undefined;
  };
  child.on("error", reject);
  child.stdin.on("error", reject);
  child.on("exit", (code, signal) =>
    reject(
      new PerfFailure(
        `${side} perf worker exited ${signal ?? code}: ${stderr}`,
      ),
    ),
  );
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const value = JSON.parse(line);
      if (value.error)
        throw value.kind === "correctness"
          ? correctnessFailure(side, value.error)
          : new PerfFailure(value.error);
      assert(pending, "Unsolicited perf worker output");
      const recipient = pending;
      pending = undefined;
      recipient.resolve(value);
    } catch (error) {
      reject(error);
    }
  });
  async function receive(request) {
    if (failure) throw failure;
    assert(!pending, "Concurrent requests to one perf worker");
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending = { resolve, reject };
        timer = setTimeout(
          () => reject(new PerfFailure(`${side} perf worker timeout`)),
          120000,
        );
        if (request) child.stdin.write(`${JSON.stringify(request)}\n`);
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const ready = receive();
  // Readiness can fail before the first sample is requested.
  ready.catch(() => {});
  return {
    sample: async (request) => {
      assert((await ready).ready);
      return receive(request);
    },
    close: () => child.kill(),
  };
}
