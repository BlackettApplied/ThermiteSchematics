import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIndex, indexFindings, loadCorpus } from "./docs-lib.mjs";
import {
  commandArguments,
  printFindings,
  sortFindings,
} from "./check-docs.mjs";

export async function docsIndex(root, { write = false } = {}) {
  const corpus = await loadCorpus(root);
  if (write) {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs/README.md"), generateIndex(corpus));
  }
  return sortFindings([
    ...corpus.findings,
    ...(write ? [] : indexFindings(corpus)),
  ]);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { root, mode } = commandArguments(process.argv.slice(2), {
      write: true,
    });
    const findings = await docsIndex(root, { write: mode === "--write" });
    printFindings(findings);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(`docs-index: ${error.message}`);
    process.exitCode = 2;
  }
}
