import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join, posix, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  REPOSITORY_ROOT,
  WORKSPACES,
  assertContainedPath,
  assertLogicalPath,
  assertOrdinaryDirectory,
  assertOrdinaryFile,
  canonicalizeJson,
  compareCodeUnits,
  parseJsonBytes,
  pathExists,
  readJsonFile,
  serializeCanonicalJson,
  sha256,
  writeExclusiveFile,
} from "./release-common.mjs";

export const THIRD_PARTY_SPECIFICATIONS = Object.freeze(
  [
    ["@nodelib/fs.scandir", "2.1.5", ["out/**/*.js"]],
    ["@nodelib/fs.stat", "2.0.5", ["out/**/*.js"]],
    ["@nodelib/fs.walk", "1.2.8", ["out/**/*.js"]],
    ["ajv", "8.20.0", ["dist/**/*.js", "dist/**/*.json"]],
    ["braces", "3.0.3", ["index.js", "lib/*.js"]],
    ["commander", "15.0.0", ["index.js", "lib/*.js"]],
    ["elkjs", "0.12.0", ["lib/*.js"]],
    ["fast-deep-equal", "3.1.3", ["index.js", "react.js", "es6/*.js"]],
    ["fast-glob", "3.3.3", ["out/**/*.js"]],
    ["fast-uri", "3.1.6", ["index.js", "lib/*.js"]],
    ["fastq", "1.20.1", ["queue.js"]],
    ["fill-range", "7.1.1", ["index.js"]],
    ["glob-parent", "5.1.2", ["index.js"]],
    ["is-extglob", "2.1.1", ["index.js"]],
    ["is-glob", "4.0.3", ["index.js"]],
    ["is-number", "7.0.0", ["index.js"]],
    ["json-schema-traverse", "1.0.0", ["index.js"]],
    ["jsonc-parser", "3.3.1", ["lib/umd/**/*.js"]],
    ["merge2", "1.4.1", ["index.js"]],
    ["micromatch", "4.0.8", ["index.js"]],
    ["picomatch", "2.3.2", ["index.js", "lib/*.js"]],
    ["queue-microtask", "1.2.3", ["index.js"]],
    ["require-from-string", "2.0.2", ["index.js"]],
    ["reusify", "1.1.0", ["reusify.js"]],
    ["run-parallel", "1.2.0", ["index.js"]],
    ["to-regex-range", "5.0.1", ["index.js"]],
  ].map(([name, version, runtime]) =>
    Object.freeze({ name, version, runtime }),
  ),
);

const SPECIFICATION_BY_NAME = new Map(
  THIRD_PARTY_SPECIFICATIONS.map((value) => [value.name, value]),
);
const INTERNAL_NAMES = new Set(WORKSPACES.map(({ name }) => name));

const DECLARATION_BOUNDS = Object.freeze({
  ajv: { entries: ["dist/ajv.d.ts", "dist/2020.d.ts"], prefixes: ["dist/"] },
  elkjs: { entries: ["lib/main.d.ts", "lib/elk-api.d.ts"], exact: true },
  "jsonc-parser": { entries: ["lib/umd/main.d.ts"], exact: true },
  "fast-uri": { entries: ["types/index.d.ts"], exact: true },
});

