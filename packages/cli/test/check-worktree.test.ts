import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { checkWorktree } from "../../../scripts/check-worktree.mjs";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const { resolve } = await import("node:path");
  return {
    ...fs,
    realpathSync: Object.assign(() => resolve("legacy temporary alias"), {
      native: () => resolve("native temporary root"),
    }),
    mkdtempSync: vi.fn(() => resolve("synthetic default temporary directory")),
  };
});

it("creates the installation checkout under the native temporary root", async () => {
  await checkWorktree({ run: () => {}, remove: () => {} });
  expect(mkdtempSync).toHaveBeenLastCalledWith(
    join(resolve("native temporary root"), "thermite-worktree-"),
  );
});

const scratch = resolve("synthetic temporary directory");
function harness({
  busy = 0,
  checkError,
  addError,
  removalError,
  loggingError = false,
}: {
  busy?: number;
  checkError?: Error;
  addError?: Error;
  removalError?: Error;
  loggingError?: boolean;
} = {}) {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const warnings: string[] = [],
    waits: number[] = [],
    removals: unknown[] = [];
  let attempts = 0;
  return {
    calls,
    warnings,
    waits,
    removals,
    run: () =>
      checkWorktree({
        makeTemporary: () => scratch,
        run: (command: string, args: string[], cwd?: string) => {
          calls.push({ command, args, ...(cwd ? { cwd } : {}) });
          if (args[0] === "worktree" && args[1] === "add" && addError)
            throw addError;
          if (args[0] === "run" && args[1] === "check" && checkError)
            throw checkError;
          if (
            args[0] === "worktree" &&
            args[1] === "remove" &&
            attempts++ < busy
          )
            throw Object.assign(new Error("EBUSY: handle still open"), {
              code: "EBUSY",
            });
        },
        remove: (_path: string, options: unknown) => {
          removals.push(options);
          if (removalError) throw removalError;
        },
        pause: async (ms: number) => {
          waits.push(ms);
        },
        warn: (message: string) => {
          warnings.push(message);
          if (loggingError) throw new Error("logging failed");
        },
      }),
  };
}
it("checks committed HEAD in a space-containing path and retries busy removal", async () => {
  const h = harness({ busy: 2 });
  await h.run();
  expect(h.calls[0].args).toEqual([
    "worktree",
    "add",
    "--detach",
    join(scratch, "linked checkout"),
    "HEAD",
  ]);
  expect(h.calls.find((call) => call.args[0] === "install")?.cwd).toContain(
    "linked checkout",
  );
  expect(h.calls.filter((call) => call.args[1] === "remove")).toHaveLength(3);
  expect(h.waits).toEqual([200, 400]);
  expect(h.removals).toEqual([
    { recursive: true, force: true, maxRetries: 3, retryDelay: 200 },
  ]);
  expect(h.warnings).toEqual([]);
});
it("cleanup failures warn and cannot fail a passing check", async () => {
  const h = harness({
    busy: 99,
    removalError: new Error("EBUSY directory"),
    loggingError: true,
  });
  await expect(h.run()).resolves.toBeUndefined();
  expect(h.calls.some((call) => call.args[1] === "prune")).toBe(false);
  expect(h.calls.filter((call) => call.args[1] === "remove")).toHaveLength(4);
  for (const call of h.calls.filter((call) => call.args[1] === "remove"))
    expect(call.args).toEqual([
      "worktree",
      "remove",
      "--force",
      join(scratch, "linked checkout"),
    ]);
  expect(h.warnings.join("\n")).toContain("EBUSY");
});
it("cleanup and warning failures cannot replace the original check error", async () => {
  const primary = Object.assign(new Error("check exited 2"), { exitCode: 2 });
  const h = harness({
    busy: 99,
    checkError: primary,
    removalError: new Error("cleanup failed"),
    loggingError: true,
  });
  await expect(h.run()).rejects.toBe(primary);
  expect(h.warnings).not.toEqual([]);
});

it("preserves an add failure without trying to unregister an unattached checkout", async () => {
  const primary = Object.assign(new Error("worktree add exited 128"), {
    exitCode: 128,
  });
  const h = harness({ addError: primary });
  await expect(h.run()).rejects.toBe(primary);
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].args[1]).toBe("add");
  expect(h.warnings).toEqual([]);
  expect(h.removals).toHaveLength(1);
});
