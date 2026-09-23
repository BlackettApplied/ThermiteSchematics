import { gzipSync } from "node:zlib";
import { isBuiltin } from "node:module";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  RELEASE_ARTIFACT,
  RELEASE_OUTPUT_NAMES,
  REPOSITORY_ROOT,
  WORKSPACES,
  assertOrdinaryDirectory,
  assertOrdinaryFile,
  compareCodeUnits,
  enumerateTree,
  materializeFileMap,
  mkdirExclusive,
  parseJsonBytes,
  parseNamedArguments,
  pathExists,
  resolveHeadCommit,
  serializeCanonicalJson,
  sha256,
  writeCommittedJson,
  writeExclusiveFile,
} from "./release-common.mjs";
import {
  assertDirectReleaseEnvironment,
  assertReleaseToolVersions,
  buildFreshRelease,
  createCompilerThirdPartyState,
  seedCompilerThirdPartyState,
  validateWorkspaceManifest,
  verifyReleaseSourceInputs,
} from "./release-build.mjs";
import {
  assertInventoryEqual,
  auditStageDeclarationClosure,
  collectThirdPartySource,
  stageThirdPartyPackages,
  transformPackageManifest,
} from "./release-third-party-inventory.mjs";

const STARTER_FILES = Object.freeze([
  "system.json",
  "presentation.json",
  "electrical-system.lock.json",
  "devices/equipment.json",
  "connections/control-power.json",
  "potentials/potentials.json",
]);

const COMMITTED_INVENTORY_PATHS = Object.freeze({
  firstParty: "scripts/release-first-party-files.json",
  thirdPartySource: "scripts/release-third-party-source-files.json",
  thirdPartyStage: "scripts/release-third-party-stage-files.json",
});

export async function captureCommittedReleaseAuthorities({
  repositoryRoot = REPOSITORY_ROOT,
  packageLockPath = join(repositoryRoot, "package-lock.json"),
  includeInventories = true,
  fileReader = readFile,
} = {}) {
  const packageLockBytes = Buffer.from(await fileReader(packageLockPath));
  const inventoryBytes = new Map();
  if (includeInventories) {
    for (const path of Object.values(COMMITTED_INVENTORY_PATHS)) {
      inventoryBytes.set(
        path,
        Buffer.from(await fileReader(join(repositoryRoot, ...path.split("/")))),
      );
    }
  }
  const parsed = Object.fromEntries(
    Object.entries(COMMITTED_INVENTORY_PATHS).map(([name, path]) => [
      name,
      inventoryBytes.has(path)
        ? parseJsonBytes(inventoryBytes.get(path), path)
        : undefined,
    ]),
  );
  return Object.freeze({
    packageLockBytes,
    inventoryBytes,
    rawBytes: new Map([
      ["package-lock.json", packageLockBytes],
      ...inventoryBytes,
    ]),
    parsed,
  });
}

function exactVersionMap(thirdParty) {
  const versions = new Map();
  for (const workspace of WORKSPACES) {
    if (workspace.name !== "@thermite/cli")
      versions.set(workspace.name, "0.2.0");
  }
  for (const package_ of thirdParty.packages)
    versions.set(package_.name, package_.version);
  return versions;
}

function assertByteMapsEqual(left, right, label) {
  const leftPaths = [...left.keys()].sort(compareCodeUnits);
  const rightPaths = [...right.keys()].sort(compareCodeUnits);
  if (JSON.stringify(leftPaths) !== JSON.stringify(rightPaths)) {
    throw new Error(`${label} path sets differ.`);
  }
  for (const path of leftPaths) {
    if (!Buffer.from(left.get(path)).equals(Buffer.from(right.get(path)))) {
      throw new Error(`${label} bytes differ at ${path}.`);
    }
  }
}

function cloneForSeam(value, seen = new Map()) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Map) {
    const clone = new Map();
    seen.set(value, clone);
    for (const [key, entry] of value) {
      clone.set(cloneForSeam(key, seen), cloneForSeam(entry, seen));
    }
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set();
    seen.set(value, clone);
    for (const entry of value) clone.add(cloneForSeam(entry, seen));
    return clone;
  }
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    for (const entry of value) clone.push(cloneForSeam(entry, seen));
    return clone;
  }
  const clone = {};
  seen.set(value, clone);
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneForSeam(entry, seen);
  }
  return clone;
}

function notifyLifecycle(observer, event) {
  if (typeof observer === "function") void observer(cloneForSeam(event));
}

async function readFirstPartySource(
  repositoryRoot,
  sourcePath,
  sourceBytes,
  expectedSha256,
  fileReader = readFile,
) {
  if (!sourceBytes.has(sourcePath)) {
    const source = join(repositoryRoot, ...sourcePath.split("/"));
    await assertOrdinaryFile(source, sourcePath);
    const bytes = Buffer.from(await fileReader(source));
    if (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256) {
      throw new Error(
        `First-party captured bytes differ from the committed authority: ${sourcePath}.`,
      );
    }
    sourceBytes.set(sourcePath, bytes);
  }
  const bytes = sourceBytes.get(sourcePath);
  if (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256) {
    throw new Error(
      `First-party captured bytes differ from the committed authority: ${sourcePath}.`,
    );
  }
  return bytes;
}

async function copyInventoryFile({
  repositoryRoot,
  sourcePath,
  stagePath,
  role,
  sourceBytes,
  stageBytes,
  expectedFile,
  fileReader,
}) {
  const bytes = await readFirstPartySource(
    repositoryRoot,
    sourcePath,
    sourceBytes,
    expectedFile?.sourceSha256,
    fileReader,
  );
  stageBytes.set(stagePath, Buffer.from(bytes));
  const record = {
    sourcePath,
    stagePath,
    role,
    sourceSha256: sha256(bytes),
    stagedSha256: sha256(bytes),
  };
  if (
    expectedFile !== undefined &&
    JSON.stringify(record) !== JSON.stringify(expectedFile)
  ) {
    throw new Error(
      `First-party staged bytes differ from the committed authority: ${stagePath}.`,
    );
  }
  return record;
}

