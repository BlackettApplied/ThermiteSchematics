import { lstat, readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import {
  DIAGNOSTIC_CATALOG,
  appendJsonPointer,
  loadSchemaRegistry,
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  parseJson,
  validateProjectManifest,
  validateSourceDocument,
  validateUniqueUids,
  type Diagnostic,
  type JsonPointerNodeMap,
  type JsonValue,
  type LibraryFile,
  type LibraryLock,
  type LibraryManifest,
  type LibraryType,
  type ParsedDocument,
  type ProjectManifest,
  type ProjectObject,
  type ProjectPresentationFile,
  type SchemaRegistry,
  type SourceFile,
} from "@thermite/schema";
import {
  SHIPPED_CORE_DISPLAY_ROOT,
  SHIPPED_CORE_LIBRARY_LOCATOR,
  SHIPPED_CORE_LIBRARY_NAME,
  SHIPPED_CORE_LIBRARY_VERSION,
  resolveShippedCoreLibrary,
  type ShippedCoreLibraryResolution,
} from "@thermite/core-library";
import fastGlob from "fast-glob";

export type LoadedProjectSourceFile = Omit<SourceFile, "objects"> & {
  objects: ProjectObject[];
};

export type LoadedLibrarySourceFile = Omit<LibraryFile, "types"> & {
  types: LibraryType[];
};

export type LoadedDocumentOwner =
  | { kind: "project" }
  | { kind: "library"; name: string; dependencyIndex: number };

export type LoadedDocumentKind =
  | "project_manifest"
  | "project_presentation"
  | "project_source"
  | "library_manifest"
  | "library_source";

export interface LoadedDocument<T> {
  file: string;
  logicalPath: string;
  canonicalPath: string;
  rawBytes: Uint8Array;
  value: T;
  nodes: JsonPointerNodeMap;
  owner: LoadedDocumentOwner;
  kind: LoadedDocumentKind;
}

export type ProjectLibraryDependency = NonNullable<
  ProjectManifest["libraries"]
>[number];

export type LibraryResolutionKind = "local" | "shipped";

export interface LoadedLibrary {
  dependencyIndex: number;
  dependency: ProjectLibraryDependency;
  resolutionKind: LibraryResolutionKind;
  logicalRootPath: string;
  canonicalRootPath: string;
  manifest: LoadedDocument<LibraryManifest>;
  sources: LoadedDocument<LoadedLibrarySourceFile>[];
}

export type NormalizedLibraryLockEntry = Omit<
  LibraryLock["libraries"][string],
  "resolutionKind"
> & {
  resolutionKind: LibraryResolutionKind;
};

export type NormalizedLibraryLock = Omit<LibraryLock, "libraries"> & {
  libraries: Record<string, NormalizedLibraryLockEntry>;
};

export type LoadedLibraryLock =
  | { state: "missing" }
  | { state: "error"; detail: string }
  | { state: "invalid"; diagnostics: Diagnostic[] }
  | {
      state: "valid";
      rawBytes: Uint8Array;
      value: NormalizedLibraryLock;
      parsedValue: LibraryLock;
      nodes: JsonPointerNodeMap;
    };

export interface LoadProjectOptions {
  readonly resolveShippedCoreLibrary?: () => ShippedCoreLibraryResolution;
}

export interface LoadedProject {
  logicalRootPath: string;
  canonicalRootPath: string;
  manifest: LoadedDocument<ProjectManifest>;
  presentation?: LoadedDocument<ProjectPresentationFile>;
  sources: LoadedDocument<LoadedProjectSourceFile>[];
  libraries: LoadedLibrary[];
  /** Frozen during structural loading, but trusted only by the lock stage. */
  libraryLock: LoadedLibraryLock;
  structuralDiagnostics: Diagnostic[];
}

export type LoadResult =
  | {
      ok: true;
      diagnostics: Diagnostic[];
      project: LoadedProject;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
      toolFailure: boolean;
    };

interface LoadedValidationDiagnostics {
  diagnostics: Diagnostic[];
  toolFailure: boolean;
}

type UnvalidatedLoadedDocument = LoadedDocument<JsonValue>;

interface UnvalidatedLoadedLibrary {
  dependencyIndex: number;
  dependency: ProjectLibraryDependency;
  resolutionKind: LibraryResolutionKind;
  logicalRootPath: string;
  canonicalRootPath: string;
  manifest: UnvalidatedLoadedDocument;
  sources: UnvalidatedLoadedDocument[];
}

interface LoadState {
  documentDiagnostics: Diagnostic[];
  crossDiagnostics: Diagnostic[];
  documents: UnvalidatedLoadedDocument[];
  projectPresentation?: UnvalidatedLoadedDocument;
  projectSources: UnvalidatedLoadedDocument[];
  libraries: UnvalidatedLoadedLibrary[];
  projectCanonicalRootPath?: string;
  toolFailure: boolean;
}

interface ManifestResolution {
  manifestPath: string;
  manifestDirectory: string;
  displayFile: string;
}

interface GlobExpansion extends LoadedValidationDiagnostics {
  files: CanonicalMatchedFile[];
  canonicalRootPath?: string;
}

type RealpathFunction = (path: string) => Promise<string>;

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

type FileIdentityFunction = (path: string) => Promise<FileIdentity>;

interface CanonicalMatchedFile {
  canonicalPath: string;
  logicalPath: string;
  identityKey: string;
}

interface TypeDeclaration {
  file: string;
  line: number;
  column: number;
}

type JsonObject = { [key: string]: JsonValue | undefined };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positionAt(
  nodes: JsonPointerNodeMap,
  pointer: string,
): { line: number; column: number } {
  const location = nodes.get(pointer)?.value;
  return location === undefined
    ? { line: 1, column: 1 }
    : { line: location.line, column: location.column };
}

export function displayPath(
  absolutePath: string,
  manifestDirectory: string,
): string {
  const relativePath = relative(manifestDirectory, absolutePath);
  return normalizeDiagnosticFile(
    relativePath === "" ? basename(absolutePath) : relativePath,
  );
}

function ioDiagnostic(file: string, message: string): Diagnostic {
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message,
    file: normalizeDiagnosticFile(file),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function errorDetail(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return error instanceof Error ? error.message : "unknown failure";
}

async function resolveManifest(
  inputPath: string | undefined,
  cwd: string,
): Promise<ManifestResolution> {
  const targetPath = resolve(cwd, inputPath ?? ".");
  let manifestPath: string;

  try {
    const targetStat = await stat(targetPath);
    manifestPath = targetStat.isDirectory()
      ? join(targetPath, "system.json")
      : targetPath;
  } catch {
    manifestPath =
      extname(targetPath).toLowerCase() === ".json"
        ? targetPath
        : join(targetPath, "system.json");
  }

  const manifestDirectory = dirname(manifestPath);
  return {
    manifestPath,
    manifestDirectory,
    displayFile: displayPath(manifestPath, manifestDirectory),
  };
}

async function parseFile(
  logicalPath: string,
  file: string,
  owner: LoadedDocumentOwner,
  kind: LoadedDocumentKind,
  knownCanonicalPath?: string,
): Promise<
  | { document: UnvalidatedLoadedDocument; diagnostics: Diagnostic[] }
  | { diagnostics: Diagnostic[]; toolFailure: true }
  | { diagnostics: Diagnostic[]; toolFailure: false }
> {
  let rawBytes: Uint8Array;

  try {
    rawBytes = await readFile(knownCanonicalPath ?? logicalPath);
  } catch (error) {
    return {
      diagnostics: [
        ioDiagnostic(
          file,
          `Unable to read ${JSON.stringify(file)} (${errorDetail(error)}).`,
        ),
      ],
      toolFailure: true,
    };
  }

  const parsed = parseJson(Buffer.from(rawBytes).toString("utf8"), file);

  if (parsed.value === undefined || parsed.diagnostics.length > 0) {
    return { diagnostics: parsed.diagnostics, toolFailure: false };
  }

  let canonicalPath: string;

  try {
    canonicalPath = knownCanonicalPath ?? (await realpath(logicalPath));
  } catch (error) {
    return {
      diagnostics: [
        ioDiagnostic(
          file,
          `Unable to canonicalize ${JSON.stringify(file)} (${errorDetail(error)}).`,
        ),
      ],
      toolFailure: true,
    };
  }

  return {
    document: {
      file,
      logicalPath,
      canonicalPath,
      rawBytes,
      value: parsed.value,
      nodes: parsed.nodes,
      owner,
      kind,
    },
    diagnostics: [],
  };
}

function pathEscapesRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

async function rootInspectionDiagnostic(
  root: string,
  file: string,
  label: "project" | "library",
  manifestDirectory: string,
): Promise<Diagnostic | undefined> {
  try {
    if (!(await lstat(root)).isSymbolicLink()) {
      return undefined;
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) {
      return undefined;
    }

    return ioDiagnostic(
      file,
      `Unable to inspect ${label} source root (${errorDetail(error)}).`,
    );
  }

  const relativeRoot = relative(manifestDirectory, root);
  const displayedRoot = normalizeDiagnosticFile(
    relativeRoot === "" ? "." : relativeRoot,
  );
  return ioDiagnostic(
    file,
    `Rejected ${label} source root ${JSON.stringify(displayedRoot)} because it is a symlink or reparse-point component.`,
  );
}

async function staticBaseReparsePoint(
  root: string,
  pattern: string,
): Promise<string | undefined> {
  try {
    if ((await lstat(root)).isSymbolicLink()) {
      return root;
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) {
      return undefined;
    }

    throw error;
  }

  const bases = fastGlob
    .generateTasks(pattern)
    .map(({ base }) => resolve(root, normalizeDiagnosticFile(base)))
    .sort(compareText);

  for (const base of new Set(bases)) {
    const relativeBase = relative(root, base);
    const components =
      relativeBase === "" ? [] : relativeBase.split(sep).filter(Boolean);
    let candidate = root;

    for (const component of components) {
      candidate = join(candidate, component);

      try {
        if ((await lstat(candidate)).isSymbolicLink()) {
          return candidate;
        }
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) {
          break;
        }

        throw error;
      }
    }
  }

  return undefined;
}

export async function canonicalizeMatchedPath(
  canonicalRoot: string,
  matchedPath: string,
  canonicalize: RealpathFunction = realpath,
): Promise<string | undefined> {
  const canonicalMatch = await canonicalize(matchedPath);
  return pathEscapesRoot(canonicalRoot, canonicalMatch)
    ? undefined
    : canonicalMatch;
}

async function statFileIdentity(path: string): Promise<FileIdentity> {
  const fileStat = await stat(path, { bigint: true });
  return { dev: fileStat.dev, ino: fileStat.ino };
}

export async function canonicalizeMatchedFile(
  canonicalRoot: string,
  matchedPath: string,
  canonicalize: RealpathFunction = realpath,
  identify: FileIdentityFunction = statFileIdentity,
): Promise<CanonicalMatchedFile | undefined> {
  const canonicalPath = await canonicalizeMatchedPath(
    canonicalRoot,
    matchedPath,
    canonicalize,
  );

  if (canonicalPath === undefined) {
    return undefined;
  }

  try {
    const identity = await identify(canonicalPath);
    return {
      canonicalPath,
      logicalPath: matchedPath,
      identityKey: `stat:${identity.dev}:${identity.ino}`,
    };
  } catch {
    return {
      canonicalPath,
      logicalPath: matchedPath,
      identityKey: `path:${canonicalPath}`,
    };
  }
}

function isAbsoluteGlob(pattern: string): boolean {
  return posix.isAbsolute(pattern) || win32.isAbsolute(pattern);
}

function hasParentSegment(pattern: string): boolean {
  return pattern.split("/").includes("..");
}

function libraryPatternEscapesRoot(pattern: string): boolean {
  let depth = 0;

  for (const segment of pattern.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (depth === 0) {
        return true;
      }

      depth -= 1;
      continue;
    }

    // A globstar may consume zero segments, so it cannot establish containment.
    if (segment !== "**") {
      depth += 1;
    }
  }

  return false;
}

