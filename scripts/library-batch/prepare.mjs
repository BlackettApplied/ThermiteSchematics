import {
  readFile,
  writeFile,
  mkdir,
  cp,
  access,
  lstat,
  stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(here, "../..");
const { values } = parseArgs({
  options: Object.fromEntries(
    [
      "inventory",
      "selection",
      "batch",
      "python",
      "pdf-module-path",
      "claude-cli",
      "codex-cli",
      "codex-model",
      "codex-effort",
    ].map((key) => [key, { type: "string" }]),
  ),
});
for (const key of ["inventory", "selection", "batch", "python", "codex-model"])
  if (!values[key]) throw new Error(`Missing --${key}`);
const batch = resolve(values.batch);
async function assertAbsent(path, message) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${message}: ${path}`);
}
async function readableFile(path) {
  if (!(await stat(path)).isFile())
    throw new Error(`Expected a readable file: ${path}`);
  await access(path, constants.R_OK);
}
async function existingDirectory(path) {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory())
      throw new Error(`Expected an ordinary directory: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await existingDirectory(batch);
await existingDirectory(join(batch, "jobs"));
for (const name of [
  "queue.json",
  "status.json",
  ".runner.lock.json",
  ".runner.lock.recovery",
])
  await assertAbsent(
    join(batch, name),
    "Batch already contains queue, status, or runner lock data",
  );
const selection = JSON.parse(await readFile(values.selection, "utf8"));
const inventoryBytes = await readFile(values.inventory);
const inventory = JSON.parse(inventoryBytes);
if (!Array.isArray(selection?.jobs) || !selection.jobs.length)
  throw new Error("Selection must contain a nonempty jobs array");
if (!Array.isArray(inventory?.parts))
  throw new Error("Inventory must contain a parts array");
const queue = { format: "thermite-component-queue/0.1", jobs: [] };
const ids = new Set();
const targets = new Set();
const sampleFiles = [
  ["breaker.json", "libraries/stahl-pilot/types/8527-21-11-0001.json"],
  ["plug.json", "libraries/stahl-pilot/types/8570-12-407.json"],
  ["socket.json", "libraries/stahl-pilot/types/8570-11-407.json"],
  ["accessory.json", "libraries/stahl-pilot/types/8570001140.json"],
  ["pushbutton.json", "libraries/stahl-pilot/types/23d01ba05.json"],
];
const sharedFiles = [
  ...["WORKER.md", "candidate.schema.json", "research-tools.py"].map((name) => [
    name,
    join(here, name),
  ]),
  ["AGENTS.md", join(here, "WORKER.md")],
  ...sampleFiles.map(([name, file]) => [
    join("reference", name),
    join(engine, file),
  ]),
  ...["device-type", "common", "library-file"].map((name) => [
    join("reference", `${name}.schema.json`),
    join(engine, `packages/schema/schemas/${name}.schema.json`),
  ]),
];
await readableFile(resolve(values.python));
await access(resolve(values.python), constants.X_OK);
if (
  values["pdf-module-path"] &&
  !(await stat(resolve(values["pdf-module-path"]))).isDirectory()
)
  throw new Error("--pdf-module-path must refer to a directory");
for (const [, file] of sharedFiles) await readableFile(file);
const planned = [];
for (const pick of selection.jobs) {
  if (
    !pick ||
    typeof pick.id !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(pick.id) ||
    ids.has(pick.id.toLowerCase())
  )
    throw new Error(`Unsafe or duplicate job ID: ${pick?.id}`);
  if (!["claude", "codex"].includes(pick.backend))
    throw new Error("Unknown backend");
  const matches = inventory.parts.filter((part) => part?.id === pick.id);
  if (matches.length !== 1)
    throw new Error(`Inventory identity must be unique: ${pick.id}`);
  const part = matches[0];
  if (
    part.status !== "research-needed" ||
    typeof part.make !== "string" ||
    !part.make.trim() ||
    typeof part.orderNumber !== "string" ||
    !part.orderNumber.trim()
  )
    throw new Error(`Not an identified unmodeled inventory item: ${pick.id}`);
  if (
    typeof pick.library !== "string" ||
    typeof pick.slug !== "string" ||
    !/^[a-z0-9-]+$/.test(pick.library) ||
    !/^[a-z0-9-]+$/.test(pick.slug)
  )
    throw new Error(`Unsafe library target: ${pick.id}`);
  if (
    pick.manufacturer !== undefined &&
    (typeof pick.manufacturer !== "string" || !pick.manufacturer.trim())
  )
    throw new Error(`Invalid manufacturer: ${pick.id}`);
  if (
    pick.hints !== undefined &&
    (!Array.isArray(pick.hints) ||
      pick.hints.some((hint) => typeof hint !== "string" || !hint.trim()))
  )
    throw new Error(`Hints must be nonempty strings: ${pick.id}`);
  if (
    pick.referenceFiles !== undefined &&
    (!Array.isArray(pick.referenceFiles) ||
      pick.referenceFiles.some((file) => typeof file !== "string" || !file))
  )
    throw new Error(`Reference files must be file paths: ${pick.id}`);
  const typeId = `${pick.library}:${pick.slug}`;
  if (targets.has(typeId)) throw new Error(`Duplicate type target: ${typeId}`);
  ids.add(pick.id.toLowerCase());
  targets.add(typeId);
  const directory = join(batch, "jobs", pick.id);
  await assertAbsent(directory, "Job directory exists");
  const referenceNames = new Set();
  const references = [];
  for (const file of pick.referenceFiles ?? []) {
    const name = basename(file);
    if (referenceNames.has(name.toLowerCase()))
      throw new Error(`Reference filename collision for ${pick.id}: ${name}`);
    referenceNames.add(name.toLowerCase());
    const source = resolve(file);
    await readableFile(source);
    references.push([name, source]);
  }
  planned.push({ pick, part, typeId, directory, references });
}
// All authored inputs and target collisions are checked before creating outputs.
await mkdir(join(batch, "jobs"), { recursive: true });
for (const { pick, part, typeId, directory, references } of planned) {
  await mkdir(directory);
  await mkdir(join(directory, "reference"), { recursive: true });
  const job = {
    id: part.id,
    backend: pick.backend,
    expectedTypeId: typeId,
    expectedManufacturer: pick.manufacturer ?? part.make,
    expectedOrderNumber: part.orderNumber,
    targetLibrary: pick.library,
    typeFileName: `${pick.slug}.json`,
    source: part,
    inventoryFileSHA256: createHash("sha256")
      .update(inventoryBytes)
      .digest("hex"),
    sourceDocument: inventory.source,
    hints: pick.hints ?? [],
    pythonCommand: [resolve(values.python), "research-tools.py"],
    pdfModulePath: values["pdf-module-path"]
      ? resolve(values["pdf-module-path"])
      : null,
  };
  await writeFile(
    join(directory, "job.json"),
    JSON.stringify(job, null, 2) + "\n",
  );
  for (const [name, file] of sharedFiles) await cp(file, join(directory, name));
  for (const [name, file] of references) {
    await mkdir(join(directory, "references"), { recursive: true });
    await cp(file, join(directory, "references", name));
  }
  const promptFile = join(directory, "prompt.txt");
  const prompt = `Research and propose exactly one component: ${part.make} ${part.orderNumber} (${part.id}).\nRead job.json and WORKER.md now, then carry this assignment to its saved deliverables without waiting for input.\nUse your web tools to obtain primary manufacturer evidence. Your only writable workspace is this job directory. Do not spawn other agents or modify shared libraries. The provided reference models illustrate format, not evidence for your component.\nWrite concise research.md, a type.json only if justified, and result.json matching candidate.schema.json. A precise needs-evidence result is valid when essential information remains unresolved.\nThe coordinator runs the central verifier; do not create or execute a bespoke test project.\n`;
  await writeFile(promptFile, prompt);
  const command =
    pick.backend === "claude"
      ? [
          values["claude-cli"] ?? "claude",
          "--safe-mode",
          "--model",
          "opus",
          "--permission-mode",
          "dontAsk",
          "--tools",
          "Read,Write,Glob,Grep,Bash,WebSearch,WebFetch",
          "--allowedTools",
          `Read(./**),Edit(./**),Glob,Grep,WebSearch,WebFetch,Bash(${resolve(values.python)} research-tools.py *)`,
          "--no-chrome",
          "--no-session-persistence",
          "--output-format",
          "stream-json",
          "--verbose",
          "-p",
        ]
      : [
          values["codex-cli"] ?? "codex",
          "--search",
          "-a",
          "never",
          "exec",
          "--ignore-user-config",
          "--model",
          values["codex-model"],
          "-c",
          `model_reasoning_effort="${values["codex-effort"] ?? "medium"}"`,
          "--disable",
          "multi_agent",
          "--disable",
          "apps",
          "--disable",
          "plugins",
          "-c",
          "sandbox_workspace_write.network_access=true",
          "-s",
          "workspace-write",
          "--skip-git-repo-check",
          "--ephemeral",
          "--json",
          "-C",
          directory,
          "-o",
          join(directory, "worker.final.txt"),
          "-",
        ];
  queue.jobs.push({
    id: part.id,
    backend: pick.backend,
    directory,
    promptFile,
    command,
  });
}
await writeFile(
  join(batch, "queue.json"),
  JSON.stringify(queue, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    batch,
    jobs: queue.jobs.length,
    backends: Object.fromEntries(
      ["claude", "codex"].map((b) => [
        b,
        queue.jobs.filter((j) => j.backend === b).length,
      ]),
    ),
  }),
);
