import { lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeFileAtomically } from "../packages/compiler/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repositoryRoot, "AGENTS.md");
const assetDirectory = join(repositoryRoot, "packages", "cli", "assets");
const destination = join(assetDirectory, "AGENTS.md");

function isExisting(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

export async function copyAgentGuide() {
  const sourceStatus = await lstat(source, { bigint: true });
  if (
    !sourceStatus.isFile() ||
    sourceStatus.isSymbolicLink() ||
    sourceStatus.nlink !== 1n
  ) {
    throw new Error("Root AGENTS.md is not an ordinary single-link file.");
  }
  const bytes = await readFile(source);
  const text = bytes.toString("utf8");
  if (
    bytes.length === 0 ||
    text.startsWith("\ufeff") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.endsWith("\n\n") ||
    !Buffer.from(text, "utf8").equals(bytes)
  ) {
    throw new Error("Root AGENTS.md does not have canonical UTF-8/LF bytes.");
  }

  try {
    await mkdir(assetDirectory);
  } catch (error) {
    if (!isExisting(error)) throw error;
  }
  const directoryStatus = await lstat(assetDirectory, { bigint: true });
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
    throw new Error("The CLI asset destination is not an ordinary directory.");
  }

  await writeFileAtomically(destination, bytes);
  const destinationStatus = await lstat(destination, { bigint: true });
  if (
    !destinationStatus.isFile() ||
    destinationStatus.isSymbolicLink() ||
    destinationStatus.nlink !== 1n ||
    !(await readFile(destination)).equals(bytes)
  ) {
    throw new Error(
      "The packaged AGENTS.md asset differs from the root authority.",
    );
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await copyAgentGuide();
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n",
    );
    process.exitCode = 1;
  }
}
