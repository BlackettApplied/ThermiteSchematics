import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";

const project = dirname(fileURLToPath(import.meta.url));
const compiled = await compileProject(project);
assert.equal(compiled.ok, true);
assert.deepEqual(
  compiled.diagnostics.map((d) => d.code).sort(),
  Array(5).fill("W904"),
);
for (const [tag, terminalCount, portCount] of [
  ["CPU", 38, 2],
  ["TCI", 14, 0],
  ["HMI", 28, 2],
]) {
  const device = compiled.ir.devices.find((d) => d.designation === tag);
  assert(device);
  const type = compiled.ir.deviceTypes.find((t) => t.id === device.typeId);
  assert.equal(type.terminals.length, terminalCount);
  assert.equal(Object.keys(type.ports ?? {}).length, portCount);
  assert.equal(type.connectionCoverage.status, "partial");
}
const netFor = (tag, key) => {
  const device = compiled.ir.devices.find((d) => d.designation === tag);
  return compiled.ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === device.uid && t.terminalKey === key,
    ),
  );
};
// Field pairs and commons stay independent even though their device has a function.
for (const [tag, a, b] of [
  ["CPU", "X10.1", "X10.2"],
  ["CPU", "X10.3", "X10.2"],
  ["CPU", "X12.1", "X12.2"],
  ["TCI", "X10.4", "X10.5"],
  ["HMI", "FE", "X80.2"],
])
  assert.notEqual(netFor(tag, a).id, netFor(tag, b).id);
assert.equal(netFor("TCI", "X10.4").terminalIds.length, 2);
assert.equal(netFor("TCI", "X10.5").terminalIds.length, 2);
const packet = await renderSchematicPacket(
  compiled.ir,
  JSON.parse(await readFile(join(project, "packet.json"), "utf8")),
);
assert.equal(packet.ok, true);
assert.equal(packet.value.sheets.length, 2);
assert(packet.value.sheets[1].svg.includes("X10.4"));
assert(packet.value.sheets[1].svg.includes("X10.5"));

const scratch = await mkdtemp(join(tmpdir(), "thermite-siemens-candidates-"));
try {
  const copiedLibrary = join(scratch, "siemens-pilot");
  await cp(resolve(project, "../.."), copiedLibrary, { recursive: true });
  const copiedProject = join(copiedLibrary, "examples/candidate-wiring");
  const sourcePath = join(copiedProject, "source.json");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  source.objects = source.objects.filter(
    (o) => !["W1", "W2", "W4", "W5", "W7", "W8"].includes(o.designation),
  );
  await writeFile(sourcePath, JSON.stringify(source));
  const missing = await compileProject(copiedProject);
  assert.equal(missing.ok, true);
  const required = missing.diagnostics.filter((d) => d.code === "W903");
  assert.equal(required.length, 3);
  for (const tag of ["CPU", "TCI", "HMI"])
    assert(required.some((d) => d.message.startsWith(`${tag}:`)));
  const typePath = join(copiedLibrary, "types/6ES7231-5QD32-0XB0.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(copiedProject);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log(
  "Verified three candidate inventories, distinct physical nets, two rendered sheets, required-power diagnostics and library-byte lock enforcement.",
);
