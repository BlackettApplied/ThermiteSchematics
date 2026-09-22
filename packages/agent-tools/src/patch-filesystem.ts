import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  computeFileIntegrity,
  LIBRARY_LOCK_FILE_NAME,
  type LoadedDocument,
  type LoadedProject,
} from "@thermite/compiler";

import { createA004Error, type A004Error } from "./common/errors.js";
import { sanitizedErrorCode } from "./common/tool-failure.js";

export interface FileStatus {
  readonly dev: bigint;
  readonly ino: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface PatchFilesystemDependencies {
  readonly copyFile: (source: string, destination: string) => Promise<void>;
  readonly lstat: (path: string) => Promise<FileStatus>;
  readonly mkdir: (path: string) => Promise<unknown>;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly nameGeneration: (
    kind: "stage" | "quarantine",
    stagingParent: string,
  ) => string;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly readdir: (path: string) => Promise<readonly string[]>;
  readonly realpath: (path: string) => Promise<string>;
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
  readonly stat: (path: string) => Promise<FileStatus>;
  readonly rm: (
    path: string,
    options: {
      readonly recursive: true;
      readonly force: true;
      readonly maxRetries: 2;
      readonly retryDelay: 50;
    },
  ) => Promise<void>;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  /** Test-only seam for D10's defensive post-primary finally path. */
  readonly primaryStageRemovalIsConfirmed?: (ownedStagePath: string) => boolean;
}

export const defaultPatchFilesystemDependencies: PatchFilesystemDependencies =
  Object.freeze({
    copyFile,
    lstat: async (path: string) => lstat(path, { bigint: true }),
    mkdir: async (path: string) => mkdir(path),
    mkdtemp,
    nameGeneration: (kind: "stage" | "quarantine", stagingParent: string) =>
      join(
        stagingParent,
        kind === "stage"
          ? ".thermite-schematics-stage-"
          : ".thermite-schematics-quarantine-",
      ),
    readFile,
    readdir: async (path: string) => readdir(path),
    realpath,
    rename,
    rm,
    stat: async (path: string) => stat(path, { bigint: true }),
    writeFile,
  });

export const OWNED_STAGE_REMOVE_OPTIONS = Object.freeze({
  recursive: true as const,
  force: true as const,
  maxRetries: 2 as const,
  retryDelay: 50 as const,
});

export interface OwnedStageDirectory {
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

type OwnedStageCleanupLocation =
  | { readonly kind: "active"; readonly path: string }
  | {
      readonly kind: "quarantined";
      readonly parent: string;
      readonly child: string;
    }
  | { readonly kind: "absent" };

export interface OwnedStageCleanup {
  readonly owned: OwnedStageDirectory;
  readonly stagingParent: string;
  location: OwnedStageCleanupLocation;
  readonly auxiliaryQuarantineParents: string[];
}

type StageCleanupAttempt = "primary" | "final";
type StageCleanupGuard =
  "active-stage" | "quarantine-child" | "quarantine-parent-absence";

export function stageDirectoryPrefix(
  stagingParent: string,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
): string {
  return dependencies.nameGeneration("stage", stagingParent);
}

export async function captureOwnedStageDirectory(
  path: string,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
): Promise<OwnedStageDirectory> {
  const status = await dependencies.stat(path);
  if (!status.isDirectory()) {
    throw new TypeError(
      "The created staging path is not an ordinary directory.",
    );
  }
  return Object.freeze({ path, dev: status.dev, ino: status.ino });
}

export function createOwnedStageCleanup(
  owned: OwnedStageDirectory,
  stagingParent: string,
): OwnedStageCleanup {
  return {
    owned,
    stagingParent,
    location: { kind: "active", path: owned.path },
    auxiliaryQuarantineParents: [],
  };
}

export function ownedStageCleanupNeedsFinalAttempt(
  cleanup: OwnedStageCleanup,
): boolean {
  return cleanup.location.kind !== "absent";
}

function stageGuardMismatch(guard: StageCleanupGuard): Error {
  const stageGuardMismatchMessage = `Stage cleanup guard mismatch at ${JSON.stringify(guard)}.`;
  return Object.assign(new Error(stageGuardMismatchMessage), {
    code: "STAGE_GUARD_MISMATCH",
  });
}

function matchesOwnedStageIdentity(
  status: FileStatus,
  owned: OwnedStageDirectory,
): boolean {
  return (
    !status.isSymbolicLink() &&
    status.isDirectory() &&
    status.dev === owned.dev &&
    status.ino === owned.ino
  );
}

function forgetAuxiliaryQuarantine(
  cleanup: OwnedStageCleanup,
  quarantineParent: string,
): void {
  const index = cleanup.auxiliaryQuarantineParents.indexOf(quarantineParent);
  if (index >= 0) cleanup.auxiliaryQuarantineParents.splice(index, 1);
}

async function confirmQuarantineParentAbsence(
  cleanup: OwnedStageCleanup,
  quarantineParent: string,
  attempt: StageCleanupAttempt,
  dependencies: PatchFilesystemDependencies,
): Promise<void> {
  try {
    await dependencies.lstat(quarantineParent);
  } catch (error) {
    if (!isMissingError(error)) throw error;
    if (
      attempt === "primary" &&
      dependencies.primaryStageRemovalIsConfirmed?.(cleanup.owned.path) ===
        false
    ) {
      return;
    }
    cleanup.location = { kind: "absent" };
    return;
  }
  throw stageGuardMismatch("quarantine-parent-absence");
}

async function removeQuarantinedStage(
  cleanup: OwnedStageCleanup,
  quarantineParent: string,
  quarantineChild: string,
  observeParentFirst: boolean,
  attempt: StageCleanupAttempt,
  dependencies: PatchFilesystemDependencies,
): Promise<void> {
  if (observeParentFirst) {
    try {
      await dependencies.lstat(quarantineParent);
    } catch (error) {
      if (!isMissingError(error)) throw error;
      cleanup.location = { kind: "absent" };
      return;
    }
  }

  const childStatus = await dependencies.lstat(quarantineChild);
  if (!matchesOwnedStageIdentity(childStatus, cleanup.owned)) {
    throw stageGuardMismatch("quarantine-child");
  }

  await dependencies.rm(quarantineParent, OWNED_STAGE_REMOVE_OPTIONS);
  await confirmQuarantineParentAbsence(
    cleanup,
    quarantineParent,
    attempt,
    dependencies,
  );
}

export async function removeOwnedStageDirectory(
  cleanup: OwnedStageCleanup,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
  attempt: StageCleanupAttempt = "primary",
): Promise<void> {
  if (cleanup.location.kind === "absent") return;

  if (cleanup.location.kind === "quarantined") {
    await removeQuarantinedStage(
      cleanup,
      cleanup.location.parent,
      cleanup.location.child,
      true,
      attempt,
      dependencies,
    );
    return;
  }

  const activeStagePath = cleanup.location.path;
  let activeStatus: FileStatus;
  try {
    activeStatus = await dependencies.lstat(activeStagePath);
  } catch (error) {
    if (!isMissingError(error)) throw error;
    cleanup.location = { kind: "absent" };
    return;
  }
  if (!matchesOwnedStageIdentity(activeStatus, cleanup.owned)) {
    throw stageGuardMismatch("active-stage");
  }

  const quarantineParent = await dependencies.mkdtemp(
    dependencies.nameGeneration("quarantine", cleanup.stagingParent),
  );
  cleanup.auxiliaryQuarantineParents.push(quarantineParent);
  const quarantineChild = join(quarantineParent, "s");
  await dependencies.rename(activeStagePath, quarantineChild);
  forgetAuxiliaryQuarantine(cleanup, quarantineParent);
  cleanup.location = {
    kind: "quarantined",
    parent: quarantineParent,
    child: quarantineChild,
  };
  await removeQuarantinedStage(
    cleanup,
    quarantineParent,
    quarantineChild,
    false,
    attempt,
    dependencies,
  );
}

export type ProjectControlledRole =
  | "project-manifest"
  | "project-presentation"
  | "project-source"
  | "lock"
  | "local-library-manifest"
  | "local-library-source";

export interface ProjectControlledSnapshotEntry {
  readonly role: ProjectControlledRole;
  readonly dependencyIndex: number;
  readonly file: string;
  readonly integrity: string;
}

export type ProjectControlledSnapshot =
  readonly ProjectControlledSnapshotEntry[];

export type ProjectControlledSnapshotResult =
  | { readonly ok: true; readonly snapshot: ProjectControlledSnapshot }
  | { readonly ok: false; readonly error: A004Error };

interface SnapshotDocument {
  readonly role: Exclude<ProjectControlledRole, "lock">;
  readonly dependencyIndex: number;
  readonly file: string;
  readonly document: LoadedDocument<unknown>;
}

interface SnapshotLock {
  readonly role: "lock";
  readonly dependencyIndex: -1;
  readonly file: typeof LIBRARY_LOCK_FILE_NAME;
}

type SnapshotItem = SnapshotDocument | SnapshotLock;

const ROLE_RANK: Readonly<Record<ProjectControlledRole, number>> = {
  "project-manifest": 0,
  "project-presentation": 1,
  "project-source": 2,
  lock: 3,
  "local-library-manifest": 4,
  "local-library-source": 5,
};

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedRelativePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  return value === "" ? "." : value;
}

function pathEscapesRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
  return !pathEscapesRoot(resolve(root), resolve(candidate));
}