function unmatchedGlobDiagnostic(
  document: ParsedDocument,
  index: number,
  pattern: string,
): Diagnostic {
  const pointer = appendJsonPointer("/sources", index);
  return {
    code: "W901",
    severity: DIAGNOSTIC_CATALOG.W901.severity,
    message: `Project source glob ${JSON.stringify(pattern)} matched no files.`,
    file: normalizeDiagnosticFile(document.file),
    ...positionAt(document.nodes, pointer),
    jsonPointer: pointer,
  };
}

async function expandSourceGlobs(
  root: string,
  patterns: readonly string[],
  ownerDocument: ParsedDocument,
  projectSources: boolean,
): Promise<GlobExpansion> {
  const matched = new Map<string, CanonicalMatchedFile>();
  const diagnostics: Diagnostic[] = [];
  let toolFailure = false;
  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    return {
      files: [],
      diagnostics: [
        ioDiagnostic(
          ownerDocument.file,
          `Unable to canonicalize source root (${errorDetail(error)}).`,
        ),
      ],
      toolFailure: true,
    };
  }

  for (const [index, pattern] of patterns.entries()) {
    const invalidReason = isAbsoluteGlob(pattern)
      ? "absolute source globs are not allowed"
      : projectSources && hasParentSegment(pattern)
        ? "project source globs may not contain '..' segments"
        : !projectSources && libraryPatternEscapesRoot(pattern)
          ? "the source glob escapes the library root"
          : pattern.includes("\0")
            ? "source globs may not contain NUL characters"
            : undefined;

    if (invalidReason !== undefined) {
      diagnostics.push(
        ioDiagnostic(
          ownerDocument.file,
          `Rejected source glob ${JSON.stringify(pattern)}: ${invalidReason}.`,
        ),
      );
      toolFailure = true;
      continue;
    }

    let matches: string[];

    try {
      const reparsePoint = await staticBaseReparsePoint(root, pattern);

      if (reparsePoint !== undefined) {
        diagnostics.push(
          ioDiagnostic(
            ownerDocument.file,
            `Rejected source glob ${JSON.stringify(pattern)} because its static base contains symlink or reparse-point component ${JSON.stringify(
              displayPath(reparsePoint, root),
            )}.`,
          ),
        );
        toolFailure = true;
        continue;
      }

      matches =
        pattern === ""
          ? []
          : await fastGlob(pattern, {
              cwd: root,
              onlyFiles: true,
              followSymbolicLinks: false,
              unique: true,
            });
    } catch (error) {
      diagnostics.push(
        ioDiagnostic(
          ownerDocument.file,
          `Unable to expand source glob ${JSON.stringify(pattern)} (${errorDetail(error)}).`,
        ),
      );
      toolFailure = true;
      continue;
    }

    if (projectSources && matches.length === 0) {
      diagnostics.push(unmatchedGlobDiagnostic(ownerDocument, index, pattern));
    }

    for (const match of matches) {
      const normalizedMatch = normalizeDiagnosticFile(match);
      const absoluteMatch = resolve(root, normalizedMatch);

      if (pathEscapesRoot(root, absoluteMatch)) {
        diagnostics.push(
          ioDiagnostic(
            ownerDocument.file,
            `Rejected source glob ${JSON.stringify(pattern)} because it resolved outside its root.`,
          ),
        );
        toolFailure = true;
        continue;
      }

      let canonicalMatch: CanonicalMatchedFile | undefined;

      try {
        canonicalMatch = await canonicalizeMatchedFile(
          canonicalRoot,
          absoluteMatch,
        );
      } catch (error) {
        diagnostics.push(
          ioDiagnostic(
            ownerDocument.file,
            `Unable to canonicalize source file ${JSON.stringify(
              normalizedMatch,
            )} (${errorDetail(error)}).`,
          ),
        );
        toolFailure = true;
        continue;
      }

      if (canonicalMatch === undefined) {
        diagnostics.push(
          ioDiagnostic(
            ownerDocument.file,
            `Rejected source glob ${JSON.stringify(pattern)} because matched file ${JSON.stringify(
              normalizedMatch,
            )} resolves outside its canonical root.`,
          ),
        );
        toolFailure = true;
        continue;
      }

      const previousMatch = matched.get(canonicalMatch.identityKey);

      if (
        previousMatch === undefined ||
        compareText(
          normalizeDiagnosticFile(
            relative(canonicalRoot, canonicalMatch.canonicalPath),
          ),
          normalizeDiagnosticFile(
            relative(canonicalRoot, previousMatch.canonicalPath),
          ),
        ) < 0
      ) {
        matched.set(canonicalMatch.identityKey, canonicalMatch);
      }
    }
  }

  return {
    files: [...matched.values()].sort((left, right) =>
      compareText(
        displayPath(left.logicalPath, root),
        displayPath(right.logicalPath, root),
      ),
    ),
    canonicalRootPath: canonicalRoot,
    diagnostics,
    toolFailure,
  };
}