function patternMatches(pattern, path) {
  if (!pattern.includes("*")) return pattern === path;
  const recursive = pattern.indexOf("**");
  if (recursive !== -1) {
    const prefix = pattern.slice(0, recursive);
    const suffix = pattern
      .slice(recursive + 2)
      .replaceAll("*", "")
      .replaceAll("/", "");
    return path.startsWith(prefix) && path.endsWith(suffix);
  }
  const wildcard = pattern.indexOf("*");
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  const middle = path.slice(prefix.length, path.length - suffix.length);
  return (
    path.startsWith(prefix) && path.endsWith(suffix) && !middle.includes("/")
  );
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**/", "(?:.*/)?")
    .replaceAll("**", ".*")
    .replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`, "u").test(path);
}

function packagePathForName(name) {
  return `package/node_modules/${name}`;
}

function parentImporterKey(importerKey) {
  const marker = importerKey.lastIndexOf("/node_modules/");
  if (marker !== -1) return importerKey.slice(0, marker);
  if (importerKey.startsWith("node_modules/")) return "";
  return "";
}

export function resolveDependencyLockKey(
  lockPackages,
  importerKey,
  dependency,
) {
  let cursor = importerKey;
  for (;;) {
    const candidate =
      cursor === ""
        ? `node_modules/${dependency}`
        : `${cursor}/node_modules/${dependency}`;
    if (lockPackages[candidate] !== undefined) return candidate;
    if (cursor === "") break;
    cursor = parentImporterKey(cursor);
  }
  throw new Error(
    `PKG001 Lockfile dependency '${dependency}' is unresolved from '${importerKey}'.`,
  );
}

async function enumerateInstalledPackage(root) {
  const output = [];
  async function visit(directory, prefix) {
    for (const name of (await readdir(directory)).sort(compareCodeUnits)) {
      if (prefix === "" && name === "node_modules") continue;
      const absolute = join(directory, name);
      const logical = prefix === "" ? name : `${prefix}/${name}`;
      assertLogicalPath(logical, "third-party package path");
      const stats = await lstat(absolute, { bigint: true });
      if (stats.isSymbolicLink())
        throw new Error(
          `PKG002 Linked third-party path '${logical}' is forbidden.`,
        );
      if (stats.isDirectory()) await visit(absolute, logical);
      else if (stats.isFile() && stats.nlink === 1n) output.push(logical);
      else
        throw new Error(
          `PKG002 Non-ordinary third-party path '${logical}' is forbidden.`,
        );
    }
  }
  await visit(root, "");
  return output;
}

async function resolveThirdPartyRoots({
  repositoryRoot,
  lockPath,
  lockBytes,
  modulesPath,
  workspaceManifestBytes,
  fileReader,
}) {
  const lock =
    lockBytes === undefined
      ? await readJsonFile(lockPath)
      : parseJsonBytes(lockBytes, "package-lock.json");
  if (
    lock.lockfileVersion !== 3 ||
    typeof lock.packages !== "object" ||
    lock.packages === null
  ) {
    throw new Error("PKG001 The release lockfile must use lockfileVersion 3.");
  }
  await assertOrdinaryDirectory(modulesPath);
  const manifests = new Map();
  for (const workspace of WORKSPACES) {
    const logicalPath = `packages/${workspace.directory}/package.json`;
    manifests.set(
      workspace.name,
      workspaceManifestBytes?.has(logicalPath)
        ? parseJsonBytes(workspaceManifestBytes.get(logicalPath), logicalPath)
        : await readJsonFile(
            join(
              repositoryRoot,
              "packages",
              workspace.directory,
              "package.json",
            ),
          ),
    );
  }

  const resolved = new Map();
  const queue = [];
  for (const workspace of WORKSPACES) {
    const manifest = manifests.get(workspace.name);
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort(
      compareCodeUnits,
    )) {
      if (!INTERNAL_NAMES.has(dependency))
        queue.push({
          dependency,
          importerKey: `packages/${workspace.directory}`,
        });
    }
  }

  while (queue.length > 0) {
    const { dependency, importerKey } = queue.shift();
    const specification = SPECIFICATION_BY_NAME.get(dependency);
    if (specification === undefined) {
      throw new Error(`PKG001 Unexpected runtime dependency '${dependency}'.`);
    }
    const lockKey = resolveDependencyLockKey(
      lock.packages,
      importerKey,
      dependency,
    );
    if (
      dependency === "picomatch" &&
      lockKey !== "node_modules/micromatch/node_modules/picomatch"
    ) {
      throw new Error(
        "PKG006 Third-party identity 'picomatch@2.3.2' does not match lock key 'node_modules/micromatch/node_modules/picomatch'.",
      );
    }
    const lockEntry = lock.packages[lockKey];
    if (
      lockEntry.version !== specification.version ||
      typeof lockEntry.integrity !== "string"
    ) {
      throw new Error(
        `PKG006 Third-party identity '${specification.name}@${specification.version}' does not match lock key '${lockKey}'.`,
      );
    }
    const existing = resolved.get(dependency);
    if (existing !== undefined) {
      if (
        existing.lockKey !== lockKey ||
        existing.version !== specification.version
      ) {
        throw new Error(
          `PKG001 Duplicate third-party identity '${dependency}' resolved inconsistently.`,
        );
      }
      continue;
    }
    const installedRoot = join(
      modulesPath,
      ...lockKey.replace(/^node_modules\//u, "").split("/"),
    );
    await assertContainedPath(modulesPath, installedRoot);
    await assertOrdinaryDirectory(installedRoot);
    const manifestPath = join(installedRoot, "package.json");
    await assertOrdinaryFile(manifestPath);
    const manifestBytes = Buffer.from(await fileReader(manifestPath));
    const manifest = parseJsonBytes(manifestBytes, `${lockKey}/package.json`);
    if (
      manifest.name !== dependency ||
      manifest.version !== specification.version
    ) {
      throw new Error(
        `PKG006 Third-party identity '${specification.name}@${specification.version}' does not match lock key '${lockKey}'.`,
      );
    }
    const record = {
      ...specification,
      lockKey,
      integrity: lockEntry.integrity,
      installedRoot,
      manifest,
      manifestBytes,
    };
    resolved.set(dependency, record);
    const dependencyNames = Object.keys(manifest.dependencies ?? {}).sort(
      compareCodeUnits,
    );
    const optionalNames = Object.keys(manifest.optionalDependencies ?? {}).sort(
      compareCodeUnits,
    );
    for (const child of [...dependencyNames, ...optionalNames]) {
      if (SPECIFICATION_BY_NAME.has(child))
        queue.push({ dependency: child, importerKey: lockKey });
    }
  }

  const expected = THIRD_PARTY_SPECIFICATIONS.map(({ name }) => name).sort(
    compareCodeUnits,
  );
  const observed = [...resolved.keys()].sort(compareCodeUnits);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `PKG001 Third-party closure differs: ${JSON.stringify(observed)}.`,
    );
  }
  if (
    resolved.get("picomatch")?.lockKey !==
    "node_modules/micromatch/node_modules/picomatch"
  ) {
    throw new Error(
      "PKG006 Third-party identity 'picomatch@2.3.2' does not match lock key 'node_modules/micromatch/node_modules/picomatch'.",
    );
  }
  return [...resolved.values()].sort((left, right) =>
    compareCodeUnits(left.name, right.name),
  );
}

function declarationPathAllowed(name, path) {
  const bound = DECLARATION_BOUNDS[name];
  if (bound === undefined || !path.endsWith(".d.ts")) return false;
  if (bound.exact) return bound.entries.includes(path);
  return bound.prefixes.some((prefix) => path.startsWith(prefix));
}

function resolveRelativeDeclaration(fromPath, specifier, available) {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (base === ".." || base.startsWith("../") || posix.isAbsolute(base)) {
    throw new Error(
      `PKG007 Declaration edge '${specifier}' escapes its package.`,
    );
  }
  const candidates = specifier.endsWith(".js")
    ? [base.slice(0, -3) + ".d.ts"]
    : specifier.endsWith(".d.ts")
      ? [base]
      : [`${base}.d.ts`, `${base}/index.d.ts`];
  return candidates.find((candidate) => available.has(candidate));
}

async function computeDeclarationClosure(packages, readPackageFile) {
  const byName = new Map(packages.map((value) => [value.name, value]));
  const available = new Map();
  for (const package_ of packages) {
    if (DECLARATION_BOUNDS[package_.name] === undefined) continue;
    available.set(
      package_.name,
      new Set(
        (await enumerateInstalledPackage(package_.installedRoot)).filter(
          (path) => path.endsWith(".d.ts"),
        ),
      ),
    );
  }
  const queue = [];
  for (const [name, bound] of Object.entries(DECLARATION_BOUNDS)) {
    for (const path of bound.entries) queue.push({ name, path });
  }
  const reached = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.name}\u0000${current.path}`;
    if (reached.has(key)) continue;
    if (
      !declarationPathAllowed(current.name, current.path) ||
      !available.get(current.name)?.has(current.path)
    ) {
      throw new Error(
        `PKG007 Declaration '${current.name}/${current.path}' is outside its positive bound.`,
      );
    }
    reached.set(key, current);
    const package_ = byName.get(current.name);
    const text = (await readPackageFile(package_, current.path)).toString(
      "utf8",
    );
    const preprocessed = ts.preProcessFile(text, true, true);
    for (const imported of [
      ...preprocessed.importedFiles,
      ...preprocessed.referencedFiles,
    ]) {
      const specifier = imported.fileName;
      if (specifier.startsWith(".")) {
        const target = resolveRelativeDeclaration(
          current.path,
          specifier,
          available.get(current.name),
        );
        if (target === undefined)
          throw new Error(`PKG007 Unresolved declaration edge '${specifier}'.`);
        queue.push({ name: current.name, path: target });
      } else if (specifier === "fast-uri") {
        queue.push({ name: "fast-uri", path: "types/index.d.ts" });
      } else if (!(specifier.startsWith("node:") && isBuiltin(specifier))) {
        throw new Error(
          `PKG007 Declaration edge '${specifier}' leaves the closed identity set.`,
        );
      }
    }
  }
  return [...reached.values()].sort((left, right) =>
    compareCodeUnits(
      `${left.name}\u0000${left.path}`,
      `${right.name}\u0000${right.path}`,
    ),
  );
}

