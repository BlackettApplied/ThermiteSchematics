import { setTimeout as delay } from "node:timers/promises";

export function groupAlive(
  pid,
  {
    owned = false,
    kill = process.kill,
    platform = process.platform,
    notes,
  } = {},
) {
  if (!pid) return false;
  try {
    kill(platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM" && platform !== "win32" && owned) {
      // macOS reports EPERM for a group containing only zombies. Only relax
      // the probe for our own groups, and retain a denied leader as alive.
      try {
        kill(pid, 0);
        notes?.push(
          `Owned process group ${pid}: probe returned EPERM; leader probe succeeded; treating group as finished`,
        );
        return false;
      } catch (leaderError) {
        if (leaderError.code === "ESRCH")
          notes?.push(
            `Owned process group ${pid}: probe returned EPERM; leader probe returned ESRCH; treating group as finished`,
          );
        return leaderError.code !== "ESRCH";
      }
    }
    return true;
  }
}

export function signalGroup(
  pid,
  signal,
  {
    owned = false,
    kill = process.kill,
    platform = process.platform,
    notes,
  } = {},
) {
  if (!pid) return;
  try {
    kill(platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    if (error.code === "ESRCH") return;
    if (error.code !== "EPERM" || platform === "win32" || !owned) throw error;
    // The caller must have spawned this detached group. A zombie leader can
    // still be signalled directly; an already reaped leader returns ESRCH.
    try {
      kill(pid, signal);
    } catch (leaderError) {
      if (leaderError.code !== "ESRCH") throw leaderError;
      notes?.push(
        `Owned process group ${pid}: ${signal} returned EPERM; leader signal returned ESRCH; group cleanup may leave unsignalable descendants`,
      );
    }
  }
}

// Construct only for children spawned by this runner, never persisted PIDs.
export function createChildProcessGroup(pid, dependencies = {}) {
  const notes = [];
  const options = { ...dependencies, owned: true, notes };
  const errors = [];
  let killTimer;
  let rejectFailure;
  const failure = new Promise((resolve, reject) => {
    rejectFailure = reject;
  });
  // Setup can fail before runJob awaits failure. Cleanup errors are also kept
  // in errors so they still reach the job's diagnostics in that case.
  failure.catch(() => {});
  const signal = (value) => {
    try {
      signalGroup(pid, value, options);
    } catch (error) {
      // Signal handlers and escalation timers must report through runJob's
      // awaited error path, including errors during the final drain.
      errors.push(error);
      rejectFailure(error);
    }
  };
  const terminate = async () => {
    if (!pid) return;
    signal("SIGTERM");
    await delay(1000);
    signal("SIGKILL");
  };
  return {
    errors,
    notes,
    failure,
    stop() {
      if (!pid) return;
      signal("SIGTERM");
      killTimer ??= setTimeout(() => signal("SIGKILL"), 1500);
    },
    async drain() {
      if (groupAlive(pid, options)) await terminate();
    },
    terminate,
    clear() {
      clearTimeout(killTimer);
    },
  };
}
