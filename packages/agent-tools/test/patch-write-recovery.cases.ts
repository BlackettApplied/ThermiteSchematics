// Write-reservation recovery cases shared by patch-write-recovery.test.ts,
// patch-write-chain-changes.test.ts and the generated project guide's test
// (packages/cli/test/project-guide.test.ts), which executes the rows its
// sentences claim.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { computeFileIntegrity } from "@thermite/compiler";
import type { ApplySourcePatchDependencies } from "../src/apply-source-patch.js";
import { reserveProjectWrite } from "../src/project-write-lock.js";
import type { PatchProjectFixture } from "./patch-project-fixture.js";

export async function requestFor(project: string) {
  return {
    format: "agent-tool-request/0.1" as const,
    project,
    patchFormat: "json-patch/0.1" as const,
    dryRun: false,
    files: [
      {
        path: "sources/a.json",
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(project, "sources/a.json")),
        ),
        operations: [{ op: "add" as const, path: "/$schema", value: "review" }],
      },
    ],
  };
}

// Windows terminate-process delivery cannot run JS signal handlers. POSIX Bun
// must clean up all three catchable termination signals and preserve the signal.
export const POSIX_SIGNALS_UNAVAILABLE = process.platform === "win32";
export const RESERVATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Starts an apply that holds the reservation, paused between its last guard
 * and its first replacement; it prints "ready" once paused.
 */
export async function startPausedWriter(fixture: PatchProjectFixture) {
  const requestPath = join(fixture.root, "request.json");
  await writeFile(
    requestPath,
    JSON.stringify(await requestFor(fixture.projectRoot)),
  );
  const child = spawn(
    process.execPath,
    [
      resolve("packages/agent-tools/test/fixtures/paused-patch-writer.mjs"),
      requestPath,
    ],
    { stdio: "pipe" },
  );
  const closed = once(child, "close");
  const lines = createInterface({ input: child.stdout! })[
    Symbol.asyncIterator
  ]();
  return { child, closed, lines };
}
/** Kills a paused writer that is still running. */
export async function stopPausedWriter({
  child,
  closed,
}: Awaited<ReturnType<typeof startPausedWriter>>) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await closed;
  }
}

/** `dependencies` with a reservation whose release throws after releasing. */
export function withFailingRelease(
  dependencies: ApplySourcePatchDependencies,
): ApplySourcePatchDependencies {
  return {
    ...dependencies,
    reserveProjectWrite(project) {
      const reservation = reserveProjectWrite(project);
      if (!reservation.ok) return reservation;
      return {
        ...reservation,
        release() {
          reservation.release();
          throw Object.assign(new Error("injected"), { code: "EACCES" });
        },
      };
    },
  };
}
