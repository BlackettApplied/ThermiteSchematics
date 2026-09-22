import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, posix } from "node:path";

import {
  DIAGNOSTIC_CATALOG,
  appendJsonPointer,
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
  type JsonPointerNodeMap,
  type LibraryLock,
  type RelatedDiagnosticLocation,
} from "@thermite/schema";
import { SHIPPED_CORE_LIBRARY_LOCATOR } from "@thermite/core-library";

import {
  writeFileAtomically,
  type AtomicWriteOptions,
} from "./atomic-write.js";
import { stringifyJson, type JsonKeyOrder } from "./canonical-json.js";
import {
  loadProject,
  type LoadedDocument,
  type LoadedLibrary,
  type NormalizedLibraryLock,
  type LoadedProject,
} from "./loader.js";

export const LIBRARY_LOCK_FILE_NAME = "electrical-system.lock.json";
export const LIBRARY_LOCK_SCHEMA_ID =
  "https://thermiteschematics.com/schemas/0.1/library-lock.schema.json";

type LibraryLockEntry = LibraryLock["libraries"][string];
type LibraryDocument =
  LoadedLibrary["manifest"] | LoadedLibrary["sources"][number];

export interface VerifyLibraryLockOptions {
  checkCanonical?: boolean;
}

export type VerifyLibraryLockResult =
  | {
      ok: true;
      diagnostics: Diagnostic[];
      canonicalBytes: Uint8Array;
      lock?: NormalizedLibraryLock;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
      toolFailure: boolean;
    };

export interface LockProjectOptions {
  check?: boolean;
  atomicWrite?: AtomicWriteOptions;
}

export type LockProjectResult =
  | {
      ok: true;
      diagnostics: Diagnostic[];
      lock: NormalizedLibraryLock;
      lockPath: string;
      written: boolean;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
      toolFailure: boolean;
    };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function errorDetail(error: unknown): string {
  return (
    errorCode(error) ??
    (error instanceof Error ? error.message : "unknown failure")
  );
}

function lockPath(project: LoadedProject): string {
  return join(project.logicalRootPath, LIBRARY_LOCK_FILE_NAME);
}

function positionAt(
  nodes: JsonPointerNodeMap,
  pointer: string,
  anchor: "key" | "value" = "value",
): { line: number; column: number } {
  const node = nodes.get(pointer);
  const location = anchor === "key" ? node?.key : node?.value;
  return location === undefined
    ? { line: 1, column: 1 }
    : { line: location.line, column: location.column };
}

function relatedAt(
  file: string,
  nodes: JsonPointerNodeMap,
  pointer: string,
  note: string,
): RelatedDiagnosticLocation {
  return {
    file: normalizeDiagnosticFile(file),
    ...positionAt(nodes, pointer),
    note,
  };
}

