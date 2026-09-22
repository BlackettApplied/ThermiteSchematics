import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

import ts from "typescript";

import {
  REPOSITORY_ROOT,
  WORKSPACES,
  assertContainedPath,
  assertGitPath,
  assertOrdinaryFile,
  compareCodeUnits,
  enumerateTree,
  mkdirExclusive,
  parseJsonBytes,
  readGitIndexEntries,
  readGitObject,
  readJsonFile,
  resolveHeadCommit,
  verifyMaterializedFileMap,
  writeExclusiveFile,
} from "./release-common.mjs";

export const RELEASE_BUILD_ENVIRONMENT = Object.freeze({
  HOME: "release-out/.home",
  LANG: "C",
  LC_ALL: "C",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_CACHE: "release-out/.npm-cache",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_GLOBALCONFIG: "release-out/.npm-globalrc",
  NPM_CONFIG_IGNORE_SCRIPTS: "true",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  NPM_CONFIG_USERCONFIG: "release-out/.npm-userrc",
  PATH: "/opt/hostedtoolcache/node/24.11.1/x64/bin:/usr/bin:/bin",
  SOURCE_DATE_EPOCH: "0",
  TZ: "UTC",
});

export function assertDirectReleaseEnvironment(environment = process.env) {
  const order = ([left], [right]) => compareCodeUnits(left, right);
  const expected = Object.entries(RELEASE_BUILD_ENVIRONMENT).sort(order);
  const observed = Object.entries(environment).sort(order);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      "REL001 Direct release process environment is not the frozen env-i/0.1 map.",
    );
  }
}

export function assertReleaseToolVersions({
  nodeVersion = process.version,
  typescriptVersion = ts.version,
} = {}) {
  if (nodeVersion !== "v24.11.1") {
    throw new Error(`REL002 Expected Node v24.11.1; found ${nodeVersion}.`);
  }
  if (typescriptVersion !== "5.9.3") {
    throw new Error(
      `REL003 Expected TypeScript 5.9.3; found ${typescriptVersion}.`,
    );
  }
}

const BUILD_ORDER = Object.freeze([
  "schema",
  "core-library",
  "compiler",
  "query",
  "render",
  "agent-tools",
  "cli",
]);

const ROOT_CONFIGURATION_PATHS = Object.freeze([
  "package.json",
  "scripts/tsconfig.release.json",
  "tsconfig.base.json",
]);

function gitBlobObjectId(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function malformedCommitObject(context) {
  return new Error(
    `REL027 Git object data is truncated or malformed: ${context}.`,
  );
}

function parseTreeMode(bytes, context) {
  if (bytes.some((byte) => byte > 0x7f)) {
    throw malformedCommitObject(`${context} has a non-ASCII mode`);
  }
  const mode = bytes.toString("latin1");
  if (["40000", "100644", "100755", "120000", "160000"].includes(mode)) {
    return mode;
  }
  throw malformedCommitObject(`${context} has unsupported mode ${mode}`);
}

function compareTreeEntries(left, right) {
  const limit = Math.max(left.nameBytes.length, right.nameBytes.length) + 1;
  for (let index = 0; index < limit; index += 1) {
    const leftByte =
      index < left.nameBytes.length
        ? left.nameBytes[index]
        : left.mode === "40000"
          ? 0x2f
          : 0;
    const rightByte =
      index < right.nameBytes.length
        ? right.nameBytes[index]
        : right.mode === "40000"
          ? 0x2f
          : 0;
    if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
    if (index >= left.nameBytes.length && index >= right.nameBytes.length) {
      return 0;
    }
  }
  return 0;
}

function parseGitTree(bytes, objectId) {
  const entries = [];
  const names = new Set();
  let offset = 0;
  let previous;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) throw malformedCommitObject(`tree ${objectId}`);
    const mode = parseTreeMode(
      bytes.subarray(offset, space),
      `tree ${objectId}`,
    );
    const nameStart = space + 1;
    const nameEnd = bytes.indexOf(0, nameStart);
    if (nameEnd === -1 || nameEnd + 21 > bytes.length) {
      throw malformedCommitObject(`tree ${objectId}`);
    }
    const nameBytes = Buffer.from(bytes.subarray(nameStart, nameEnd));
    if (nameBytes.some((byte) => byte > 0x7f)) {
      throw malformedCommitObject(`tree ${objectId} has a non-ASCII name`);
    }
    const name = nameBytes.toString("latin1");
    if (
      name === "" ||
      name === "." ||
      name === ".." ||
      name.toLowerCase() === ".git" ||
      name.includes("/") ||
      name.includes(String.fromCharCode(92)) ||
      name.includes("\0")
    ) {
      throw malformedCommitObject(`tree ${objectId} has an unsafe name`);
    }
    if (names.has(name)) {
      throw malformedCommitObject(`tree ${objectId} has a duplicate name`);
    }
    const entry = Object.freeze({
      mode,
      name,
      nameBytes,
      objectId: bytes.subarray(nameEnd + 1, nameEnd + 21).toString("hex"),
    });
    if (previous !== undefined && compareTreeEntries(previous, entry) >= 0) {
      throw malformedCommitObject(`tree ${objectId} is not sorted`);
    }
    entries.push(entry);
    names.add(name);
    previous = entry;
    offset = nameEnd + 21;
  }
  return Object.freeze(entries);
}