function stringArray(value: JsonValue | undefined): string[] | undefined {
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

function dependencyMismatchDiagnostics(
  dependency: JsonObject,
  dependencyIndex: number,
  manifest: ParsedDocument,
  libraryManifest: ParsedDocument,
): Diagnostic[] {
  if (!isJsonObject(libraryManifest.value)) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const field of ["name", "version"] as const) {
    const expected = dependency[field];
    const actual = libraryManifest.value[field];

    if (
      typeof expected !== "string" ||
      typeof actual !== "string" ||
      expected === actual
    ) {
      continue;
    }

    const dependencyPointer = appendJsonPointer(
      appendJsonPointer("/libraries", dependencyIndex),
      field,
    );
    const libraryPointer = appendJsonPointer("", field);
    diagnostics.push({
      code: "E028",
      severity: DIAGNOSTIC_CATALOG.E028.severity,
      message: `Dependency ${field} ${JSON.stringify(expected)} does not match library ${field} ${JSON.stringify(actual)}.`,
      file: normalizeDiagnosticFile(manifest.file),
      ...positionAt(manifest.nodes, dependencyPointer),
      jsonPointer: dependencyPointer,
      related: [
        {
          file: normalizeDiagnosticFile(libraryManifest.file),
          ...positionAt(libraryManifest.nodes, libraryPointer),
          note: `Library declares ${field} ${JSON.stringify(actual)}.`,
        },
      ],
    });
  }

  return diagnostics;
}