async function trackedAssetEntries(
  repositoryRoot,
  workspace,
  sourceBytes,
  fileReader,
) {
  const entries = [];
  if (workspace.directory === "cli") {
    entries.push(["packages/cli/README.md", "README.md", "readme"]);
    entries.push([
      "packages/cli/assets/AGENTS.md",
      "assets/AGENTS.md",
      "agent-guide",
    ]);
    for (const path of STARTER_FILES) {
      entries.push([
        `packages/cli/templates/starter-default/${path}`,
        `templates/starter-default/${path}`,
        "starter-template",
      ]);
    }
    entries.push(["LICENSE", "LICENSE", "license"]);
    const [rootGuide, packagedGuide] = await Promise.all([
      readFirstPartySource(
        repositoryRoot,
        "AGENTS.md",
        sourceBytes,
        undefined,
        fileReader,
      ),
      readFirstPartySource(
        repositoryRoot,
        "packages/cli/assets/AGENTS.md",
        sourceBytes,
        undefined,
        fileReader,
      ),
    ]);
    if (!rootGuide.equals(packagedGuide))
      throw new Error("Packaged AGENTS.md differs from root authority.");
  }
  if (workspace.directory === "schema") {
    entries.push(["packages/schema/README.md", "README.md", "readme"]);
    for (const { path } of await enumerateTree(
      join(repositoryRoot, "packages", "schema", "schemas"),
    )) {
      entries.push([
        `packages/schema/schemas/${path}`,
        `schemas/${path}`,
        "schema",
      ]);
    }
  }
  if (workspace.directory === "core-library") {
    entries.push(["packages/core-library/README.md", "README.md", "readme"]);
    entries.push(["packages/core-library/LICENSE", "LICENSE", "license"]);
    const [rootLicense, coreLicense] = await Promise.all([
      readFirstPartySource(
        repositoryRoot,
        "LICENSE",
        sourceBytes,
        undefined,
        fileReader,
      ),
      readFirstPartySource(
        repositoryRoot,
        "packages/core-library/LICENSE",
        sourceBytes,
        undefined,
        fileReader,
      ),
    ]);
    if (!rootLicense.equals(coreLicense)) {
      throw new Error(
        "Core-library LICENSE differs from root license authority.",
      );
    }
    for (const { path } of await enumerateTree(
      join(repositoryRoot, "packages", "core-library", "library"),
    )) {
      entries.push([
        `packages/core-library/library/${path}`,
        `library/${path}`,
        "library",
      ]);
    }
  }
  return entries;
}

export async function stageFirstParty({
  repositoryRoot,
  build,
  thirdParty,
  expectedInventory,
  firstPartySourceBytes = new Map(),
  stageBytes = new Map(),
  fileReader = readFile,
}) {
  const versions = exactVersionMap(thirdParty);
  const expectedPackages = new Map(
    (expectedInventory?.packages ?? []).map((package_) => [
      package_.name,
      package_,
    ]),
  );
  const packages = [];
  for (const workspace of WORKSPACES) {
    const expectedPackage = expectedPackages.get(workspace.name);
    if (expectedInventory !== undefined && expectedPackage === undefined) {
      throw new Error(
        `First-party package is absent from the committed authority: ${workspace.name}.`,
      );
    }
    const sourceManifestPath = `packages/${workspace.directory}/package.json`;
    const stagedManifestPath = `${workspace.stagePath}/package.json`;
    const sourceManifestBytes = build.verifiedInputs.get(sourceManifestPath);
    if (sourceManifestBytes === undefined) {
      throw new Error(
        `Verified release input is missing: ${sourceManifestPath}.`,
      );
    }
    if (
      expectedPackage !== undefined &&
      expectedPackage.sourceManifest.sha256 !== sha256(sourceManifestBytes)
    ) {
      throw new Error(
        `First-party source manifest differs from the committed authority: ${sourceManifestPath}.`,
      );
    }
    const sourceManifest = validateWorkspaceManifest(
      parseJsonBytes(sourceManifestBytes, sourceManifestPath),
      workspace,
    );
    const transformed = transformPackageManifest(sourceManifest, versions, {
      cliRoot: workspace.directory === "cli",
    });
    const stagedManifestBytes = Buffer.from(
      serializeCanonicalJson(transformed),
    );
    if (
      expectedPackage !== undefined &&
      expectedPackage.stagedManifest.sha256 !== sha256(stagedManifestBytes)
    ) {
      throw new Error(
        `First-party staged manifest differs from the committed authority: ${stagedManifestPath}.`,
      );
    }
    stageBytes.set(stagedManifestPath, Buffer.from(stagedManifestBytes));
    const files = [];
    for (const path of build.outputs.get(workspace.directory)) {
      const sourcePath = `packages/${workspace.directory}/dist/${path}`;
      const stagePath = `${workspace.stagePath}/dist/${path}`;
      const sourceBytes = build.outputBytes.get(stagePath);
      if (sourceBytes === undefined) {
        throw new Error(`Captured build output is missing: ${stagePath}.`);
      }
      stageBytes.set(stagePath, Buffer.from(sourceBytes));
      const stagedBytes = sourceBytes;
      const record = {
        sourcePath,
        stagePath,
        role: path.endsWith(".d.ts") ? "declaration" : "runtime",
        sourceSha256: sha256(sourceBytes),
        stagedSha256: sha256(stagedBytes),
      };
      const expectedFile = expectedPackage?.files.find(
        (file) =>
          file.sourcePath === sourcePath && file.stagePath === stagePath,
      );
      if (expectedInventory !== undefined && expectedFile === undefined) {
        throw new Error(
          `First-party build output is absent from the committed authority: ${stagePath}.`,
        );
      }
      if (
        expectedFile !== undefined &&
        JSON.stringify(record) !== JSON.stringify(expectedFile)
      ) {
        throw new Error(
          `First-party build output differs from the committed authority: ${stagePath}.`,
        );
      }
      files.push(record);
    }
    for (const [
      sourcePath,
      relativeStagePath,
      role,
    ] of await trackedAssetEntries(
      repositoryRoot,
      workspace,
      firstPartySourceBytes,
      fileReader,
    )) {
      const stagePath = `${workspace.stagePath}/${relativeStagePath}`;
      const expectedFile = expectedPackage?.files.find(
        (file) =>
          file.sourcePath === sourcePath && file.stagePath === stagePath,
      );
      if (expectedInventory !== undefined && expectedFile === undefined) {
        throw new Error(
          `First-party asset is absent from the committed authority: ${stagePath}.`,
        );
      }
      files.push(
        await copyInventoryFile({
          repositoryRoot,
          sourcePath,
          stagePath,
          role,
          sourceBytes: firstPartySourceBytes,
          stageBytes,
          expectedFile,
          fileReader,
        }),
      );
    }
    files.sort((left, right) => {
      const source = compareCodeUnits(left.sourcePath, right.sourcePath);
      return source === 0
        ? compareCodeUnits(left.stagePath, right.stagePath)
        : source;
    });
    if (files.some((file) => file.sourceSha256 !== file.stagedSha256)) {
      throw new Error(
        `First-party source/stage bytes differ for ${workspace.name}.`,
      );
    }
    packages.push({
      name: workspace.name,
      sourceRoot: `packages/${workspace.directory}`,
      stagePath: workspace.stagePath,
      sourceManifest: {
        path: sourceManifestPath,
        sha256: sha256(sourceManifestBytes),
      },
      stagedManifest: {
        path: stagedManifestPath,
        sha256: sha256(stagedManifestBytes),
      },
      files,
    });
  }
  packages.sort((left, right) => compareCodeUnits(left.name, right.name));
  const inventory = {
    format: "thermite-schematics-release-first-party-files/0.1",
    packages,
  };
  if (expectedInventory !== undefined) {
    assertInventoryEqual(inventory, expectedInventory, "First-party inventory");
  }
  return inventory;
}