function parseCommitTree(bytes, objectId) {
  const headerEnd = bytes.indexOf(Buffer.from("\n\n"));
  if (headerEnd === -1) throw malformedCommitObject(`commit ${objectId}`);
  const headerBytes = bytes.subarray(0, headerEnd);
  if (
    headerBytes.some((byte) => byte > 0x7f || byte === 0) ||
    headerBytes.includes(0x0d)
  ) {
    throw malformedCommitObject(`commit ${objectId} has non-ASCII headers`);
  }
  const headers = headerBytes.toString("latin1").split("\n");
  if (
    headers.some(
      (line, index) =>
        line === "" ||
        (index > 0 && !line.startsWith(" ") && !/^[a-z]+ .+$/u.test(line)),
    )
  ) {
    throw malformedCommitObject(`commit ${objectId} has malformed headers`);
  }
  const match = /^tree ([0-9a-f]{40})$/u.exec(headers[0]);
  if (match === null) {
    throw malformedCommitObject(
      `commit ${objectId} does not begin with a tree header`,
    );
  }
  return match[1];
}

function requiredTreeEntry(entries, name, mode, path) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(
      `REL035 Declared source commit is missing release input: ${path}.`,
    );
  }
  if (entry.mode !== mode) {
    throw new Error(
      `REL035 Declared source commit has forbidden mode ${entry.mode}: ${path}.`,
    );
  }
  return entry;
}

async function readExpectedGitObject(
  repositoryRoot,
  objectId,
  expectedType,
  objectReader,
) {
  const object = await objectReader(repositoryRoot, objectId);
  if (
    object === null ||
    typeof object !== "object" ||
    typeof object.type !== "string" ||
    !Buffer.isBuffer(object.bytes)
  ) {
    throw malformedCommitObject(`object reader result for ${objectId}`);
  }
  if (object.type !== expectedType) {
    throw new Error(
      `REL026 Git object type mismatch: expected ${expectedType}; found ${object.type} for ${objectId}.`,
    );
  }
  return object.bytes;
}

export async function releaseInputsFromCommit({
  repositoryRoot = REPOSITORY_ROOT,
  sourceCommit,
  objectReader = readGitObject,
} = {}) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "")) {
    throw new Error("REL030 A lowercase 40-hex source commit is required.");
  }
  const treeCache = new Map();
  async function readTree(objectId) {
    let entries = treeCache.get(objectId);
    if (entries === undefined) {
      entries = parseGitTree(
        await readExpectedGitObject(
          repositoryRoot,
          objectId,
          "tree",
          objectReader,
        ),
        objectId,
      );
      treeCache.set(objectId, entries);
    }
    return entries;
  }

  const commitBytes = await readExpectedGitObject(
    repositoryRoot,
    sourceCommit,
    "commit",
    objectReader,
  );
  const rootTreeId = parseCommitTree(commitBytes, sourceCommit);
  const root = await readTree(rootTreeId);
  const scripts = requiredTreeEntry(root, "scripts", "40000", "scripts/");
  const packages = requiredTreeEntry(root, "packages", "40000", "packages/");
  const rootInputs = [
    requiredTreeEntry(root, "package.json", "100644", "package.json"),
    requiredTreeEntry(
      await readTree(scripts.objectId),
      "tsconfig.release.json",
      "100644",
      "scripts/tsconfig.release.json",
    ),
    requiredTreeEntry(
      root,
      "tsconfig.base.json",
      "100644",
      "tsconfig.base.json",
    ),
  ];
  const inputs = ROOT_CONFIGURATION_PATHS.map((path, index) =>
    Object.freeze({
      path,
      mode: rootInputs[index].mode,
      objectId: rootInputs[index].objectId,
    }),
  );
  const packagesTree = await readTree(packages.objectId);

  async function collectSourceTree(treeId, prefix, output) {
    for (const entry of await readTree(treeId)) {
      const path = `${prefix}${entry.name}`;
      if (entry.mode === "40000") {
        await collectSourceTree(entry.objectId, `${path}/`, output);
      } else if (entry.mode === "100644") {
        if (!path.endsWith(".ts")) {
          throw new Error(
            `REL023 Tracked release source is not a .ts file: ${path}.`,
          );
        }
        output.push(
          Object.freeze({
            path,
            mode: entry.mode,
            objectId: entry.objectId,
          }),
        );
      } else {
        throw new Error(
          `REL035 Declared source commit has forbidden mode ${entry.mode}: ${path}.`,
        );
      }
    }
  }

  for (const directory of BUILD_ORDER) {
    const packagePrefix = `packages/${directory}/`;
    const packageEntry = requiredTreeEntry(
      packagesTree,
      directory,
      "40000",
      packagePrefix,
    );
    const packageTree = await readTree(packageEntry.objectId);
    for (const name of ["package.json", "tsconfig.json"]) {
      const path = `${packagePrefix}${name}`;
      const entry = requiredTreeEntry(packageTree, name, "100644", path);
      inputs.push(
        Object.freeze({
          path,
          mode: entry.mode,
          objectId: entry.objectId,
        }),
      );
    }
    const sourcePrefix = `${packagePrefix}src/`;
    const sourceEntry = requiredTreeEntry(
      packageTree,
      "src",
      "40000",
      sourcePrefix,
    );
    const sourceInputs = [];
    await collectSourceTree(sourceEntry.objectId, sourcePrefix, sourceInputs);
    sourceInputs.sort(({ path: left }, { path: right }) =>
      compareCodeUnits(left, right),
    );
    if (sourceInputs.length === 0) {
      throw new Error(
        `REL035 Declared source commit has no release source: ${sourcePrefix}**.`,
      );
    }
    inputs.push(...sourceInputs);
  }
  return Object.freeze(inputs);
}

