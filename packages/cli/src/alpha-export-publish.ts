import { lstat, mkdir, rmdir, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { writeFileAtomically, type LoadedProject } from "@thermite/compiler";
import {
  assertOrdinaryPath,
  canonicalOutputPath,
  guardAlphaOutput,
} from "./alpha-output.js";
import { ExportInputError, filesystemCode } from "./alpha-export-input.js";
import { MANIFEST_PATH, RECEIPT_SUFFIX } from "./alpha-export-plan.js";

export interface ExportTarget {
  label: string;
  file: string;
}

const LOCK_NAME = ".thermite-export.lock";
function normalized(path: string) {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

export function assertDistinctTargets(targets: readonly ExportTarget[]) {
  const seen = new Set<string>();
  for (const target of targets) {
    const path = normalized(target.file);
    if (seen.has(path) || path.split(sep).includes(LOCK_NAME))
      throw new ExportInputError(
        `Colliding or reserved output path: ${target.label}.`,
      );
    seen.add(path);
  }
  const parents = new Map<string, string>();
  for (const target of targets) {
    let parent = dirname(target.file);
    while (dirname(parent) !== parent) {
      const key = normalized(parent);
      if (seen.has(key))
        throw new ExportInputError(
          `Output has a file as its parent: ${target.label}.`,
        );
      const previous = parents.get(key);
      if (previous && previous !== parent)
        throw new ExportInputError(
          `Aliased output directory: ${target.label}.`,
        );
      parents.set(key, parent);
      parent = dirname(parent);
    }
  }
}

export function deliveryTargets(
  directory: string,
  paths: readonly string[],
  receipts = false,
) {
  for (const path of paths) {
    const name = normalized(path.split("/").at(-1) ?? "");
    if (name === MANIFEST_PATH || name.endsWith(RECEIPT_SUFFIX))
      throw new ExportInputError(`Reserved export metadata name: ${path}.`);
  }
  return [
    ...paths,
    ...(receipts
      ? paths.map((path) => path + RECEIPT_SUFFIX)
      : [MANIFEST_PATH]),
  ].map((label) => ({ label, file: resolve(directory, label) }));
}

export async function guardTarget(
  project: LoadedProject,
  target: ExportTarget,
  inputs: readonly string[],
) {
  try {
    const guarded = await guardAlphaOutput(project, target.file, inputs, {
      allowText: true,
    });
    if (guarded !== target.file)
      throw new Error("Output aliases a different path.");
  } catch (error) {
    const code = filesystemCode(error);
    const detail = error instanceof Error ? error.message : "Invalid path.";
    throw new ExportInputError(
      `Output ${target.label}: ${detail}`,
      code && code !== "ENOTDIR" ? 2 : 1,
      [],
      target.label,
    );
  }
}

export async function guardTargets(
  project: LoadedProject,
  targets: ExportTarget[],
  inputs: readonly string[],
) {
  assertDistinctTargets(targets);
  for (const target of targets) await guardTarget(project, target, inputs);
}

export async function outputDirectory(path: string) {
  const directory = resolve(path);
  try {
    await assertOrdinaryPath(directory, "directory");
    if ((await canonicalOutputPath(directory)) !== directory)
      throw new Error("Output directory aliases a different path.");
  } catch (error) {
    throw new ExportInputError(
      error instanceof Error ? error.message : "Invalid output directory.",
      2,
    );
  }
  return directory;
}

async function reserveDirectory(directory: string) {
  await assertOrdinaryPath(directory, "directory");
  await mkdir(directory, { recursive: true });
  await assertOrdinaryPath(directory, "directory");
  const lock = resolve(directory, LOCK_NAME);
  try {
    await mkdir(lock);
  } catch (error) {
    if (filesystemCode(error) !== "EEXIST") throw error;
    throw new Error(
      `Export destination is reserved: ${lock}. Retry after the writer exits.`,
    );
  }
  const identity = await lstat(lock, { bigint: true });
  async function assertHeld() {
    await assertOrdinaryPath(lock, "directory");
    const current = await lstat(lock, { bigint: true });
    if (current.dev !== identity.dev || current.ino !== identity.ino)
      throw new Error("Export destination reservation changed.");
  }
  return {
    assertHeld,
    async release() {
      await assertHeld();
      await rmdir(lock);
    },
  };
}

export async function withExportReservations<T>(
  targets: ExportTarget[],
  run: (assertHeld: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const directories = [
    ...new Set(targets.map(({ file }) => dirname(file))),
  ].sort();
  const locks: Awaited<ReturnType<typeof reserveDirectory>>[] = [];
  try {
    for (const directory of directories)
      locks.push(await reserveDirectory(directory));
    return await run(async () => {
      for (const lock of locks) await lock.assertHeld();
    });
  } finally {
    const released = await Promise.allSettled(
      locks.map((lock) => lock.release()),
    );
    const failed = released.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}

export async function retireMarker(
  marker: ExportTarget,
  validate: () => Promise<void>,
) {
  await validate();
  try {
    await unlink(marker.file);
  } catch (error) {
    if (filesystemCode(error) !== "ENOENT") throw error;
  }
}

export async function publishArtifact(
  target: ExportTarget,
  content: Uint8Array | string,
  validate: () => Promise<void>,
) {
  await writeFileAtomically(target.file, content, {
    validateDestination: validate,
  });
}