export async function collectThirdPartySource({
  repositoryRoot = REPOSITORY_ROOT,
  lockPath = join(repositoryRoot, "package-lock.json"),
  lockBytes,
  modulesPath = join(repositoryRoot, "node_modules"),
  workspaceManifestBytes,
  expectedInventory,
  fileReader = readFile,
} = {}) {
  const packages = await resolveThirdPartyRoots({
    repositoryRoot,
    lockPath,
    lockBytes,
    modulesPath,
    workspaceManifestBytes,
    fileReader,
  });
  const expectedPackages = new Map(
    (expectedInventory?.packages ?? []).map((package_) => [
      package_.name,
      package_,
    ]),
  );
  const assertCapturedByte = (package_, path, bytes) => {
    if (expectedInventory === undefined) return;
    const expectedPackage = expectedPackages.get(package_.name);
    const expectedFile = expectedPackage?.files.find(
      (file) => file.path === path,
    );
    if (
      expectedPackage?.version !== package_.version ||
      expectedPackage?.lockKey !== package_.lockKey ||
      expectedPackage?.integrity !== package_.integrity ||
      expectedFile === undefined ||
      expectedFile.sha256 !== sha256(bytes)
    ) {
      throw new Error(
        `PKG002 Captured bytes differ for '${package_.name}/${path}'.`,
      );
    }
  };
  const sourceBytes = new Map();
  for (const package_ of packages) {
    assertCapturedByte(package_, "package.json", package_.manifestBytes);
    sourceBytes.set(
      join(package_.installedRoot, "package.json"),
      Buffer.from(package_.manifestBytes),
    );
  }
  const readPackageFile = async (package_, path) => {
    const absolute = join(package_.installedRoot, ...path.split("/"));
    if (!sourceBytes.has(absolute)) {
      const bytes = Buffer.from(await fileReader(absolute));
      assertCapturedByte(package_, path, bytes);
      sourceBytes.set(absolute, bytes);
    }
    return sourceBytes.get(absolute);
  };
  const declarationClosure = await computeDeclarationClosure(
    packages,
    readPackageFile,
  );
  const declarationsByName = new Map();
  for (const entry of declarationClosure) {
    const values = declarationsByName.get(entry.name) ?? new Set();
    values.add(entry.path);
    declarationsByName.set(entry.name, values);
  }
  const records = [];
  for (const package_ of packages) {
    const paths = await enumerateInstalledPackage(package_.installedRoot);
    const files = [];
    for (const path of paths) {
      let role;
      if (path === "package.json") role = "manifest";
      else if (
        /^(?:LICENSE|COPYING|NOTICE)/iu.test(path) &&
        !path.includes("/")
      )
        role = "license";
      else if (declarationsByName.get(package_.name)?.has(path))
        role = "declaration";
      else if (
        package_.runtime.some((pattern) => patternMatches(pattern, path))
      )
        role = "runtime";
      else continue;
      const bytes = await readPackageFile(package_, path);
      files.push({ path, role, sha256: sha256(bytes) });
    }
    files.sort((left, right) => compareCodeUnits(left.path, right.path));
    if (
      !files.some(
        ({ path, role }) => path === "package.json" && role === "manifest",
      )
    ) {
      throw new Error(
        `PKG001 Third-party package '${package_.name}@${package_.version}' has no source manifest.`,
      );
    }
    const license = package_.manifest.license;
    if (typeof license !== "string" || license === "") {
      throw new Error(
        `PKG003 Third-party package '${package_.name}@${package_.version}' has no declared license.`,
      );
    }
    if (license === "UNLICENSED" || license === "NONE") {
      throw new Error(
        `PKG004 Third-party package '${package_.name}@${package_.version}' has an unusable license declaration.`,
      );
    }
    if (!files.some(({ role }) => role === "license")) {
      throw new Error(
        `PKG005 Third-party package '${package_.name}@${package_.version}' has no packaged license file.`,
      );
    }
    if (license.startsWith("SEE LICENSE IN ")) {
      const named = license.slice("SEE LICENSE IN ".length);
      if (
        !files.some(({ path, role }) => role === "license" && path === named)
      ) {
        throw new Error(
          `PKG005 Third-party package '${package_.name}@${package_.version}' has no packaged license file.`,
        );
      }
    }
    records.push({
      name: package_.name,
      version: package_.version,
      lockKey: package_.lockKey,
      integrity: package_.integrity,
      files,
      installedRoot: package_.installedRoot,
      manifest: package_.manifest,
      fileBytes: new Map(
        files.map(({ path }) => [
          path,
          Buffer.from(
            sourceBytes.get(join(package_.installedRoot, ...path.split("/"))),
          ),
        ]),
      ),
    });
  }
  const inventory = {
    format: "thermite-schematics-release-third-party-source-files/0.1",
    packages: records.map(
      ({
        installedRoot: _root,
        manifest: _manifest,
        fileBytes: _bytes,
        ...record
      }) => record,
    ),
  };
  if (expectedInventory !== undefined) {
    assertInventoryEqual(
      inventory,
      expectedInventory,
      "Third-party source inventory",
    );
  }
  return {
    inventory,
    packages: records,
    declarationClosure,
    capturedBytes: sourceBytes,
  };
}