function isReleaseIndexPath(path) {
  if (ROOT_CONFIGURATION_PATHS.includes(path)) return true;
  return BUILD_ORDER.some((directory) => {
    const packagePrefix = `packages/${directory}/`;
    return (
      path === `${packagePrefix}package.json` ||
      path === `${packagePrefix}tsconfig.json` ||
      path.startsWith(`${packagePrefix}src/`)
    );
  });
}

function containedRepositoryPath(repositoryRoot, path) {
  assertGitPath(path, "release input path");
  const root = resolve(repositoryRoot);
  const absolute = resolve(root, ...path.split("/"));
  const child = relative(root, absolute);
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error(
      `REL034 Git index is invalid: release input escaped the repository: ${path}.`,
    );
  }
  return absolute;
}

async function verifyTrackedReleaseInput(repositoryRoot, entry, fileReader) {
  const absolute = containedRepositoryPath(repositoryRoot, entry.path);
  try {
    await assertContainedPath(repositoryRoot, absolute);
    await assertOrdinaryFile(absolute, entry.path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `REL019 Tracked release input is missing from the worktree: ${entry.path}.`,
      );
    }
    throw error;
  }
  let bytes;
  try {
    bytes = Buffer.from(await fileReader(absolute));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `REL019 Tracked release input is missing from the worktree: ${entry.path}.`,
      );
    }
    throw error;
  }
  if (gitBlobObjectId(bytes) !== entry.objectId) {
    throw new Error(
      `REL020 Release input is modified relative to the Git index: ${entry.path}.`,
    );
  }
  return Object.freeze({ ...entry, bytes });
}

