// Use the compiler's glob implementation/options against system.json, not an
// independent recursive JSON inventory. This module performs no compilation.
import fastGlob from "fast-glob";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { projectReader } from "./capture-files.mjs";
export function listedFiles(root, patterns) {
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== "string"))
    return [];
  const files = new Set();
  for (const pattern of patterns) {
    for (const path of fastGlob.sync(pattern, {
      cwd: root,
      onlyFiles: true,
      followSymbolicLinks: false,
      unique: true,
      ignore: [".thermite-schematics-write.lock"],
    })) {
      const canonical = realpathSync(join(root, path)),
        rel = relative(realpathSync(root), canonical);
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      files.add(
        relative(resolve(root), resolve(root, path)).replaceAll("\\", "/"),
      );
    }
  }
  return [...files].sort();
}
// Even fast-glob's static literal lookups go through the descriptor adapter.
function confinedMatches(source, dir, patterns) {
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== "string"))
    return [];
  const cwd = join(source.identity.path, dir);
  const pathFor = (path) =>
    path === source.identity.path ? "" : source.path(path);
  const lstatSync = (path) => source.inspect(pathFor(path));
  const fs = {
    statSync: lstatSync,
    lstatSync,
    readdirSync(path) {
      return source.list(pathFor(path)).flatMap((name) => {
        try {
          const state = lstatSync(join(path, name));
          return [
            {
              name,
              isDirectory: () => state.isDirectory(),
              isFile: () => state.isFile(),
              isSymbolicLink: () => false,
            },
          ];
        } catch {
          return [];
        }
      });
    },
  };
  const files = new Set();
  for (const pattern of patterns) {
    if (!pattern) continue;
    for (const path of fastGlob.sync(pattern, {
      cwd,
      onlyFiles: true,
      followSymbolicLinks: false,
      unique: true,
      suppressErrors: true,
      ignore: [".thermite-schematics-write.lock"],
      fs,
    })) {
      const resolved = resolve(cwd, path);
      const normalized = relative(cwd, resolved);
      if (normalized && !escapes(cwd, resolved)) files.add(normalized);
    }
  }
  return [...files].sort();
}
function parseSources(paths, read) {
  return paths.flatMap((path) => {
    try {
      const doc = JSON.parse(read(path));
      return Array.isArray(doc.objects) ? [{ ...doc, path }] : [];
    } catch {
      return [];
    }
  });
}
export function sourceDocuments(root) {
  // The standalone document helper is also used by Windows fixtures.
  // E2 run and recheck refuse Windows before reaching it.
  if (process.platform === "win32") {
    const manifest = jsonAt(join(root, "system.json"));
    return parseSources(listedFiles(root, manifest?.sources), (path) =>
      readFileSync(join(root, path)),
    );
  }
  return withManifest(root, (source, manifest) =>
    parseSources(confinedMatches(source, "", manifest.sources), (path) =>
      source.read(source.path(path)),
    ),
  );
}
function withManifest(root, select) {
  let source;
  try {
    source = projectReader(root);
    return select(source, JSON.parse(source.read("system.json")));
  } catch {
    return [];
  } finally {
    source?.close();
  }
}
export function libraryTypes(root) {
  return withManifest(root, (source, manifest) => {
    if (!Array.isArray(manifest.libraries)) return [];
    return manifest.libraries.flatMap((library) => {
      try {
        const manifestPath = source.path(
          resolve(
            source.identity.path,
            library.path ?? join("libraries", library.name),
            "library.json",
          ),
        );
        const directory = dirname(manifestPath);
        const definition = JSON.parse(source.read(manifestPath));
        return confinedMatches(source, directory, definition.sources).flatMap(
          (file) => {
            const document = JSON.parse(
              source.read(source.path(join(directory, file))),
            );
            return (document.types ?? []).map((type) => ({
              ...type,
              library: library.name,
            }));
          },
        );
      } catch {
        return [];
      }
    });
  });
}
function jsonAt(path) {
  try {
    return JSON.parse(readFileSync(path));
  } catch {
    return null;
  }
}
function escapes(root, path) {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
}
// The compiler can use paths named inside captured manifests. Check their
// lexical scope before handing the link-free snapshot to its normal loader.
export function assertConfinedProjectPaths(
  project,
  manifest = jsonAt(join(project, "system.json")),
) {
  const checkSources = (root, patterns) => {
    if (!Array.isArray(patterns)) return;
    for (const pattern of patterns) {
      if (typeof pattern !== "string" || !pattern) continue;
      for (const { base, positive } of fastGlob.generateTasks(pattern)) {
        if (
          [base, ...positive].some(
            (entry) =>
              isAbsolute(entry) || escapes(project, resolve(root, entry)),
          )
        )
          throw new Error("Source glob leaves the eval snapshot");
      }
    }
  };
  checkSources(project, manifest?.sources);
  if (!Array.isArray(manifest?.libraries)) return;
  for (const dependency of manifest.libraries) {
    if (typeof dependency?.path !== "string") continue;
    const root = resolve(project, dependency.path);
    if (escapes(project, root))
      throw new Error("Project library dependency leaves the eval snapshot");
    checkSources(root, jsonAt(join(root, "library.json"))?.sources);
  }
}
export const canonical = (value) => JSON.stringify(sortKeys(value));
export function sortKeys(value) {
  return Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, sortKeys(value[k])]),
        )
      : value;
}
