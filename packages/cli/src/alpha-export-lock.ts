import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { parseJson } from "@thermite/schema";
import { filesystemCode, isJsonObject } from "./alpha-export-input.js";
import type { ExportTarget } from "./alpha-export-publish.js";
import { assertOrdinaryPath } from "./alpha-output.js";

export const LOCK_NAME = ".thermite-export.lock";
const host = hostname();
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

function directories(targets: readonly ExportTarget[]) {
  return [...new Set(targets.map(({ file }) => dirname(file)))].sort();
}

function reserved(path: string) {
  return new Error(
    `Export destination is reserved: ${path}. Retry after the writer exits. If the lock remains, verify that no publisher is using the directory, then remove the lock and its owner metadata by hand.`,
  );
}

function lockStat(path: string) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (filesystemCode(error) !== "ENOENT") throw error;
    return undefined;
  }
}

function assertSameDirectory(path: string, identity: BigIntStats) {
  const current = lockStat(path);
  if (
    !current?.isDirectory() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  )
    throw reserved(path);
}

function deadOwner(file: string) {
  const stat = lockStat(file);
  if (!stat?.isFile() || stat.nlink !== 1n || stat.size > 1024n) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      readFileSync(file),
    );
    const { value: owner, diagnostics } = parseJson(text, file);
    if (
      diagnostics.length ||
      !isJsonObject(owner) ||
      owner.hostname !== host ||
      typeof owner.startedAt !== "string" ||
      !Number.isFinite(Date.parse(owner.startedAt)) ||
      typeof owner.pid !== "number" ||
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      owner.pid > 0x7fffffff
    )
      return false;
    process.kill(owner.pid, 0);
  } catch (error) {
    return filesystemCode(error) === "ESRCH";
  }
  return false;
}

function clearAbandonedReservation(directory: string) {
  const path = join(directory, LOCK_NAME);
  try {
    const identity = lockStat(path);
    if (!identity) return;
    if (!identity.isDirectory()) throw reserved(path);
    const entries = readdirSync(path);
    const [name] = entries;
    if (
      entries.length !== 1 ||
      !name ||
      !/^owner-[a-f0-9-]{36}\.json$/u.test(name) ||
      !deadOwner(join(path, name))
    )
      throw reserved(path);
    assertSameDirectory(path, identity);
    // Only the contender that unlinks this owner's unique file may remove the directory.
    unlinkSync(join(path, name));
    rmdirSync(path);
  } catch {
    throw reserved(path);
  }
}

export function checkExportReservations(targets: readonly ExportTarget[]) {
  for (const directory of directories(targets))
    clearAbandonedReservation(directory);
}

const held = new Set<() => void>();
const interrupt = () => exitWithRelease(130);
const terminate = () => exitWithRelease(143);

function exitWithRelease(code: number) {
  for (const release of held) {
    try {
      release();
    } catch {
      // Leave any lock we cannot release for the next publisher to inspect.
    }
  }
  process.exit(code);
}

async function reserveDirectory(directory: string) {
  await assertOrdinaryPath(directory, "directory");
  await mkdir(directory, { recursive: true });
  await assertOrdinaryPath(directory, "directory");
  clearAbandonedReservation(directory);
  const path = join(directory, LOCK_NAME);
  try {
    mkdirSync(path);
  } catch (error) {
    if (filesystemCode(error) === "EEXIST") throw reserved(path);
    throw error;
  }
  const identity = lstatSync(path, { bigint: true });
  const owner = join(path, `owner-${randomUUID()}.json`);
  function assertHeld() {
    assertSameDirectory(path, identity);
    if (!lockStat(owner)?.isFile()) throw reserved(path);
  }
  function release() {
    assertHeld();
    unlinkSync(owner);
    rmdirSync(path);
  }
  try {
    writeFileSync(
      owner,
      JSON.stringify({ pid: process.pid, hostname: host, startedAt }) + "\n",
      { flag: "wx" },
    );
  } catch (error) {
    assertSameDirectory(path, identity);
    if (lockStat(owner)) unlinkSync(owner);
    rmdirSync(path);
    throw error;
  }
  if (!held.size) {
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
  }
  held.add(release);
  return { path, assertHeld, release };
}

export async function withExportReservations<T>(
  targets: readonly ExportTarget[],
  run: (assertHeld: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const locks: Awaited<ReturnType<typeof reserveDirectory>>[] = [];
  try {
    for (const directory of directories(targets))
      locks.push(await reserveDirectory(directory));
    return await run(async () => {
      for (const lock of locks) {
        await assertOrdinaryPath(lock.path, "directory");
        lock.assertHeld();
      }
    });
  } finally {
    const pending = Promise.allSettled(
      locks.map(async ({ release }) => {
        held.delete(release);
        release();
      }),
    );
    if (!held.size) {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    }
    const failed = (await pending).find(
      (result) => result.status === "rejected",
    );
    if (failed?.status === "rejected") throw failed.reason;
  }
}
