import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
export async function treeHash(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".js")) files.push(path);
    }
  }
  await walk(root);
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(await readFile(path));
  }
  return hash.digest("hex");
}
export async function engine(path) {
  const root = await realpath(path),
    load = async (p) => import(pathToFileURL(join(root, p)).href);
  const renderer = await load("packages/render/dist/index.js"),
    compiler = await load("packages/compiler/dist/index.js");
  return {
    root,
    renderer,
    compiler,
    metadata: {
      root,
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      dirty: !!execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      rendererDistSha256: await treeHash(join(root, "packages/render/dist")),
      compilerDistSha256: await treeHash(join(root, "packages/compiler/dist")),
      schemaDistSha256: await treeHash(join(root, "packages/schema/dist")),
    },
  };
}