const REMOVED_MANIFEST_FIELDS = Object.freeze([
  "scripts",
  "devDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "workspaces",
  "packageManager",
  "publishConfig",
  "files",
  "directories",
  "repository",
  "bugs",
  "homepage",
  "funding",
  "keywords",
  "contributors",
  "maintainers",
]);

export function transformPackageManifest(
  manifest,
  exactVersions,
  { cliRoot = false } = {},
) {
  const transformed = structuredClone(manifest);
  for (const field of REMOVED_MANIFEST_FIELDS) delete transformed[field];
  delete transformed.bundleDependencies;
  delete transformed.bundledDependencies;
  const dependencies = {};
  const declared = cliRoot
    ? [...exactVersions.keys()]
    : [
        ...Object.keys(transformed.dependencies ?? {}),
        ...Object.keys(transformed.optionalDependencies ?? {}),
      ];
  for (const name of [...new Set(declared)].sort(compareCodeUnits)) {
    const version = exactVersions.get(name);
    if (version === undefined)
      throw new Error(
        `PKG001 Staged dependency '${name}' is outside the resolved closure.`,
      );
    dependencies[name] = version;
  }
  if (Object.keys(dependencies).length === 0) delete transformed.dependencies;
  else transformed.dependencies = dependencies;
  delete transformed.optionalDependencies;
  if (cliRoot) transformed.bundledDependencies = Object.keys(dependencies);
  const canonical = canonicalizeJson(transformed);
  if (
    canonical.scripts !== undefined ||
    canonical.optionalDependencies !== undefined
  ) {
    throw new Error("PKG001 Staged manifest retains a forbidden field.");
  }
  if (
    cliRoot &&
    (JSON.stringify(canonical.bin) !==
      JSON.stringify({ thermite: "./dist/bin.js" }) ||
      JSON.stringify(canonical.bundledDependencies) !==
        JSON.stringify(Object.keys(dependencies)))
  ) {
    throw new Error("PKG001 Staged CLI bin or bundled closure differs.");
  }
  const reparsed = parseJsonBytes(
    Buffer.from(serializeCanonicalJson(canonical)),
    "transformed package manifest",
  );
  if (JSON.stringify(reparsed) !== JSON.stringify(canonical)) {
    throw new Error("PKG001 Staged manifest serialization is unstable.");
  }
  return canonical;
}

