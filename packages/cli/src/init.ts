import {
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  rmdir as nodeRmdir,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHIPPED_CORE_FILE_INVENTORY,
  resolveShippedCoreLibrary,
} from "@thermite/compiler";

import {
  DEFAULT_STARTER_PROJECT_NAME,
  DEFAULT_STARTER_REVISION,
  STARTER_DIRECTORY_PATHS,
  STARTER_OUTPUT_FILE_PATHS,
  STARTER_TEMPLATE_PATHS,
  StarterAssetValidationError,
  prepareStarterScaffoldFromAssets,
  type ShippedCoreFilePath,
  type StarterAssetBytes,
  type StarterOutputFilePath,
  type StarterTemplatePath,
} from "./starter.js";

export type InitExitCode = 0 | 1 | 2;
export type InitFailureCode =
  | "INIT000"
  | "INIT001"
  | "INIT002"
  | "INIT003"
  | "INIT004"
  | "INIT005"
  | "INIT006"
  | "INIT007"
  | "INIT008"
  | "INIT009"
  | "INIT010"
  | "INIT011"
  | "INIT012";

export interface InitResult {
  readonly exitCode: InitExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

export interface InitFileStatus {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly nlink: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface InitFileHandle {
  stat(options: { readonly bigint: true }): Promise<InitFileStatus>;
  writeFile(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface InitFilesystemDependencies {
  realpath(path: string): Promise<string>;
  lstat(
    path: string,
    options: { readonly bigint: true },
  ): Promise<InitFileStatus>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
  mkdir(path: string): Promise<void>;
  open(path: string, flags: "wx", mode: 0o644): Promise<InitFileHandle>;
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
}

export interface InitAssetLocations {
  readonly cliPackageRootPath: string;
  readonly corePackageRootPath: string;
}

export interface RunInitOptions {
  readonly cwd?: string;
  readonly filesystem?: InitFilesystemDependencies;
  readonly assetLocations?: InitAssetLocations;
}

export type ParsedInitArguments =
  | {
      readonly kind: "action";
      readonly name: string;
      readonly revision: string;
    }
  | { readonly kind: "help" }
  | { readonly kind: "syntax-error" };

const INIT_MESSAGES: Readonly<Record<InitFailureCode, string>> = Object.freeze({
  INIT000: "INIT000 Cannot initialize: invalid command syntax.\n",
  INIT001:
    "INIT001 Cannot initialize: --name must be 1-160 XML-valid single-line Unicode code points.\n",
  INIT002:
    "INIT002 Cannot initialize: --revision must be 1-128 XML-valid single-line Unicode code points.\n",
  INIT003: "INIT003 Cannot initialize: current directory inspection failed.\n",
  INIT004:
    "INIT004 Cannot initialize: current directory is not an ordinary directory.\n",
  INIT005:
    "INIT005 Cannot initialize: packaged starter assets are unavailable.\n",
  INIT006: "INIT006 Cannot initialize: starter preparation failed.\n",
  INIT007: "INIT007 Cannot initialize: final empty-directory check failed.\n",
  INIT008: "INIT008 Cannot initialize: scaffold write failed.\n",
  INIT009:
    "INIT009 Cannot initialize: rollback failed; created entries may remain.\n",
  INIT010:
    "INIT010 Cannot initialize: concurrent filesystem change detected.\n",
  INIT011:
    "INIT011 Cannot initialize: rollback ownership changed; foreign entries were preserved.\n",
  INIT012:
    "INIT012 Cannot initialize: created entry identity capture failed.\n",
});

export const INIT_SYNTAX_MESSAGE = INIT_MESSAGES.INIT000;

export const INIT_NON_EMPTY_MESSAGE =
  "Cannot initialize: current directory is not empty.\n";
export const INIT_SUCCESS_MESSAGE =
  'Initialized Thermite Schematics project in ".".\n';

const FORBIDDEN_SINGLE_LINE = new Set([
  0x0009, 0x000a, 0x000d, 0x0085, 0x2028, 0x2029,
]);

const defaultFilesystem: InitFilesystemDependencies = Object.freeze({
  realpath: nodeRealpath,
  lstat: async (path: string, options: { readonly bigint: true }) =>
    (await nodeLstat(path, options)) as InitFileStatus,
  readdir: async (path: string) => nodeReaddir(path),
  readFile: nodeReadFile,
  mkdir: async (path: string) => {
    await nodeMkdir(path);
  },
  open: async (path: string, flags: "wx", mode: 0o644) =>
    (await nodeOpen(path, flags, mode)) as InitFileHandle,
  unlink: nodeUnlink,
  rmdir: nodeRmdir,
});

interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface CapturedAncestor extends Identity {
  readonly path: string;
}

interface CapturedEntry extends Identity {
  readonly logicalPath: string;
  readonly path: string;
  readonly type: "directory" | "file";
}

interface CapturedCwd {
  readonly path: string;
  readonly realpath: string;
  readonly ancestors: readonly CapturedAncestor[];
}

interface RollbackOutcome {
  readonly ioFailure: boolean;
  readonly guardRefusal: boolean;
}

function failure(code: InitFailureCode): InitResult {
  return { exitCode: 2, stdout: "", stderr: INIT_MESSAGES[code] };
}

function collision(): InitResult {
  return { exitCode: 1, stdout: "", stderr: INIT_NON_EMPTY_MESSAGE };
}

function success(): InitResult {
  return { exitCode: 0, stdout: INIT_SUCCESS_MESSAGE, stderr: "" };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isExisting(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

function isOrdinaryDirectory(status: InitFileStatus): boolean {
  return status.isDirectory() && !status.isSymbolicLink();
}

function isOrdinaryFile(status: InitFileStatus): boolean {
  return (
    status.isFile() && !status.isSymbolicLink() && BigInt(status.nlink) === 1n
  );
}

function identity(status: InitFileStatus): Identity {
  return { dev: BigInt(status.dev), ino: BigInt(status.ino) };
}

function sameIdentity(status: InitFileStatus, expected: Identity): boolean {
  const observedDev = BigInt(status.dev);
  return (
    BigInt(status.ino) === expected.ino &&
    (observedDev === expected.dev || observedDev === 0n || expected.dev === 0n)
  );
}

function ancestorPaths(path: string): string[] {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const remainder = absolute.slice(root.length);
  const segments = remainder === "" ? [] : remainder.split(sep).filter(Boolean);
  const paths = [root];
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    paths.push(current);
  }
  return paths;
}

function isXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x0009 ||
    codePoint === 0x000a ||
    codePoint === 0x000d ||
    (codePoint >= 0x0020 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

export function isValidInitText(value: string, maximum: number): boolean {
  const codePoints = [...value];
  if (codePoints.length === 0 || codePoints.length > maximum) {
    return false;
  }
  return codePoints.every((character) => {
    const codePoint = character.codePointAt(0)!;
    return isXmlCodePoint(codePoint) && !FORBIDDEN_SINGLE_LINE.has(codePoint);
  });
}

export function parseInitArguments(
  arguments_: readonly string[],
): ParsedInitArguments {
  if (arguments_.length === 1 && arguments_[0] === "--help") {
    return { kind: "help" };
  }
  let name = DEFAULT_STARTER_PROJECT_NAME;
  let revision = DEFAULT_STARTER_REVISION;
  let sawName = false;
  let sawRevision = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index]!;
    if (token === "--") {
      return index === arguments_.length - 1
        ? { kind: "action", name, revision }
        : { kind: "syntax-error" };
    }
    if (token !== "--name" && token !== "--revision") {
      return { kind: "syntax-error" };
    }
    if (
      (token === "--name" && sawName) ||
      (token === "--revision" && sawRevision)
    ) {
      return { kind: "syntax-error" };
    }
    const operand = arguments_[index + 1];
    if (operand === undefined) {
      return { kind: "syntax-error" };
    }
    index += 1;
    if (token === "--name") {
      sawName = true;
      name = operand;
    } else {
      sawRevision = true;
      revision = operand;
    }
  }
  return { kind: "action", name, revision };
}

async function inspectCurrentDirectory(
  cwd: string,
  filesystem: InitFilesystemDependencies,
): Promise<
  | { readonly kind: "ready"; readonly captured: CapturedCwd }
  | { readonly kind: "collision" }
  | { readonly kind: "failure"; readonly code: "INIT003" | "INIT004" }
> {
  let canonical: string;
  try {
    canonical = await filesystem.realpath(cwd);
  } catch {
    return { kind: "failure", code: "INIT003" };
  }

  const ancestors: CapturedAncestor[] = [];
  for (const path of ancestorPaths(cwd)) {
    let status: InitFileStatus;
    try {
      status = await filesystem.lstat(path, { bigint: true });
    } catch {
      return { kind: "failure", code: "INIT003" };
    }
    if (!isOrdinaryDirectory(status)) {
      return { kind: "failure", code: "INIT004" };
    }
    ancestors.push({ path, ...identity(status) });
  }

  let entries: string[];
  try {
    entries = await filesystem.readdir(cwd);
  } catch {
    return { kind: "failure", code: "INIT003" };
  }
  if (entries.length !== 0) {
    return { kind: "collision" };
  }
  return {
    kind: "ready",
    captured: { path: cwd, realpath: canonical, ancestors },
  };
}

async function loadAsset(
  path: string,
  filesystem: InitFilesystemDependencies,
): Promise<Uint8Array> {
  const status = await filesystem.lstat(path, { bigint: true });
  if (!isOrdinaryFile(status)) {
    throw new Error("Packaged asset is not an ordinary file.");
  }
  return filesystem.readFile(path);
}

async function loadStarterAssets(
  locations: InitAssetLocations,
  filesystem: InitFilesystemDependencies,
): Promise<StarterAssetBytes> {
  const agentGuide = await loadAsset(
    join(locations.cliPackageRootPath, "assets", "AGENTS.md"),
    filesystem,
  );
  const templates = new Map<StarterTemplatePath, Uint8Array>();
  for (const path of STARTER_TEMPLATE_PATHS) {
    templates.set(
      path,
      await loadAsset(
        join(
          locations.cliPackageRootPath,
          "templates",
          "starter-default",
          ...path.split("/"),
        ),
        filesystem,
      ),
    );
  }
  const shippedCore = new Map<ShippedCoreFilePath, Uint8Array>();
  for (const path of SHIPPED_CORE_FILE_INVENTORY) {
    shippedCore.set(
      path,
      await loadAsset(
        join(locations.corePackageRootPath, ...path.split("/")),
        filesystem,
      ),
    );
  }
  return { agentGuide, templates, shippedCore };
}

async function verifyCapturedCwd(
  captured: CapturedCwd,
  filesystem: InitFilesystemDependencies,
): Promise<"ok" | "rejected" | "changed"> {
  for (const ancestor of captured.ancestors) {
    let status: InitFileStatus;
    try {
      status = await filesystem.lstat(ancestor.path, { bigint: true });
    } catch {
      return "rejected";
    }
    if (!isOrdinaryDirectory(status) || !sameIdentity(status, ancestor)) {
      return "changed";
    }
  }
  return "ok";
}

async function finalEmptyRecheck(
  captured: CapturedCwd,
  filesystem: InitFilesystemDependencies,
): Promise<"ready" | "collision" | "io" | "changed"> {
  const cwdResult = await verifyCapturedCwd(captured, filesystem);
  if (cwdResult === "rejected") return "io";
  if (cwdResult === "changed") return "changed";
  let entries: string[];
  try {
    entries = await filesystem.readdir(captured.path);
  } catch {
    return "io";
  }
  return entries.length === 0 ? "ready" : "collision";
}

function createdAncestorFor(
  logicalPath: string,
  owned: readonly CapturedEntry[],
): CapturedEntry | undefined {
  const parent = logicalPath.includes("/")
    ? logicalPath.slice(0, logicalPath.lastIndexOf("/"))
    : undefined;
  return parent === undefined
    ? undefined
    : owned.find(
        (entry) => entry.type === "directory" && entry.logicalPath === parent,
      );
}

async function verifyBeforeCreate(
  logicalPath: string,
  captured: CapturedCwd,
  owned: readonly CapturedEntry[],
  filesystem: InitFilesystemDependencies,
): Promise<boolean> {
  if ((await verifyCapturedCwd(captured, filesystem)) !== "ok") {
    return false;
  }
  const parent = createdAncestorFor(logicalPath, owned);
  if (parent === undefined) return !logicalPath.includes("/");
  try {
    const status = await filesystem.lstat(parent.path, { bigint: true });
    return isOrdinaryDirectory(status) && sameIdentity(status, parent);
  } catch {
    return false;
  }
}

async function closeBeforeRollback(handle: InitFileHandle): Promise<boolean> {
  try {
    await handle.close();
    return false;
  } catch {
    return true;
  }
}

async function guardAncestorsForRollback(
  entry: CapturedEntry,
  captured: CapturedCwd,
  owned: readonly CapturedEntry[],
  filesystem: InitFilesystemDependencies,
): Promise<"ok" | "io" | "refused"> {
  for (const ancestor of captured.ancestors) {
    let status: InitFileStatus;
    try {
      status = await filesystem.lstat(ancestor.path, { bigint: true });
    } catch (error) {
      return isMissing(error) ? "refused" : "io";
    }
    if (!isOrdinaryDirectory(status) || !sameIdentity(status, ancestor)) {
      return "refused";
    }
  }
  const parent = createdAncestorFor(entry.logicalPath, owned);
  if (parent !== undefined) {
    try {
      const status = await filesystem.lstat(parent.path, { bigint: true });
      if (!isOrdinaryDirectory(status) || !sameIdentity(status, parent)) {
        return "refused";
      }
    } catch (error) {
      return isMissing(error) ? "refused" : "io";
    }
  }
  return "ok";
}

async function rollbackOwnedEntries(
  captured: CapturedCwd,
  owned: readonly CapturedEntry[],
  filesystem: InitFilesystemDependencies,
): Promise<RollbackOutcome> {
  let ioFailure = false;
  let guardRefusal = false;
  const absent = new Map<string, boolean>();

  for (const entry of [...owned].reverse()) {
    if (entry.type === "directory") {
      const childWasPreserved = owned.some(
        (candidate) =>
          candidate.logicalPath.startsWith(entry.logicalPath + "/") &&
          absent.get(candidate.logicalPath) !== true,
      );
      if (childWasPreserved) {
        absent.set(entry.logicalPath, false);
        continue;
      }
    }

    const ancestorGuard = await guardAncestorsForRollback(
      entry,
      captured,
      owned,
      filesystem,
    );
    if (ancestorGuard !== "ok") {
      if (ancestorGuard === "refused") guardRefusal = true;
      else ioFailure = true;
      absent.set(entry.logicalPath, false);
      continue;
    }

    let status: InitFileStatus;
    try {
      status = await filesystem.lstat(entry.path, { bigint: true });
    } catch (error) {
      if (isMissing(error)) {
        absent.set(entry.logicalPath, true);
      } else {
        ioFailure = true;
        absent.set(entry.logicalPath, false);
      }
      continue;
    }
    const typeMatches =
      entry.type === "file"
        ? isOrdinaryFile(status)
        : isOrdinaryDirectory(status);
    if (!typeMatches || !sameIdentity(status, entry)) {
      guardRefusal = true;
      absent.set(entry.logicalPath, false);
      continue;
    }

    try {
      if (entry.type === "file") await filesystem.unlink(entry.path);
      else await filesystem.rmdir(entry.path);
      absent.set(entry.logicalPath, true);
    } catch (error) {
      if (isMissing(error)) {
        absent.set(entry.logicalPath, true);
      } else {
        ioFailure = true;
        absent.set(entry.logicalPath, false);
      }
    }
  }
  return { ioFailure, guardRefusal };
}

async function failWithRollback(
  primary: "INIT008" | "INIT010",
  captured: CapturedCwd,
  owned: readonly CapturedEntry[],
  filesystem: InitFilesystemDependencies,
  openHandle?: InitFileHandle,
): Promise<InitResult> {
  const cleanupFailure =
    openHandle === undefined ? false : await closeBeforeRollback(openHandle);
  const rollback = await rollbackOwnedEntries(captured, owned, filesystem);
  if (rollback.guardRefusal) return failure("INIT011");
  if (cleanupFailure || rollback.ioFailure) return failure("INIT009");
  return failure(primary);
}

function directChildren(paths: readonly string[], directory: string): string[] {
  const prefix = directory === "" ? "" : directory + "/";
  return paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .filter((path) => !path.includes("/"))
    .sort();
}

async function verifyFinishedScaffold(
  captured: CapturedCwd,
  owned: readonly CapturedEntry[],
  prepared: ReadonlyMap<StarterOutputFilePath, Uint8Array>,
  filesystem: InitFilesystemDependencies,
): Promise<boolean> {
  const allPaths = [...STARTER_DIRECTORY_PATHS, ...STARTER_OUTPUT_FILE_PATHS];
  for (const directory of ["", ...STARTER_DIRECTORY_PATHS]) {
    if ((await verifyCapturedCwd(captured, filesystem)) !== "ok") return false;
    const entry = owned.find(
      (candidate) =>
        candidate.type === "directory" && candidate.logicalPath === directory,
    );
    if (directory !== "" && entry === undefined) return false;
    const absolute =
      directory === "" ? captured.path : join(captured.path, directory);
    try {
      if (entry !== undefined) {
        const status = await filesystem.lstat(entry.path, { bigint: true });
        if (!isOrdinaryDirectory(status) || !sameIdentity(status, entry)) {
          return false;
        }
      }
      const entries = (await filesystem.readdir(absolute)).sort();
      if (
        JSON.stringify(entries) !==
        JSON.stringify(directChildren(allPaths, directory))
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  for (const logicalPath of STARTER_OUTPUT_FILE_PATHS) {
    if ((await verifyCapturedCwd(captured, filesystem)) !== "ok") return false;
    const parent = createdAncestorFor(logicalPath, owned);
    if (parent !== undefined) {
      try {
        const parentStatus = await filesystem.lstat(parent.path, {
          bigint: true,
        });
        if (
          !isOrdinaryDirectory(parentStatus) ||
          !sameIdentity(parentStatus, parent)
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
    const entry = owned.find(
      (candidate) =>
        candidate.type === "file" && candidate.logicalPath === logicalPath,
    );
    if (entry === undefined) return false;
    try {
      const status = await filesystem.lstat(entry.path, { bigint: true });
      if (!isOrdinaryFile(status) || !sameIdentity(status, entry)) {
        return false;
      }
      const bytes = await filesystem.readFile(entry.path);
      if (!Buffer.from(bytes).equals(Buffer.from(prepared.get(logicalPath)!))) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function writeScaffold(
  captured: CapturedCwd,
  prepared: ReadonlyMap<StarterOutputFilePath, Uint8Array>,
  filesystem: InitFilesystemDependencies,
): Promise<InitResult> {
  const owned: CapturedEntry[] = [];
  const uncapturedCreatedPaths: string[] = [];

  for (const logicalPath of STARTER_DIRECTORY_PATHS) {
    if (!(await verifyBeforeCreate(logicalPath, captured, owned, filesystem))) {
      return failWithRollback("INIT010", captured, owned, filesystem);
    }
    const path = join(captured.path, logicalPath);
    try {
      await filesystem.mkdir(path);
    } catch (error) {
      return failWithRollback(
        isExisting(error) ? "INIT010" : "INIT008",
        captured,
        owned,
        filesystem,
      );
    }
    uncapturedCreatedPaths.push(logicalPath);
    let status: InitFileStatus;
    try {
      status = await filesystem.lstat(path, { bigint: true });
    } catch {
      return failure("INIT012");
    }
    if (!isOrdinaryDirectory(status)) {
      return failure("INIT012");
    }
    uncapturedCreatedPaths.pop();
    owned.push({ logicalPath, path, type: "directory", ...identity(status) });
  }

  for (const logicalPath of STARTER_OUTPUT_FILE_PATHS) {
    if (!(await verifyBeforeCreate(logicalPath, captured, owned, filesystem))) {
      return failWithRollback("INIT010", captured, owned, filesystem);
    }
    const path = join(captured.path, ...logicalPath.split("/"));
    let handle: InitFileHandle;
    try {
      handle = await filesystem.open(path, "wx", 0o644);
    } catch (error) {
      return failWithRollback(
        isExisting(error) ? "INIT010" : "INIT008",
        captured,
        owned,
        filesystem,
      );
    }

    let handleStatus: InitFileStatus;
    try {
      handleStatus = await handle.stat({ bigint: true });
    } catch {
      try {
        await handle.close();
      } catch {
        // INIT012 deliberately ignores no-identity close failure.
      }
      return failure("INIT012");
    }
    if (!isOrdinaryFile(handleStatus)) {
      try {
        await handle.close();
      } catch {
        // INIT012 deliberately ignores no-identity close failure.
      }
      return failure("INIT012");
    }

    const entry: CapturedEntry = {
      logicalPath,
      path,
      type: "file",
      ...identity(handleStatus),
    };
    owned.push(entry);
    try {
      const pathStatus = await filesystem.lstat(path, { bigint: true });
      if (!isOrdinaryFile(pathStatus) || !sameIdentity(pathStatus, entry)) {
        return failWithRollback("INIT010", captured, owned, filesystem, handle);
      }
    } catch {
      return failWithRollback("INIT010", captured, owned, filesystem, handle);
    }

    try {
      await handle.writeFile(prepared.get(logicalPath)!);
    } catch {
      return failWithRollback("INIT008", captured, owned, filesystem, handle);
    }
    try {
      await handle.close();
    } catch {
      return failWithRollback("INIT008", captured, owned, filesystem, handle);
    }
  }

  if (!(await verifyFinishedScaffold(captured, owned, prepared, filesystem))) {
    return failWithRollback("INIT010", captured, owned, filesystem);
  }
  void uncapturedCreatedPaths;
  return success();
}

function defaultAssetLocations(): InitAssetLocations {
  const cliPackageRootPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const corePackageRootPath = resolveShippedCoreLibrary().packageRootPath;
  return { cliPackageRootPath, corePackageRootPath };
}

export async function runInit(
  name = DEFAULT_STARTER_PROJECT_NAME,
  revision = DEFAULT_STARTER_REVISION,
  options: RunInitOptions = {},
): Promise<InitResult> {
  if (!isValidInitText(name, 160)) return failure("INIT001");
  if (!isValidInitText(revision, 128)) return failure("INIT002");

  const filesystem = options.filesystem ?? defaultFilesystem;
  let cwd: string;
  try {
    cwd = resolve(options.cwd ?? process.cwd());
  } catch {
    return failure("INIT003");
  }
  const inspected = await inspectCurrentDirectory(cwd, filesystem);
  if (inspected.kind === "failure") return failure(inspected.code);
  if (inspected.kind === "collision") return collision();

  let assets: StarterAssetBytes;
  try {
    assets = await loadStarterAssets(
      options.assetLocations ?? defaultAssetLocations(),
      filesystem,
    );
  } catch {
    return failure("INIT005");
  }

  let prepared: ReturnType<typeof prepareStarterScaffoldFromAssets>;
  try {
    prepared = prepareStarterScaffoldFromAssets(assets, name, revision);
  } catch (error) {
    return failure(
      error instanceof StarterAssetValidationError ? "INIT005" : "INIT006",
    );
  }

  const recheck = await finalEmptyRecheck(inspected.captured, filesystem);
  if (recheck === "io") return failure("INIT007");
  if (recheck === "changed") return failure("INIT010");
  if (recheck === "collision") return collision();

  return writeScaffold(inspected.captured, prepared.files, filesystem);
}
