import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { conveyorPacket } from "../../evals/engine/packets.mjs";

const engine = resolve(process.argv[2]);
async function publicPackage(name) {
  const directory = join(engine, "packages", name);
  const metadata = JSON.parse(readFileSync(join(directory, "package.json")));
  const entry = metadata.exports["."];
  return import(
    pathToFileURL(
      join(directory, typeof entry === "string" ? entry : entry.import),
    ).href
  );
}
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let compileProject, renderSchematicPacket;
try {
  ({ compileProject } = await publicPackage("compiler"));
  ({ renderSchematicPacket } = await publicPackage("render"));
} catch (error) {
  send({ error: error.message, kind: "correctness" });
  process.exit(0);
}
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function inputHash(directory) {
  const files = [];
  function visit(path, prefix = "") {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    )) {
      if (["out", ".git", "node_modules"].includes(entry.name)) continue;
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(path, entry.name), `${relative}/`);
      else if (entry.name.endsWith(".json"))
        files.push([relative, readFileSync(join(path, entry.name), "utf8")]);
    }
  }
  visit(directory);
  return hash(files);
}
const cases = new Map();
try {
  for (const [name, views, packet] of [
    [
      "machine-demo",
      12,
      JSON.parse(
        readFileSync(join(engine, "examples/machine-demo/packet.request.json")),
      ),
    ],
    ["conveyor-line", 4, conveyorPacket],
  ]) {
    assert.equal(packet.views.length, views);
    const project = join(engine, "examples", name);
    cases.set(name, {
      project,
      packet,
      views,
      inputSha256: inputHash(project),
    });
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error.message, kind: "correctness" })}\n`,
  );
  process.exit(0);
}
send({ ready: true });
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const { name, operation } = JSON.parse(line);
    const task = cases.get(name);
    assert(task, "Unknown performance workload");
    assert(["compile", "packet"].includes(operation), "Unknown operation");
    const start = performance.now();
    const result =
      operation === "compile"
        ? await compileProject(task.project)
        : await renderSchematicPacket(
            task.compiled.ir,
            task.packet,
            task.compiled.presentation,
          );
    const ms = performance.now() - start;
    assert(result.ok, JSON.stringify(result.diagnostics ?? result.error));
    if (operation === "compile") task.compiled = result;
    send({
      ms,
      sha256: hash(result),
      inputSha256: task.inputSha256,
      views: task.views,
      ...(operation === "packet" ? { sheets: result.value.sheets.length } : {}),
    });
  } catch (error) {
    send({ error: error.message, kind: "correctness" });
  }
}
