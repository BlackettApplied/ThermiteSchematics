import { spawn } from "node:child_process";

const activeOwners = new Set();
export const closeExampleProcesses = () =>
  Promise.all([...activeOwners].map((owner) => owner.close()));

// A group belongs to one fixture. Teardown awaits its children before the
// fixture can remove files, including when a test has already timed out.
export class ProcessOwner {
  children = new Set();
  closing;
  constructor({ timeoutMs = 30000, interruptGraceMs = 1000 } = {}) {
    activeOwners.add(this);
    this.timeoutMs = timeoutMs;
    this.interruptGraceMs = interruptGraceMs;
  }
  async run(args, cwd, env = process.env, options = {}) {
    if (this.closing) throw new Error("Example process owner is closed");
    const { timeoutMs = this.timeoutMs, label = args[0] } = options;
    const handle = start(args, cwd, env, options, this.interruptGraceMs);
    this.children.add(handle);
    const timer = setTimeout(() => {
      handle.error = new Error(
        `Example child exceeded ${timeoutMs} ms deadline: ${label}`,
      );
      handle.error.childPid = handle.child.pid;
      void handle.kill();
    }, timeoutMs);
    try {
      const result = await handle.closed;
      if (handle.error) throw handle.error;
      return {
        ...result,
        stdout: handle.stdout,
        stderr: handle.stderr,
        interrupted: handle.interrupted,
      };
    } finally {
      clearTimeout(timer);
      clearTimeout(handle.escalation);
      await handle.kill();
      this.children.delete(handle);
    }
  }
  close() {
    this.closing ??= Promise.all(
      [...this.children].map((handle) => {
        handle.error ??= new Error("Example execution canceled during cleanup");
        return handle.kill();
      }),
    );
    return this.closing.finally(() => activeOwners.delete(this));
  }
}
function start(args, cwd, env, options, interruptGraceMs) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle = { child, stdout: "", stderr: "", interrupted: false };
  handle.closed = new Promise((resolveRun) => {
    child.once("error", (error) => {
      handle.error = error;
    });
    child.once("close", (code, signal) => resolveRun({ code, signal }));
  });
  handle.kill = () => (handle.stopping ??= killGroup(child, handle.closed));
  const interrupt = () => {
    if (handle.interrupted) return;
    handle.interrupted = true;
    child.kill("SIGINT");
    handle.escalation = setTimeout(() => {
      void handle.kill();
    }, interruptGraceMs);
  };
  const collect = (stream) => (chunk) => {
    const text = chunk.toString();
    handle[stream] += text;
    if (options.forward) process[stream].write(text);
    try {
      options.onOutput?.(text, interrupt);
    } catch (error) {
      handle.error = error;
      void handle.kill();
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", collect("stdout"));
  child.stderr.on("data", collect("stderr"));
  child.stdin.on("error", () => {}); // Child may exit before observing EOF.
  child.stdin.end();
  return handle;
}
async function killGroup(child, closed) {
  if (child.pid) {
    if (process.platform === "win32") {
      if (child.exitCode === null && child.signalCode === null)
        await killWindowsTree(child.pid);
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  await closed;
}
async function killWindowsTree(pid) {
  await new Promise((resolveKill) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    const timer = setTimeout(() => killer.kill("SIGKILL"), 3000);
    killer.once("error", () => {}); // Direct SIGKILL remains the fallback.
    killer.once("close", () => {
      clearTimeout(timer);
      resolveKill();
    });
  });
}
