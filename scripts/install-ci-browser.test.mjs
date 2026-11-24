import { describe, expect, it } from "vitest";
import {
  INSTALL_BUDGET,
  PROBE_GRACE_MS,
  installCiBrowser,
  worstCaseSeconds,
} from "./install-ci-browser.mjs";

const isLockProbe = (command, args) =>
  command === "sudo" && args[1] === "timeout" && args[4] === "fuser";

describe("CI browser installer", () => {
  it("keeps worst-case retries, kill-after, backoff, and lock waits (with probe grace) inside the 20-minute step timeout", () => {
    const worst = worstCaseSeconds(INSTALL_BUDGET);
    expect(worst).toBe(1069);
    expect(worst).toBeLessThan(INSTALL_BUDGET.stepTimeoutSeconds);
    expect(INSTALL_BUDGET.stepTimeoutSeconds - worst).toBeGreaterThanOrEqual(
      60,
    );
  });

  it("configures apt timeouts, wraps Linux installs with GNU timeout, and rewrites mirrors after attempt 1", async () => {
    const calls = [];
    const logs = [];
    const waits = [];
    let installs = 0;
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => file === "/etc/apt/sources.list.d/ubuntu.sources",
      run: (command, args, options) => {
        calls.push({ command, args, options });
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(calls[0].command).toBe("sudo");
    expect(calls[0].args).toEqual([
      "tee",
      "/etc/apt/apt.conf.d/99thermite-timeouts",
    ]);
    expect(calls[0].options.input).toContain('Acquire::http::Timeout "30";');
    expect(calls[0].options.input).toContain('Acquire::https::Timeout "30";');
    expect(calls[0].options.input).toContain('Acquire::Retries "3";');
    expect(calls[0].options.input).toContain('DPkg::Lock::Timeout "120";');

    const timeoutCall = calls.find((call) => call.command === "timeout");
    expect(timeoutCall.args).toEqual([
      "--kill-after=30s",
      "240s",
      "bun",
      "node_modules/playwright-core/cli.js",
      "install",
      "--with-deps",
      "--no-shell",
      "chromium",
    ]);

    const sedCall = calls.find(
      (call) => call.command === "sudo" && call.args[0] === "sed",
    );
    expect(sedCall).toBeDefined();
    expect(sedCall.args[3]).toContain("\\1://archive.ubuntu.com/ubuntu");
    expect(calls.some((call) => call.args.includes("kill"))).toBe(false);
    expect(waits).toEqual([5_000]);
  });

  it("waits for apt/dpkg lock files to be no longer in use before a Linux retry", async () => {
    const calls = [];
    const logs = [];
    const waits = [];
    let clock = 0;
    let installs = 0;
    let lockPolls = 0;
    const locks = new Set([
      "/var/lib/dpkg/lock-frontend",
      "/var/lib/dpkg/lock",
    ]);
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => locks.has(file),
      now: () => clock,
      run: (command, args, options) => {
        calls.push({ command, args, options });
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args)) {
          lockPolls++;
          return { status: lockPolls < 3 ? 0 : 1, stderr: "" };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(lockPolls).toBe(3);
    const probes = calls.filter((c) => isLockProbe(c.command, c.args));
    expect(probes).toHaveLength(3);
    expect(probes[0].args).toEqual([
      "-n",
      "timeout",
      "--signal=KILL",
      "120s",
      "fuser",
      "-s",
      "/var/lib/dpkg/lock-frontend",
      "/var/lib/dpkg/lock",
    ]);
    expect(probes.map((c) => c.args[3])).toEqual(["120s", "115s", "110s"]);
    expect(probes.map((c) => c.options.timeout)).toEqual(
      [120_000, 115_000, 110_000].map((ms) => ms + PROBE_GRACE_MS),
    );
    expect(probes[0].options.killSignal).toBe("SIGKILL");
    expect(probes[0].options.stdio).toEqual(["ignore", "ignore", "pipe"]);
    expect(waits).toEqual([5_000, 5_000, 5_000]);
    expect(logs).toContain(
      `apt/dpkg lock files in use; waiting up to ${INSTALL_BUDGET.lockWaitSeconds}s for them to clear...`,
    );
    expect(logs).toContain("apt/dpkg lock files no longer in use after 10s.");
    expect(calls.some((call) => call.args.includes("kill"))).toBe(false);
  });

  it("stops at the deadline without starting another probe when lock files stay in use", async () => {
    const calls = [];
    const logs = [];
    const waits = [];
    let clock = 0;
    let installs = 0;
    let lockPolls = 0;
    const locks = new Set([
      "/var/lib/dpkg/lock-frontend",
      "/var/lib/dpkg/lock",
    ]);
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => locks.has(file),
      now: () => clock,
      run: (command, args, options) => {
        calls.push({ command, args, options });
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args)) {
          lockPolls++;
          return { status: 0, stderr: "" };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    const expectedPolls =
      INSTALL_BUDGET.lockWaitSeconds / INSTALL_BUDGET.lockPollSeconds;
    expect(installs).toBe(2);
    expect(lockPolls).toBe(expectedPolls);
    expect(waits).toEqual([
      5_000,
      ...Array(expectedPolls).fill(INSTALL_BUDGET.lockPollSeconds * 1_000),
    ]);
    expect(logs).toContain(
      `Warning: apt/dpkg lock files still in use after ${INSTALL_BUDGET.lockWaitSeconds}s; proceeding with retry.`,
    );
    expect(calls.some((call) => call.args.includes("kill"))).toBe(false);
  });

  it("bounds slow probes and final sleeps to the monotonic lock-wait deadline", async () => {
    const probeTimeouts = [];
    const innerTimeouts = [];
    const logs = [];
    const waits = [];
    let clock = 0;
    let installs = 0;
    const probeDurations = [58_000, 55_000];
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => file === "/var/lib/dpkg/lock-frontend",
      now: () => clock,
      run: (command, args, options) => {
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args)) {
          innerTimeouts.push(args[3]);
          probeTimeouts.push(options.timeout);
          clock += probeDurations[probeTimeouts.length - 1] ?? 10_000;
          return { status: 0, stderr: "" };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(innerTimeouts).toEqual(["120s", "57s"]);
    expect(probeTimeouts).toEqual([
      120_000 + PROBE_GRACE_MS,
      57_000 + PROBE_GRACE_MS,
    ]);
    expect(waits).toEqual([5_000, 5_000, 2_000]);
    expect(clock).toBe(5_000 + INSTALL_BUDGET.lockWaitSeconds * 1_000);
    expect(logs).toContain(
      `Warning: apt/dpkg lock files still in use after ${INSTALL_BUDGET.lockWaitSeconds}s; proceeding with retry.`,
    );
  });

  it("stops waiting and logs the diagnostic when a lock probe times out", async () => {
    const probeTimeouts = [];
    const innerTimeouts = [];
    const logs = [];
    const waits = [];
    let clock = 0;
    let installs = 0;
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => file === "/var/lib/dpkg/lock-frontend",
      now: () => clock,
      run: (command, args, options) => {
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args)) {
          innerTimeouts.push(args[3]);
          probeTimeouts.push(options.timeout);
          if (probeTimeouts.length === 1) return { status: 0, stderr: "" };
          clock += options.timeout;
          return {
            status: null,
            signal: options.killSignal,
            error: new Error("spawnSync sudo ETIMEDOUT"),
            stderr: "",
          };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(innerTimeouts).toEqual(["120s", "115s"]);
    expect(probeTimeouts).toEqual([
      120_000 + PROBE_GRACE_MS,
      115_000 + PROBE_GRACE_MS,
    ]);
    expect(waits).toEqual([5_000, 5_000]);
    expect(logs).toContain(
      "Warning: apt/dpkg lock file check failed (spawnSync sudo ETIMEDOUT); continuing.",
    );
    expect(logs.some((line) => /released|no longer in use/.test(line))).toBe(
      false,
    );
  });

  it("treats inner GNU timeout status 124 as a probe failure and proceeds to retry", async () => {
    const innerTimeouts = [];
    const logs = [];
    const waits = [];
    let clock = 0;
    let installs = 0;
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => file === "/var/lib/dpkg/lock-frontend",
      now: () => clock,
      run: (command, args) => {
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args)) {
          innerTimeouts.push(args[3]);
          if (innerTimeouts.length === 1) {
            clock += 113_750;
            return { status: 0, stderr: "" };
          }
          clock += 300;
          return { status: 124, stderr: "" };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(innerTimeouts).toEqual(["120s", "1.25s"]);
    expect(waits).toEqual([5_000, 5_000]);
    expect(logs).toContain(
      "Warning: apt/dpkg lock file check failed (timed out (exit 124)); continuing.",
    );
    expect(logs.some((line) => /released|no longer in use/.test(line))).toBe(
      false,
    );
  });

  it("formats sub-second inner timeouts and classifies status 137 as timed out", async () => {
    const innerTimeouts = [];
    const logs = [];
    let clock = 0;
    let installs = 0;
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => file === "/var/lib/dpkg/lock-frontend",
      now: () => clock,
      run: (command, args) => {
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args)) {
          innerTimeouts.push(args[3]);
          if (innerTimeouts.length === 1) {
            clock += 114_700;
            return { status: 0, stderr: "" };
          }
          return { status: 137, stderr: "" };
        }
        return { status: 0 };
      },
      pause: async (ms) => {
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(innerTimeouts).toEqual(["120s", "0.3s"]);
    expect(logs).toContain(
      "Warning: apt/dpkg lock file check failed (timed out (exit 137)); continuing.",
    );
  });

  it.each([
    [
      "missing timeout under sudo (exit 1 with stderr)",
      { status: 1, stderr: "sudo: timeout: command not found\n" },
      "Warning: apt/dpkg lock file check failed (exit 1: sudo: timeout: command not found); continuing.",
    ],
    [
      "missing fuser under GNU timeout (exit 127 with stderr)",
      {
        status: 127,
        stderr:
          "timeout: failed to run command 'fuser': No such file or directory\n",
      },
      "Warning: apt/dpkg lock file check failed (exit 127: timeout: failed to run command 'fuser': No such file or directory); continuing.",
    ],
    [
      "signal-only SIGKILL from the outer backstop",
      { status: null, signal: "SIGKILL" },
      "Warning: apt/dpkg lock file check failed (signal SIGKILL); continuing.",
    ],
  ])(
    "treats %s as a probe failure, proceeds to retry without further probes, and never logs cleared",
    async (_label, failure, expectedLog) => {
      const logs = [];
      const waits = [];
      let clock = 0;
      let installs = 0;
      let lockPolls = 0;
      await installCiBrowser({
        platform: "linux",
        execPath: "bun",
        hasFile: (file) => file === "/var/lib/dpkg/lock-frontend",
        now: () => clock,
        run: (command, args) => {
          if (command === "timeout") {
            installs++;
            return installs === 1 ? { status: 124 } : { status: 0 };
          }
          if (isLockProbe(command, args)) {
            lockPolls++;
            return lockPolls === 1 ? { status: 0, stderr: "" } : failure;
          }
          return { status: 0 };
        },
        pause: async (ms) => {
          waits.push(ms);
          clock += ms;
        },
        log: (message) => logs.push(message),
      });
      expect(installs).toBe(2);
      expect(lockPolls).toBe(2);
      expect(waits).toEqual([5_000, 5_000]);
      expect(logs).toContain(expectedLog);
      expect(logs.some((line) => /released|no longer in use/.test(line))).toBe(
        false,
      );
    },
  );

  it("continues immediately if sudo fuser fails during a Linux lock check", async () => {
    const logs = [];
    const waits = [];
    let clock = 0;
    let installs = 0;
    await installCiBrowser({
      platform: "linux",
      execPath: "bun",
      hasFile: (file) => file === "/var/lib/dpkg/lock-frontend",
      now: () => clock,
      run: (command, args) => {
        if (command === "timeout") {
          installs++;
          return installs === 1 ? { status: 124 } : { status: 0 };
        }
        if (isLockProbe(command, args))
          return { error: new Error("spawn ENOENT") };
        return { status: 0 };
      },
      pause: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(installs).toBe(2);
    expect(waits).toEqual([5_000]);
    expect(logs).toContain(
      "Warning: apt/dpkg lock file check failed (spawn ENOENT); continuing.",
    );
  });

  it.each(["darwin", "win32"])(
    "runs plain install with bounded retries and skips apt lock wait on %s",
    async (platform) => {
      const calls = [];
      const waits = [];
      await expect(
        installCiBrowser({
          platform,
          execPath: "bun",
          hasFile: () => true,
          run: (command, args) => {
            calls.push({ command, args });
            return { status: 1 };
          },
          pause: async (ms) => {
            waits.push(ms);
          },
          log: () => {},
        }),
      ).rejects.toThrow(/Pinned Chromium install failed after 3 attempts/);
      expect(calls).toHaveLength(3);
      for (const call of calls) {
        expect(call.command).toBe("bun");
        expect(call.args).toEqual([
          "node_modules/playwright-core/cli.js",
          "install",
          "--with-deps",
          "--no-shell",
          "chromium",
        ]);
      }
      expect(calls.some((call) => call.args.includes("fuser"))).toBe(false);
      expect(waits).toEqual([5_000, 10_000]);
    },
  );
});
