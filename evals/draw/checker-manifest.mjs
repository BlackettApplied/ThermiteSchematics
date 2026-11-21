import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hash, json } from "./support.mjs";
import assert from "node:assert/strict";

// Include the complete sorted module inventory, including native helper source.
export const checkerManifestHash = (checkers) =>
  hash(
    json(
      Object.entries(checkers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );
export async function readCheckers(directory) {
  const files = [];
  const walk = async (path, prefix = "") => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name,
        target = join(path, entry.name);
      assert(
        !entry.isSymbolicLink(),
        `Checker source symlinks are unsupported: ${name}`,
      );
      if (entry.isDirectory()) await walk(target, name + "/");
      else if (/\.(?:mjs|cjs|js|ts|swift)$/.test(name)) files.push(name);
    }
  };
  await walk(directory);
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (p) => [p, hash(await readFile(join(directory, p)))]),
    ),
  );
}
