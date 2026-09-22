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
  ".codex-reviews/component-review/8570-12-407",
);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(scratchRoot, "verify-"));
const poles = ["L1", "L2", "L3", "PE"];
const keys = ["C", "M"].flatMap((side) =>
  poles.map((pole) => `${side}.${pole}`),
);
const device = (ir, tag) => ir.devices.find((d) => d.designation === tag);
const net = (ir, tag, key) =>
  ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === device(ir, tag).uid && t.terminalKey === key,
    ),
  );
const valid = (result) =>
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const isolatedPoles = (ir) =>
  assert.equal(
    new Set(poles.map((pole) => net(ir, "XP", `C.${pole}`).id)).size,
    4,
    "Three power poles and PE must remain separate",
  );

try {
  // Snapshot exactly this component so concurrent library work cannot change
  // its byte lock. Ordinary runs also verify the integrated tracked example.
  const copyLibrary = join(scratch, "stahl-pilot");
  const copyProject = join(copyLibrary, "examples/8570-12-407");
  await mkdir(join(copyLibrary, "types"), { recursive: true });
  await cp(
    join(library, "types/8570-12-407.json"),
    join(copyLibrary, "types/8570-12-407.json"),
  );
  await writeFile(
    join(copyLibrary, "library.json"),
    JSON.stringify({
      name: "stahl-pilot",
      version: "0.1.0",
      sources: ["types/8570-12-407.json"],
    }),
  );
  await cp(project, copyProject, { recursive: true });
  valid(await lockProject(copyProject));
  const baseline = await compileProject(isolated ? copyProject : project);
  valid(baseline);
  assert.equal(baseline.diagnostics.length, 3);
  assert(baseline.diagnostics.every((d) => d.code === "W904"));
  const type = baseline.ir.deviceTypes.find(
    (t) => t.id === device(baseline.ir, "XP").typeId,
  );
  const authored = JSON.parse(
    await readFile(join(library, "types/8570-12-407.json"), "utf8"),
  ).types[0];
  assert.equal(authored.catalog.orderNumber, "8570/12-407");
  assert.deepEqual(type.terminals.map((t) => t.key).sort(), [...keys].sort());
  assert.equal(type.connectionCoverage.status, "partial");
  assert.equal(type.terminals.find((t) => t.key === "C.PE").required, true);
  assert.equal(type.functions.length, 8);
  assert(
    type.functions.every(
      (f) => f.kind === "bus" && f.terminalKeys.length === 1,
    ),
  );
  assert.deepEqual(
    Object.keys(authored.circuitSymbols).sort(),
    [...keys].sort(),
  );
  assert(
    Object.values(authored.circuitSymbols).every(
      (symbol) => symbol === "terminal",
    ),
  );
  assert.deepEqual(Object.keys(type.connectorPorts.MATE.pins).sort(), poles);
  for (const pole of poles) {
    assert.equal(type.connectorPorts.MATE.pins[pole].terminal, `M.${pole}`);
    assert.equal(
      net(baseline.ir, "XP", `C.${pole}`).id,
      net(baseline.ir, "XP", `M.${pole}`).id,
    );
    for (const [side, boundary] of [
      ["C", "CABLE"],
      ["M", "MATE"],
    ]) {
      assert.equal(
        net(baseline.ir, "XP", `${side}.${pole}`).id,
        net(baseline.ir, boundary, pole).id,
      );
      if (pole !== "PE")
        assert.deepEqual(authored.terminals[`${side}.${pole}`].rating, {
          nominal_voltage: 500,
          voltage_type: "AC",
          current: 16,
        });
    }
    assert.equal(net(baseline.ir, "XP", `C.${pole}`).terminalIds.length, 4);
  }
  isolatedPoles(baseline.ir);
  const request = JSON.parse(
    await readFile(join(project, "packet.json"), "utf8"),
  );
  const source = JSON.parse(
    await readFile(join(copyProject, "source.json"), "utf8"),
  );
  const sourcePath = join(copyProject, "source.json");
  assert.deepEqual(
    request.views
      .flatMap((v) => v.groups.flatMap((g) => g.functions.map((f) => f.key)))
      .sort(),
    [...keys].sort(),
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
  const svg = packet.value.sheets[0].svg;
  for (const text of [
    "8570/12-407",
    ...keys,
    ...source.objects
      .filter((o) => o.kind !== "device")
      .map((o) => o.designation),
  ])
    assert(svg.includes(text), `Missing rendered ${text}`);

  const variant = async (objects) => {
    await writeFile(sourcePath, JSON.stringify({ objects }));
    const result = await compileProject(copyProject);
    valid(result);
    return result;
  };
  // Every factory path is essential: opening one must disconnect only that pair.
  for (const openPole of poles) {
    const opened = await variant(
      source.objects.filter((o) => o.designation !== `INTERNAL-${openPole}`),
    );
    for (const pole of poles)
      assert.equal(
        net(opened.ir, "XP", `C.${pole}`).id ===
          net(opened.ir, "XP", `M.${pole}`).id,
        pole !== openPole,
        `Opening ${openPole} changed ${pole} incorrectly`,
      );
    isolatedPoles(opened.ir);
  }
  const noLinks = await variant(
    source.objects.filter((o) => o.kind !== "jumper"),
  );
  assert.equal(
    new Set(keys.map((key) => net(noLinks.ir, "XP", key).id)).size,
    8,
  );
  // A deliberately authored cross-pole short must fail the topology oracle.
  // The unenergized fixture does not ask the compiler to infer a safety verdict.
  const shorted = await variant([
    ...source.objects,
    {
      kind: "jumper",
      uid: "f0551147-2f8f-4e6f-8fc0-3b2d3588eec5",
      designation: "FAULT-L1-L2",
      endpoints: [
        { device: "XP", terminal: "C.L1" },
        { device: "XP", terminal: "C.L2" },
      ],
    },
  ]);
  assert.throws(() => isolatedPoles(shorted.ir), /must remain separate/);
  assert.equal(
    net(shorted.ir, "XP", "M.L1").id,
    net(shorted.ir, "XP", "M.L2").id,
  );
  assert.notEqual(
    net(shorted.ir, "XP", "M.L1").id,
    net(shorted.ir, "XP", "M.PE").id,
  );
  const missingPE = await variant(
    source.objects.filter(
      (o) => !["INTERNAL-PE", "CABLE-PE"].includes(o.designation),
    ),
  );
  assert.equal(
    missingPE.diagnostics.filter((d) => d.code === "W903").length,
    1,
  );
  assert(
    missingPE.diagnostics.some(
      (d) =>
        d.code === "W903" &&
        d.message.startsWith("XP:") &&
        d.message.includes("C.PE"),
    ),
  );
  const floatingPE = await variant(
    source.objects.filter(
      (o) => !["CABLE-PE", "MATE-PE"].includes(o.designation),
    ),
  );
  assert(!floatingPE.diagnostics.some((d) => d.code === "W903"));
  assert.equal(net(floatingPE.ir, "XP", "C.PE").terminalIds.length, 2);
  assert.equal(
    net(floatingPE.ir, "XP", "C.PE").id,
    net(floatingPE.ir, "XP", "M.PE").id,
  );
  const typePath = join(copyLibrary, "types/8570-12-407.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(copyProject);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "plug.svg"), svg);
    await writeFile(
      join(output, "diagnostics.json"),
      JSON.stringify(
        {
          baseline: baseline.diagnostics,
          missingPE: missingPE.diagnostics,
          floatingPE: floatingPE.diagnostics,
          staleLibrary: stale.diagnostics,
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(
    "Verified 8570/12-407: eight endpoints, four fixed isolated conductors, individual open and cross-pole short checks, missing-PE warning and floating-PE limit, complete circuit view and stale-byte rejection; three W904 warnings preserved.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
