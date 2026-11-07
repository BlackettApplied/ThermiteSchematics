// Use the compiler's glob implementation/options against system.json, not an
// independent recursive JSON inventory. This module performs no compilation.
import fastGlob from "fast-glob";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
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
export function sourceDocuments(root) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));
  } catch {
    return [];
  }
  return listedFiles(root, manifest.sources).flatMap((path) => {
    try {
      const doc = JSON.parse(readFileSync(join(root, path), "utf8"));
      return Array.isArray(doc.objects) ? [{ ...doc, path }] : [];
    } catch {
      return [];
    }
  });
}
export function libraryTypes(root) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));
  } catch {
    return [];
  }
  return (manifest.libraries ?? []).flatMap((library) => {
    const dir = library.path
      ? resolve(root, library.path)
      : join(root, "libraries", library.name);
    try {
      const definition = JSON.parse(
        readFileSync(join(dir, "library.json"), "utf8"),
      );
      return listedFiles(dir, definition.sources).flatMap((file) =>
        (JSON.parse(readFileSync(join(dir, file), "utf8")).types ?? []).map(
          (type) => ({ ...type, library: library.name }),
        ),
      );
    } catch {
      return [];
    }
  });
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