async function createReleaseStage({
  repositoryRoot,
  build,
  stageRoot,
  thirdPartySource,
  firstPartyExpected,
  thirdPartyStageExpected,
  firstPartySourceBytes = new Map(),
  fileReader = readFile,
  lifecycleObserver,
  stageIndex,
}) {
  const bytes = new Map();
  const firstParty = await stageFirstParty({
    repositoryRoot,
    build,
    thirdParty: thirdPartySource,
    expectedInventory: firstPartyExpected,
    firstPartySourceBytes,
    stageBytes: bytes,
    fileReader,
  });
  const thirdParty = await stageThirdPartyPackages({
    source: thirdPartySource,
    exactVersions: exactVersionMap(thirdPartySource),
    expectedInventory: thirdPartyStageExpected,
  });
  for (const [path, value] of thirdParty.bytes) {
    if (bytes.has(path))
      throw new Error(`Duplicate release stage path: ${path}.`);
    bytes.set(path, Buffer.from(value));
  }
  const licenseBytes = Buffer.from(serializeCanonicalJson(thirdParty.licenses));
  bytes.set("package/THIRD_PARTY_LICENSES.json", Buffer.from(licenseBytes));

  const expectedFiles = new Set(["package/THIRD_PARTY_LICENSES.json"]);
  for (const package_ of firstParty.packages) {
    expectedFiles.add(package_.stagedManifest.path);
    for (const file of package_.files) expectedFiles.add(file.stagePath);
  }
  for (const package_ of thirdParty.inventory.packages) {
    expectedFiles.add(package_.manifest.path);
    for (const file of package_.files) expectedFiles.add(file.path);
  }
  const expected = [...expectedFiles].sort(compareCodeUnits);
  if (
    JSON.stringify([...bytes.keys()].sort(compareCodeUnits)) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      "Immutable release stage bytes contain a missing or extra file.",
    );
  }
  notifyLifecycle(lifecycleObserver, {
    type: "stage-map-complete",
    stageIndex,
    stageRoot,
    bytes,
  });
  notifyLifecycle(lifecycleObserver, {
    type: "declaration-resolution",
    stageIndex,
    stageRoot,
    bytes,
  });
  const declarationClosure = auditStageDeclarationClosure(
    bytes,
    firstParty,
    thirdParty.inventory,
  );
  return {
    stageRoot,
    firstParty,
    thirdParty: thirdParty.inventory,
    licenses: thirdParty.licenses,
    bytes,
    declarationClosure,
  };
}

