import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  LIBRARY_LOCK_FILE_NAME,
  loadProject,
  type LoadedProject,
} from "@thermite/compiler";
import { parseJson, type Diagnostic } from "@thermite/schema";
import { assertOrdinaryPath, canonicalOutputPath } from "./alpha-output.js";
import { exportBuildIdentity } from "./alpha-export-build.js";

export const THERMITE_VERSION = "0.3.0-alpha.2";

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function filesystemCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export class ExportInputError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
    readonly diagnostics: Diagnostic[] = [],
    readonly path?: string,
  ) {
    super(message);
  }
}

export interface Producer {
  version: string;
  build: string;
}

export function exportProducer(): Producer {
  return { version: THERMITE_VERSION, build: exportBuildIdentity() };
}

function decode(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ExportInputError(`Invalid UTF-8 in ${path}.`, 1, [], path);
  }
}

export function parseExportJson(bytes: Uint8Array, path: string) {
  const result = parseJson(decode(bytes, path), path);
  if (result.diagnostics.length || result.value === undefined)
    throw new ExportInputError(
      `Invalid JSON in ${path}.`,
      1,
      result.diagnostics,
      path,
    );
  return { value: result.value, source: { file: path, nodes: result.nodes } };
}

export async function readExportJson(path: string, label = path) {
  const bytes = await readExportBytes(path, label);
  if (bytes.length > 16 * 1024 * 1024)
    throw new ExportInputError(
      `JSON input exceeds 16 MiB: ${label}.`,
      1,
      [],
      label,
    );
  return { ...parseExportJson(bytes, label), sha256: sha256(bytes) };
}

async function readExportBytes(path: string, label: string) {
  try {
    await assertOrdinaryPath(path, "file");
    if ((await canonicalOutputPath(path)) !== path)
      throw new ExportInputError(
        `Input aliases a different path: ${label}.`,
        1,
        [],
        label,
      );
    return await readFile(path);
  } catch (error) {
    if (error instanceof ExportInputError) throw error;
    const code = filesystemCode(error);
    throw new ExportInputError(
      `Unable to read ${label}${code ? ` (${code})` : ""}.`,
      code && code !== "ENOENT" && code !== "ENOTDIR" ? 2 : 1,
      [],
      label,
    );
  }
}

/** A portable, unambiguous relative path, using forward slashes on all hosts. */
export function portablePath(path: string): string {
  if (
    !path
      .split("/")
      .every(
        (part) =>
          part &&
          !/[<>:"\\|?*\x00-\x1f]/u.test(part) &&
          !/[. ]$/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part),
      ) ||
    path === "-"
  )
    throw new ExportInputError(
      `Expected a portable relative path: ${JSON.stringify(path)}.`,
    );
  return path;
}

export interface InputBinding {
  path: string;
  sha256: string;
}

export async function namedExportInput(project: LoadedProject, path: string) {
  const file = resolve(project.canonicalRootPath, portablePath(path));
  const input = await readExportJson(file, path);
  return { ...input, binding: { path, sha256: input.sha256 }, file };
}

export async function standaloneInputPath(
  project: LoadedProject,
  path: string,
) {
  if (path === "-")
    throw new ExportInputError(
      "--receipt requires named project-relative inputs.",
      2,
    );
  const file = resolve(path);
  // CLI paths are relative to cwd. Bind them relative to the project so the
  // receipt still works after moving the project and delivery together.
  return portablePath(
    relative(project.canonicalRootPath, file).split(sep).join("/"),
  );
}

export interface InputFingerprint {
  format: "export-input/1";
  sha256: string;
}

export function inputFingerprint(project: LoadedProject): InputFingerprint {
  const entries: string[] = [];
  function append(
    role: string,
    path: string,
    bytes?: Uint8Array,
    owner: string[] = [],
  ) {
    if (bytes !== undefined) decode(bytes, path);
    entries.push(
      JSON.stringify([
        role,
        path,
        ...owner,
        bytes === undefined ? null : sha256(bytes),
      ]),
    );
  }
  append("manifest", project.manifest.file, project.manifest.rawBytes);
  append(
    "presentation",
    project.presentation?.file ?? "",
    project.presentation?.rawBytes,
  );
  for (const source of project.sources)
    append("source", source.file, source.rawBytes);
  for (const library of project.libraries) {
    const owner = [
      library.dependency.name,
      library.dependency.version,
      library.resolutionKind,
    ];
    for (const doc of [library.manifest, ...library.sources]) {
      const path = relative(library.logicalRootPath, doc.logicalPath)
        .split(sep)
        .join("/");
      append(doc.kind, path, doc.rawBytes, owner);
    }
  }
  const lock = project.libraryLock;
  if (lock.state === "error")
    throw new ExportInputError(
      `Unable to read ${LIBRARY_LOCK_FILE_NAME} (${lock.detail}).`,
      lock.detail === "ENOENT" ? 1 : 2,
      [],
      LIBRARY_LOCK_FILE_NAME,
    );
  if (lock.state === "invalid")
    throw new ExportInputError(
      `Invalid ${LIBRARY_LOCK_FILE_NAME}.`,
      1,
      lock.diagnostics,
      LIBRARY_LOCK_FILE_NAME,
    );
  append(
    "lock",
    LIBRARY_LOCK_FILE_NAME,
    lock.state === "valid" ? lock.rawBytes : undefined,
  );
  const format = "export-input/1";
  return {
    format,
    sha256: sha256(JSON.stringify([format, ...entries.sort()])),
  };
}

export async function loadExportSnapshot(path: string) {
  const loaded = await loadProject(path);
  if (!loaded.ok) {
    const infrastructure =
      loaded.toolFailure &&
      loaded.diagnostics.some(
        (d) =>
          d.code === "E001" &&
          /\((?!ENOENT\)|ENOTDIR\))[A-Z][A-Z0-9]+\)|Validation tool failure|Unable to initialize schema validation/u.test(
            d.message,
          ),
      );
    throw new ExportInputError(
      "Project inputs cannot be verified.",
      infrastructure ? 2 : 1,
      loaded.diagnostics,
      loaded.diagnostics.find((diagnostic) => diagnostic.severity === "error")
        ?.file ?? "project",
    );
  }
  const { project } = loaded;
  await guardSnapshotFile(project.manifest.logicalPath, project.manifest.file);
  await guardSnapshotFile(
    resolve(project.logicalRootPath, LIBRARY_LOCK_FILE_NAME),
    LIBRARY_LOCK_FILE_NAME,
  );
  return {
    project: loaded.project,
    fingerprint: inputFingerprint(loaded.project),
  };
}

async function guardSnapshotFile(path: string, label: string) {
  try {
    await assertOrdinaryPath(path, "file");
  } catch (error) {
    const code = filesystemCode(error);
    throw new ExportInputError(
      `Unable to verify ordinary input ${label}${code ? ` (${code})` : ""}.`,
      code && code !== "ENOTDIR" ? 2 : 1,
      [],
      label,
    );
  }
}
