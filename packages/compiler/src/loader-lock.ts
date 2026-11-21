import { errorCode, errorDetail } from "./loader-errors.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeDiagnostics,
  parseJson,
  type LibraryLock,
  type SchemaRegistry,
} from "@thermite/schema";
import type {
  LoadedLibraryLock,
  NormalizedLibraryLockEntry,
} from "./loader-types.js";

export async function loadLibraryLockSnapshot(
  projectRoot: string,
  registry: SchemaRegistry,
): Promise<LoadedLibraryLock> {
  const file = "electrical-system.lock.json";
  let rawBytes: Buffer;

  try {
    rawBytes = await readFile(join(projectRoot, file));
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { state: "missing" }
      : { state: "error", detail: errorDetail(error) };
  }

  const parsed = parseJson(rawBytes.toString("utf8"), file);

  if (parsed.value === undefined || parsed.diagnostics.length > 0) {
    return {
      state: "invalid",
      diagnostics: normalizeDiagnostics(parsed.diagnostics),
    };
  }

  const diagnostics = registry.validateEntity("library-lock", parsed.value, {
    file,
    nodes: parsed.nodes,
  });

  if (diagnostics.length > 0) {
    return {
      state: "invalid",
      diagnostics: normalizeDiagnostics(diagnostics),
    };
  }

  const parsedValue = parsed.value as unknown as LibraryLock;
  const normalizedValue = structuredClone(parsedValue);
  const libraries = Object.fromEntries(
    Object.entries(normalizedValue.libraries).map(([name, library]) => [
      name,
      {
        ...library,
        resolutionKind: library.resolutionKind ?? "local",
      },
    ]),
  ) as Record<string, NormalizedLibraryLockEntry>;

  return {
    state: "valid",
    rawBytes,
    value: { ...normalizedValue, libraries },
    parsedValue,
    nodes: parsed.nodes,
  };
}