async function createTwinStages({
  repositoryRoot,
  temporaryRoot,
  modulesPath,
  sourceCommit,
  resolvedHeadCommit,
  authorities,
  buildNames = ["build-a", "build-b"],
  stageNames = ["stage-a", "stage-b"],
  releaseInputFileReader = readFile,
  firstPartyFileReader = readFile,
  thirdPartyFileReader = readFile,
  compilerHostOptions,
  lifecycleObserver,
  materializationProbe,
}) {
  const verifiedReleaseInputs = await verifyReleaseSourceInputs({
    repositoryRoot,
    sourceCommit,
    ...(resolvedHeadCommit === undefined ? {} : { resolvedHeadCommit }),
    fileReader: releaseInputFileReader,
  });
  notifyLifecycle(lifecycleObserver, {
    type: "verified-input-map",
    bytes: verifiedReleaseInputs.verifiedInputs,
  });
  const buildRoots = buildNames.map((name) => join(temporaryRoot, name));
  const stageRoots = stageNames.map((name) => join(temporaryRoot, name));
  for (const root of [...buildRoots, ...stageRoots]) {
    await mkdirExclusive(root);
  }
  const capturedBuildRoots = await Promise.all(
    buildRoots.map((root) => lstat(root, { bigint: true })),
  );
  const capturedStageRoots = await Promise.all(
    stageRoots.map((root) => lstat(root, { bigint: true })),
  );
  const thirdPartySource = await collectThirdPartySource({
    repositoryRoot,
    lockBytes: authorities.packageLockBytes,
    modulesPath,
    workspaceManifestBytes: verifiedReleaseInputs.verifiedInputs,
    expectedInventory: authorities.parsed.thirdPartySource,
    fileReader: thirdPartyFileReader,
  });
  const thirdPartyState = createCompilerThirdPartyState();
  seedCompilerThirdPartyState(thirdPartyState, thirdPartySource.capturedBytes);
  const buildA = await buildFreshRelease({
    repositoryRoot,
    buildRoot: buildRoots[0],
    verifiedReleaseInputs,
    thirdPartyState,
    compilerHostOptions,
    precreatedBuildRoot: true,
  });
  notifyLifecycle(lifecycleObserver, {
    type: "output-map-complete",
    buildIndex: 0,
    bytes: buildA.outputBytes,
  });
  const buildB = await buildFreshRelease({
    repositoryRoot,
    buildRoot: buildRoots[1],
    verifiedReleaseInputs,
    thirdPartyState,
    compilerHostOptions,
    precreatedBuildRoot: true,
  });
  notifyLifecycle(lifecycleObserver, {
    type: "output-map-complete",
    buildIndex: 1,
    bytes: buildB.outputBytes,
  });
  assertByteMapsEqual(
    buildB.outputBytes,
    buildA.outputBytes,
    "Twin captured compiler output",
  );
  const firstPartySourceBytes = new Map();
  const stageA = await createReleaseStage({
    repositoryRoot,
    build: buildA,
    stageRoot: stageRoots[0],
    thirdPartySource,
    firstPartyExpected: authorities.parsed.firstParty,
    thirdPartyStageExpected: authorities.parsed.thirdPartyStage,
    firstPartySourceBytes,
    fileReader: firstPartyFileReader,
    lifecycleObserver,
    stageIndex: 0,
  });
  const stageB = await createReleaseStage({
    repositoryRoot,
    build: buildB,
    stageRoot: stageRoots[1],
    thirdPartySource,
    firstPartyExpected: authorities.parsed.firstParty,
    thirdPartyStageExpected: authorities.parsed.thirdPartyStage,
    firstPartySourceBytes,
    fileReader: firstPartyFileReader,
    lifecycleObserver,
    stageIndex: 1,
  });
  assertByteMapsEqual(stageB.bytes, stageA.bytes, "Twin release stage");
  assertInventoryEqual(
    stageB.firstParty,
    stageA.firstParty,
    "Twin first-party inventory",
  );
  assertInventoryEqual(
    stageB.thirdParty,
    stageA.thirdParty,
    "Twin third-party stage inventory",
  );
  assertInventoryEqual(
    stageB.licenses,
    stageA.licenses,
    "Twin third-party license inventory",
  );
  assertInventoryEqual(
    stageB.declarationClosure,
    stageA.declarationClosure,
    "Twin declaration closure",
  );
  return {
    buildA,
    buildB,
    stageA,
    stageB,
    thirdPartySource,
    verifiedReleaseInputs,
    capturedBuildRoots,
    capturedStageRoots,
    lifecycleObserver,
    materializationProbe,
  };
}

async function removeOwnedTemporaryRoot(temporaryRoot, captured) {
  const resolvedRoot = resolve(temporaryRoot);
  const resolvedTemp = resolve(tmpdir());
  const child = relative(resolvedTemp, resolvedRoot);
  const observed = await lstat(resolvedRoot, { bigint: true });
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    observed.dev !== captured.dev ||
    observed.ino !== captured.ino ||
    !observed.isDirectory() ||
    observed.isSymbolicLink()
  ) {
    throw new Error("Release temporary-root cleanup identity changed.");
  }
  await rm(resolvedRoot, {
    recursive: true,
    force: false,
    maxRetries: 10,
    retryDelay: 100,
  });
}

export async function recordOrVerifyReleaseInventories({
  mode,
  repositoryRoot = REPOSITORY_ROOT,
  lockPath,
  modulesPath,
  firstPartyPath,
  sourceInventoryPath,
  stageInventoryPath,
} = {}) {
  if (mode !== "record" && mode !== "verify")
    throw new Error("Invalid release inventory mode.");
  const sourceCommit = await resolveHeadCommit(repositoryRoot);
  const destinations = [
    firstPartyPath,
    sourceInventoryPath,
    stageInventoryPath,
  ];
  if (destinations.some((value) => typeof value !== "string")) {
    throw new Error("All three release inventory paths are required.");
  }
  const existence = await Promise.all(destinations.map(pathExists));
  if (mode === "record" && existence.some(Boolean)) {
    throw new Error(
      "The absent-only release inventory record operation requires all three destinations absent.",
    );
  }
  if (mode === "verify" && existence.some((value) => !value)) {
    throw new Error("A committed release inventory is missing.");
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-release-inventory-"),
  );
  const captured = await lstat(temporaryRoot, { bigint: true });
  try {
    const authorities = await captureCommittedReleaseAuthorities({
      repositoryRoot,
      packageLockPath: lockPath,
      includeInventories: mode === "verify",
    });
    const twin = await createTwinStages({
      repositoryRoot,
      temporaryRoot,
      modulesPath,
      sourceCommit,
      resolvedHeadCommit: sourceCommit,
      authorities,
    });
    const sourceInventory = twin.thirdPartySource.inventory;
    if (mode === "record") {
      await writeCommittedJson(twin.stageA.firstParty, firstPartyPath);
      await writeCommittedJson(sourceInventory, sourceInventoryPath);
      await writeCommittedJson(twin.stageA.thirdParty, stageInventoryPath);
    } else {
      const firstExpected = authorities.parsed.firstParty;
      const sourceExpected = authorities.parsed.thirdPartySource;
      const stageExpected = authorities.parsed.thirdPartyStage;
      assertInventoryEqual(
        twin.stageA.firstParty,
        firstExpected,
        "First-party inventory",
      );
      assertInventoryEqual(
        sourceInventory,
        sourceExpected,
        "Third-party source inventory",
      );
      assertInventoryEqual(
        twin.stageA.thirdParty,
        stageExpected,
        "Third-party stage inventory",
      );
    }
    return {
      firstParty: twin.stageA.firstParty,
      thirdPartySource: sourceInventory,
      thirdPartyStage: twin.stageA.thirdParty,
    };
  } finally {
    await removeOwnedTemporaryRoot(temporaryRoot, captured);
  }
}

