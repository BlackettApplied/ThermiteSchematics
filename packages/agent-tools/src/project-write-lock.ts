import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import {
  PROJECT_WRITE_LOCK_FILE_NAME,
  type SourcePatchProject,
} from "@thermite/compiler";
import {
  createA005Error,
  type A005Error,
  type ProjectWriteOwner,
  type ProjectWriteOwnerState,
} from "./common/errors.js";
import { sanitizedErrorCode } from "./common/tool-failure.js";

export const defaultProjectWriteLockOperations = Object.freeze({
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  // Match fs/promises.realpath in the loader and source-chain guards. The
  // legacy synchronous component walk can preserve Windows 8.3 aliases.
  realpathSync: realpathSync.native,
  unlinkSync,
  writeFileSync,
});
type LockOperations = typeof defaultProjectWriteLockOperations;
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const active = new Map<
  () => void,
  { readonly path: string; readonly revoke: () => void }
>();
const installedSignals = new Set<(typeof signals)[number]>();

function onSignal(signal: (typeof signals)[number]): void {
  for (const [release, reservation] of [...active]) {
    reservation.revoke();
    try {
      release();
    } catch (error) {
      process.stderr.write(
        `Interrupted writer could not release ${JSON.stringify(reservation.path)} (${sanitizedErrorCode(error)}).\n`,
      );
    }
  }
  // A host may have added a listener after we acquired the reservation. It
  // receives this original signal once; do not deliver it a second time.
  removeSignalHandlers();
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

const signalHandlers = {
  SIGINT: () => onSignal("SIGINT"),
  SIGTERM: () => onSignal("SIGTERM"),
  SIGHUP: () => onSignal("SIGHUP"),
};

function removeSignalHandlers(): void {
  for (const signal of installedSignals)
    process.removeListener(signal, signalHandlers[signal]);
  installedSignals.clear();
}

function register(release: () => void, path: string, revoke: () => void): void {
  if (active.size === 0) {
    for (const signal of signals) {
      // Public API callers own their existing signal policy. Only an otherwise
      // unhandled signal gets the CLI cleanup/default-termination behavior.
      if (process.listenerCount(signal) === 0) {
        process.on(signal, signalHandlers[signal]);
        installedSignals.add(signal);
      }
    }
  }
  active.set(release, { path, revoke });
}
function unregister(release: () => void): void {
  active.delete(release);
  if (active.size === 0) removeSignalHandlers();
}

function guardMismatch(): Error {
  return Object.assign(
    new Error("Project write reservation identity changed."),
    { code: "PATCH_LOCK_GUARD_MISMATCH" },
  );
}

function readOwner(
  path: string,
  operations: LockOperations,
): ProjectWriteOwner | null {
  try {
    const status = operations.lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink() || status.size > 4096)
      return null;
    const value: unknown = JSON.parse(operations.readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const owner = value as Record<string, unknown>;
    if (
      typeof owner.pid !== "number" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.hostname !== "string" ||
      typeof owner.createdAt !== "string" ||
      !Number.isFinite(Date.parse(owner.createdAt)) ||
      typeof owner.thermiteVersion !== "string"
    )
      return null;
    return {
      pid: owner.pid,
      hostname: owner.hostname,
      createdAt: owner.createdAt,
      thermiteVersion: owner.thermiteVersion,
    };
  } catch {
    return null;
  }
}
function ownerState(owner: ProjectWriteOwner | null): ProjectWriteOwnerState {
  if (owner === null) return "unknown";
  if (owner.hostname !== hostname()) return "other-host";
  try {
    process.kill(owner.pid, 0);
    return "alive";
  } catch (error) {
    return sanitizedErrorCode(error) === "ESRCH" ? "not-running" : "unknown";
  }
}

export type ProjectWriteReservation =
  | {
      readonly ok: true;
      readonly release: () => void;
      readonly path: string;
      readonly assertHeld: () => void;
    }
  | { readonly ok: false; readonly error: A005Error };

/** Exclusive creation arbitrates processes; existing reservations are never stolen. */
export function reserveProjectWrite(
  project: SourcePatchProject,
  operations: LockOperations = defaultProjectWriteLockOperations,
): ProjectWriteReservation {
  const root = project.canonicalRootPath;
  const rootStatus = operations.lstatSync(root, { bigint: true });
  const rootMatches = (): boolean => {
    const current = operations.lstatSync(root, { bigint: true });
    return (
      !current.isSymbolicLink() &&
      current.isDirectory() &&
      current.dev === rootStatus.dev &&
      current.ino === rootStatus.ino &&
      operations.realpathSync(project.logicalRootPath) === root
    );
  };
  if (!rootMatches()) throw guardMismatch();
  const path = join(root, PROJECT_WRITE_LOCK_FILE_NAME);
  let descriptor: number;
  try {
    descriptor = operations.openSync(path, "wx", 0o600);
  } catch (error) {
    if (sanitizedErrorCode(error) !== "EEXIST") throw error;
    const owner = readOwner(path, operations);
    return {
      ok: false,
      error: createA005Error(
        PROJECT_WRITE_LOCK_FILE_NAME,
        path,
        owner,
        owner === null
          ? null
          : Math.max(0, Date.now() - Date.parse(owner.createdAt)),
        ownerState(owner),
      ),
    };
  }
  let descriptorOpen = true;
  let owned: { readonly dev: bigint; readonly ino: bigint } | undefined;
  // Package release version (the alpha CLI also has its own preview version).
  const metadata = {
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
    thermiteVersion: "unknown",
    token: randomUUID(),
  };
  let contents = "";
  let removed = false;
  let revoked = false;
  const assertHeld = (): void => {
    if (revoked || removed || !descriptorOpen)
      throw Object.assign(new Error("Project write reservation was revoked."), {
        code: "PATCH_LOCK_REVOKED",
      });
  };
  const release = (): void => {
    if (removed) return;
    unregister(release);
    if (descriptorOpen) {
      operations.closeSync(descriptor);
      descriptorOpen = false;
    }
    if (!rootMatches()) throw guardMismatch();
    const current = operations.lstatSync(path, { bigint: true });
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      (owned !== undefined &&
        (current.dev !== owned.dev || current.ino !== owned.ino)) ||
      (owned === undefined &&
        operations.readFileSync(path, "utf8") !== contents)
    )
      throw guardMismatch();
    operations.unlinkSync(path);
    removed = true;
  };
  try {
    const manifest = JSON.parse(
      operations.readFileSync(
        new URL("../package.json", import.meta.url),
        "utf8",
      ),
    ) as { version: string };
    metadata.thermiteVersion = manifest.version;
    contents = `${JSON.stringify(metadata)}\n`;
    operations.writeFileSync(descriptor, contents, "utf8");
    owned = operations.fstatSync(descriptor, { bigint: true });
    if (!rootMatches()) throw guardMismatch();
    register(release, path, () => {
      revoked = true;
    });
    return { ok: true, release, path, assertHeld };
  } catch (error) {
    // A unique token written through the owned descriptor also permits guarded
    // cleanup when fstat fails. Never leak the descriptor on setup failure.
    if (owned === undefined) {
      try {
        owned = operations.fstatSync(descriptor, { bigint: true });
      } catch {
        /* Token guards cleanup when fstat is unavailable. */
      }
    }
    try {
      release();
    } catch {
      if (descriptorOpen) {
        operations.closeSync(descriptor);
        descriptorOpen = false;
      }
    }
    throw error;
  }
}
