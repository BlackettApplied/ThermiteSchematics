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
assert.deepEqual(
  compiled.diagnostics.filter((d) => d.code === "I304"),
  [
    {
      file: "system.json",
      line: 3,
      column: 14,
      jsonPointer: "/project",
      code: "I304",
      severity: "info",
      message:
        'Voltage compatibility is unassessed on rated nets without voltage facts in potentials (2 nets: ["IN.8, XP.C.P1, XP.M.P1 [net:sha256:70a20a287274644271ece8da80a27a4e4f19f1fb2265c42d946d2ee8e199b5b1]", "IN.9, XP.C.P2, XP.M.P2 [net:sha256:f49ee6d7d6b185d70a3c6640e63173ffd04a3f35d1376934aca06ad4831e7010]"]). Ratings describe equipment capability; potentials declare net intent.',
    },
  ],
);
assert.equal(compiled.diagnostics.length, 8);
const singleRated = compiled.diagnostics.filter((d) => d.code === "I305");
assert.equal(singleRated.length, 1);
assert.equal(singleRated[0].severity, "info");
assert(singleRated[0].message.includes("(10 nets:"));
assert.deepEqual(
  compiled.diagnostics
    .filter((d) => d.code !== "I304" && d.code !== "I305")
    .map((d) => d.code),
  ["W904", "W904", "W904", "W904", "W904", "W904"],
);
const device = (ir, tag) => ir.devices.find((d) => d.designation === tag);
const type = (ir, tag) =>
  ir.deviceTypes.find((t) => t.id === device(ir, tag).typeId);
const net = (ir, tag, key) =>
  ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === device(ir, tag).uid && t.terminalKey === key,
    ),
  );
for (const [tag, expected] of [
  ["Q1", 7],
  ["XS", 6],
  ["XP", 6],
  ["XC", 6],
  ["CAP", 0],
]) {
  assert.equal(type(compiled.ir, tag).terminals.length, expected);
  assert.equal(
    type(compiled.ir, tag).connectionCoverage.status,
    tag === "CAP" ? "complete" : "partial",
  );
}
const breaker = type(compiled.ir, "Q1");
assert.deepEqual(
  breaker.functions
    .filter((f) => f.kind === "contact")
    .map((f) => f.terminalKeys),
  [
    ["1", "2"],
    ["3", "4"],
    ["5", "6"],
  ],
);
assert(
  !breaker.terminals.some((t) =>
    ["13", "14", "21", "22", "C1", "C2", "D1", "D2"].includes(t.key),
  ),
);
assert.equal(breaker.terminals.find((t) => t.key === "PE").required, true);
for (const [a, b] of [
  ["1", "2"],
  ["3", "4"],
  ["5", "6"],
  ["1", "3"],
  ["1", "PE"],
])
  assert.notEqual(net(compiled.ir, "Q1", a).id, net(compiled.ir, "Q1", b).id);
for (const tag of ["XS", "XC"]) {
  for (const pole of ["P1", "P2"])
    assert.notEqual(
      net(compiled.ir, tag, `C.${pole}`).id,
      net(compiled.ir, tag, `M.${pole}`).id,
    );
  assert.equal(
    net(compiled.ir, tag, "C.PE").id,
    net(compiled.ir, tag, "M.PE").id,
  );
  assert.equal(
    type(compiled.ir, tag).functions.filter((f) => f.kind === "contact").length,
    2,
  );
}
for (const pole of ["P1", "P2", "PE"])
  assert.equal(
    net(compiled.ir, "XP", `C.${pole}`).id,
    net(compiled.ir, "XP", `M.${pole}`).id,
  );
assert.notEqual(
  net(compiled.ir, "XP", "C.P1").id,
  net(compiled.ir, "XP", "C.P2").id,
);
assert.notEqual(
  net(compiled.ir, "XP", "C.P1").id,
  net(compiled.ir, "XP", "C.PE").id,
);
assert.equal(type(compiled.ir, "CAP").functions.length, 0);
assert.equal(
  Object.keys(type(compiled.ir, "CAP").connectorPorts.COVER.pins ?? {}).length,
  0,
);
const assembly = buildConnectorAssemblyInventory(compiled.ir);
assert.equal(assembly.assemblies.length, 1);
assert.equal(assembly.assemblies[0].assembly.kind, "cap");
assert.equal(
  assembly.assemblies[0].assembly.pinMapping.status,
  "not-applicable",
);
const packet = await renderSchematicPacket(
  compiled.ir,
  JSON.parse(await readFile(join(project, "packet.json"), "utf8")),
  { paper: "tabloid" },
);
assert.equal(packet.ok, true, JSON.stringify(packet.error));
assert.equal(packet.value.sheets.length, 5);
for (const phrase of [
  "8527/21-11-0001",
  "8570/11-306",
  "8570/12-306",
  "8575/14-306",
  "Protective cap",
])
  assert(
    packet.value.sheets.some((s) => s.svg.includes(phrase)),
    phrase,
  );
const scratch = await mkdtemp(join(tmpdir(), "thermite-stahl-library-"));
try {
  const library = join(scratch, "stahl-pilot");
  await cp(resolve(project, "../.."), library, { recursive: true });
  const copy = join(library, "examples/component-check");
  const sourcePath = join(copy, "source.json");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  // A cap/connector description must not manufacture any of the factory links.
  source.objects = source.objects.filter((o) => o.kind !== "jumper");
  await writeFile(sourcePath, JSON.stringify(source));
  const unlinked = await compileProject(copy);
  assert.equal(unlinked.ok, true);
  for (const tag of ["XS", "XP", "XC"])
    for (const pole of ["P1", "P2", "PE"])
      assert.notEqual(
        net(unlinked.ir, tag, `C.${pole}`).id,
        net(unlinked.ir, tag, `M.${pole}`).id,
      );
  assert.equal(
    buildConnectorAssemblyInventory(unlinked.ir).assemblies.length,
    1,
  );
  source.objects = source.objects.filter(
    (o) => !["Q-PE", "XS-PE", "XP-PE", "XC-PE"].includes(o.designation),
  );
  await writeFile(sourcePath, JSON.stringify(source));
  const missing = await compileProject(copy);
  assert.equal(missing.ok, true);
  const warnings = missing.diagnostics.filter((d) => d.code === "W903");
  assert.equal(warnings.length, 4);
  for (const tag of ["Q1", "XS", "XP", "XC"])
    assert(warnings.some((d) => d.message.startsWith(`${tag}:`)));
  const typePath = join(library, "types/8575-14-306.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(copy);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log(
  "Verified five STAHL catalog entries, 25 electrical endpoints, five complete circuit/assembly views, isolated switched poles, explicit factory conductors, required PE warnings and byte locks.",
);
