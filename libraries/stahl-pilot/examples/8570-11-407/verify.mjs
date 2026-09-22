import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject, lockProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";

const project = dirname(fileURLToPath(import.meta.url));
const library = resolve(project, "../..");
const repository = resolve(library, "../..");
const isolated = process.argv.includes("--isolated");
const outputIndex = process.argv.indexOf("--output-dir");
const output = outputIndex < 0 ? null : resolve(process.argv[outputIndex + 1]);
const scratchRoot = join(
  repository,
  ".codex-reviews/component-review/8570-11-407",
);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(scratchRoot, "verify-"));
const device = (ir, tag) => ir.devices.find((d) => d.designation === tag);
const net = (ir, tag, key) =>
  ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === device(ir, tag).uid && t.terminalKey === key,
    ),
  );
const checkValid = (result) =>
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const expectedTerminals = [
  "C.L1",
  "C.L2",
  "C.L3",
  "C.PE",
  "M.L1",
  "M.L2",
  "M.L3",
  "M.PE",
];

try {
  // Snapshot only this exact part: concurrent library additions cannot alter
  // this test's lock. The tracked example still uses the complete pilot.
  const copyLibrary = join(scratch, "stahl-pilot");
  const copyProject = join(copyLibrary, "examples/8570-11-407");
  await mkdir(join(copyLibrary, "types"), { recursive: true });
  await cp(
    join(library, "types/8570-11-407.json"),
    join(copyLibrary, "types/8570-11-407.json"),
  );
  await writeFile(
    join(copyLibrary, "library.json"),
    JSON.stringify({
      name: "stahl-pilot",
      version: "0.1.0",
      sources: ["types/8570-11-407.json"],
    }),
  );
  await cp(project, copyProject, { recursive: true });
  checkValid(await lockProject(copyProject));
  const baseline = await compileProject(isolated ? copyProject : project);
  checkValid(baseline);
  assert.equal(baseline.diagnostics.length, 3);
  assert(baseline.diagnostics.every((d) => d.code === "W904"));
  const type = baseline.ir.deviceTypes.find(
    (t) => t.id === device(baseline.ir, "XS").typeId,
  );
  assert.deepEqual(
    type.terminals.map((t) => t.key).sort(),
    [...expectedTerminals].sort(),
  );
  assert.equal(type.connectionCoverage.status, "partial");
  assert.equal(type.terminals.find((t) => t.key === "C.PE").required, true);
  const authored = JSON.parse(
    await readFile(join(library, "types/8570-11-407.json"), "utf8"),
  ).types[0];
  assert.equal(authored.catalog.orderNumber, "8570/11-407");
  assert.deepEqual(
    Object.keys(authored.functions).sort(),
    Object.keys(authored.circuitSymbols).sort(),
  );
  assert.deepEqual(Object.keys(type.connectorPorts.MATE.pins).sort(), [
    "L1",
    "L2",
    "L3",
    "PE",
  ]);
  for (const pole of ["L1", "L2", "L3", "PE"])
    assert.equal(type.connectorPorts.MATE.pins[pole].terminal, `M.${pole}`);
  assert.deepEqual(
    type.functions
      .filter((f) => f.kind === "contact")
      .map((f) => f.terminalKeys),
    [
      ["C.L1", "M.L1"],
      ["C.L2", "M.L2"],
      ["C.L3", "M.L3"],
    ],
  );
  for (const terminal of authored.terminalOrder.filter(
    (key) => !key.endsWith(".PE"),
  ))
    assert.deepEqual(authored.terminals[terminal].rating, {
      nominal_voltage: 500,
      voltage_type: "AC",
      current: 16,
    });

  // Every switched endpoint remains separate from every other endpoint except
  // the one deliberately authored protective-earth link.
  for (const [i, a] of expectedTerminals.entries())
    for (const b of expectedTerminals.slice(i + 1)) {
      const bothPE = a.endsWith(".PE") && b.endsWith(".PE");
      assert.equal(
        net(baseline.ir, "XS", a).id === net(baseline.ir, "XS", b).id,
        bothPE,
        `${a}/${b}`,
      );
    }
  for (const pole of ["L1", "L2", "L3", "PE"])
    for (const [side, boundary] of [
      ["C", "IN"],
      ["M", "OUT"],
    ])
      assert.equal(
        net(baseline.ir, "XS", `${side}.${pole}`).id,
        net(baseline.ir, boundary, pole).id,
      );

  const request = JSON.parse(
    await readFile(join(project, "packet.json"), "utf8"),
  );
  assert.deepEqual(
    request.views
      .flatMap((v) => v.groups.flatMap((g) => g.functions.map((f) => f.key)))
      .sort(),
    Object.keys(authored.functions).sort(),
  );
  const source = JSON.parse(
    await readFile(join(copyProject, "source.json"), "utf8"),
  );
  assert.deepEqual(
    request.views.flatMap((v) => v.groups.flatMap((g) => g.conductors)).sort(),
    source.objects
      .filter((o) => ["wire", "jumper"].includes(o.kind))
      .map((o) => o.designation)
      .sort(),
  );
  const packet = await renderSchematicPacket(baseline.ir, request, {
    paper: "tabloid",
  });
  assert.equal(packet.ok, true, JSON.stringify(packet.error));
  assert.equal(packet.value.sheets.length, 1);
  for (const key of Object.keys(authored.functions))
    assert(
      packet.value.sheets[0].svg.includes(`data-function-key="${key}"`),
      `Function was not rendered: ${key}`,
    );
  for (const conductor of source.objects.filter((o) =>
    ["wire", "jumper"].includes(o.kind),
  ))
    assert(
      packet.value.sheets[0].svg.includes(
        `data-conductor-designation="${conductor.designation}"`,
      ),
      `Conductor was not rendered: ${conductor.designation}`,
    );
  for (const text of [
    "8570/11-407",
    "C.L1",
    "M.L1",
    "C.L2",
    "M.L2",
    "C.L3",
    "M.L3",
    "C.PE",
    "M.PE",
    "INTERNAL-PE",
  ])
    assert(
      packet.value.sheets[0].svg.includes(text),
      `Missing rendered ${text}`,
    );
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "socket.svg"), packet.value.sheets[0].svg);
    await writeFile(
      join(output, "diagnostics.json"),
      JSON.stringify(baseline.diagnostics, null, 2) + "\n",
    );
  }

  const sourcePath = join(copyProject, "source.json");
  const variant = async (predicate) => {
    await writeFile(
      sourcePath,
      JSON.stringify({ objects: source.objects.filter(predicate) }),
    );
    const result = await compileProject(copyProject);
    checkValid(result);
    return result;
  };
  const noFactoryPE = await variant((o) => o.designation !== "INTERNAL-PE");
  assert.notEqual(
    net(noFactoryPE.ir, "XS", "C.PE").id,
    net(noFactoryPE.ir, "XS", "M.PE").id,
  );
  // A contact, port, and ganging relation never invent a physical conductor.
  const unwired = await variant((o) => o.kind === "device");
  assert.equal(
    new Set(expectedTerminals.map((key) => net(unwired.ir, "XS", key).id)).size,
    8,
  );
  const missingPE = await variant(
    (o) => !["INTERNAL-PE", "IN-PE"].includes(o.designation),
  );
  assert.equal(
    missingPE.diagnostics.filter((d) => d.code === "W903").length,
    1,
  );
  assert(
    missingPE.diagnostics.some(
      (d) =>
        d.code === "W903" &&
        d.message.startsWith("XS:") &&
        d.message.includes("C.PE"),
    ),
  );
  // Presence alone cannot prove an external supply: this PE pair is floating.
  const floatingPE = await variant(
    (o) => !["IN-PE", "OUT-PE"].includes(o.designation),
  );
  assert(!floatingPE.diagnostics.some((d) => d.code === "W903"));
  assert.equal(net(floatingPE.ir, "XS", "C.PE").terminalIds.length, 2);
  assert.equal(
    net(floatingPE.ir, "XS", "C.PE").id,
    net(floatingPE.ir, "XS", "M.PE").id,
  );
  const typePath = join(copyLibrary, "types/8570-11-407.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(copyProject);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));
  console.log(
    "Verified 8570/11-407: eight endpoints, three isolated switched poles, explicit PE, required-PE negative and floating-PE limit, complete circuit view and stale-byte rejection; three W904 warnings preserved.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
