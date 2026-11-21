import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exampleFences } from "./docs-examples-lib.mjs";
import { sha256 } from "./docs-lib.mjs";

export const evidencePath = (directory, file) =>
  join(directory, `${sha256(file)}.json`);
// A receipt follows one successful execution callback, never a parser's list.
// Match location AND content to discovery so ignored/nested fences cannot bind.
export function topicExecution(file, text, languages) {
  const directory = process.env.THERMITE_DOC_EXAMPLE_EVIDENCE;
  const discovered = exampleFences({ documents: new Map([[file, { text }]]) });
  const hashes = new Set();
  const exactFence = (fence) => {
    assert.ok(
      languages.includes(fence.lang),
      `Topic ${file} cannot execute ${fence.lang} fence at line ${fence.line}`,
    );
    const exact = discovered.find(
      (d) =>
        d.line === fence.line && d.lang === fence.lang && d.body === fence.body,
    );
    assert.ok(
      exact,
      `Topic parser/discovery mismatch at ${file}:${fence.line}`,
    );
    return exact;
  };
  return {
    checkLanguages(fences) {
      for (const fence of fences) exactFence(fence);
    },
    async run(fence, execute) {
      const exact = exactFence(fence);
      const result = await execute();
      hashes.add(exact.hash);
      if (directory)
        await writeFile(
          evidencePath(directory, file),
          JSON.stringify({ file, hashes: [...hashes] }),
        );
      return result;
    },
    finish(fences) {
      for (const fence of fences)
        assert.ok(
          hashes.has(exactFence(fence).hash),
          `Unexecuted topic fence at ${file}:${fence.line}`,
        );
    },
  };
}
export async function requireConsumedFence(directory, file, hash) {
  const proof = await readFile(evidencePath(directory, file), "utf8")
    .then(JSON.parse)
    .catch(() => undefined);
  if (proof?.file !== file || !proof.hashes?.includes(hash))
    throw new Error(
      "Selected fence was not consumed by the bound topic test; inventory unchanged",
    );
  return proof.hashes;
}
