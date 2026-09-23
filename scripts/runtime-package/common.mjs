import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { runtimeTargets } from "./platform.mjs";
import { parseBunLockText } from "../read-bun-lock.mjs";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const json = (value) => JSON.stringify(value, null, 2) + "\n";
export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));
export const manifestName = "runtime-manifest.json";
export const isLicenseFile = (path) =>
  /^(?:(?:MIT|Apache-2\.0|brotli-vendor)-)?(?:licen[cs]e|copying|notice|copyright(?:notice)?)(?:\.(?:txt|md|rst|MIT))?$/i.test(
    path,
  );
export const runtimeFilename = (manifest) =>
  `thermite-${manifest.version}-${manifest.target}-bun-${manifest.preview ? `preview-${manifest.sourceDigest.slice(0, 8)}` : manifest.commit.slice(0, 8)}.zip`;
export function verifyArchiveIdentity(
  manifest,
  filename,
  { allowPreview = false } = {},
) {
  if (manifest.preview && !allowPreview)
    throw new Error(
      "Preview package is not a release; use --allow-preview only for local testing.",
    );
  if (filename !== runtimeFilename(manifest))
    throw new Error("Runtime filename does not match the manifest identity.");
  const sourceUrl = `https://github.com/BlackettApplied/ThermiteSchematics/tree/${manifest.commit}`;
  if (
    (manifest.preview ? manifest.baseSourceUrl : manifest.sourceUrl) !==
    sourceUrl
  )
    throw new Error("Runtime source URL does not match the commit identity.");
}

// Never dereference links into a developer checkout or Bun's package cache.
export async function listFiles(root, prefix = "") {
  const files = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = await lstat(join(root, path));
    if (stat.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (stat.isFile() && stat.nlink === 1) files.push(path);
    else throw new Error(`Runtime package requires ordinary files: ${path}`);
  }
  return files.sort();
}

export async function fileInventory(root) {
  return Promise.all(
    (await listFiles(root))
      .filter((path) => path !== manifestName)
      .map(async (path) => {
        const bytes = await readFile(join(root, path));
        return { path, size: bytes.length, sha256: sha256(bytes) };
      }),
  );
}

export function verifyEntries(entries) {
  const files = entries.filter((entry) => entry.type === "file");
  const manifestEntry = files.find((entry) => entry.path === manifestName);
  if (!manifestEntry) throw new Error("Missing runtime manifest.");
  const manifest = JSON.parse(manifestEntry.bytes.toString("utf8"));
  if (
    manifest.format !== "thermite-runtime-release/0.1" ||
    manifest.runtime !== "Bun 1.4.2" ||
    !runtimeTargets.includes(manifest.target) ||
    typeof manifest.preview !== "boolean" ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceDigest) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.dependencies) ||
    typeof manifest.version !== "string" ||
    !/^[0-9A-Za-z.-]+$/.test(manifest.version)
  )
    throw new Error("Invalid runtime manifest.");
  const observed = files
    .filter((entry) => entry.path !== manifestName)
    .map((entry) => ({
      path: entry.path,
      size: entry.bytes.length,
      sha256: sha256(entry.bytes),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (JSON.stringify(observed) !== JSON.stringify(manifest.files))
    throw new Error("Runtime file inventory or digest mismatch.");
  const byPath = new Map(files.map((entry) => [entry.path, entry.bytes]));
  if (byPath.size !== files.length) throw new Error("Duplicate runtime file.");
  for (const { path } of files) {
    if (
      path
        .split("/")
        .some(
          (part) =>
            part === ".git" ||
            /^\.env(?:\.|$)/.test(part) ||
            part.endsWith(".tsbuildinfo"),
        ) ||
      (!path.startsWith("node_modules/") &&
        !path.startsWith("third-party/") &&
        ![
          manifestName,
          "thermite.mjs",
          "README.md",
          "LICENSE",
          "NOTICE",
          "THIRD_PARTY_NOTICES.md",
          "bun.lock",
        ].includes(path))
    )
      throw new Error(`Unexpected runtime payload: ${path}`);
  }
  for (const path of [
    "thermite.mjs",
    "README.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "bun.lock",
    "third-party/sources.json",
    "third-party/ELK-SOURCE.md",
    "node_modules/@thermite/cli/assets/fonts/OFL.txt",
    "node_modules/@thermite/core-library/LICENSE",
    "node_modules/@thermite/core-library/NOTICE",
  ]) {
    if (!byPath.has(path)) throw new Error(`Missing runtime resource: ${path}`);
  }
  const packagePaths = [...byPath.keys()].filter((path) =>
    /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(path),
  );
  const packages = new Map(
    packagePaths.map((path) => [
      posix.dirname(path),
      JSON.parse(byPath.get(path).toString()),
    ]),
  );
  const expectedDependencies = [...packages]
    .filter(([, metadata]) => !metadata.name.startsWith("@thermite/"))
    .map(([path]) => path)
    .sort();
  if (
    JSON.stringify(expectedDependencies) !==
    JSON.stringify(manifest.dependencies.map((item) => item.path).sort())
  )
    throw new Error("Incomplete or duplicate dependency inventory.");
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    const metadata = packages.get(path);
    if (!metadata) throw new Error(`Missing runtime package: ${path}`);
    visited.add(path);
    for (const name of Object.keys({
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
    })) {
      let parent = path;
      let resolved;
      while (true) {
        const candidate = posix.join(parent, "node_modules", name);
        if (packages.has(candidate)) {
          resolved = candidate;
          break;
        }
        if (parent === ".") break;
        parent = posix.dirname(parent);
      }
      if (resolved) {
        const range =
          metadata.optionalDependencies?.[name] ?? metadata.dependencies[name];
        if (!Bun.semver.satisfies(packages.get(resolved).version, range))
          throw new Error(
            `Runtime dependency version mismatch: ${name} from ${path}`,
          );
        visit(resolved);
      } else if (!metadata.optionalDependencies?.[name])
        throw new Error(`Missing runtime dependency: ${name} from ${path}`);
    }
  }
  visit("node_modules/@thermite/cli");
  if (visited.size !== packages.size)
    throw new Error("Unreachable or development package in runtime.");
  const lock = parseBunLockText(byPath.get("bun.lock").toString());
  for (const dependency of manifest.dependencies) {
    const metadata = JSON.parse(
      byPath.get(`${dependency.path}/package.json`)?.toString() ?? "null",
    );
    if (
      !metadata ||
      metadata.name !== dependency.name ||
      metadata.version !== dependency.version ||
      !Array.isArray(dependency.licenses) ||
      dependency.licenses.length === 0 ||
      !Object.values(lock.packages).some(
        (row) =>
          row[0] === `${dependency.name}@${dependency.version}` &&
          row[3] === dependency.integrity,
      )
    )
      throw new Error(`Invalid dependency inventory: ${dependency.name}`);
    for (const path of dependency.licenses)
      if (!isLicenseFile(path) || !byPath.has(`${dependency.path}/${path}`))
        throw new Error(
          `Missing dependency license: ${dependency.name}/${path}`,
        );
  }
  return manifest;
}