export async function stageThirdPartyPackages({
  stageRoot,
  source,
  exactVersions,
  expectedInventory,
} = {}) {
  const stageRecords = [];
  const licensePackages = [];
  const bytes = new Map();
  const expectedPackages = new Map(
    (expectedInventory?.packages ?? []).map((package_) => [
      package_.name,
      package_,
    ]),
  );
  for (const package_ of source.packages) {
    const packagePath = packagePathForName(package_.name);
    const transformed = transformPackageManifest(
      package_.manifest,
      exactVersions,
    );
    const manifestBytes = serializeCanonicalJson(transformed);
    const manifestPath = `${packagePath}/package.json`;
    bytes.set(manifestPath, Buffer.from(manifestBytes));
    const expectedPackage = expectedPackages.get(package_.name);
    if (
      expectedInventory !== undefined &&
      (expectedPackage?.version !== package_.version ||
        expectedPackage?.packagePath !== packagePath ||
        expectedPackage?.manifest.path !== manifestPath ||
        expectedPackage?.manifest.sha256 !== sha256(manifestBytes))
    ) {
      throw new Error(`PKG002 Staged manifest differs for '${package_.name}'.`);
    }
    const files = [];
    const licenseFiles = [];
    for (const entry of package_.files) {
      if (entry.role === "manifest") continue;
      const stagePath = `${packagePath}/${entry.path}`;
      const stagedBytes = package_.fileBytes.get(entry.path);
      if (stagedBytes === undefined || sha256(stagedBytes) !== entry.sha256) {
        throw new Error(
          `PKG002 Staged bytes differ for '${package_.name}/${entry.path}'.`,
        );
      }
      bytes.set(stagePath, Buffer.from(stagedBytes));
      const expectedFile = expectedPackage?.files.find(
        (file) => file.path === stagePath,
      );
      if (
        expectedInventory !== undefined &&
        (expectedFile?.role !== entry.role ||
          expectedFile?.sha256 !== entry.sha256)
      ) {
        throw new Error(
          `PKG002 Staged bytes differ for '${package_.name}/${entry.path}'.`,
        );
      }
      files.push({ path: stagePath, role: entry.role, sha256: entry.sha256 });
      if (entry.role === "license")
        licenseFiles.push({ path: entry.path, sha256: entry.sha256 });
    }
    files.sort((left, right) => compareCodeUnits(left.path, right.path));
    licenseFiles.sort((left, right) => compareCodeUnits(left.path, right.path));
    stageRecords.push({
      name: package_.name,
      version: package_.version,
      packagePath,
      manifest: { path: manifestPath, sha256: sha256(manifestBytes) },
      files,
    });
    licensePackages.push({
      name: package_.name,
      version: package_.version,
      license: package_.manifest.license,
      packagePath,
      licenseFiles,
    });
  }
  stageRecords.sort((left, right) => compareCodeUnits(left.name, right.name));
  licensePackages.sort((left, right) => {
    for (const key of ["name", "version", "packagePath"]) {
      const compared = compareCodeUnits(left[key], right[key]);
      if (compared !== 0) return compared;
    }
    return 0;
  });
  const inventory = {
    format: "thermite-schematics-release-third-party-stage-files/0.1",
    packages: stageRecords,
  };
  if (expectedInventory !== undefined) {
    assertInventoryEqual(
      inventory,
      expectedInventory,
      "Third-party stage inventory",
    );
  }
  if (stageRoot !== undefined) {
    for (const path of [...bytes.keys()].sort(compareCodeUnits)) {
      await writeExclusiveFile(
        join(stageRoot, ...path.split("/")),
        bytes.get(path),
      );
    }
    for (const package_ of source.packages) {
      await assertOrdinaryDirectory(
        join(stageRoot, ...packagePathForName(package_.name).split("/")),
      );
    }
  }
  return {
    inventory,
    licenses: {
      format: "thermite-schematics-third-party-licenses/0.1",
      packages: licensePackages,
    },
    bytes,
  };
}