function writeStringField(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length)
    throw new Error(`Ustar field is too long: ${value}.`);
  bytes.copy(header, offset);
}

function writeOctalField(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length > length - 1)
    throw new Error("Ustar numeric field overflow.");
  writeStringField(header, offset, length, `${text}\0`);
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let index = path.length - 1; index > 0; index -= 1) {
    if (path[index] !== "/") continue;
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(
    `Release path cannot be represented by POSIX ustar: ${path}.`,
  );
}

function createUstarHeader({ path, type, mode, size }) {
  const header = Buffer.alloc(512);
  const split = splitUstarPath(path);
  writeStringField(header, 0, 100, split.name);
  writeOctalField(header, 100, 8, mode);
  writeOctalField(header, 108, 8, 0);
  writeOctalField(header, 116, 8, 0);
  writeOctalField(header, 124, 12, size);
  writeOctalField(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? 0x35 : 0x30;
  writeStringField(header, 257, 6, "ustar\0");
  writeStringField(header, 263, 2, "00");
  writeStringField(header, 345, 155, split.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeStringField(header, 148, 8, `${checksumText}\0 `);
  return header;
}

export async function createDeterministicTar(stageBytes) {
  const directories = new Set();
  for (const path of stageBytes.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  const entries = [
    ...[...directories].map((path) => ({ path, type: "directory" })),
    ...[...stageBytes.keys()].map((path) => ({ path, type: "file" })),
  ].sort(({ path: left }, { path: right }) => compareCodeUnits(left, right));
  const chunks = [];
  const headers = [];
  const stageFiles = [];
  for (const entry of entries) {
    const type = entry.type;
    const mode =
      type === "directory" || entry.path === "package/dist/bin.js"
        ? 0o755
        : 0o644;
    const bytes =
      type === "file" ? stageBytes.get(entry.path) : Buffer.alloc(0);
    chunks.push(
      createUstarHeader({ path: entry.path, type, mode, size: bytes.length }),
    );
    if (type === "file") {
      chunks.push(bytes);
      const remainder = bytes.length % 512;
      if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder));
      stageFiles.push({
        path: entry.path,
        mode: mode === 0o755 ? "0755" : "0644",
        size: bytes.length,
        sha256: sha256(bytes),
      });
    }
    headers.push({
      path: entry.path,
      type,
      mode: mode === 0o755 ? "0755" : "0644",
      uid: 0,
      gid: 0,
      size: bytes.length,
      mtime: 0,
      linkname: "",
    });
  }
  chunks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(chunks);
  const gzip = gzipSync(tar, { level: 9, mtime: 0 });
  gzip[9] = 3;
  return { gzip, headers, stageFiles };
}

function packageNameFromSpecifier(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function packageRootForName(name) {
  return `package/node_modules/${name}`;
}

function resolveRelativeRuntime(from, specifier, files) {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (base === ".." || base.startsWith("../") || posix.isAbsolute(base)) {
    throw new Error(`PKG008 Runtime edge '${specifier}' escapes its package.`);
  }
  for (const candidate of [
    base,
    `${base}.js`,
    `${base}.json`,
    `${base}/index.js`,
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

function exportedRuntimeTarget(manifest, subpath, kind) {
  if (subpath !== "") return `./${subpath}`;
  const root = manifest.exports?.["."] ?? manifest.exports;
  if (typeof root === "string") return root;
  if (root !== null && typeof root === "object") {
    const target = root[kind] ?? root.import ?? root.default;
    if (typeof target === "string") return target;
  }
  if (typeof manifest.main === "string") return manifest.main;
  return "./index.js";
}

export async function auditRuntimeClosure(stageBytes, thirdPartySource) {
  const files = new Set(stageBytes.keys());
  const manifestCache = new Map();
  const versions = new Map([
    ["@thermite/cli", "0.2.0"],
    ...WORKSPACES.filter(({ name }) => name !== "@thermite/cli").map(
      ({ name }) => [name, "0.2.0"],
    ),
    ...thirdPartySource.packages.map(({ name, version }) => [name, version]),
  ]);
  const roots = [
    { name: "@thermite/cli", root: "package" },
    ...[...versions.keys()]
      .filter((name) => name !== "@thermite/cli")
      .map((name) => ({ name, root: packageRootForName(name) })),
  ].sort((left, right) => right.root.length - left.root.length);
  const ownerOf = (path) =>
    roots.find(({ root }) => path === root || path.startsWith(`${root}/`));
  const readManifest = async (name) => {
    if (manifestCache.has(name)) return manifestCache.get(name);
    const root =
      name === "@thermite/cli" ? "package" : packageRootForName(name);
    const path = `${root}/package.json`;
    if (!files.has(path))
      throw new Error(
        `PKG008 Runtime package manifest is missing for '${name}'.`,
      );
    const manifest = parseJsonBytes(stageBytes.get(path), path);
    manifestCache.set(name, manifest);
    return manifest;
  };
  const edges = [];
  const queue = ["package/dist/bin.js"];
  const visited = new Set();
  const reachedPackages = new Set(["@thermite/cli"]);
  const manifestQueue = ["@thermite/cli"];
  const visitedManifests = new Set();
  while (manifestQueue.length > 0) {
    const ownerName = manifestQueue.shift();
    if (visitedManifests.has(ownerName)) continue;
    visitedManifests.add(ownerName);
    const ownerManifest = await readManifest(ownerName);
    const ownerRoot =
      ownerName === "@thermite/cli" ? "package" : packageRootForName(ownerName);
    for (const dependency of Object.keys(ownerManifest.dependencies ?? {}).sort(
      compareCodeUnits,
    )) {
      if (
        !versions.has(dependency) ||
        ownerManifest.dependencies[dependency] !== versions.get(dependency)
      ) {
        throw new Error(
          `PKG008 Manifest dependency '${dependency}' from '${ownerName}' is unresolved.`,
        );
      }
      const dependencyManifest = await readManifest(dependency);
      if (dependencyManifest.version !== versions.get(dependency)) {
        throw new Error(
          `PKG008 Manifest dependency '${dependency}' has the wrong staged version.`,
        );
      }
      reachedPackages.add(dependency);
      const dependencyManifestPath = `${packageRootForName(dependency)}/package.json`;
      edges.push({
        from: `${ownerRoot}/package.json`,
        kind: "main",
        specifier: dependency,
        to: dependencyManifestPath,
        package: `${dependency}@${versions.get(dependency)}`,
      });
      manifestQueue.push(dependency);
    }
  }
  while (queue.length > 0) {
    const from = queue.shift();
    if (visited.has(from)) continue;
    if (!files.has(from))
      throw new Error(`PKG008 Runtime closure target is absent: '${from}'.`);
    visited.add(from);
    if (!from.endsWith(".js")) continue;
    const text = stageBytes.get(from).toString("utf8");
    const imports = [];
    const expression =
      /(?:\bimport\s*(?:\([^)]*?\)|[^;]*?\bfrom\s*)|\bexport\s+[^;]*?\bfrom\s*|\brequire\s*\()\s*["']([^"']+)["']/gu;
    for (const match of text.matchAll(expression)) imports.push(match[1]);
    imports.length = 0;
    imports.push(
      ...ts
        .preProcessFile(text, true, true)
        .importedFiles.map(({ fileName }) => fileName),
    );
    for (const specifier of imports.filter(
      (value) =>
        !["exports", "module", "require"].includes(value) &&
        !value.includes(" ") &&
        !value.includes(","),
    )) {
      if (specifier.startsWith("node:") || isBuiltin(specifier)) continue;
      if (
        from === "package/node_modules/elkjs/lib/elk.bundled.js" &&
        specifier === "web-worker"
      ) {
        continue;
      }
      const kind = text.includes(`require(${JSON.stringify(specifier)}`)
        ? "require"
        : "import";
      let to;
      if (specifier.startsWith(".")) {
        to = resolveRelativeRuntime(from, specifier, files);
      } else {
        const name = packageNameFromSpecifier(specifier);
        if (!versions.has(name))
          throw new Error(
            `PKG008 Runtime import '${specifier}' is outside the staged closure.`,
          );
        reachedPackages.add(name);
        const subpath = specifier.slice(name.length).replace(/^\//u, "");
        const manifest = await readManifest(name);
        const target = exportedRuntimeTarget(manifest, subpath, kind);
        const root = packageRootForName(name);
        to = resolveRelativeRuntime(`${root}/package.json`, target, files);
        edges.push({
          from: `${root}/package.json`,
          kind: "main",
          specifier: target,
          to,
          package: `${name}@${versions.get(name)}`,
        });
      }
      if (to === undefined)
        throw new Error(
          `PKG008 Runtime edge '${specifier}' from '${from}' is unresolved.`,
        );
      const owner = ownerOf(to);
      edges.push({
        from,
        kind,
        specifier,
        to,
        package: `${owner.name}@${versions.get(owner.name)}`,
      });
      queue.push(to);
    }
    const assetExpression =
      /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu;
    for (const match of text.matchAll(assetExpression)) {
      const to = resolveRelativeRuntime(from, match[1], files);
      if (to === undefined) continue;
      const owner = ownerOf(to);
      edges.push({
        from,
        kind: "asset",
        specifier: match[1],
        to,
        package: `${owner.name}@${versions.get(owner.name)}`,
      });
    }
  }
  const missing = [...versions.keys()]
    .filter((name) => !reachedPackages.has(name))
    .sort(compareCodeUnits);
  if (missing.length !== 0) {
    throw new Error(
      `PKG008 Runtime packages are unreachable: ${missing.join(", ")}.`,
    );
  }
  edges.sort((left, right) => {
    for (const key of ["from", "kind", "specifier", "to", "package"]) {
      const compared = compareCodeUnits(left[key], right[key]);
      if (compared !== 0) return compared;
    }
    return 0;
  });
  return {
    format: "thermite-schematics-runtime-closure/0.1",
    root: "package/dist/bin.js",
    edges,
  };
}

async function removeOwnedOutputChild(outputRoot, path, captured) {
  const absoluteOutput = resolve(outputRoot);
  const absolutePath = resolve(path);
  const child = relative(absoluteOutput, absolutePath);
  const observed = await lstat(absolutePath, { bigint: true });
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    observed.dev !== captured.dev ||
    observed.ino !== captured.ino ||
    !observed.isDirectory() ||
    observed.isSymbolicLink()
  ) {
    throw new Error("Release owned-root cleanup identity changed.");
  }
  await rm(absolutePath, {
    recursive: true,
    force: false,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function createReleaseOutputs({
  sourceCommit,
  stage,
  tar,
  closure,
  authorityBytes,
}) {
  const artifactSha = sha256(tar.gzip);
  const tarHeaders = {
    format: "thermite-schematics-tar-headers/0.1",
    artifact: RELEASE_ARTIFACT,
    sha256: artifactSha,
    entries: tar.headers,
  };
  const stageFiles = {
    format: "thermite-schematics-stage-files/0.1",
    artifact: RELEASE_ARTIFACT,
    files: tar.stageFiles,
  };
  const firstPartyBytes = authorityBytes.get(
    COMMITTED_INVENTORY_PATHS.firstParty,
  );
  const sourceInventoryBytes = authorityBytes.get(
    COMMITTED_INVENTORY_PATHS.thirdPartySource,
  );
  const stageInventoryBytes = authorityBytes.get(
    COMMITTED_INVENTORY_PATHS.thirdPartyStage,
  );
  if (
    firstPartyBytes === undefined ||
    sourceInventoryBytes === undefined ||
    stageInventoryBytes === undefined
  ) {
    throw new Error("Retained committed release inventory bytes are missing.");
  }
  const provenance = {
    format: "thermite-schematics-build-provenance/0.2",
    artifact: RELEASE_ARTIFACT,
    sha256: artifactSha,
    source: {
      repository: "BlackettApplied/ThermiteSchematics",
      commit: sourceCommit,
    },
    builder: {
      os: "linux",
      arch: "x64",
      tools: { node: "24.11.1", npm: "11.6.2", typescript: "5.9.3" },
    },
    isolation: {
      policy: "env-i/0.1",
      inheritedEnvironment: "discarded-before-bash-node-npm",
      locale: "C",
      timezone: "UTC",
      sourceDateEpoch: "0",
      commandSearch: [
        "pinned-node-24.11.1-bin",
        "system-usr-bin",
        "system-bin",
      ],
      npmConfig: {
        home: "release-output-home",
        cache: "release-output-cache",
        userConfig: "empty-release-user-config",
        globalConfig: "empty-release-global-config",
        audit: false,
        fund: false,
        ignoreScripts: true,
        updateNotifier: false,
      },
    },
    inventories: {
      firstPartySha256: sha256(firstPartyBytes),
      thirdPartySourceSha256: sha256(sourceInventoryBytes),
      thirdPartyStageSha256: sha256(stageInventoryBytes),
    },
  };
  const outputs = new Map([
    [RELEASE_ARTIFACT, tar.gzip],
    [`${RELEASE_ARTIFACT}.sha256`, `${artifactSha}  ${RELEASE_ARTIFACT}\n`],
    [`thermite-cli-0.2.0.tar-headers.json`, serializeCanonicalJson(tarHeaders)],
    [`thermite-cli-0.2.0.stage-files.json`, serializeCanonicalJson(stageFiles)],
    [
      `thermite-cli-0.2.0.runtime-closure.json`,
      serializeCanonicalJson(closure),
    ],
    [
      `thermite-cli-0.2.0.third-party-licenses.json`,
      serializeCanonicalJson(stage.licenses),
    ],
    [
      `thermite-cli-0.2.0.build-provenance.json`,
      serializeCanonicalJson(provenance),
    ],
  ]);
  return { artifactSha, tarHeaders, stageFiles, provenance, outputs };
}

async function writeReleaseOutputMap(outputRoot, outputs) {
  for (const name of RELEASE_OUTPUT_NAMES) {
    if (await pathExists(join(outputRoot, name))) {
      throw new Error(`Release output already exists: ${name}.`);
    }
  }
  for (const name of RELEASE_OUTPUT_NAMES) {
    await writeExclusiveFile(join(outputRoot, name), outputs.get(name));
  }
}

export async function auditTwinReleaseOutputs({
  auditor,
  outputMaps,
  stages,
  builds,
  authorityBytes,
} = {}) {
  if (
    typeof auditor !== "function" ||
    outputMaps?.length !== 2 ||
    stages?.length !== 2 ||
    builds?.length !== 2
  ) {
    throw new Error("Twin release audit inputs are incomplete.");
  }
  const results = [];
  for (let index = 0; index < 2; index += 1) {
    results.push(
      await auditor({
        ...cloneForSeam({
          outputBytes: outputMaps[index],
          stageBytes: stages[index].bytes,
          committedAuthorityBytes: authorityBytes,
          capturedOutputMaps: builds.map(({ outputBytes }) => outputBytes),
          declarationClosure: stages[index].declarationClosure,
        }),
      }),
    );
  }
  return results;
}

async function completeTwinRelease({
  twin,
  authorities,
  sourceCommit,
  lifecycleObserver = twin.lifecycleObserver,
  materializationProbe = twin.materializationProbe,
}) {
  const stages = [twin.stageA, twin.stageB];
  const builds = [twin.buildA, twin.buildB];
  const closures = await Promise.all(
    stages.map((stage) =>
      auditRuntimeClosure(stage.bytes, twin.thirdPartySource),
    ),
  );
  assertInventoryEqual(closures[1], closures[0], "Twin runtime closure");
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    notifyLifecycle(lifecycleObserver, {
      type: "stage-write",
      stageIndex: index,
      stageRoot: stage.stageRoot,
      bytes: stage.bytes,
    });
    await materializeFileMap({
      root: stage.stageRoot,
      files: stage.bytes,
      executablePaths: new Set(["package/dist/bin.js"]),
      label: "Release stage",
      precreatedRoot: true,
    });
  }
  if (typeof materializationProbe === "function") {
    await materializationProbe(cloneForSeam({ stages, builds }));
  }
  const releaseTarAuditor = await import("./release-tar-audit.mjs");
  for (const stage of stages) {
    releaseTarAuditor.assertRetainedStageFileSet(
      stage.bytes,
      authorities.rawBytes,
    );
  }
  const tars = await Promise.all(
    stages.map((stage) => createDeterministicTar(stage.bytes)),
  );
  if (!tars[0].gzip.equals(tars[1].gzip)) {
    throw new Error("Independent release tarballs are not byte-identical.");
  }
  assertInventoryEqual(tars[1].headers, tars[0].headers, "Twin tar headers");
  assertInventoryEqual(
    tars[1].stageFiles,
    tars[0].stageFiles,
    "Twin stage files",
  );
  const releases = [0, 1].map((index) =>
    createReleaseOutputs({
      sourceCommit,
      stage: stages[index],
      tar: tars[index],
      closure: closures[index],
      authorityBytes: authorities.rawBytes,
    }),
  );
  assertByteMapsEqual(
    releases[1].outputs,
    releases[0].outputs,
    "Twin release output",
  );
  await auditTwinReleaseOutputs({
    auditor: releaseTarAuditor.auditReleaseOutputs,
    outputMaps: releases.map(({ outputs }) => outputs),
    stages,
    builds,
    authorityBytes: authorities.rawBytes,
  });
  return { stages, builds, closures, tars, releases };
}

export async function packagePrebuiltRelease({
  repositoryRoot = REPOSITORY_ROOT,
  outputRoot,
  sourceCommit,
  authorityFileReader = readFile,
} = {}) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? ""))
    throw new Error("A lowercase 40-hex source commit is required.");
  await assertOrdinaryDirectory(outputRoot);
  const authorities = await captureCommittedReleaseAuthorities({
    repositoryRoot,
    fileReader: authorityFileReader,
  });
  const buildPaths = [
    join(outputRoot, ".build-a"),
    join(outputRoot, ".build-b"),
  ];
  const stagePaths = [
    join(outputRoot, ".stage-a"),
    join(outputRoot, ".stage-b"),
  ];
  const twin = await createTwinStages({
    repositoryRoot,
    temporaryRoot: outputRoot,
    modulesPath: join(repositoryRoot, "node_modules"),
    sourceCommit,
    authorities,
    buildNames: [".build-a", ".build-b"],
    stageNames: [".stage-a", ".stage-b"],
  });
  const capturedBuilds = twin.capturedBuildRoots;
  const completed = await completeTwinRelease({
    twin,
    authorities,
    sourceCommit,
  });
  const capturedStages = twin.capturedStageRoots;
  await writeReleaseOutputMap(outputRoot, completed.releases[0].outputs);
  for (let index = 0; index < 2; index += 1) {
    await removeOwnedOutputChild(
      outputRoot,
      stagePaths[index],
      capturedStages[index],
    );
    await removeOwnedOutputChild(
      outputRoot,
      buildPaths[index],
      capturedBuilds[index],
    );
  }
  const { outputs: _outputs, ...result } = completed.releases[0];
  return result;
}

export async function buildDisposableReleaseCandidate({
  repositoryRoot = REPOSITORY_ROOT,
  sourceCommit,
  authorityFileReader = readFile,
  releaseInputFileReader = readFile,
  firstPartyFileReader = readFile,
  thirdPartyFileReader = readFile,
  compilerHostOptions,
  lifecycleObserver,
  materializationProbe,
} = {}) {
  const headCommit = await resolveHeadCommit(repositoryRoot);
  const resolvedSourceCommit = sourceCommit ?? headCommit;
  if (!/^[0-9a-f]{40}$/u.test(resolvedSourceCommit)) {
    throw new Error("REL030 A lowercase 40-hex source commit is required.");
  }
  if (resolvedSourceCommit !== headCommit) {
    throw new Error(
      `REL030 Declared source commit ${resolvedSourceCommit} does not equal HEAD ${headCommit}.`,
    );
  }
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-disposable-release-"),
  );
  const captured = await lstat(temporaryRoot, { bigint: true });
  try {
    const authorities = await captureCommittedReleaseAuthorities({
      repositoryRoot,
      fileReader: authorityFileReader,
    });
    const twin = await createTwinStages({
      repositoryRoot,
      temporaryRoot,
      modulesPath: join(repositoryRoot, "node_modules"),
      sourceCommit: resolvedSourceCommit,
      resolvedHeadCommit: headCommit,
      authorities,
      releaseInputFileReader,
      firstPartyFileReader,
      thirdPartyFileReader,
      compilerHostOptions,
      lifecycleObserver,
      materializationProbe,
    });
    const completed = await completeTwinRelease({
      twin,
      authorities,
      sourceCommit: resolvedSourceCommit,
    });
    return {
      sourceCommit: resolvedSourceCommit,
      tar: completed.tars[0],
      closure: completed.closures[0],
      firstParty: twin.stageA.firstParty,
      thirdPartySource: twin.thirdPartySource.inventory,
      thirdPartyStage: twin.stageA.thirdParty,
      licenses: twin.stageA.licenses,
      verifiedInputs: twin.verifiedReleaseInputs.verifiedInputs,
      verifiedInputMaps: completed.builds.map(
        ({ verifiedInputs }) => verifiedInputs,
      ),
      outputMaps: completed.builds.map(({ outputBytes }) => outputBytes),
      stageMaps: completed.stages.map(({ bytes }) => bytes),
      declarationClosures: completed.stages.map(
        ({ declarationClosure }) => declarationClosure,
      ),
      authorityBytes: authorities.rawBytes,
      releaseOutputMaps: completed.releases.map(({ outputs }) => outputs),
      releaseOutputs: completed.releases[0].outputs,
    };
  } finally {
    await removeOwnedTemporaryRoot(temporaryRoot, captured);
  }
}

async function main(argv) {
  const arguments_ = parseNamedArguments(argv, ["--output", "--source-commit"]);
  const output = arguments_["--output"];
  const sourceCommit = arguments_["--source-commit"];
  if (output === undefined || !/^[0-9a-f]{40}$/u.test(sourceCommit ?? "")) {
    throw new Error(
      "Usage: node scripts/release-package.mjs --output <release-out> --source-commit <lowercase-40-hex>",
    );
  }
  assertDirectReleaseEnvironment();
  assertReleaseToolVersions();
  await packagePrebuiltRelease({
    repositoryRoot: REPOSITORY_ROOT,
    outputRoot: resolve(REPOSITORY_ROOT, output),
    sourceCommit,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
