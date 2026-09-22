import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject } from "@thermite/compiler";
import { buildConnectorAssemblyInventory } from "@thermite/query";
import { renderSchematicPacket } from "@thermite/render";

const project = dirname(fileURLToPath(import.meta.url));
const compiled = await compileProject(project);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
assert(compiled.diagnostics.length > 0);
assert(compiled.diagnostics.every((d) => d.code === "W904"));
const deviceFor = (ir, tag) => ir.devices.find((d) => d.designation === tag);
const typeFor = (tag) =>
  compiled.ir.deviceTypes.find(
    (t) => t.id === deviceFor(compiled.ir, tag).typeId,
  );
const terminal = (tag, key) =>
  typeFor(tag).terminals.find((t) => t.key === key);
const netFor = (ir, tag, key) =>
  ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === deviceFor(ir, tag).uid && t.terminalKey === key,
    ),
  );
for (const [tag, terminals, connectors, networks] of [
  ["IM", 10, 2, 2],
  ["DI", 40, 8, 0],
  ["DQ", 20, 4, 0],
  ["AIU", 20, 4, 0],
  ["AII", 20, 4, 0],
  ["AO", 20, 4, 0],
  ["PSE", 12, 0, 0],
]) {
  const type = typeFor(tag);
  assert.equal(
    type.terminals.length,
    terminals,
    `${tag} complete declared connector/screw inventory`,
  );
  assert.equal(Object.keys(type.connectorPorts ?? {}).length, connectors);
  assert.equal(Object.keys(type.ports ?? {}).length, networks);
  assert.equal(type.connectionCoverage.status, "partial");
  for (const [connector, port] of Object.entries(type.connectorPorts ?? {})) {
    assert.equal(Object.keys(port.pins).length, 5);
    for (const [pin, info] of Object.entries(port.pins))
      assert.equal(info.terminal, `${connector}.${pin}`);
  }
}
// These distinctions prevent substituting a different connection module or variant.
assert.equal(terminal("DI", "X1.2").role, "no_connection");
assert.equal(terminal("DI", "X8.4").description, "DI7 input");
assert.equal(terminal("DQ", "X1.1").role, "no_connection");
assert.equal(terminal("DQ", "X1.2").role, "no_connection");
assert.equal(terminal("DQ", "X1.3").role, "load_supply_return");
assert.equal(terminal("IM", "X03.1").role, "load_supply_return");
assert.equal(terminal("IM", "X03.2").role, "supply_return");
assert.equal(terminal("IM", "X03.2").required, true);
assert.equal(terminal("IM", "X03.4").required, true);
assert.equal(terminal("PSE", "S").role, "status_output");
assert.equal(terminal("PSE", "NF.1").role, "no_connection");
assert.equal(terminal("PSE", "+24V.1").required, undefined);
assert.equal(terminal("PSE", "+24V.2").required, undefined);
assert(!typeFor("PSE").functions.some((f) => f.kind === "contact"));
for (const tag of ["AIU", "AII", "AO"]) {
  for (const [a, b] of [
    ["X1.2", "X1.4"],
    ["X1.2", "X1.3"],
    ["X1.4", "X1.3"],
    ["X1.3", "X2.3"],
  ])
    assert.notEqual(
      netFor(compiled.ir, tag, a).id,
      netFor(compiled.ir, tag, b).id,
    );
  assert.equal(netFor(compiled.ir, tag, "X1.2").terminalIds.length, 2);
}
assert.notEqual(
  netFor(compiled.ir, "PSE", "+24V.1").id,
  netFor(compiled.ir, "PSE", "1").id,
);
assert.notEqual(
  netFor(compiled.ir, "PSE", "1").id,
  netFor(compiled.ir, "PSE", "2").id,
);
assert.notEqual(
  netFor(compiled.ir, "IM", "X03.4").id,
  netFor(compiled.ir, "IM", "X04.4").id,
);
const inventory = buildConnectorAssemblyInventory(compiled.ir);
assert.equal(inventory.assemblies.length, 1);
assert.equal(inventory.assemblies[0].assembly.pinMapping.status, "unresolved");
const packet = await renderSchematicPacket(
  compiled.ir,
  JSON.parse(await readFile(join(project, "packet.json"), "utf8")),
);
assert.equal(packet.ok, true, JSON.stringify(packet.error));
assert(packet.value.sheets.length >= 7);
assert(
  packet.value.sheets.some(
    (s) => s.svg.includes("HARNESS") && s.svg.includes("unresolved"),
  ),
);
for (const tag of ["DI", "DQ", "AIU", "AII", "AO"])
  assert(
    packet.value.sheets.some((s) =>
      s.svg.includes(`${tag} channel 0 connector demonstration`),
    ),
  );

const scratch = await mkdtemp(join(tmpdir(), "thermite-et200pro-library-"));
try {
  const library = join(scratch, "siemens-et200pro-pilot");
  await cp(resolve(project, "../.."), library, { recursive: true });
  const copiedProject = join(library, "examples/connector-wiring");
  const sourcePath = join(copiedProject, "source.json");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  // An occupied connector with a documented pin inventory still cannot supply
  // missing conductors. The retained assembly must not manufacture continuity.
  source.objects = source.objects.filter(
    (o) =>
      !["P11", "P12", "P13", "P14", "P15", "P01", "P02"].includes(
        o.designation,
      ),
  );
  await writeFile(sourcePath, JSON.stringify(source));
  const missing = await compileProject(copiedProject);
  assert.equal(missing.ok, true);
  const required = missing.diagnostics.filter((d) => d.code === "W903");
  assert.equal(required.length, 2);
  for (const tag of ["IM", "PSE"])
    assert(required.some((d) => d.message.startsWith(`${tag}:`)));
  assert.equal(
    buildConnectorAssemblyInventory(missing.ir).assemblies.length,
    1,
  );
  for (let pin = 1; pin <= 5; pin++)
    assert.equal(netFor(missing.ir, "IM", `X03.${pin}`).terminalIds.length, 1);
  const typePath = join(library, "types/ai4-i-hf-cm4-m12.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(copiedProject);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log(
  `Verified seven catalog models, 142 connector/screw terminals, ${packet.value.sheets.length} rendered sheets, assembly/net separation, selected power requirements and library-byte lock enforcement.`,
);