function exportedTypeTargets(manifest, subpath) {
  const key = subpath === "" ? "." : `./${subpath}`;
  const entry =
    manifest.exports?.[key] ?? (subpath === "" ? manifest.exports : undefined);
  const targets = [];
  const visit = (value, insideTypes = false) => {
    if (typeof value === "string") {
      if (insideTypes || value.endsWith(".d.ts")) targets.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, insideTypes);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [condition, child] of Object.entries(value)) {
      visit(child, insideTypes || condition === "types");
    }
  };
  visit(entry);
  if (subpath === "") {
    for (const target of [manifest.types, manifest.typings]) {
      if (typeof target === "string") targets.push(target);
    }
  }
  return [...new Set(targets)];
}

const STAGE_DECLARATION_ROOT = "/__thermite_schematics_completed_stage__";

function stageDeclarationVirtualPath(path) {
  return STAGE_DECLARATION_ROOT + "/" + path;
}

function stageDeclarationLogicalPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const prefix = STAGE_DECLARATION_ROOT + "/";
  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : undefined;
}

function declarationFileName(path) {
  return /\.d\.(?:c|m)?ts$/u.test(path);
}

function createStageDeclarationHost(stageBytes, options) {
  const directories = new Set([STAGE_DECLARATION_ROOT]);
  const children = new Map();
  const addChild = (directory, kind, name) => {
    const entry = children.get(directory) ?? {
      files: new Set(),
      directories: new Set(),
    };
    entry[kind].add(name);
    children.set(directory, entry);
  };
  for (const logical of stageBytes.keys()) {
    const parts = logical.split("/");
    let directory = STAGE_DECLARATION_ROOT;
    for (let index = 0; index < parts.length - 1; index += 1) {
      addChild(directory, "directories", parts[index]);
      directory += "/" + parts[index];
      directories.add(directory);
    }
    addChild(directory, "files", parts.at(-1));
  }
  const normalized = (path) => path.replaceAll("\\", "/");
  const readBytes = (path) => {
    const logical = stageDeclarationLogicalPath(normalized(path));
    return logical === undefined ? undefined : stageBytes.get(logical);
  };
  const host = {
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
    getDefaultLibFileName() {
      return STAGE_DECLARATION_ROOT + "/__missing_lib__.d.ts";
    },
    writeFile() {
      throw new Error("PKG007 Completed stage declaration proof cannot write.");
    },
    getCurrentDirectory() {
      return STAGE_DECLARATION_ROOT;
    },
    getCanonicalFileName(fileName) {
      return normalized(fileName);
    },
    useCaseSensitiveFileNames() {
      return true;
    },
    getNewLine() {
      return "\n";
    },
    fileExists(path) {
      return readBytes(path) !== undefined;
    },
    readFile(path) {
      const bytes = readBytes(path);
      return bytes === undefined ? undefined : bytes.toString("utf8");
    },
    directoryExists(path) {
      return directories.has(normalized(path).replace(/\/$/u, ""));
    },
    getDirectories(path) {
      const directory = normalized(path).replace(/\/$/u, "");
      return [...(children.get(directory)?.directories ?? [])].sort(
        compareCodeUnits,
      );
    },
    readDirectory(path, extensions, _excludes, _includes, depth) {
      const directory = normalized(path).replace(/\/$/u, "");
      const prefix = directory + "/";
      return [...stageBytes.keys()]
        .map(stageDeclarationVirtualPath)
        .filter((file) => {
          if (!file.startsWith(prefix)) return false;
          const child = file.slice(prefix.length);
          if (depth !== undefined && child.split("/").length - 1 > depth) {
            return false;
          }
          return (
            extensions === undefined ||
            extensions.some((extension) => file.endsWith(extension))
          );
        })
        .sort(compareCodeUnits);
    },
    realpath(path) {
      const value = normalized(path).replace(/\/$/u, "");
      return host.fileExists(value) || host.directoryExists(value)
        ? value
        : undefined;
    },
  };
  const moduleCache = ts.createModuleResolutionCache(
    STAGE_DECLARATION_ROOT,
    (path) => host.getCanonicalFileName(path),
    options,
  );
  const typeReferenceCache = ts.createTypeReferenceDirectiveResolutionCache(
    STAGE_DECLARATION_ROOT,
    (path) => host.getCanonicalFileName(path),
    options,
  );
  return { host, moduleCache, typeReferenceCache };
}

