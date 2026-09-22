import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { parseHTML } from "linkedom";

const project = dirname(fileURLToPath(import.meta.url));
const compiled = await compileProject(project);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
assert.equal(compiled.diagnostics.length, 4);
assert(compiled.diagnostics.every((d) => d.code === "W904"));
const device = (ir, tag) => ir.devices.find((d) => d.designation === tag);
const type = (ir, tag) =>
  ir.deviceTypes.find((t) => t.id === device(ir, tag).typeId);
const net = (ir, tag, key) =>
  ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === device(ir, tag).uid && t.terminalKey === key,
    ),
  );
for (const [tag, order, count, voltage, current] of [
  ["XQ", "3031306", 4, 800, 24],
  ["XQB", "3031319", 4, 800, 24],
  ["XMT", "3036356", 3, 400, 20],
  ["X16", "3036149", 2, 1000, 76],
]) {
  const t = type(compiled.ir, tag);
  assert.equal(t.catalog.orderNumber, order);
  assert.equal(t.terminals.length, count);
  assert.equal(t.connectionCoverage.status, "partial");
  for (const terminal of t.terminals) {
    assert.notEqual(terminal.required, true);
    assert.equal(terminal.role, "passive_connection");
    assert.equal(terminal.rating.nominal_voltage, voltage);
    assert.equal(terminal.rating.current, current);
  }
  assert.equal(Object.keys(t.ports ?? {}).length, 0);
  assert.equal(Object.keys(t.connectorPorts ?? {}).length, 0);
}
for (const tag of ["XQ", "XQB", "X16"]) {
  const terminals = type(compiled.ir, tag).terminals;
  for (const t of terminals)
    assert.equal(
      net(compiled.ir, tag, t.key).id,
      net(compiled.ir, tag, "A1").id,
    );
  assert.equal(
    net(compiled.ir, tag, "A1").terminalIds.length,
    terminals.length * 2,
  );
}
assert.equal(
  net(compiled.ir, "XMT", "A1").id,
  net(compiled.ir, "XMT", "A2").id,
);
assert.notEqual(
  net(compiled.ir, "XMT", "A1").id,
  net(compiled.ir, "XMT", "B1").id,
);
assert.equal(net(compiled.ir, "XMT", "A1").terminalIds.length, 4);
assert.equal(net(compiled.ir, "XMT", "B1").terminalIds.length, 2);
const knife = type(compiled.ir, "XMT").functions.find((f) => f.key === "knife");
assert.equal(knife.normal_state, "open");

const source = JSON.parse(await readFile(join(project, "source.json"), "utf8"));
assert.equal(source.objects.filter((o) => o.kind === "wire").length, 13);
assert.equal(source.objects.filter((o) => o.kind === "jumper").length, 8);
const request = JSON.parse(
  await readFile(join(project, "packet.json"), "utf8"),
);
const before = JSON.stringify(compiled.ir);
const packet = await renderSchematicPacket(compiled.ir, request);
assert.equal(packet.ok, true, JSON.stringify(packet.error));
assert.equal(packet.value.sheets.length, 4);
assert.equal(JSON.stringify(compiled.ir), before);
const { document } = parseHTML(packet.value.html);
assert.equal(document.querySelectorAll("[data-circuit-conductor]").length, 21);
assert.equal(
  document.querySelectorAll('[data-circuit-mark="terminal"]').length,
  11,
);
assert.equal(
  document.querySelectorAll('[data-circuit-mark="switch-no"]').length,
  1,
);
const selectedConductors = request.views.flatMap((v) =>
  v.groups.flatMap((g) => g.conductors),
);
assert.deepEqual(
  [...selectedConductors].sort(),
  source.objects
    .filter((o) => o.kind !== "device")
    .map((o) => o.designation)
    .sort(),
);

const scratch = await mkdtemp(join(tmpdir(), "thermite-phoenix-terminal-"));
try {
  const library = join(scratch, "phoenix-terminal-pilot");
  await cp(resolve(project, "../.."), library, { recursive: true });
  const copiedProject = join(library, "examples/terminal-wiring");
  const sourcePath = join(copiedProject, "source.json");
  const noJumpers = structuredClone(source);
  noJumpers.objects = noJumpers.objects.filter((o) => o.kind !== "jumper");
  await writeFile(sourcePath, JSON.stringify(noJumpers));
  const separated = await compileProject(copiedProject);
  assert.equal(separated.ok, true);
  for (const tag of ["XQ", "XQB", "XMT", "X16"]) {
    const keys = type(separated.ir, tag).terminals.map((t) => t.key);
    assert.equal(
      new Set(keys.map((k) => net(separated.ir, tag, k).id)).size,
      keys.length,
    );
  }
  const unused = structuredClone(source);
  unused.objects = unused.objects.filter((o) => o.kind === "device");
  await writeFile(sourcePath, JSON.stringify(unused));
  const passive = await compileProject(copiedProject);
  assert.equal(passive.ok, true);
  assert(!passive.diagnostics.some((d) => d.code === "W903"));
  unused.objects.find((o) => o.designation === "XMT").connectionReview = {
    terminals: {
      B1: {
        status: "required",
        reason:
          "This application selects the isolated knife-side external lead.",
      },
    },
  };
  await writeFile(sourcePath, JSON.stringify(unused));
  const required = await compileProject(copiedProject);
  assert.equal(required.ok, true);
  assert.equal(required.diagnostics.filter((d) => d.code === "W903").length, 1);
  assert(
    required.diagnostics.some(
      (d) => d.code === "W903" && d.message.startsWith("XMT:"),
    ),
  );
  const typePath = join(library, "types/3036356.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(copiedProject);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log(
  "Verified four Phoenix catalog models, 13 wire clamps, 21 explicit conductors, four rendered sheets, knife separation, passive requirements and library locks.",
);
