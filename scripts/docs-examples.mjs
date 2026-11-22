import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, repositoryRoot, sha256 } from "./docs-lib.mjs";
import {
  exampleFences,
  exampleKey,
  inventoryFile,
  readInventory,
  validateEntry,
} from "./docs-examples-lib.mjs";
import { recipes } from "./docs-example-recipes.mjs";
import { context } from "./docs-example-context.mjs";
import {
  ProcessOwner,
  closeExampleProcesses,
} from "./docs-example-process.mjs";
import { requireConsumedFence } from "./docs-example-evidence.mjs";

const help = `Classify one reviewed README/live-doc code block (ordinal is 1-based):
  bun scripts/docs-examples.mjs --classify README.md#4 --as executed --recipe repo-shell
  bun scripts/docs-examples.mjs --classify docs/example.md#1 --as illustrative --reason "Why this is a fragment"
  bun scripts/docs-examples.mjs --classify docs/example.md#1 --as platform-only --setup "Named OS/setup" --reason "Required resources"
Executed classification runs the recipe or the exact bound test BEFORE writing.
Bound recipe IDs and their named tests are in scripts/docs-examples.json bindings.
--measure prints file/language counts. --root <tree> supports source archives.
No command automatically approves a changed executed example.`;
export async function classify(root, target, options) {
  const corpus = await loadCorpus(root);
  const fences = exampleFences(corpus);
  const fence = fences.find((f) => `${f.file}#${f.ordinal}` === target);
  if (!fence) throw new Error(`No code block ${target}`);
  const inventory = await readInventory(root);
  const entry = { file: fence.file, hash: fence.hash, ...options };
  const problem = validateEntry(entry, inventory.bindings);
  if (problem) throw new Error(problem);
  if (entry.kind === "executed")
    await executeClassification(root, inventory, entry, fence, fences);
  const keys = new Set(fences.map(exampleKey));
  inventory.entries = inventory.entries.filter(
    (old) =>
      exampleKey(old) !== exampleKey(entry) &&
      !(old.file === entry.file && !keys.has(exampleKey(old))),
  );
  inventory.entries.push(entry);
  inventory.entries.sort(
    (a, b) =>
      fences.findIndex((f) => exampleKey(f) === exampleKey(a)) -
      fences.findIndex((f) => exampleKey(f) === exampleKey(b)),
  );
  await writeFile(
    join(root, inventoryFile),
    JSON.stringify(inventory, null, 2) + "\n",
  );
}
async function executeClassification(root, inventory, entry, fence, fences) {
  const binding = Object.hasOwn(inventory.bindings ?? {}, entry.recipe)
    ? inventory.bindings[entry.recipe]
    : undefined;
  if (binding) {
    if (binding.file !== entry.file)
      throw new Error("Binding targets a different document");
    if (!["json", "sh"].includes(fence.lang))
      throw new Error("Topic tests only execute JSON and shell fences");
    binding.consumedHashes = await executeBoundTest(root, binding, fence);
    binding.testHash = sha256(
      await readFile(join(root, binding.testFile), "utf8"),
    );
  } else {
    const c = await context(root);
    c.fences = fences;
    try {
      await recipes[entry.recipe](c, fence);
    } finally {
      await c.cleanup();
    }
  }
}
export async function executeBoundTest(
  root,
  binding,
  fence,
  { timeoutMs = 120000 } = {},
) {
  const temporary = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-example-binding-"),
  );
  const report = join(temporary, "results.json");
  const owner = new ProcessOwner({ timeoutMs });
  try {
    const run = await owner.run(
      [
        join(repositoryRoot, "scripts/test.mjs"),
        binding.testFile,
        "-t",
        `^${binding.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "--reporter=json",
        `--outputFile=${report}`,
      ],
      root,
      {
        ...process.env,
        VITEST_MAX_WORKERS: "2",
        THERMITE_DOC_EXAMPLE_EVIDENCE: temporary,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
      },
      { forward: true },
    );
    const results = JSON.parse(await readFile(report, "utf8"));
    if (run.code !== 0) boundFailure(results, binding);
    const passed = results.testResults
      .flatMap((r) => r.assertionResults)
      .filter((r) => r.status === "passed" && r.fullName === binding.testName);
    if (passed.length !== 1)
      throw new Error(
        "Bound example test did not execute exactly once; inventory unchanged",
      );
    return await requireConsumedFence(temporary, fence.file, fence.hash);
  } finally {
    await owner.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
function boundFailure(results, binding) {
  const failure = results.testResults
    .flatMap((r) => r.assertionResults)
    .find((r) => r.fullName === binding.testName && r.status === "failed")
    ?.failureMessages?.[0]?.split("\n")[0];
  throw new Error(
    `Bound example test failed${failure ? `: ${failure}` : ""}; inventory unchanged`,
  );
}
function argumentsFor(args) {
  const options = {};
  let root = repositoryRoot,
    target,
    measure = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--measure") measure = true;
    else if (arg === "--root" && args[i + 1]) root = resolve(args[++i]);
    else if (arg === "--classify" && args[i + 1]) target = args[++i];
    else if (
      ["--as", "--recipe", "--reason", "--setup"].includes(arg) &&
      args[i + 1]
    )
      options[arg === "--as" ? "kind" : arg.slice(2)] = args[++i];
    else throw new Error(`Unknown/incomplete argument ${arg}; see --help`);
  }
  return { root, target, options, measure };
}
async function main() {
  if (process.argv.includes("--help")) return console.log(help);
  const { root, target, options, measure } = argumentsFor(
    process.argv.slice(2),
  );
  if (measure) {
    const fences = exampleFences(await loadCorpus(root));
    const counts = {};
    for (const f of fences) {
      counts[f.file] ??= {};
      counts[f.file][f.lang || "unlabelled"] =
        (counts[f.file][f.lang || "unlabelled"] ?? 0) + 1;
    }
    return console.log(
      JSON.stringify(
        { fences: fences.length, files: Object.keys(counts).length, counts },
        null,
        2,
      ),
    );
  }
  if (!target) throw new Error("Specify --classify or --measure; see --help");
  await classify(root, target, options);
  console.log(`Classified ${target} as ${options.kind}`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const cancel = () => {
    void closeExampleProcesses();
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await main();
  } catch (error) {
    console.error(`docs-examples: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closeExampleProcesses();
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