function safeSnapshotFile(root: string, path: string): string {
  const file = normalizedRelativePath(root, path);
  return CONTROL_CHARACTER_PATTERN.test(file) || isAbsolute(file)
    ? "<project>"
    : file;
}

function compareSnapshotEntries(
  left: ProjectControlledSnapshotEntry,
  right: ProjectControlledSnapshotEntry,
): number {
  return (
    ROLE_RANK[left.role] - ROLE_RANK[right.role] ||
    left.dependencyIndex - right.dependencyIndex ||
    compareCodeUnits(left.file, right.file)
  );
}

function snapshotEntryKey(entry: ProjectControlledSnapshotEntry): string {
  return JSON.stringify([
    ROLE_RANK[entry.role],
    entry.dependencyIndex,
    entry.file,
  ]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isMissingError(error: unknown): boolean {
  return sanitizedErrorCode(error) === "ENOENT";
}

async function readPresentFile(
  path: string,
  dependencies: PatchFilesystemDependencies,
): Promise<Uint8Array | "missing"> {
  try {
    const status = await dependencies.lstat(path);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new TypeError("A project-controlled path is not an ordinary file.");
    }
    return await dependencies.readFile(path);
  } catch (error) {
    if (isMissingError(error)) return "missing";
    throw error;
  }
}

export async function scanOrdinaryProjectTree(
  root: string,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
): Promise<string | undefined> {
  const rootStatus = await dependencies.lstat(root);
  if (rootStatus.isSymbolicLink()) return ".";
  if (!rootStatus.isDirectory()) {
    throw new TypeError("The project root is not an ordinary directory.");
  }
  const rootNames = [...(await dependencies.readdir(root))].sort(
    compareCodeUnits,
  );
  const pending = rootNames.map((name) => join(root, name)).reverse();
  while (pending.length > 0) {
    const path = pending.pop()!;
    const relativePath = normalizedRelativePath(root, path);
    const status = await dependencies.lstat(path);
    if (status.isSymbolicLink()) return relativePath;
    if (status.isDirectory()) {
      const names = [...(await dependencies.readdir(path))].sort(
        compareCodeUnits,
      );
      for (let index = names.length - 1; index >= 0; index -= 1) {
        pending.push(join(path, names[index]!));
      }
      continue;
    }
    if (!status.isFile()) {
      throw new TypeError("The project tree contains a non-ordinary entry.");
    }
  }
  return undefined;
}

export async function copyOrdinaryProjectTree(
  sourceRoot: string,
  destinationRoot: string,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
): Promise<void> {
  const rootNames = [...(await dependencies.readdir(sourceRoot))].sort(
    compareCodeUnits,
  );
  const pending = rootNames.map((name) => join(sourceRoot, name)).reverse();
  while (pending.length > 0) {
    const source = pending.pop()!;
    const destination = join(destinationRoot, relative(sourceRoot, source));
    const status = await dependencies.lstat(source);
    if (status.isSymbolicLink()) {
      throw new TypeError(
        "The project tree changed to contain a reparse point.",
      );
    }
    if (status.isDirectory()) {
      await dependencies.mkdir(destination);
      const names = [...(await dependencies.readdir(source))].sort(
        compareCodeUnits,
      );
      for (let index = names.length - 1; index >= 0; index -= 1) {
        pending.push(join(source, names[index]!));
      }
      continue;
    }
    if (!status.isFile()) {
      throw new TypeError("The project tree contains a non-ordinary entry.");
    }
    await dependencies.copyFile(source, destination);
  }
}

function presentationSnapshotFile(
  project: LoadedProject,
  document: LoadedDocument<unknown>,
): string {
  const file = safeSnapshotFile(project.logicalRootPath, document.logicalPath);
  if (file !== document.file) {
    throw new TypeError(
      "The project presentation display path is not its exact safe project-relative path.",
    );
  }
  return file;
}

function snapshotDocuments(
  project: LoadedProject,
): readonly SnapshotDocument[] {
  const documents: SnapshotDocument[] = [
    {
      role: "project-manifest",
      dependencyIndex: -1,
      file: safeSnapshotFile(
        project.logicalRootPath,
        project.manifest.logicalPath,
      ),
      document: project.manifest,
    },
    ...(project.presentation === undefined
      ? []
      : [
          {
            role: "project-presentation" as const,
            dependencyIndex: -1,
            file: presentationSnapshotFile(project, project.presentation),
            document: project.presentation,
          },
        ]),
    ...project.sources.map((document) => ({
      role: "project-source" as const,
      dependencyIndex: -1,
      file: safeSnapshotFile(project.logicalRootPath, document.logicalPath),
      document,
    })),
  ];
  for (const library of project.libraries) {
    if (library.resolutionKind !== "local") continue;
    documents.push({
      role: "local-library-manifest",
      dependencyIndex: library.dependencyIndex,
      file: safeSnapshotFile(
        project.logicalRootPath,
        library.manifest.logicalPath,
      ),
      document: library.manifest,
    });
    documents.push(
      ...library.sources.map((document) => ({
        role: "local-library-source" as const,
        dependencyIndex: library.dependencyIndex,
        file: safeSnapshotFile(project.logicalRootPath, document.logicalPath),
        document,
      })),
    );
  }
  return documents.sort((left, right) =>
    compareSnapshotEntries(
      { ...left, integrity: "missing" },
      { ...right, integrity: "missing" },
    ),
  );
}

function snapshotItems(project: LoadedProject): readonly SnapshotItem[] {
  const items: SnapshotItem[] = [
    ...snapshotDocuments(project),
    {
      role: "lock",
      dependencyIndex: -1,
      file: LIBRARY_LOCK_FILE_NAME,
    },
  ];
  return items.sort((left, right) =>
    compareSnapshotEntries(
      { ...left, integrity: "missing" },
      { ...right, integrity: "missing" },
    ),
  );
}

export interface ProjectControlledSnapshotPlanEntry {
  readonly role: ProjectControlledRole;
  readonly dependencyIndex: number;
  readonly file: string;
  readonly key: string;
}

export function projectControlledSnapshotPlan(
  project: LoadedProject,
): readonly ProjectControlledSnapshotPlanEntry[] {
  return Object.freeze(
    snapshotItems(project).map(({ role, dependencyIndex, file }) => ({
      role,
      dependencyIndex,
      file,
      key: snapshotEntryKey({
        role,
        dependencyIndex,
        file,
        integrity: "missing",
      }),
    })),
  );
}

export async function captureProjectControlledSnapshot(
  project: LoadedProject,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
): Promise<ProjectControlledSnapshotResult> {
  const entries: ProjectControlledSnapshotEntry[] = [];
  for (const item of snapshotItems(project)) {
    if (item.role === "lock") break;
    const expectedIntegrity = computeFileIntegrity(item.document.rawBytes);
    const bytes = await readPresentFile(
      item.document.canonicalPath,
      dependencies,
    );
    if (bytes === "missing") {
      return {
        ok: false,
        error: createA004Error(item.file, expectedIntegrity, "missing"),
      };
    }
    const actualIntegrity = computeFileIntegrity(bytes);
    if (!bytesEqual(bytes, item.document.rawBytes)) {
      return {
        ok: false,
        error: createA004Error(item.file, expectedIntegrity, actualIntegrity),
      };
    }
    entries.push({
      role: item.role,
      dependencyIndex: item.dependencyIndex,
      file: item.file,
      integrity: actualIntegrity,
    });
  }

  const lockPath = join(project.logicalRootPath, LIBRARY_LOCK_FILE_NAME);
  const lockBytes = await readPresentFile(lockPath, dependencies);
  let lockIntegrity: string;
  switch (project.libraryLock.state) {
    case "missing":
      if (lockBytes !== "missing") {
        return {
          ok: false,
          error: createA004Error(
            LIBRARY_LOCK_FILE_NAME,
            "missing",
            computeFileIntegrity(lockBytes),
          ),
        };
      }
      lockIntegrity = "missing";
      break;
    case "error":
      throw new TypeError("The loader could not capture the library lock.");
    case "invalid":
      if (lockBytes === "missing") {
        throw new TypeError(
          "The invalid library lock disappeared before capture.",
        );
      }
      lockIntegrity = computeFileIntegrity(lockBytes);
      break;
    case "valid": {
      const expectedIntegrity = computeFileIntegrity(
        project.libraryLock.rawBytes,
      );
      if (lockBytes === "missing") {
        return {
          ok: false,
          error: createA004Error(
            LIBRARY_LOCK_FILE_NAME,
            expectedIntegrity,
            "missing",
          ),
        };
      }
      lockIntegrity = computeFileIntegrity(lockBytes);
      if (!bytesEqual(lockBytes, project.libraryLock.rawBytes)) {
        return {
          ok: false,
          error: createA004Error(
            LIBRARY_LOCK_FILE_NAME,
            expectedIntegrity,
            lockIntegrity,
          ),
        };
      }
      break;
    }
  }
  entries.push({
    role: "lock",
    dependencyIndex: -1,
    file: LIBRARY_LOCK_FILE_NAME,
    integrity: lockIntegrity,
  });

  for (const item of snapshotItems(project)) {
    if (
      item.role !== "local-library-manifest" &&
      item.role !== "local-library-source"
    ) {
      continue;
    }
    const expectedIntegrity = computeFileIntegrity(item.document.rawBytes);
    const bytes = await readPresentFile(
      item.document.canonicalPath,
      dependencies,
    );
    if (bytes === "missing") {
      return {
        ok: false,
        error: createA004Error(item.file, expectedIntegrity, "missing"),
      };
    }
    const actualIntegrity = computeFileIntegrity(bytes);
    if (!bytesEqual(bytes, item.document.rawBytes)) {
      return {
        ok: false,
        error: createA004Error(item.file, expectedIntegrity, actualIntegrity),
      };
    }
    entries.push({
      role: item.role,
      dependencyIndex: item.dependencyIndex,
      file: item.file,
      integrity: actualIntegrity,
    });
  }

  return {
    ok: true,
    snapshot: Object.freeze(entries.sort(compareSnapshotEntries)),
  };
}

export function compareProjectControlledSnapshots(
  expected: ProjectControlledSnapshot,
  actual: ProjectControlledSnapshot,
): A004Error | undefined {
  const expectedByKey = new Map(
    expected.map((entry) => [snapshotEntryKey(entry), entry]),
  );
  const actualByKey = new Map(
    actual.map((entry) => [snapshotEntryKey(entry), entry]),
  );
  const union = new Map<string, ProjectControlledSnapshotEntry>();
  for (const entry of [...expected, ...actual]) {
    union.set(snapshotEntryKey(entry), entry);
  }
  const entries = [...union.values()].sort(compareSnapshotEntries);
  for (const entry of entries) {
    const key = snapshotEntryKey(entry);
    const expectedEntry = expectedByKey.get(key);
    const actualEntry = actualByKey.get(key);
    if (expectedEntry?.integrity === actualEntry?.integrity) continue;
    const file = expectedEntry?.file ?? actualEntry?.file ?? "<project>";
    return createA004Error(
      file,
      expectedEntry?.integrity ?? "missing",
      actualEntry?.integrity ?? "missing",
    );
  }
  return undefined;
}

async function ordinaryStatus(
  path: string,
  kind: "directory" | "file",
  dependencies: PatchFilesystemDependencies,
): Promise<boolean> {
  const status = await dependencies.lstat(path);
  if (status.isSymbolicLink()) return false;
  return kind === "directory" ? status.isDirectory() : status.isFile();
}

export async function validateProjectSourceChain(
  project: LoadedProject,
  document: LoadedDocument<unknown>,
  dependencies: PatchFilesystemDependencies = defaultPatchFilesystemDependencies,
): Promise<boolean> {
  try {
    if (
      !(await ordinaryStatus(
        project.logicalRootPath,
        "directory",
        dependencies,
      ))
    ) {
      return false;
    }
    const canonicalRoot = await dependencies.realpath(project.logicalRootPath);
    if (canonicalRoot !== project.canonicalRootPath) return false;

    const targetRelativePath = relative(
      project.logicalRootPath,
      document.logicalPath,
    );
    if (
      targetRelativePath === "" ||
      targetRelativePath === ".." ||
      targetRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(targetRelativePath)
    ) {
      return false;
    }
    const components = targetRelativePath.split(sep).filter(Boolean);
    let candidate = project.logicalRootPath;
    for (let index = 0; index < components.length; index += 1) {
      candidate = join(candidate, components[index]!);
      const isTarget = index === components.length - 1;
      if (
        !(await ordinaryStatus(
          candidate,
          isTarget ? "file" : "directory",
          dependencies,
        ))
      ) {
        return false;
      }
      const canonical = await dependencies.realpath(candidate);
      if (isTarget) {
        if (canonical !== document.canonicalPath) return false;
      } else if (pathEscapesRoot(project.canonicalRootPath, canonical)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
