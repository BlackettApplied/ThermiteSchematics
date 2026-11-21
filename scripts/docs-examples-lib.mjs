import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { finding, sha256 } from "./docs-lib.mjs";
import { recipes } from "./docs-example-recipes.mjs";

export const inventoryFile = "scripts/docs-examples.json";
export const fenceHash = (lang, body, meta = "") =>
  sha256(`${lang}${meta ? ` ${meta}` : ""}\n${body}`);

// Use exactly the source discovery/policy used by the index. Planning is already
// excluded there; archives are navigable but are not current runnable guidance.
const projectGuide = "packages/cli/assets/THERMITE_AGENTS.md";
const shellLanguages = new Set([
  "sh",
  "shell",
  "bash",
  "zsh",
  "console",
  "shell-session",
  "powershell",
  "pwsh",
  "ps1",
  "cmd",
  "bat",
]);

export function exampleFences({ documents }) {
  const fences = [];
  for (const [file, document] of documents) {
    if (file.startsWith("docs/legacy/")) continue;
    const allBlocks =
      file === "README.md" ||
      file.endsWith("/README.md") ||
      file.startsWith("docs/") ||
      file === projectGuide;
    if (
      !allBlocks &&
      file !== "libraries/COMPONENT_EXAMPLES.md" &&
      file !== "CLA.md"
    )
      continue;
    let ordinal = 0;
    const visit = (node) => {
      if (node.type === "code") {
        const lang = node.lang ?? "";
        const meta = node.meta ?? "";
        ordinal++;
        if (!allBlocks && !shellLanguages.has(lang)) return;
        fences.push({
          file,
          ordinal,
          line: node.position.start.line,
          lang,
          meta,
          body: node.value,
          hash: fenceHash(lang, node.value, meta),
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(fromMarkdown(document.text));
  }
  return fences;
}
export async function readInventory(root) {
  try {
    const value = JSON.parse(await readFile(join(root, inventoryFile), "utf8"));
    if (value.version !== 1 || !Array.isArray(value.entries))
      throw new Error("invalid docs example inventory format");
    return value;
  } catch (error) {
    if (error.code === "ENOENT")
      return { version: 1, entries: [], bindings: {} };
    throw error;
  }
}
export const exampleKey = (entry) => `${entry.file}:${entry.hash}`;
export function validateEntry(entry, bindings = {}) {
  if (!/^[a-f0-9]{64}$/.test(entry.hash ?? "")) return "invalid fence hash";
  if (entry.kind === "executed")
    return Object.hasOwn(recipes, entry.recipe) ||
      Object.hasOwn(bindings, entry.recipe)
      ? undefined
      : "missing executed recipe binding";
  if (!["illustrative", "platform-only"].includes(entry.kind))
    return "invalid example classification";
  if (!entry.reason?.trim()) return "classification needs a reason";
  if (entry.kind === "platform-only" && !entry.setup?.trim())
    return "platform-only classification needs a named OS or setup";
}
export async function exampleFindings(corpus) {
  const { entries, bindings = {} } = await readInventory(corpus.root);
  const fences = exampleFences(corpus);
  const findings = [];
  const counts = new Map();
  const testSources = new Map();
  for (const entry of entries) {
    const key = exampleKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const binding = Object.hasOwn(bindings, entry.recipe)
      ? bindings[entry.recipe]
      : undefined;
    let problem = validateEntry(entry, bindings);
    if (binding) {
      if (binding.file !== entry.file)
        problem = "executed binding targets a different document";
      if (!binding.consumedHashes?.includes(entry.hash))
        problem =
          "selected fence lacks consumed-hash evidence from its bound test";
      if (!testSources.has(binding.testFile))
        testSources.set(
          binding.testFile,
          await readFile(join(corpus.root, binding.testFile), "utf8").catch(
            () => "",
          ),
        );
      const source = testSources.get(binding.testFile);
      if (sha256(source) !== binding.testHash)
        problem =
          "executed test binding changed or was deleted; re-run classification";
      if (
        !fences.some(
          (f) => exampleKey(f) === key && ["json", "sh"].includes(f.lang),
        )
      )
        problem = "topic binding only executes JSON and shell fences";
    }
    if (problem) findings.push(finding(entry.file, 1, entry.hash, problem));
    if (!fences.some((fence) => exampleKey(fence) === key))
      findings.push(
        finding(
          entry.file,
          1,
          entry.hash,
          "stale example classification; remove the old entry after reviewing its replacement",
        ),
      );
  }
  for (const fence of fences) {
    const target = `fence #${fence.ordinal} (${fence.lang || "unlabelled"}, ${fence.hash.slice(0, 12)})`;
    const count = counts.get(exampleKey(fence)) ?? 0;
    if (count !== 1)
      findings.push(
        finding(
          fence.file,
          fence.line,
          target,
          count
            ? "duplicate example classification"
            : `unclassified or changed example; run bun scripts/docs-examples.mjs --classify ${fence.file}#${fence.ordinal} --as <executed|illustrative|platform-only> (see --help)`,
        ),
      );
  }
  return findings;
}
