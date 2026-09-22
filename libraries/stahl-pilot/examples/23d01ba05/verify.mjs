import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeCompleteness,
  compileProject,
  lockProject,
} from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";

const example = dirname(fileURLToPath(import.meta.url));
const library = resolve(example, "../..");
const isolated = process.argv.includes("--isolated");
const outputArgument = process.argv
  .slice(2)
  .find((arg) => arg !== "--isolated");
const output = outputArgument ? resolve(outputArgument) : undefined;
const scratch = await mkdtemp(join(tmpdir(), "thermite-23d01ba05-"));
const clone = join(scratch, "stahl-pilot");
const project = join(clone, "examples/23d01ba05");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
const device = (ir, tag) => ir.devices.find((d) => d.designation === tag);
const net = (ir, key) =>
  ir.nets.find((n) =>
    n.terminalIds.some(
      (t) => t.deviceUid === device(ir, "S1").uid && t.terminalKey === key,
    ),
  );

try {
  // Copy only the reviewed type; another agent's library edits cannot race this lock.
  await mkdir(join(clone, "types"), { recursive: true });
  await cp(join(library, "library.json"), join(clone, "library.json"));
  await cp(
    join(library, "types/23d01ba05.json"),
    join(clone, "types/23d01ba05.json"),
  );
  await mkdir(project, { recursive: true });
  for (const file of ["system.json", "source.json", "packet.json"])
    await cp(join(example, file), join(project, file));
  await cp(join(example, "fixture"), join(project, "fixture"), {
    recursive: true,
  });
  const locked = await lockProject(project);
  assert.equal(locked.ok, true, JSON.stringify(locked.diagnostics));
  const compiled = await compileProject(isolated ? project : example);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(
    compiled.diagnostics.map((d) => d.code),
    ["W904", "W904"],
  );
  const type = compiled.ir.deviceTypes.find(
    (t) => t.id === "stahl-pilot:23d01ba05",
  );
  assert.deepEqual(
    type.terminals.map((t) => t.key),
    ["11", "12", "13", "14"],
  );
  assert.equal(type.connectionCoverage.status, "partial");
  assert(
    type.terminals.every((t) => t.required !== true && t.rating === undefined),
  );
  assert.deepEqual(
    type.functions.map((f) => [f.key, f.kind, f.normal_state, f.terminalKeys]),
    [
      ["nc", "contact", "closed", ["11", "12"]],
      ["no", "contact", "open", ["13", "14"]],
    ],
  );
  assert.equal(type.internalRelations.length, 0);
  assert.equal(Object.keys(type.connectorPorts ?? {}).length, 0);
  // Every endpoint remains separate, even across the normally closed function.
  assert.equal(
    new Set(["11", "12", "13", "14"].map((key) => net(compiled.ir, key).id))
      .size,
    4,
  );

  const request = await readJson(join(project, "packet.json"));
  const rendered = await renderSchematicPacket(compiled.ir, request, {
    paper: "tabloid",
  });
  assert.equal(rendered.ok, true, JSON.stringify(rendered.error));
  assert.equal(rendered.value.sheets.length, 1);
  const svg = rendered.value.sheets[0].svg;
  for (const text of [
    "23D01BA05",
    "W11",
    "W12",
    "W13",
    "W14",
    "pushbutton-nc",
    "pushbutton-no",
  ])
    assert(svg.includes(text), `Rendered sheet missing ${text}`);

  assert.deepEqual(
    [...svg.matchAll(/data-function-key="([^"]+)"/gu)].map((m) => m[1]).sort(),
    ["nc", "no"],
  );
  assert.deepEqual(
    [...svg.matchAll(/data-conductor-designation="([^"]+)"/gu)]
      .map((m) => m[1])
      .sort(),
    ["W11", "W12", "W13", "W14"],
  );

  // An unknown contact selection cannot silently render as a valid contact.
  const incompleteRequest = structuredClone(request);
  incompleteRequest.views[0].groups[0].functions[1].key = "unverified-contact";
  const incomplete = await renderSchematicPacket(
    compiled.ir,
    incompleteRequest,
    { paper: "tabloid" },
  );
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.error.code, "R006");

  const sourcePath = join(project, "source.json");
  const source = await readJson(sourcePath);
  const disconnectedSource = structuredClone(source);
  disconnectedSource.objects = disconnectedSource.objects.filter(
    (o) => o.kind !== "wire",
  );
  await writeJson(sourcePath, disconnectedSource);
  const disconnected = await compileProject(project);
  assert.equal(disconnected.ok, true, JSON.stringify(disconnected.diagnostics));
  assert(!disconnected.diagnostics.some((d) => d.code === "W903"));
  assert.equal(
    new Set(["11", "12", "13", "14"].map((key) => net(disconnected.ir, key).id))
      .size,
    4,
  );
  const report = analyzeCompleteness(disconnected.ir);
  assert.equal(report.findings.filter((f) => f.code === "I001").length, 8);

  const joinedSource = structuredClone(source);
  joinedSource.objects.push({
    kind: "jumper",
    uid: "53413f21-807e-4e2c-b6f0-498fc88d3e69",
    designation: "TEST-LINK",
    endpoints: [
      { device: "S1", terminal: "11" },
      { device: "S1", terminal: "12" },
    ],
  });
  await writeJson(sourcePath, joinedSource);
  const joined = await compileProject(project);
  assert.equal(joined.ok, true, JSON.stringify(joined.diagnostics));
  assert.equal(net(joined.ir, "11").id, net(joined.ir, "12").id);
  assert.equal(
    new Set(["11", "13", "14"].map((key) => net(joined.ir, key).id)).size,
    3,
  );

  const invalidSource = structuredClone(source);
  invalidSource.objects.find(
    (o) => o.designation === "W13",
  ).endpoints[1].terminal = "23";
  await writeJson(sourcePath, invalidSource);
  const invalid = await compileProject(project);
  assert.equal(invalid.ok, false);
  assert(
    invalid.diagnostics.some((d) => d.code === "E102"),
    JSON.stringify(invalid.diagnostics),
  );

  await writeJson(sourcePath, source);
  const typePath = join(clone, "types/23d01ba05.json");
  await writeFile(typePath, (await readFile(typePath, "utf8")) + "\n");
  const stale = await compileProject(project);
  assert.equal(stale.ok, false);
  assert(stale.diagnostics.some((d) => d.code === "E108"));

  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "23d01ba05.svg"), svg);
    await writeJson(join(output, "diagnostics.json"), compiled.diagnostics);
    await writeJson(join(output, "verification.json"), {
      type: type.id,
      coverage: type.connectionCoverage,
      terminalKeys: type.terminals.map((t) => t.key),
      sheetCount: rendered.value.sheets.length,
      checks: [
        "four separate contact nets",
        "normal states",
        "no implicit gangs, ports or ratings",
        "all four wires and both symbols rendered",
        "unknown contact view rejected R006",
        "passive unconnected endpoints",
        "explicit jumper continuity",
        "unknown terminal rejected E102",
        "stale library rejected E108",
      ],
    });
  }
  console.log(
    "Verified 23D01BA05: four numbered endpoints, independent NC/NO contacts, partial physical coverage, passive unused contacts, explicit-wire continuity, complete rendering and negative topology/lock checks.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