function libraryTypeDiagnostics(
  documents: readonly ParsedDocument[],
  libraryName: string,
): { diagnostics: Diagnostic[]; typeCount: number } {
  const firstById = new Map<string, TypeDeclaration>();
  const diagnostics: Diagnostic[] = [];
  let typeCount = 0;

  for (const document of documents) {
    if (!isJsonObject(document.value) || !Array.isArray(document.value.types)) {
      continue;
    }

    document.value.types.forEach((typeValue, index) => {
      if (!isJsonObject(typeValue)) {
        return;
      }

      if (typeValue.kind === "device_type" || typeValue.kind === "cable_type") {
        typeCount += 1;
      }

      if (typeof typeValue.id !== "string") {
        return;
      }

      const pointer = appendJsonPointer(
        appendJsonPointer("/types", index),
        "id",
      );
      const position = positionAt(document.nodes, pointer);
      const colonIndex = typeValue.id.indexOf(":");
      const namespace =
        colonIndex === -1 ? undefined : typeValue.id.slice(0, colonIndex);

      if (namespace !== undefined && namespace !== libraryName) {
        diagnostics.push({
          code: "E027",
          severity: DIAGNOSTIC_CATALOG.E027.severity,
          message: `Type id ${JSON.stringify(typeValue.id)} must use library namespace ${JSON.stringify(libraryName)}.`,
          file: normalizeDiagnosticFile(document.file),
          ...position,
          jsonPointer: pointer,
        });
      }

      const first = firstById.get(typeValue.id);

      if (first === undefined) {
        firstById.set(typeValue.id, {
          file: normalizeDiagnosticFile(document.file),
          ...position,
        });
        return;
      }

      diagnostics.push({
        code: "E022",
        severity: DIAGNOSTIC_CATALOG.E022.severity,
        message: `Duplicate type id ${JSON.stringify(typeValue.id)} within library ${JSON.stringify(libraryName)}.`,
        file: normalizeDiagnosticFile(document.file),
        ...position,
        jsonPointer: pointer,
        related: [
          {
            ...first,
            note: "First declaration of this type id.",
          },
        ],
      });
    });
  }

  return { diagnostics, typeCount };
}

