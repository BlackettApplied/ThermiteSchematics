import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { corpus, readJson, sha256, version } from "./support.mjs";

async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await inventory(directory, path)));
    else {
      assert(entry.isFile(), `Non-ordinary corpus entry ${path}`);
      if (path !== "manifest.json")
        files.push({
          path,
          sha256: sha256(await readFile(join(directory, path))),
        });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export async function corpusInventory(directory = corpus) {
  return inventory(directory);
}
export async function verifyCorpus() {
  const manifest = await readJson(join(corpus, "manifest.json"));
  assert.equal(manifest.evalsVersion, version);
  assert.deepEqual(await corpusInventory(), manifest.files);
  return {
    files: manifest.files.length,
    sha256: sha256(await readFile(join(corpus, "manifest.json"))),
  };
}