function lockIoDiagnostic(message: string): Diagnostic {
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message,
    file: LIBRARY_LOCK_FILE_NAME,
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function semanticFailure(diagnostics: readonly Diagnostic[]) {
  return {
    ok: false as const,
    diagnostics: normalizeDiagnostics(diagnostics),
    toolFailure: false,
  };
}

function canonicalLock(lock: LibraryLock): NormalizedLibraryLock {
  const libraries = Object.fromEntries(
    Object.keys(lock.libraries)
      .sort(compareText)
      .map((name) => {
        const library = lock.libraries[name]!;
        const files = Object.fromEntries(
          Object.keys(library.files)
            .sort(compareText)
            .map((path) => [path, library.files[path]!] as const),
        ) as LibraryLockEntry["files"];

        return [
          name,
          {
            version: library.version,
            path: library.path,
            resolutionKind: library.resolutionKind ?? "local",
            integrity: library.integrity,
            files,
          },
        ] as const;
      }),
  ) as Record<string, NormalizedLibraryLock["libraries"][string]>;

  return {
    $schema: LIBRARY_LOCK_SCHEMA_ID,
    lockfile_version: 1,
    project_format: lock.project_format,
    libraries,
  };
}

const TOP_LEVEL_LOCK_FIELDS = [
  "$schema",
  "lockfile_version",
  "project_format",
  "libraries",
] as const;
const LIBRARY_LOCK_FIELDS = [
  "version",
  "path",
  "resolutionKind",
  "integrity",
  "files",
] as const;

const lockKeyOrder: JsonKeyOrder = (value, path) => {
  if (path.length === 0) {
    return TOP_LEVEL_LOCK_FIELDS;
  }

  if (path.length === 2 && path[0] === "libraries") {
    return LIBRARY_LOCK_FIELDS;
  }

  return Object.keys(value).sort(compareText);
};

export function computeFileIntegrity(rawBytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(rawBytes).digest("base64")}`;
}

export function computeLibraryIntegrity(
  files: Readonly<Record<string, string>>,
): string {
  const records = Object.keys(files)
    .sort(compareText)
    .map((path) => `${path}\0${files[path]!}\n`)
    .join("");
  return computeFileIntegrity(Buffer.from(records, "utf8"));
}

function libraryFilePath(
  library: LoadedLibrary,
  document: LoadedDocument<unknown>,
): string {
  const libraryDisplayRoot = posix.dirname(
    normalizeDiagnosticFile(library.manifest.file),
  );
  return posix.relative(
    libraryDisplayRoot,
    normalizeDiagnosticFile(document.file),
  );
}

function currentLibraryFiles(
  library: LoadedLibrary,
): Map<string, LibraryDocument> {
  const files = new Map<string, LibraryDocument>();
  files.set("library.json", library.manifest);

  for (const document of library.sources) {
    files.set(libraryFilePath(library, document), document);
  }

  return new Map(
    [...files].sort(([left], [right]) => compareText(left, right)),
  );
}

function libraryLockPath(library: LoadedLibrary): string {
  if (library.resolutionKind === "shipped") {
    return SHIPPED_CORE_LIBRARY_LOCATOR;
  }
  const path = library.dependency.path;
  if (path === undefined) {
    throw new Error("A local library dependency is missing its authored path.");
  }
  return path;
}

export function generateLibraryLock(
  project: LoadedProject,
): NormalizedLibraryLock {
  const libraries = Object.fromEntries(
    [...project.libraries]
      .sort((left, right) =>
        compareText(left.dependency.name, right.dependency.name),
      )
      .map((library) => {
        const files = Object.fromEntries(
          [...currentLibraryFiles(library)].map(
            ([path, document]) =>
              [path, computeFileIntegrity(document.rawBytes)] as const,
          ),
        ) as LibraryLockEntry["files"];

        return [
          library.dependency.name,
          {
            version: library.dependency.version,
            path: libraryLockPath(library),
            resolutionKind: library.resolutionKind,
            integrity: computeLibraryIntegrity(files),
            files,
          },
        ] as const;
      }),
  );

  return canonicalLock({
    $schema: LIBRARY_LOCK_SCHEMA_ID,
    lockfile_version: 1,
    project_format: project.manifest.value.format,
    libraries,
  });
}

export function serializeLibraryLock(lock: LibraryLock): string {
  return `${stringifyJson(canonicalLock(lock), lockKeyOrder)}\n`;
}

function canonicalBytes(project: LoadedProject): Uint8Array {
  return Buffer.from(
    serializeLibraryLock(generateLibraryLock(project)),
    "utf8",
  );
}

function missingLockDiagnostic(project: LoadedProject): Diagnostic {
  const pointer = "/libraries";
  return {
    code: "E105",
    severity: DIAGNOSTIC_CATALOG.E105.severity,
    message: `Project declares libraries but ${JSON.stringify(LIBRARY_LOCK_FILE_NAME)} is missing.`,
    file: normalizeDiagnosticFile(project.manifest.file),
    ...positionAt(project.manifest.nodes, pointer),
    jsonPointer: pointer,
  };
}

function formatMismatchDiagnostic(
  project: LoadedProject,
  lock: LibraryLock,
  lockNodes: JsonPointerNodeMap,
): Diagnostic {
  const manifestPointer = "/format";
  const lockPointer = "/project_format";
  return {
    code: "E106",
    severity: DIAGNOSTIC_CATALOG.E106.severity,
    message: `Lock project format ${JSON.stringify(lock.project_format)} does not match manifest format ${JSON.stringify(project.manifest.value.format)}.`,
    file: normalizeDiagnosticFile(project.manifest.file),
    ...positionAt(project.manifest.nodes, manifestPointer),
    jsonPointer: manifestPointer,
    related: [
      relatedAt(
        LIBRARY_LOCK_FILE_NAME,
        lockNodes,
        lockPointer,
        `Lock declares project format ${JSON.stringify(lock.project_format)}.`,
      ),
    ],
  };
}

function missingLibraryDiagnostic(
  project: LoadedProject,
  name: string,
  dependencyIndex: number,
): Diagnostic {
  const pointer = appendJsonPointer("/libraries", dependencyIndex);
  return {
    code: "E106",
    severity: DIAGNOSTIC_CATALOG.E106.severity,
    message: `Library ${JSON.stringify(name)} is declared by the manifest but missing from the lock.`,
    file: normalizeDiagnosticFile(project.manifest.file),
    ...positionAt(project.manifest.nodes, pointer),
    jsonPointer: pointer,
  };
}

function extraLibraryDiagnostic(
  name: string,
  lockNodes: JsonPointerNodeMap,
): Diagnostic {
  const pointer = appendJsonPointer("/libraries", name);
  return {
    code: "E106",
    severity: DIAGNOSTIC_CATALOG.E106.severity,
    message: `Library ${JSON.stringify(name)} exists in the lock but is not declared by the manifest.`,
    file: LIBRARY_LOCK_FILE_NAME,
    ...positionAt(lockNodes, pointer, "key"),
    jsonPointer: pointer,
  };
}

function dependencyFieldMismatchDiagnostic(
  project: LoadedProject,
  lockNodes: JsonPointerNodeMap,
  name: string,
  dependencyIndex: number,
  field: "version" | "path",
  expected: string,
  actual: string,
): Diagnostic {
  const manifestPointer = appendJsonPointer(
    appendJsonPointer("/libraries", dependencyIndex),
    field,
  );
  const lockPointer = appendJsonPointer(
    appendJsonPointer("/libraries", name),
    field,
  );
  return {
    code: "E106",
    severity: DIAGNOSTIC_CATALOG.E106.severity,
    message: `Library ${JSON.stringify(name)} lock ${field} ${JSON.stringify(actual)} does not match manifest ${field} ${JSON.stringify(expected)}.`,
    file: normalizeDiagnosticFile(project.manifest.file),
    ...positionAt(project.manifest.nodes, manifestPointer),
    jsonPointer: manifestPointer,
    related: [
      relatedAt(
        LIBRARY_LOCK_FILE_NAME,
        lockNodes,
        lockPointer,
        `Lock declares ${field} ${JSON.stringify(actual)}.`,
      ),
    ],
  };
}

function dependencyResolutionKindMismatchDiagnostic(
  project: LoadedProject,
  lockNodes: JsonPointerNodeMap,
  name: string,
  dependencyIndex: number,
  expected: "local" | "shipped",
  actual: "local" | "shipped",
): Diagnostic {
  const manifestPointer = appendJsonPointer("/libraries", dependencyIndex);
  const lockPointer = appendJsonPointer(
    appendJsonPointer("/libraries", name),
    "resolutionKind",
  );
  return {
    code: "E106",
    severity: DIAGNOSTIC_CATALOG.E106.severity,
    message: `Library ${JSON.stringify(name)} lock resolution kind ${JSON.stringify(actual)} does not match manifest-selected kind ${JSON.stringify(expected)}.`,
    file: normalizeDiagnosticFile(project.manifest.file),
    ...positionAt(project.manifest.nodes, manifestPointer),
    jsonPointer: manifestPointer,
    related: [
      relatedAt(
        LIBRARY_LOCK_FILE_NAME,
        lockNodes,
        lockPointer,
        `Lock declares resolution kind ${JSON.stringify(actual)}.`,
      ),
    ],
  };
}

function aggregateMismatchDiagnostic(
  name: string,
  lockNodes: JsonPointerNodeMap,
): Diagnostic {
  const pointer = appendJsonPointer(
    appendJsonPointer("/libraries", name),
    "integrity",
  );
  return {
    code: "E109",
    severity: DIAGNOSTIC_CATALOG.E109.severity,
    message: `Library ${JSON.stringify(name)} aggregate integrity does not match its locked file map.`,
    file: LIBRARY_LOCK_FILE_NAME,
    ...positionAt(lockNodes, pointer),
    jsonPointer: pointer,
  };
}

function fileSetMismatchDiagnostic(
  library: LoadedLibrary,
  name: string,
  lockNodes: JsonPointerNodeMap,
  added: readonly string[],
  removed: readonly string[],
): Diagnostic {
  const pointer = appendJsonPointer(
    appendJsonPointer("/libraries", name),
    "files",
  );
  return {
    code: "E107",
    severity: DIAGNOSTIC_CATALOG.E107.severity,
    message: `Library ${JSON.stringify(name)} file set differs: added ${JSON.stringify(added)}; removed ${JSON.stringify(removed)}.`,
    file: LIBRARY_LOCK_FILE_NAME,
    ...positionAt(lockNodes, pointer),
    jsonPointer: pointer,
    related: [
      relatedAt(
        library.manifest.file,
        library.manifest.nodes,
        "/sources",
        "Current library source globs declare this file set.",
      ),
    ],
  };
}

function fileIntegrityMismatchDiagnostic(
  document: LibraryDocument,
  name: string,
  path: string,
  expected: string,
  lockNodes: JsonPointerNodeMap,
): Diagnostic {
  const pointer = appendJsonPointer(
    appendJsonPointer(appendJsonPointer("/libraries", name), "files"),
    path,
  );
  return {
    code: "E108",
    severity: DIAGNOSTIC_CATALOG.E108.severity,
    message: `Library ${JSON.stringify(name)} file ${JSON.stringify(path)} integrity does not match the lock.`,
    file: normalizeDiagnosticFile(document.file),
    line: 1,
    column: 1,
    jsonPointer: "",
    related: [
      relatedAt(
        LIBRARY_LOCK_FILE_NAME,
        lockNodes,
        pointer,
        `Locked integrity is ${JSON.stringify(expected)}.`,
      ),
    ],
  };
}

function noncanonicalLockDiagnostic(): Diagnostic {
  return {
    code: "E110",
    severity: DIAGNOSTIC_CATALOG.E110.severity,
    message: `Lock file bytes are not canonical; run "thermite lock" to rewrite ${JSON.stringify(LIBRARY_LOCK_FILE_NAME)}.`,
    file: LIBRARY_LOCK_FILE_NAME,
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

export function verifyLibraryLock(
  project: LoadedProject,
  options: VerifyLibraryLockOptions = {},
): VerifyLibraryLockResult {
  const generatedBytes = canonicalBytes(project);
  const snapshot = project.libraryLock;

  if (snapshot.state === "missing") {
    return project.libraries.length === 0
      ? { ok: true, diagnostics: [], canonicalBytes: generatedBytes }
      : semanticFailure([missingLockDiagnostic(project)]);
  }

  if (snapshot.state === "error") {
    return {
      ok: false,
      diagnostics: [
        lockIoDiagnostic(
          `Unable to read ${JSON.stringify(LIBRARY_LOCK_FILE_NAME)} (${snapshot.detail}).`,
        ),
      ],
      toolFailure: true,
    };
  }

  if (snapshot.state === "invalid") {
    return semanticFailure(snapshot.diagnostics);
  }

  const lock: NormalizedLibraryLock = snapshot.value;
  const lockNodes = snapshot.nodes;
  const rawBytes = snapshot.rawBytes;
  const dependencies = project.manifest.value.libraries ?? [];
  const dependencyByName = new Map(
    dependencies.map((dependency, index) => [
      dependency.name,
      { dependency, index },
    ]),
  );
  const lockNames = Object.keys(lock.libraries).sort(compareText);
  const globalDiagnostics: Diagnostic[] = [];

  if (lock.project_format !== project.manifest.value.format) {
    globalDiagnostics.push(formatMismatchDiagnostic(project, lock, lockNodes));
  }

  for (const [name, { index }] of dependencyByName) {
    if (!Object.hasOwn(lock.libraries, name)) {
      globalDiagnostics.push(missingLibraryDiagnostic(project, name, index));
    }
  }

  for (const name of lockNames) {
    if (!dependencyByName.has(name)) {
      globalDiagnostics.push(extraLibraryDiagnostic(name, lockNodes));
    }
  }

  if (globalDiagnostics.length > 0) {
    return semanticFailure(globalDiagnostics);
  }

  const libraryByName = new Map(
    project.libraries.map((library) => [library.dependency.name, library]),
  );
  const eligible = new Set(lockNames);
  const semanticDiagnostics: Diagnostic[] = [];
  const dependencyFailures = new Set<string>();

  for (const name of lockNames) {
    const lockedLibrary = lock.libraries[name]!;
    const current = dependencyByName.get(name)!;
    const loadedLibrary = libraryByName.get(name)!;

    const expectedFields = {
      version: current.dependency.version,
      path: libraryLockPath(loadedLibrary),
    };
    for (const field of ["version", "path"] as const) {
      if (lockedLibrary[field] !== expectedFields[field]) {
        semanticDiagnostics.push(
          dependencyFieldMismatchDiagnostic(
            project,
            lockNodes,
            name,
            current.index,
            field,
            expectedFields[field],
            lockedLibrary[field],
          ),
        );
        dependencyFailures.add(name);
      }
    }
    if (lockedLibrary.resolutionKind !== loadedLibrary.resolutionKind) {
      semanticDiagnostics.push(
        dependencyResolutionKindMismatchDiagnostic(
          project,
          lockNodes,
          name,
          current.index,
          loadedLibrary.resolutionKind,
          lockedLibrary.resolutionKind,
        ),
      );
      dependencyFailures.add(name);
    }
  }

  for (const name of dependencyFailures) {
    eligible.delete(name);
  }

  const aggregateFailures = new Set<string>();

  for (const name of eligible) {
    const lockedLibrary = lock.libraries[name]!;

    if (
      computeLibraryIntegrity(lockedLibrary.files) !== lockedLibrary.integrity
    ) {
      semanticDiagnostics.push(aggregateMismatchDiagnostic(name, lockNodes));
      aggregateFailures.add(name);
    }
  }

  for (const name of aggregateFailures) {
    eligible.delete(name);
  }

  const fileSetFailures = new Set<string>();

  for (const name of eligible) {
    const library = libraryByName.get(name)!;
    const currentFiles = currentLibraryFiles(library);
    const lockedFiles = lock.libraries[name]!.files;
    const currentPaths = [...currentFiles.keys()];
    const lockedPaths = Object.keys(lockedFiles).sort(compareText);
    const added = currentPaths.filter(
      (path) => !Object.hasOwn(lockedFiles, path),
    );
    const removed = lockedPaths.filter((path) => !currentFiles.has(path));

    if (added.length > 0 || removed.length > 0) {
      semanticDiagnostics.push(
        fileSetMismatchDiagnostic(library, name, lockNodes, added, removed),
      );
      fileSetFailures.add(name);
    }
  }

  for (const name of fileSetFailures) {
    eligible.delete(name);
  }

  for (const name of eligible) {
    const library = libraryByName.get(name)!;
    const currentFiles = currentLibraryFiles(library);
    const lockedFiles = lock.libraries[name]!.files;

    for (const [path, document] of currentFiles) {
      const expected = lockedFiles[path]!;

      if (computeFileIntegrity(document.rawBytes) !== expected) {
        semanticDiagnostics.push(
          fileIntegrityMismatchDiagnostic(
            document,
            name,
            path,
            expected,
            lockNodes,
          ),
        );
      }
    }
  }

  if (semanticDiagnostics.length > 0) {
    return semanticFailure(semanticDiagnostics);
  }

  if (
    options.checkCanonical === true &&
    !Buffer.from(rawBytes).equals(Buffer.from(generatedBytes))
  ) {
    return semanticFailure([noncanonicalLockDiagnostic()]);
  }

  return {
    ok: true,
    diagnostics: [],
    canonicalBytes: generatedBytes,
    lock,
  };
}

export async function writeLibraryLock(
  project: LoadedProject,
  lock = generateLibraryLock(project),
  options: AtomicWriteOptions = {},
): Promise<void> {
  await writeFileAtomically(
    lockPath(project),
    serializeLibraryLock(lock),
    options,
  );
}

async function lockExists(project: LoadedProject): Promise<boolean> {
  try {
    await lstat(lockPath(project));
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function lockProject(
  inputPath?: string,
  cwd = process.cwd(),
  options: LockProjectOptions = {},
): Promise<LockProjectResult> {
  const loaded = await loadProject(inputPath, cwd);

  if (!loaded.ok) {
    return loaded;
  }

  const project = loaded.project;
  const generated = generateLibraryLock(project);
  const destination = lockPath(project);

  if (options.check === true) {
    const verified = await verifyLibraryLock(project, { checkCanonical: true });
    const diagnostics = normalizeDiagnostics([
      ...loaded.diagnostics,
      ...verified.diagnostics,
    ]);

    if (!verified.ok) {
      return {
        ok: false,
        diagnostics,
        toolFailure: verified.toolFailure,
      };
    }

    return {
      ok: true,
      diagnostics,
      lock: generated,
      lockPath: destination,
      written: false,
    };
  }

  let shouldWrite = project.libraries.length > 0;

  if (!shouldWrite) {
    try {
      shouldWrite = await lockExists(project);
    } catch (error) {
      return {
        ok: false,
        diagnostics: normalizeDiagnostics([
          ...loaded.diagnostics,
          lockIoDiagnostic(
            `Unable to inspect ${JSON.stringify(LIBRARY_LOCK_FILE_NAME)} (${errorDetail(error)}).`,
          ),
        ]),
        toolFailure: true,
      };
    }
  }

  if (shouldWrite) {
    try {
      await writeLibraryLock(project, generated, options.atomicWrite);
    } catch (error) {
      return {
        ok: false,
        diagnostics: normalizeDiagnostics([
          ...loaded.diagnostics,
          lockIoDiagnostic(
            `Unable to write ${JSON.stringify(LIBRARY_LOCK_FILE_NAME)} (${errorDetail(error)}).`,
          ),
        ]),
        toolFailure: true,
      };
    }
  }

  return {
    ok: true,
    diagnostics: normalizeDiagnostics(loaded.diagnostics),
    lock: generated,
    lockPath: destination,
    written: shouldWrite,
  };
}