function emptyLibraryDiagnostic(
  manifest: ParsedDocument,
  dependencyIndex: number,
  libraryName: string,
): Diagnostic {
  const pointer = appendJsonPointer("/libraries", dependencyIndex);
  return {
    code: "E029",
    severity: DIAGNOSTIC_CATALOG.E029.severity,
    message: `Library ${JSON.stringify(libraryName)} resolved zero type definitions.`,
    file: normalizeDiagnosticFile(manifest.file),
    ...positionAt(manifest.nodes, pointer),
    jsonPointer: pointer,
  };
}

interface LibraryRootResolution {
  readonly resolutionKind: LibraryResolutionKind;
  readonly libraryRoot: string;
  readonly libraryManifestFile: string;
  readonly displayRoot?: string;
}

function unavailableShippedLibraryDiagnostic(
  manifest: ParsedDocument,
  dependencyIndex: number,
  name: string,
  version: string,
): Diagnostic {
  const namePointer = appendJsonPointer(
    appendJsonPointer("/libraries", dependencyIndex),
    "name",
  );
  if (name !== SHIPPED_CORE_LIBRARY_NAME) {
    return {
      code: "E032",
      severity: DIAGNOSTIC_CATALOG.E032.severity,
      message: `Shipped library ${JSON.stringify(name)} at version ${JSON.stringify(version)} is unavailable.`,
      file: normalizeDiagnosticFile(manifest.file),
      ...positionAt(manifest.nodes, namePointer),
      jsonPointer: namePointer,
    };
  }

  const versionPointer = appendJsonPointer(
    appendJsonPointer("/libraries", dependencyIndex),
    "version",
  );
  return {
    code: "E032",
    severity: DIAGNOSTIC_CATALOG.E032.severity,
    message: `Shipped library ${JSON.stringify(name)} does not provide version ${JSON.stringify(version)}; available version is ${JSON.stringify(SHIPPED_CORE_LIBRARY_VERSION)}.`,
    file: normalizeDiagnosticFile(manifest.file),
    ...positionAt(manifest.nodes, versionPointer),
    jsonPointer: versionPointer,
  };
}

function resolveLibraryRoot(
  dependency: JsonObject,
  dependencyIndex: number,
  manifest: ParsedDocument,
  manifestDirectory: string,
  shippedCoreResolver: () => ShippedCoreLibraryResolution,
): LibraryRootResolution | Diagnostic {
  const name = dependency.name;
  const version = dependency.version;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error("Validated library dependency metadata is incomplete.");
  }

  if (typeof dependency.path === "string") {
    const libraryRoot = resolve(manifestDirectory, dependency.path);
    return {
      resolutionKind: "local",
      libraryRoot,
      libraryManifestFile: displayPath(
        join(libraryRoot, "library.json"),
        manifestDirectory,
      ),
    };
  }

  if (
    name !== SHIPPED_CORE_LIBRARY_NAME ||
    version !== SHIPPED_CORE_LIBRARY_VERSION
  ) {
    return unavailableShippedLibraryDiagnostic(
      manifest,
      dependencyIndex,
      name,
      version,
    );
  }

  const shipped = shippedCoreResolver();
  if (
    shipped.displayRoot !== SHIPPED_CORE_DISPLAY_ROOT ||
    shipped.locator !== SHIPPED_CORE_LIBRARY_LOCATOR
  ) {
    throw new Error("Shipped core resolver identity mismatch.");
  }
  return {
    resolutionKind: "shipped",
    libraryRoot: shipped.libraryRootPath,
    libraryManifestFile: `${shipped.displayRoot}/library.json`,
    displayRoot: shipped.displayRoot,
  };
}

async function inspectPresentationFile(
  manifestDirectory: string,
  presentationPath: string,
): Promise<Diagnostic | undefined> {
  let candidate = manifestDirectory;
  const components = presentationPath.split("/");

  for (const [index, component] of components.entries()) {
    candidate = join(candidate, component);
    let status;
    try {
      status = await lstat(candidate);
    } catch (error) {
      return ioDiagnostic(
        presentationPath,
        `Unable to inspect project presentation ${JSON.stringify(presentationPath)} (${errorDetail(error)}).`,
      );
    }

    if (status.isSymbolicLink()) {
      return ioDiagnostic(
        presentationPath,
        `Rejected project presentation ${JSON.stringify(presentationPath)} because it contains symlink or reparse-point component ${JSON.stringify(
          normalizeDiagnosticFile(relative(manifestDirectory, candidate)),
        )}.`,
      );
    }

    const finalComponent = index === components.length - 1;
    if (
      (finalComponent && !status.isFile()) ||
      (!finalComponent && !status.isDirectory())
    ) {
      return ioDiagnostic(
        presentationPath,
        `Rejected project presentation ${JSON.stringify(presentationPath)} because it is not an ordinary project file.`,
      );
    }
  }

  return undefined;
}