function collectStageModuleUsages(sourceFile) {
  const usages = [];
  const add = (kind, usage) => {
    if (usage !== undefined && ts.isStringLiteralLike(usage)) {
      usages.push({ kind, usage });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      add("import", node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      add("export", node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add("import-equals", node.moduleReference.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      add("import-type", node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add("dynamic-import", node.arguments[0]);
    }
    if (ts.isModuleDeclaration(node)) {
      add("module-declaration", node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return usages;
}

export function auditStageDeclarationClosure(
  stageBytes,
  firstPartyInventory,
  thirdPartyInventory,
) {
  if (!(stageBytes instanceof Map)) {
    throw new Error(
      "PKG007 Completed stage declaration proof requires stage bytes.",
    );
  }
  const expectedFirstParty = new Set(
    firstPartyInventory.packages.flatMap((package_) =>
      package_.files
        .filter(({ role }) => role === "declaration")
        .map(({ stagePath }) => stagePath),
    ),
  );
  const expectedThirdParty = new Set(
    thirdPartyInventory.packages.flatMap((package_) =>
      package_.files
        .filter(({ role }) => role === "declaration")
        .map(({ path }) => path),
    ),
  );
  const packages = new Map();
  for (const package_ of [
    ...firstPartyInventory.packages,
    ...thirdPartyInventory.packages,
  ]) {
    const root = package_.stagePath ?? package_.packagePath;
    const manifestPath = root + "/package.json";
    const manifestBytes = stageBytes.get(manifestPath);
    if (manifestBytes === undefined) {
      throw new Error(
        "PKG007 Declaration package manifest is missing: '" +
          manifestPath +
          "'.",
      );
    }
    const manifest = parseJsonBytes(manifestBytes, manifestPath);
    if (manifest.name !== package_.name || packages.has(package_.name)) {
      throw new Error(
        "PKG007 Declaration package identity differs: '" + package_.name + "'.",
      );
    }
    packages.set(package_.name, { root, manifest });
  }

  const rootNames = [];
  for (const package_ of firstPartyInventory.packages) {
    const information = packages.get(package_.name);
    const targets = exportedTypeTargets(information.manifest, "");
    if (targets.length === 0) {
      throw new Error(
        "PKG007 Declaration package has no types entry: '" +
          package_.name +
          "'.",
      );
    }
    for (const target of targets) {
      if (!target.startsWith("./")) {
        throw new Error(
          "PKG007 Declaration package types entry is not relative: '" +
            package_.name +
            "'.",
        );
      }
      const path = posix.normalize(
        posix.join(information.root, target.slice(2)),
      );
      if (
        !path.startsWith(information.root + "/") ||
        !stageBytes.has(path) ||
        !expectedFirstParty.has(path) ||
        !declarationFileName(path)
      ) {
        throw new Error(
          "PKG007 Unresolved declaration edge '" +
            package_.name +
            " package types'.",
        );
      }
      rootNames.push(stageDeclarationVirtualPath(path));
    }
  }
  for (const [name, bound] of Object.entries(DECLARATION_BOUNDS)) {
    const information = packages.get(name);
    if (information === undefined) continue;
    for (const entry of bound.entries) {
      const path = information.root + "/" + entry;
      if (
        !stageBytes.has(path) ||
        !expectedThirdParty.has(path) ||
        !declarationFileName(path)
      ) {
        throw new Error(
          "PKG007 Unresolved declaration edge '" + name + "/" + entry + "'.",
        );
      }
      rootNames.push(stageDeclarationVirtualPath(path));
    }
  }

  const options = {
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [],
  };
  const { host, moduleCache, typeReferenceCache } = createStageDeclarationHost(
    stageBytes,
    options,
  );
  const program = ts.createProgram({
    rootNames: [...new Set(rootNames)].sort(compareCodeUnits),
    options,
    host,
  });
  const reached = new Set();
  const sources = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    const logical = stageDeclarationLogicalPath(sourceFile.fileName);
    if (
      logical === undefined ||
      !stageBytes.has(logical) ||
      !sourceFile.isDeclarationFile ||
      (!expectedFirstParty.has(logical) && !expectedThirdParty.has(logical))
    ) {
      throw new Error(
        "PKG007 Declaration is outside the completed stage inventory: '" +
          sourceFile.fileName +
          "'.",
      );
    }
    const canonical = host.getCanonicalFileName(sourceFile.fileName);
    if (sources.has(canonical) || reached.has(logical)) {
      throw new Error(
        "PKG007 Duplicate declaration identity in the completed stage: '" +
          logical +
          "'.",
      );
    }
    reached.add(logical);
    sources.set(canonical, { logical, sourceFile });
  }

  const edges = [];
  const assertResolved = (from, specifier, resolvedFileName) => {
    const real = host.realpath(resolvedFileName);
    const target =
      real === undefined
        ? undefined
        : sources.get(host.getCanonicalFileName(real));
    if (
      target === undefined ||
      !target.sourceFile.isDeclarationFile ||
      (!expectedFirstParty.has(target.logical) &&
        !expectedThirdParty.has(target.logical)) ||
      !reached.has(target.logical)
    ) {
      throw new Error(
        "PKG007 Declaration edge '" +
          specifier +
          "' from '" +
          from +
          "' did not resolve to a loaded inventoried declaration.",
      );
    }
    edges.push({ from, specifier, to: target.logical });
  };
  for (const { logical: from, sourceFile } of sources.values()) {
    if (sourceFile.libReferenceDirectives.length !== 0) {
      throw new Error(
        "PKG007 Declaration '" + from + "' contains a forbidden lib reference.",
      );
    }
    for (const { usage } of collectStageModuleUsages(sourceFile)) {
      const specifier = usage.text;
      const resolved = ts.resolveModuleName(
        specifier,
        sourceFile.fileName,
        options,
        host,
        moduleCache,
        undefined,
        program.getModeForUsageLocation(sourceFile, usage),
      ).resolvedModule;
      if (resolved === undefined) {
        if (specifier.startsWith("node:") && isBuiltin(specifier)) continue;
        throw new Error(
          "PKG007 Unresolved declaration edge '" + specifier + "'.",
        );
      }
      assertResolved(from, specifier, resolved.resolvedFileName);
    }
    for (const reference of sourceFile.referencedFiles) {
      const resolved = ts.resolveTripleslashReference(
        reference.fileName,
        sourceFile.fileName,
      );
      if (!host.fileExists(resolved)) {
        throw new Error(
          "PKG007 Unresolved declaration edge '" + reference.fileName + "'.",
        );
      }
      assertResolved(from, reference.fileName, resolved);
    }
    for (const reference of sourceFile.typeReferenceDirectives) {
      const name = reference.fileName;
      const resolved = ts.resolveTypeReferenceDirective(
        name,
        sourceFile.fileName,
        options,
        host,
        undefined,
        typeReferenceCache,
        ts.getModeForFileReference(reference, sourceFile.impliedNodeFormat),
      ).resolvedTypeReferenceDirective;
      if (resolved === undefined) {
        throw new Error("PKG007 Unresolved declaration edge '" + name + "'.");
      }
      assertResolved(from, name, resolved.resolvedFileName);
    }
  }

  const expectedThirdPartyPaths = [...expectedThirdParty].sort(
    compareCodeUnits,
  );
  const reachedThirdParty = [...reached]
    .filter((path) => expectedThirdParty.has(path))
    .sort(compareCodeUnits);
  if (
    JSON.stringify(reachedThirdParty) !==
    JSON.stringify(expectedThirdPartyPaths)
  ) {
    throw new Error(
      "PKG007 Completed stage declaration closure differs from the committed inventory.",
    );
  }
  edges.sort((left, right) =>
    compareCodeUnits(
      left.from + "\u0000" + left.specifier + "\u0000" + left.to,
      right.from + "\u0000" + right.specifier + "\u0000" + right.to,
    ),
  );
  return Object.freeze({
    reached: Object.freeze([...reached].sort(compareCodeUnits)),
    edges,
  });
}

export function assertInventoryEqual(observed, expected, label) {
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`${label} differs from the committed authority.`);
  }
}

function parseArguments(argv) {
  const values = {};
  let mode;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--record" || argument === "--verify") {
      if (mode !== undefined)
        throw new Error("Exactly one inventory mode is required.");
      mode = argument.slice(2);
      continue;
    }
    if (
      ![
        "--lock",
        "--modules",
        "--source-inventory",
        "--stage-inventory",
      ].includes(argument)
    ) {
      throw new Error(
        `Unknown inventory argument ${JSON.stringify(argument)}.`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || values[argument] !== undefined)
      throw new Error("Invalid inventory arguments.");
    values[argument] = value;
    index += 1;
  }
  if (mode === undefined || Object.keys(values).length !== 4) {
    throw new Error(
      "The inventory command requires lock, modules, source/stage inventories, and one mode.",
    );
  }
  return { mode, values };
}

async function main(argv) {
  const { mode, values } = parseArguments(argv);
  if (mode === "verify") {
    const lockPath = resolve(REPOSITORY_ROOT, values["--lock"]);
    const modulesPath = resolve(REPOSITORY_ROOT, values["--modules"]);
    const sourceInventoryPath = resolve(
      REPOSITORY_ROOT,
      values["--source-inventory"],
    );
    const stageInventoryPath = resolve(
      REPOSITORY_ROOT,
      values["--stage-inventory"],
    );
    const source = await collectThirdPartySource({
      lockPath,
      modulesPath,
    });
    assertInventoryEqual(
      source.inventory,
      await readJsonFile(sourceInventoryPath),
      "Third-party source inventory",
    );
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-third-party-verify-"),
    );
    const captured = await lstat(temporaryRoot, { bigint: true });
    try {
      const staged = await stageThirdPartyPackages({
        stageRoot: temporaryRoot,
        source,
        exactVersions: new Map(
          source.packages.map(({ name, version }) => [name, version]),
        ),
      });
      assertInventoryEqual(
        staged.inventory,
        await readJsonFile(stageInventoryPath),
        "Third-party stage inventory",
      );
    } finally {
      const observed = await lstat(temporaryRoot, { bigint: true });
      if (
        !observed.isDirectory() ||
        observed.isSymbolicLink() ||
        observed.dev !== captured.dev ||
        observed.ino !== captured.ino
      ) {
        throw new Error(
          "Third-party verification temporary-root identity changed.",
        );
      }
      await rm(temporaryRoot, { recursive: true, force: false });
    }
    return;
  }
  const { recordOrVerifyReleaseInventories } =
    await import("./release-package.mjs");
  await recordOrVerifyReleaseInventories({
    mode,
    lockPath: resolve(REPOSITORY_ROOT, values["--lock"]),
    modulesPath: resolve(REPOSITORY_ROOT, values["--modules"]),
    firstPartyPath: join(
      REPOSITORY_ROOT,
      "scripts",
      "release-first-party-files.json",
    ),
    sourceInventoryPath: resolve(REPOSITORY_ROOT, values["--source-inventory"]),
    stageInventoryPath: resolve(REPOSITORY_ROOT, values["--stage-inventory"]),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
