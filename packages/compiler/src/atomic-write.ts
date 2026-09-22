import {
  open as openFile,
  rename as renameFile,
  unlink as unlinkFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface AtomicWritableFile {
  writeFile(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicWriteOperations {
  open(path: string, flags: "wx"): Promise<AtomicWritableFile>;
  rename(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface AtomicWriteOptions {
  operations?: AtomicWriteOperations;
  maxCollisionRetries?: number;
  temporaryPath?: (destinationPath: string, attempt: number) => string;
}

const DEFAULT_OPERATIONS: AtomicWriteOperations = {
  open: async (path, flags) => openFile(path, flags),
  rename: renameFile,
  unlink: unlinkFile,
};

let temporarySequence = 0;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function defaultTemporaryPath(destinationPath: string): string {
  temporarySequence += 1;
  return join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${process.pid}.${temporarySequence}.tmp`,
  );
}

async function ignoreCleanupFailure(operation: () => Promise<void>) {
  try {
    await operation();
  } catch {
    // The original write/close/rename failure remains authoritative.
  }
}

export async function writeFileAtomically(
  destinationPath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const operations = options.operations ?? DEFAULT_OPERATIONS;
  const maxCollisionRetries = options.maxCollisionRetries ?? 32;

  if (!Number.isSafeInteger(maxCollisionRetries) || maxCollisionRetries < 0) {
    throw new RangeError("maxCollisionRetries must be a non-negative integer.");
  }

  const destinationDirectory = resolve(dirname(destinationPath));
  const bytes =
    typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  let lastCollision: unknown;

  for (let attempt = 0; attempt <= maxCollisionRetries; attempt += 1) {
    const temporaryPath =
      options.temporaryPath?.(destinationPath, attempt) ??
      defaultTemporaryPath(destinationPath);

    if (resolve(dirname(temporaryPath)) !== destinationDirectory) {
      throw new Error(
        "Atomic temporary files must be created in the destination directory.",
      );
    }

    let handle: AtomicWritableFile;

    try {
      handle = await operations.open(temporaryPath, "wx");
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        lastCollision = error;
        continue;
      }

      throw error;
    }

    let handleOpen = true;

    try {
      await handle.writeFile(bytes);
      await handle.close();
      handleOpen = false;
      await operations.rename(temporaryPath, destinationPath);
      return;
    } catch (error) {
      if (handleOpen) {
        await ignoreCleanupFailure(async () => handle.close());
      }

      await ignoreCleanupFailure(async () => operations.unlink(temporaryPath));
      throw error;
    }
  }

  throw (
    lastCollision ??
    new Error("Unable to reserve an exclusive atomic temporary file.")
  );
}
