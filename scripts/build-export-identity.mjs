import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./build-guide.mjs";

const hash = createHash("sha256");
async function include(file) {
  const bytes = await readFile(join(root, file));
  hash.update(JSON.stringify([file, bytes.length]) + "\n").update(bytes);
}
async function includeTree(directory, accept = () => true) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = directory + "/" + entry.name;
    if (entry.isDirectory()) await includeTree(file, accept);
    else if (entry.isFile() && accept(file)) await include(file);
  }
}

await include("bun.lock");
const { references } = JSON.parse(
  await readFile(join(root, "tsconfig.json"), "utf8"),
);
for (const directory of references
  .map(({ path }) => path.replace(/^\.\//u, ""))
  .sort()) {
  await include(directory + "/package.json");
  await includeTree(directory + "/dist", (file) => file.endsWith(".js"));
}
for (const directory of [
  "packages/cli/assets",
  "packages/cli/templates",
  "packages/core-library/library",
  "packages/core-library/versions",
  "packages/render/assets",
  "packages/schema/schemas",
])
  await includeTree(directory, (file) => !file.endsWith("/guide-source.json"));

await writeFile(
  join(root, "packages/cli/dist/export-build.txt"),
  hash.digest("hex") + "\n",
);