async function loadProjectPresentation(
  registry: SchemaRegistry,
  manifest: ParsedDocument,
  manifestDirectory: string,
  canonicalRootPath: string,
  state: LoadState,
): Promise<CanonicalMatchedFile | undefined> {
  if (
    !isJsonObject(manifest.value) ||
    typeof manifest.value.presentation !== "string"
  ) {
    return undefined;
  }

  const presentationPath = manifest.value.presentation;
  const logicalPath = resolve(manifestDirectory, presentationPath);
  if (pathEscapesRoot(manifestDirectory, logicalPath)) {
    state.documentDiagnostics.push(
      ioDiagnostic(
        presentationPath,
        `Rejected project presentation ${JSON.stringify(presentationPath)} because it resolves outside the project root.`,
      ),
    );
    state.toolFailure = true;
    return undefined;
  }

  const inspectionDiagnostic = await inspectPresentationFile(
    manifestDirectory,
    presentationPath,
  );
  if (inspectionDiagnostic !== undefined) {
    state.documentDiagnostics.push(inspectionDiagnostic);
    state.toolFailure = true;
    return undefined;
  }

  let matchedFile: CanonicalMatchedFile | undefined;
  try {
    matchedFile = await canonicalizeMatchedFile(canonicalRootPath, logicalPath);
  } catch (error) {
    state.documentDiagnostics.push(
      ioDiagnostic(
        presentationPath,
        `Unable to canonicalize project presentation ${JSON.stringify(presentationPath)} (${errorDetail(error)}).`,
      ),
    );
    state.toolFailure = true;
    return undefined;
  }

  if (matchedFile === undefined) {
    state.documentDiagnostics.push(
      ioDiagnostic(
        presentationPath,
        `Rejected project presentation ${JSON.stringify(presentationPath)} because it resolves outside the canonical project root.`,
      ),
    );
    state.toolFailure = true;
    return undefined;
  }

  const parsed = await parseFile(
    logicalPath,
    presentationPath,
    { kind: "project" },
    "project_presentation",
    matchedFile.canonicalPath,
  );
  state.documentDiagnostics.push(...parsed.diagnostics);
  if (!("document" in parsed)) {
    state.toolFailure ||= parsed.toolFailure;
    return undefined;
  }

  state.projectPresentation = parsed.document;
  state.documentDiagnostics.push(
    ...registry.validateEntity("project-presentation", parsed.document.value, {
      file: parsed.document.file,
      nodes: parsed.document.nodes,
    }),
  );
  return matchedFile;
}

async function loadProjectDocuments(
  registry: SchemaRegistry,
  manifest: ParsedDocument,
  manifestDirectory: string,
  state: LoadState,
): Promise<void> {
  if (!isJsonObject(manifest.value)) {
    return;
  }

  const sources = stringArray(manifest.value.sources);

  if (sources === undefined) {
    return;
  }

  const expansion = await expandSourceGlobs(
    manifestDirectory,
    sources,
    manifest,
    true,
  );
  state.documentDiagnostics.push(...expansion.diagnostics);
  state.toolFailure ||= expansion.toolFailure;

  if (expansion.canonicalRootPath === undefined) {
    return;
  }
  state.projectCanonicalRootPath = expansion.canonicalRootPath;
  const presentationMatch = await loadProjectPresentation(
    registry,
    manifest,
    manifestDirectory,
    expansion.canonicalRootPath,
    state,
  );

  for (const matchedFile of expansion.files) {
    const file = displayPath(matchedFile.logicalPath, manifestDirectory);
    if (
      presentationMatch !== undefined &&
      matchedFile.identityKey === presentationMatch.identityKey
    ) {
      if (file !== manifest.value.presentation) {
        state.documentDiagnostics.push(
          ioDiagnostic(
            file,
            `Rejected project source ${JSON.stringify(file)} because it aliases project presentation ${JSON.stringify(manifest.value.presentation)}.`,
          ),
        );
        state.toolFailure = true;
      }
      continue;
    }

    const parsed = await parseFile(
      matchedFile.logicalPath,
      file,
      { kind: "project" },
      "project_source",
      matchedFile.canonicalPath,
    );
    state.documentDiagnostics.push(...parsed.diagnostics);

    if (!("document" in parsed)) {
      state.toolFailure ||= parsed.toolFailure;
      continue;
    }

    state.projectSources.push(parsed.document);
    state.documents.push(parsed.document);
    state.documentDiagnostics.push(
      ...validateSourceDocument(registry, parsed.document),
    );
  }
}