export async function verifyReleaseSourceInputs({
  repositoryRoot = REPOSITORY_ROOT,
  sourceCommit,
  indexEntries,
  objectReader = readGitObject,
  fileReader = readFile,
  resolvedHeadCommit,
} = {}) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "")) {
    throw new Error("REL030 A lowercase 40-hex source commit is required.");
  }
  const headCommit =
    resolvedHeadCommit ?? (await resolveHeadCommit(repositoryRoot));
  if (sourceCommit !== headCommit) {
    throw new Error(
      `REL030 Declared source commit ${sourceCommit} does not equal HEAD ${headCommit}.`,
    );
  }
  const entries = indexEntries ?? (await readGitIndexEntries(repositoryRoot));
  const entriesByPath = new Map();
  for (const entry of entries) {
    assertGitPath(entry.path, "index entry path");
    if (
      typeof entry.mode !== "string" ||
      !/^[0-9a-f]{40}$/u.test(entry.objectId ?? "")
    ) {
      throw new Error(
        `REL034 Git index is invalid: malformed stage-0 row for ${entry.path}.`,
      );
    }
    if (entriesByPath.has(entry.path)) {
      throw new Error(
        `REL034 Git index is invalid: duplicate stage-0 path ${entry.path}.`,
      );
    }
    entriesByPath.set(entry.path, entry);
  }

  const releaseEntries = await releaseInputsFromCommit({
    repositoryRoot,
    sourceCommit,
    objectReader,
  });
  const commitEntriesByPath = new Map(
    releaseEntries.map((entry) => [entry.path, entry]),
  );
  const additions = entries
    .filter(
      (entry) =>
        isReleaseIndexPath(entry.path) && !commitEntriesByPath.has(entry.path),
    )
    .sort(({ path: left }, { path: right }) => compareCodeUnits(left, right));
  if (additions.length !== 0) {
    throw new Error(
      `REL031 Staged release input was added outside the declared source commit: ${additions[0].path}.`,
    );
  }
  for (const committed of releaseEntries) {
    const indexed = entriesByPath.get(committed.path);
    if (indexed === undefined) {
      throw new Error(
        `REL033 Declared release input was deleted from the index: ${committed.path}.`,
      );
    }
    if (
      indexed.mode !== committed.mode ||
      indexed.objectId !== committed.objectId
    ) {
      throw new Error(
        `REL032 Staged release input differs from the declared source commit: ${committed.path}.`,
      );
    }
  }

  const sourceFilesByWorkspace = new Map();
  for (const directory of BUILD_ORDER) {
    const packagePrefix = `packages/${directory}/`;
    const sourcePrefix = `${packagePrefix}src/`;
    const sourceEntries = releaseEntries
      .filter(({ path }) => path.startsWith(sourcePrefix))
      .sort(({ path: left }, { path: right }) => compareCodeUnits(left, right));
    const sourceFiles = sourceEntries.map(({ path }) =>
      path.slice(sourcePrefix.length),
    );
    const trackedSourceFiles = new Set(sourceFiles);
    const sourceRoot = containedRepositoryPath(
      repositoryRoot,
      `packages/${directory}/src`,
    );
    await assertContainedPath(repositoryRoot, sourceRoot);
    for (const { path } of await enumerateTree(sourceRoot)) {
      if (!trackedSourceFiles.has(path)) {
        throw new Error(
          `REL021 Release source is untracked or ignored: ${sourcePrefix}${path}.`,
        );
      }
    }
    sourceFilesByWorkspace.set(directory, Object.freeze(sourceFiles));
  }

  const verifiedFiles = [];
  const filesByPath = new Map();
  for (const entry of releaseEntries) {
    const verified = await verifyTrackedReleaseInput(
      repositoryRoot,
      entry,
      fileReader,
    );
    verifiedFiles.push(verified);
    filesByPath.set(entry.path, verified);
  }

  return Object.freeze({
    releaseEntries,
    verifiedFiles: Object.freeze(verifiedFiles),
    filesByPath,
    verifiedInputs: new Map(
      verifiedFiles.map(({ path, bytes }) => [path, Buffer.from(bytes)]),
    ),
    sourceFilesByWorkspace,
  });
}

async function writeRootReleaseConfigurations(verifiedInputs, buildRoot) {
  for (const path of ROOT_CONFIGURATION_PATHS) {
    await writeExclusiveFile(
      join(buildRoot, "source", ...path.split("/")),
      verifiedInputs.get(path),
      0o644,
    );
  }
}

async function copyReleaseSources(
  buildRoot,
  directory,
  sourceFiles,
  verifiedInputs,
) {
  const privatePackage = join(buildRoot, "source", "packages", directory);
  await mkdirExclusive(privatePackage);
  for (const path of ["package.json", "tsconfig.json"]) {
    const logical = `packages/${directory}/${path}`;
    await writeExclusiveFile(
      join(privatePackage, path),
      verifiedInputs.get(logical),
      0o644,
    );
  }
  for (const path of sourceFiles) {
    const logical = `packages/${directory}/src/${path}`;
    await writeExclusiveFile(
      join(privatePackage, "src", path),
      verifiedInputs.get(logical),
      0o644,
    );
  }
  return sourceFiles;
}