async function loadLibraryDocuments(
  registry: SchemaRegistry,
  manifest: ParsedDocument,
  manifestDirectory: string,
  state: LoadState,
  shippedCoreResolver: () => ShippedCoreLibraryResolution,
): Promise<void> {
  if (
    !isJsonObject(manifest.value) ||
    !Array.isArray(manifest.value.libraries)
  ) {
    return;
  }

  for (const [
    dependencyIndex,
    dependencyValue,
  ] of manifest.value.libraries.entries()) {
    if (
      !isJsonObject(dependencyValue) ||
      typeof dependencyValue.name !== "string" ||
      typeof dependencyValue.version !== "string"
    ) {
      continue;
    }

    const rootResolution = resolveLibraryRoot(
      dependencyValue,
      dependencyIndex,
      manifest,
      manifestDirectory,
      shippedCoreResolver,
    );
    if ("code" in rootResolution) {
      state.crossDiagnostics.push(rootResolution);
      continue;
    }
    const { resolutionKind, libraryRoot, libraryManifestFile, displayRoot } =
      rootResolution;
    const libraryManifestPath = join(libraryRoot, "library.json");
    const rootDiagnostic = await rootInspectionDiagnostic(
      libraryRoot,
      libraryManifestFile,
      "library",
      manifestDirectory,
    );

    if (rootDiagnostic !== undefined) {
      state.documentDiagnostics.push(rootDiagnostic);
      state.toolFailure = true;
      continue;
    }

    const parsedManifest = await parseFile(
      libraryManifestPath,
      libraryManifestFile,
      {
        kind: "library",
        name: dependencyValue.name,
        dependencyIndex,
      },
      "library_manifest",
    );
    state.documentDiagnostics.push(...parsedManifest.diagnostics);

    if (!("document" in parsedManifest)) {
      state.toolFailure ||= parsedManifest.toolFailure;
      continue;
    }

    const libraryManifest = parsedManifest.document;
    state.documents.push(libraryManifest);
    const libraryManifestDiagnostics = registry.validateEntity(
      "library",
      libraryManifest.value,
      {
        file: libraryManifest.file,
        nodes: libraryManifest.nodes,
      },
    );
    state.documentDiagnostics.push(...libraryManifestDiagnostics);
    state.crossDiagnostics.push(
      ...dependencyMismatchDiagnostics(
        dependencyValue,
        dependencyIndex,
        manifest,
        libraryManifest,
      ),
    );

    if (
      libraryManifestDiagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      ) ||
      !isJsonObject(libraryManifest.value)
    ) {
      continue;
    }

    const sources = stringArray(libraryManifest.value.sources);
    const libraryName = libraryManifest.value.name;

    if (sources === undefined || typeof libraryName !== "string") {
      continue;
    }

    const expansion = await expandSourceGlobs(
      libraryRoot,
      sources,
      libraryManifest,
      false,
    );
    state.documentDiagnostics.push(...expansion.diagnostics);
    state.toolFailure ||= expansion.toolFailure;
    const libraryDocuments: UnvalidatedLoadedDocument[] = [];
    const owner: LoadedDocumentOwner = {
      kind: "library",
      name: libraryName,
      dependencyIndex,
    };

    for (const matchedFile of expansion.files) {
      const file =
        displayRoot === undefined
          ? displayPath(matchedFile.logicalPath, manifestDirectory)
          : posix.join(
              displayRoot,
              normalizeDiagnosticFile(
                relative(libraryRoot, matchedFile.logicalPath),
              ),
            );
      const parsed = await parseFile(
        matchedFile.logicalPath,
        file,
        owner,
        "library_source",
        matchedFile.canonicalPath,
      );
      state.documentDiagnostics.push(...parsed.diagnostics);

      if (!("document" in parsed)) {
        state.toolFailure ||= parsed.toolFailure;
        continue;
      }

      libraryDocuments.push(parsed.document);
      state.documents.push(parsed.document);
      state.documentDiagnostics.push(
        ...registry.validateEntity("library-file", parsed.document.value, {
          file: parsed.document.file,
          nodes: parsed.document.nodes,
        }),
      );
    }

    const libraryChecks = libraryTypeDiagnostics(libraryDocuments, libraryName);
    state.crossDiagnostics.push(...libraryChecks.diagnostics);

    if (!expansion.toolFailure && libraryChecks.typeCount === 0) {
      state.crossDiagnostics.push(
        emptyLibraryDiagnostic(manifest, dependencyIndex, libraryName),
      );
    }

    if (expansion.canonicalRootPath !== undefined) {
      state.libraries.push({
        dependencyIndex,
        dependency: dependencyValue as ProjectLibraryDependency,
        resolutionKind,
        logicalRootPath: libraryRoot,
        canonicalRootPath: expansion.canonicalRootPath,
        manifest: libraryManifest,
        sources: libraryDocuments,
      });
    }
  }
}

function typedDocument<T>(
  document: UnvalidatedLoadedDocument,
): LoadedDocument<T> {
  return document as unknown as LoadedDocument<T>;
}