function diagnosticText(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

export function createCompilerThirdPartyState() {
  return {
    bytes: new Map(),
    directoryExists: new Map(),
    directories: new Map(),
    reads: new Map(),
    realpaths: new Map(),
    stats: new Map(),
  };
}

const compilerThirdPartyState = createCompilerThirdPartyState();

function compilerPathKey(path) {
  const absolute = normalize(resolve(path));
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function seedCompilerThirdPartyState(state, capturedBytes) {
  if (!(state?.bytes instanceof Map) || !(capturedBytes instanceof Map)) {
    throw new Error("Compiler third-party state requires captured byte maps.");
  }
  for (const [path, bytes] of capturedBytes) {
    const key = compilerPathKey(path);
    const existing = state.bytes.get(key);
    if (existing !== undefined && !Buffer.from(existing).equals(bytes)) {
      throw new Error(`Compiler third-party bytes differ at ${path}.`);
    }
    state.bytes.set(key, Buffer.from(bytes));
  }
}

function pathIsWithin(root, path) {
  const child = relative(root, path);
  return (
    child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

function compilerText(bytes) {
  const input = Buffer.from(bytes);
  if (
    input.length >= 3 &&
    input[0] === 0xef &&
    input[1] === 0xbb &&
    input[2] === 0xbf
  ) {
    return input.subarray(3).toString("utf8");
  }
  return input.toString("utf8");
}

function immutableDirectories(files, roots) {
  const directories = new Set();
  for (const path of files.keys()) {
    let cursor = dirname(path);
    const authorityRoot = roots.find((root) => pathIsWithin(root, path));
    if (authorityRoot === undefined) continue;
    for (;;) {
      const key = compilerPathKey(cursor);
      if (directories.has(key)) break;
      directories.add(key);
      if (compilerPathKey(cursor) === compilerPathKey(authorityRoot)) break;
      const parent = dirname(cursor);
      if (parent === cursor || !pathIsWithin(authorityRoot, parent)) break;
      cursor = parent;
    }
  }
  return directories;
}

export function createImmutableCompilerHost({
  options,
  privateSourceRoot,
  immutableFiles,
  priorDeclarationFiles = new Map(),
  priorDeclarationRoot,
  rootPackageJsonBytes,
  repositoryRoot = REPOSITORY_ROOT,
  emittedFiles = new Map(),
  stagePrefix = "",
  thirdPartyState = compilerThirdPartyState,
  thirdPartyFileReader = readFileSync,
  thirdPartyStatReader = lstatSync,
  thirdPartyDirectoryReader = readdirSync,
  thirdPartyRealpathReader = realpathSync,
} = {}) {
  const defaultHost = ts.createCompilerHost(options);
  const privateRoot = resolve(privateSourceRoot);
  const nodeModulesRoot = resolve(repositoryRoot, "node_modules");
  const files = new Map(
    [...immutableFiles, ...priorDeclarationFiles].map(([path, bytes]) => [
      compilerPathKey(path),
      Buffer.from(bytes),
    ]),
  );
  if (rootPackageJsonBytes !== undefined) {
    files.set(
      compilerPathKey(resolve(repositoryRoot, "package.json")),
      Buffer.from(rootPackageJsonBytes),
    );
  }
  const immutableRoots = [
    privateRoot,
    ...(priorDeclarationRoot === undefined
      ? []
      : [resolve(priorDeclarationRoot)]),
  ];
  const directories = immutableDirectories(files, immutableRoots);

  const immutableBytes = (path) => files.get(compilerPathKey(path));
  const inNodeModules = (path) => pathIsWithin(nodeModulesRoot, resolve(path));
  const stateMap = (name) => {
    if (!(thirdPartyState[name] instanceof Map)) {
      thirdPartyState[name] = new Map();
    }
    return thirdPartyState[name];
  };
  const memoized = (map, key, read) => {
    if (!map.has(key)) map.set(key, read());
    return map.get(key);
  };
  const readThirdPartyStat = (path) => {
    if (!inNodeModules(path)) return undefined;
    const key = compilerPathKey(path);
    return memoized(stateMap("stats"), key, () => {
      try {
        const stats = thirdPartyStatReader(path, { bigint: true });
        return stats.isSymbolicLink() ? undefined : stats;
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          return undefined;
        }
        throw error;
      }
    });
  };
  const readThirdParty = (path) => {
    if (!inNodeModules(path)) return undefined;
    const key = compilerPathKey(path);
    const byteMap = stateMap("bytes");
    if (!byteMap.has(key)) {
      try {
        const stats = readThirdPartyStat(path);
        if (stats === undefined || !stats.isFile() || stats.nlink !== 1n) {
          byteMap.set(key, undefined);
        } else {
          const resolved = thirdPartyRealpathReader(path);
          if (!pathIsWithin(nodeModulesRoot, resolve(resolved))) {
            byteMap.set(key, undefined);
          } else {
            byteMap.set(key, Buffer.from(thirdPartyFileReader(path)));
          }
        }
      } catch (error) {
        if (
          error?.code === "ENOENT" ||
          error?.code === "EISDIR" ||
          error?.code === "ENOTDIR"
        ) {
          byteMap.set(key, undefined);
        } else {
          throw error;
        }
      }
    }
    return byteMap.get(key);
  };
  const readThirdPartyDirectory = (path) => {
    if (!inNodeModules(path)) return undefined;
    const key = compilerPathKey(path);
    return memoized(stateMap("directories"), key, () => {
      const stats = readThirdPartyStat(path);
      if (stats === undefined || !stats.isDirectory()) return undefined;
      try {
        const files = [];
        const directories = [];
        for (const entry of thirdPartyDirectoryReader(path, {
          withFileTypes: true,
        })) {
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) directories.push(entry.name);
          else if (entry.isFile()) files.push(entry.name);
        }
        files.sort(compareCodeUnits);
        directories.sort(compareCodeUnits);
        return Object.freeze({ files, directories });
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          return undefined;
        }
        throw error;
      }
    });
  };
  const readThirdPartyTree = (path, extensions, depth) => {
    const output = [];
    const visit = (directory, remaining) => {
      const snapshot = readThirdPartyDirectory(directory);
      if (snapshot === undefined) return;
      for (const name of snapshot.files) {
        const file = join(directory, name);
        if (
          extensions === undefined ||
          extensions.some((extension) => file.endsWith(extension))
        ) {
          output.push(file);
        }
      }
      if (remaining === 0) return;
      for (const name of snapshot.directories) {
        visit(
          join(directory, name),
          remaining === undefined ? undefined : remaining - 1,
        );
      }
    };
    visit(path, depth);
    return output.sort(compareCodeUnits);
  };

  const host = {
    ...defaultHost,
    getSourceFile(
      fileName,
      languageVersionOrOptions,
      onError,
      _shouldCreateNewSourceFile,
    ) {
      try {
        const text = host.readFile(fileName);
        return text === undefined
          ? undefined
          : ts.createSourceFile(
              fileName,
              text,
              languageVersionOrOptions,
              true,
              ts.getScriptKindFromFileName(fileName),
            );
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    fileExists(path) {
      if (immutableBytes(path) !== undefined) return true;
      if (inNodeModules(path)) return readThirdParty(path) !== undefined;
      return false;
    },
    readFile(path) {
      const captured = immutableBytes(path);
      if (captured !== undefined) return compilerText(captured);
      if (inNodeModules(path)) {
        const bytes = readThirdParty(path);
        return bytes === undefined ? undefined : compilerText(bytes);
      }
      return undefined;
    },
    directoryExists(path) {
      const key = compilerPathKey(path);
      if (directories.has(key)) return true;
      if (inNodeModules(path)) {
        return memoized(
          stateMap("directoryExists"),
          key,
          () => readThirdPartyDirectory(path) !== undefined,
        );
      }
      return false;
    },
    getDirectories(path) {
      const absolute = resolve(path);
      const key = compilerPathKey(path);
      if (directories.has(key)) {
        const children = new Set();
        for (const file of files.keys()) {
          const child = relative(absolute, file);
          if (
            child !== "" &&
            child !== ".." &&
            !child.startsWith(`..${sep}`) &&
            !isAbsolute(child) &&
            child.includes(sep)
          ) {
            children.add(child.split(sep)[0]);
          }
        }
        return [...children].sort(compareCodeUnits);
      }
      if (inNodeModules(path)) {
        const snapshot = readThirdPartyDirectory(path);
        return snapshot === undefined
          ? []
          : snapshot.directories.map((name) => join(path, name));
      }
      return [];
    },
    readDirectory(path, extensions, excludes, includes, depth) {
      const absolute = resolve(path);
      if (directories.has(compilerPathKey(path))) {
        return [...files.keys()]
          .filter((file) => {
            const child = relative(absolute, file);
            if (
              child === "" ||
              child === ".." ||
              child.startsWith(`..${sep}`) ||
              isAbsolute(child)
            ) {
              return false;
            }
            if (depth !== undefined && child.split(sep).length - 1 > depth) {
              return false;
            }
            return (
              extensions === undefined ||
              extensions.some((extension) => file.endsWith(extension))
            );
          })
          .sort(compareCodeUnits);
      }
      if (inNodeModules(path)) {
        const key = JSON.stringify([
          compilerPathKey(path),
          extensions,
          excludes,
          includes,
          depth,
        ]);
        return memoized(stateMap("reads"), key, () =>
          readThirdPartyTree(path, extensions, depth),
        );
      }
      return [];
    },
    realpath(path) {
      const key = compilerPathKey(path);
      if (immutableBytes(path) !== undefined || directories.has(key)) {
        return resolve(path);
      }
      if (inNodeModules(path)) {
        return memoized(stateMap("realpaths"), key, () => {
          const stats = readThirdPartyStat(path);
          if (stats === undefined) return undefined;
          if (stats.isFile() && readThirdParty(path) === undefined) {
            return undefined;
          }
          try {
            const resolved = resolve(thirdPartyRealpathReader(path));
            return pathIsWithin(nodeModulesRoot, resolved)
              ? resolved
              : undefined;
          } catch (error) {
            if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
              return undefined;
            }
            throw error;
          }
        });
      }
      return undefined;
    },
    writeFile(path, data, writeByteOrderMark, onError, sourceFiles) {
      const absolute = resolve(path);
      if (!pathIsWithin(resolve(options.outDir), absolute)) {
        throw new Error(`TypeScript output escaped its release root: ${path}.`);
      }
      const relativeOutput = relative(resolve(options.outDir), absolute)
        .split(sep)
        .join("/");
      if (
        relativeOutput === "" ||
        relativeOutput.startsWith("../") ||
        (!relativeOutput.endsWith(".js") && !relativeOutput.endsWith(".d.ts"))
      ) {
        throw new Error(`Fresh release output is forbidden: ${path}.`);
      }
      const bytes = Buffer.from(
        `${writeByteOrderMark ? "\ufeff" : ""}${data}`,
        "utf8",
      );
      const stagePath = `${stagePrefix}/dist/${relativeOutput}`;
      if (emittedFiles.has(stagePath)) {
        throw new Error(`Duplicate TypeScript release output: ${stagePath}.`);
      }
      emittedFiles.set(stagePath, bytes);
      defaultHost.writeFile(
        path,
        data,
        writeByteOrderMark,
        onError,
        sourceFiles,
      );
      chmodSync(path, 0o644);
      let directory = dirname(path);
      const outputDirectory = resolve(options.outDir);
      while (pathIsWithin(outputDirectory, directory)) {
        chmodSync(directory, 0o755);
        if (compilerPathKey(directory) === compilerPathKey(outputDirectory)) {
          break;
        }
        directory = dirname(directory);
      }
    },
  };
  return host;
}

export async function compileOnePackage(
  repositoryRoot,
  buildRoot,
  directory,
  sourceFiles,
  immutableFiles,
  emittedFiles,
  rootPackageJsonBytes,
  thirdPartyState,
  compilerHostOptions = {},
) {
  const packageRoot = join(buildRoot, "source", "packages", directory);
  const outputRoot = join(buildRoot, "packages", directory, "dist");
  const internalPaths = {};
  const priorDeclarationFiles = new Map();
  for (const workspace of WORKSPACES) {
    if (workspace.directory === directory) continue;
    const stageDeclaration = `${workspace.stagePath}/dist/index.d.ts`;
    const declaration = join(
      buildRoot,
      "packages",
      workspace.directory,
      "dist",
      "index.d.ts",
    );
    if (emittedFiles.has(stageDeclaration)) {
      internalPaths[workspace.name] = [declaration];
      const stagePrefix = `${workspace.stagePath}/dist/`;
      for (const [stagePath, bytes] of emittedFiles) {
        if (stagePath.startsWith(stagePrefix) && stagePath.endsWith(".d.ts")) {
          priorDeclarationFiles.set(
            join(
              buildRoot,
              "packages",
              workspace.directory,
              "dist",
              ...stagePath.slice(stagePrefix.length).split("/"),
            ),
            Buffer.from(bytes),
          );
        }
      }
    }
  }
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts"],
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    declaration: true,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
    composite: false,
    noEmitOnError: true,
    rootDir: join(packageRoot, "src"),
    outDir: outputRoot,
    baseUrl: repositoryRoot,
    paths: {
      ...internalPaths,
      "ajv/*": [join(repositoryRoot, "node_modules", "ajv", "*")],
      commander: [
        join(
          repositoryRoot,
          "node_modules",
          "commander",
          "typings",
          "index.d.ts",
        ),
      ],
      "elkjs/*": [join(repositoryRoot, "node_modules", "elkjs", "*")],
      "fast-glob": [
        join(repositoryRoot, "node_modules", "fast-glob", "out", "index.d.ts"),
      ],
      "jsonc-parser": [
        join(
          repositoryRoot,
          "node_modules",
          "jsonc-parser",
          "lib",
          "umd",
          "main.d.ts",
        ),
      ],
    },
    types: ["node"],
  };
  const rootNames = sourceFiles.map((path) => join(packageRoot, "src", path));
  const stagePrefix = WORKSPACES.find(
    (workspace) => workspace.directory === directory,
  ).stagePath;
  const host = createImmutableCompilerHost({
    options,
    privateSourceRoot: join(buildRoot, "source"),
    immutableFiles,
    priorDeclarationFiles,
    priorDeclarationRoot: join(buildRoot, "packages"),
    rootPackageJsonBytes,
    repositoryRoot,
    emittedFiles,
    stagePrefix,
    thirdPartyState,
    ...compilerHostOptions,
  });
  const program = ts.createProgram({ rootNames, options, host });
  const result = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(result.diagnostics);
  if (diagnostics.length !== 0 || result.emitSkipped) {
    const summary = diagnostics
      .map((diagnostic) => `TS${diagnostic.code} ${diagnosticText(diagnostic)}`)
      .join("\n");
    throw new Error(
      `Fresh release compilation failed for ${directory}.\n${summary}`,
    );
  }
  const files = await enumerateTree(outputRoot);
  const captured = [...emittedFiles.keys()]
    .filter((path) => path.startsWith(`${stagePrefix}/dist/`))
    .map((path) => path.slice(`${stagePrefix}/dist/`.length))
    .sort(compareCodeUnits);
  if (
    files.length === 0 ||
    files.some(
      ({ path }) => !path.endsWith(".js") && !path.endsWith(".d.ts"),
    ) ||
    JSON.stringify(files.map(({ path }) => path)) !== JSON.stringify(captured)
  ) {
    throw new Error(
      `Fresh release output contains a forbidden path for ${directory}.`,
    );
  }
  const materializedBytes = new Map(
    captured.map((path) => [
      path,
      Buffer.from(emittedFiles.get(`${stagePrefix}/dist/${path}`)),
    ]),
  );
  await verifyMaterializedFileMap({
    root: outputRoot,
    files: materializedBytes,
    label: `Fresh release output for ${directory}`,
  });
  return captured;
}

export async function buildFreshRelease({
  repositoryRoot = REPOSITORY_ROOT,
  buildRoot,
  sourceCommit,
  indexEntries,
  objectReader,
  fileReader,
  verifiedReleaseInputs,
  thirdPartyState = compilerThirdPartyState,
  compilerHostOptions,
  precreatedBuildRoot = false,
} = {}) {
  if (typeof buildRoot !== "string")
    throw new Error("A fresh build root is required.");
  const verified =
    verifiedReleaseInputs ??
    (await verifyReleaseSourceInputs({
      repositoryRoot,
      sourceCommit,
      ...(indexEntries === undefined ? {} : { indexEntries }),
      ...(objectReader === undefined ? {} : { objectReader }),
      ...(fileReader === undefined ? {} : { fileReader }),
    }));
  const releaseConfiguration = parseJsonBytes(
    verified.verifiedInputs.get("scripts/tsconfig.release.json"),
    "scripts/tsconfig.release.json",
  );
  const baseConfiguration = parseJsonBytes(
    verified.verifiedInputs.get("tsconfig.base.json"),
    "tsconfig.base.json",
  );
  const expectedReleaseConfiguration = {
    extends: "../tsconfig.base.json",
    compilerOptions: {
      composite: false,
      declaration: true,
      declarationMap: false,
      incremental: false,
      noEmitOnError: true,
      sourceMap: false,
    },
  };
  const expectedBaseConfiguration = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
    },
  };
  if (
    JSON.stringify(releaseConfiguration) !==
    JSON.stringify(expectedReleaseConfiguration)
  ) {
    throw new Error("Release-only TypeScript configuration differs.");
  }
  if (
    JSON.stringify(baseConfiguration) !==
    JSON.stringify(expectedBaseConfiguration)
  ) {
    throw new Error("Base TypeScript configuration differs.");
  }
  if (precreatedBuildRoot) {
    if (
      (await enumerateTree(buildRoot, { includeDirectories: true })).length !==
      0
    ) {
      throw new Error("Fresh release build root is not empty.");
    }
  } else {
    await mkdirExclusive(buildRoot);
  }
  await mkdirExclusive(join(buildRoot, "source"));
  await mkdirExclusive(join(buildRoot, "source", "packages"));
  await mkdirExclusive(join(buildRoot, "packages"));
  await writeRootReleaseConfigurations(verified.verifiedInputs, buildRoot);

  const immutableFiles = new Map(
    [...verified.verifiedInputs].map(([path, bytes]) => [
      join(buildRoot, "source", ...path.split("/")),
      Buffer.from(bytes),
    ]),
  );
  const outputBytes = new Map();
  const outputs = new Map();
  for (const directory of BUILD_ORDER) {
    const trackedSourceFiles = verified.sourceFilesByWorkspace.get(directory);
    const sourceFiles = await copyReleaseSources(
      buildRoot,
      directory,
      trackedSourceFiles,
      verified.verifiedInputs,
    );
    const distFiles = await compileOnePackage(
      repositoryRoot,
      buildRoot,
      directory,
      sourceFiles,
      immutableFiles,
      outputBytes,
      verified.verifiedInputs.get("package.json"),
      thirdPartyState,
      compilerHostOptions,
    );
    outputs.set(directory, Object.freeze(distFiles));
  }
  return Object.freeze({
    buildRoot,
    outputs,
    outputBytes,
    verifiedInputs: verified.verifiedInputs,
    verifiedReleaseInputs: verified,
  });
}

export function validateWorkspaceManifest(manifest, workspace) {
  if (
    manifest.name !== workspace.name ||
    manifest.version !== "0.2.0" ||
    manifest.private !== true ||
    manifest.license !== "Apache-2.0" ||
    manifest.type !== "module" ||
    manifest.engines?.node !== "^22.12.0 || >=24"
  ) {
    throw new Error(
      `Release workspace metadata is invalid for ${workspace.name}.`,
    );
  }
  return manifest;
}

export async function verifyWorkspaceMetadata(
  repositoryRoot = REPOSITORY_ROOT,
) {
  const packages = new Map();
  for (const workspace of WORKSPACES) {
    const manifestPath = join(
      repositoryRoot,
      "packages",
      workspace.directory,
      "package.json",
    );
    await assertOrdinaryFile(manifestPath);
    const manifest = validateWorkspaceManifest(
      await readJsonFile(manifestPath),
      workspace,
    );
    packages.set(workspace.name, manifest);
  }
  return packages;
}