function createLoadedProject(
  manifest: UnvalidatedLoadedDocument,
  manifestDirectory: string,
  state: LoadState,
): Omit<LoadedProject, "libraryLock" | "structuralDiagnostics"> | undefined {
  if (state.projectCanonicalRootPath === undefined) {
    return undefined;
  }

  return {
    logicalRootPath: manifestDirectory,
    canonicalRootPath: state.projectCanonicalRootPath,
    manifest: typedDocument<ProjectManifest>(manifest),
    ...(state.projectPresentation === undefined
      ? {}
      : {
          presentation: typedDocument<ProjectPresentationFile>(
            state.projectPresentation,
          ),
        }),
    sources: state.projectSources.map((document) =>
      typedDocument<LoadedProjectSourceFile>(document),
    ),
    libraries: state.libraries.map((library) => ({
      dependencyIndex: library.dependencyIndex,
      dependency: library.dependency,
      resolutionKind: library.resolutionKind,
      logicalRootPath: library.logicalRootPath,
      canonicalRootPath: library.canonicalRootPath,
      manifest: typedDocument<LibraryManifest>(library.manifest),
      sources: library.sources.map((document) =>
        typedDocument<LoadedLibrarySourceFile>(document),
      ),
    })),
  };
}

async function loadLibraryLockSnapshot(
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

export async function loadProject(
  inputPath?: string,
  cwd = process.cwd(),
  options: LoadProjectOptions = {},
): Promise<LoadResult> {
  const resolution = await resolveManifest(inputPath, cwd);
  const state: LoadState = {
    documentDiagnostics: [],
    crossDiagnostics: [],
    documents: [],
    projectSources: [],
    libraries: [],
    toolFailure: false,
  };
  let loadedManifest: UnvalidatedLoadedDocument | undefined;
  let loadedRegistry: SchemaRegistry | undefined;

  try {
    const rootDiagnostic = await rootInspectionDiagnostic(
      resolution.manifestDirectory,
      resolution.displayFile,
      "project",
      resolution.manifestDirectory,
    );

    if (rootDiagnostic !== undefined) {
      state.documentDiagnostics.push(rootDiagnostic);
      state.toolFailure = true;
      return {
        ok: false,
        diagnostics: state.documentDiagnostics,
        toolFailure: state.toolFailure,
      };
    }

    const parsedManifest = await parseFile(
      resolution.manifestPath,
      resolution.displayFile,
      { kind: "project" },
      "project_manifest",
    );
    state.documentDiagnostics.push(...parsedManifest.diagnostics);

    if (!("document" in parsedManifest)) {
      state.toolFailure = parsedManifest.toolFailure;
    } else {
      const manifest = parsedManifest.document;
      loadedManifest = manifest;
      try {
        loadedRegistry = await loadSchemaRegistry();
      } catch (error) {
        state.documentDiagnostics.push(
          ioDiagnostic(
            resolution.displayFile,
            `Unable to initialize schema validation (${errorDetail(error)}).`,
          ),
        );
        state.toolFailure = true;
      }

      if (loadedRegistry !== undefined) {
        const manifestDiagnostics = validateProjectManifest(
          loadedRegistry,
          manifest,
        );
        state.documentDiagnostics.push(...manifestDiagnostics);

        if (
          !manifestDiagnostics.some(
            (diagnostic) => diagnostic.severity === "error",
          )
        ) {
          await loadProjectDocuments(
            loadedRegistry,
            manifest,
            resolution.manifestDirectory,
            state,
          );
          await loadLibraryDocuments(
            loadedRegistry,
            manifest,
            resolution.manifestDirectory,
            state,
            options.resolveShippedCoreLibrary ?? resolveShippedCoreLibrary,
          );
          state.crossDiagnostics.push(...validateUniqueUids(state.documents));
        }
      }
    }
  } catch (error) {
    state.documentDiagnostics.push(
      ioDiagnostic(
        resolution.displayFile,
        `Validation tool failure (${errorDetail(error)}).`,
      ),
    );
    state.toolFailure = true;
  }

  const diagnostics = normalizeDiagnostics([
    // Put whole-library E022 before the per-file E022 so deduplication retains
    // the correct cross-file wording and first-declaration relationship.
    ...state.crossDiagnostics,
    ...state.documentDiagnostics,
  ]);

  if (
    state.toolFailure ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return {
      ok: false,
      diagnostics,
      toolFailure: state.toolFailure,
    };
  }

  const project =
    loadedManifest === undefined
      ? undefined
      : createLoadedProject(
          loadedManifest,
          resolution.manifestDirectory,
          state,
        );

  if (project === undefined) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        ioDiagnostic(
          resolution.displayFile,
          "Validation tool failure (incomplete loaded project).",
        ),
      ],
      toolFailure: true,
    };
  }

  const libraryLock = await loadLibraryLockSnapshot(
    project.logicalRootPath,
    loadedRegistry!,
  );

  return {
    ok: true,
    diagnostics,
    project: { ...project, libraryLock, structuralDiagnostics: diagnostics },
  };
}
