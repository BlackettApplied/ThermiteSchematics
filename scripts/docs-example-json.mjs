import assert from "node:assert/strict";
import { join } from "node:path";
import { json, put } from "./docs-example-context.mjs";

async function packet(c, project, value) {
  const input = join(c.work, "request.json");
  await put(
    input,
    value.views
      ? value
      : { format: "schematic-packet-request/0.1", views: [value] },
  );
  await c.cli(["packet", "--project", project, "--input", input, "--json"]);
}
function blocks(c, file) {
  return c.fences
    .filter((f) => f.file === file && f.lang === "json")
    .map((f) => JSON.parse(f.body));
}
async function communication(c) {
  const project = join(c.work, "communication");
  const values = blocks(c, "docs/communication-ports.md");
  assert.equal(values.length, 3, "Unbound communication example");
  const [type, relation, request] = values;
  await put(join(project, "library/library.json"), {
    name: "example",
    version: "0.1.0",
    sources: ["types.json"],
  });
  await put(join(project, "library/types.json"), { types: [type] });
  await put(join(project, "system.json"), {
    format: "electrical-system/0.1",
    project: { name: "Synthetic network" },
    sources: ["source.json"],
    libraries: [{ name: "example", version: "0.1.0", path: "library" }],
  });
  await put(join(project, "source.json"), {
    objects: [
      {
        uid: "42000000-0000-4000-8000-000000000001",
        kind: "device",
        designation: "PLC1",
        type: type.id,
      },
      {
        uid: "42000000-0000-4000-8000-000000000002",
        kind: "device",
        designation: "RIO1",
        type: type.id,
      },
      relation,
    ],
  });
  await c.cli(["lock", project]);
  await c.cli(["validate", project]);
  await packet(c, project, request);
}
async function assemblies(c) {
  const project = join(c.work, "assemblies");
  await c.copy("examples/topology-coverage", project);
  const values = blocks(c, "docs/connector-assemblies.md");
  assert.equal(values.length, 3, "Unbound connector assembly example");
  const [ports, relation, request] = values;
  const file = join(project, "source.json");
  const source = JSON.parse(
    JSON.stringify(await json(file))
      .replaceAll('"R1"', '"RACK1"')
      .replaceAll('"S1"', '"PT1"'),
  );
  source.objects = source.objects.filter((o) => o.uid !== relation.uid);
  source.objects.push(relation);
  await put(file, source);
  const types = await json(join(project, "library/types.json"));
  const rack = types.types.find((t) => t.id === "connector-fixture:rack");
  Object.assign(rack.connectorPorts, ports.connectorPorts);
  rack.terminals["L+"] = {};
  await put(join(project, "library/types.json"), types);
  await c.cli(["lock", project]);
  await c.cli(["validate", project]);
  await packet(c, project, request);
}
export async function jsonSource(c, fence) {
  if (fence.file === "docs/communication-ports.md") {
    c.communication ??= communication(c);
    return c.communication;
  }
  if (fence.file === "docs/connector-assemblies.md") {
    c.assemblies ??= assemblies(c);
    return c.assemblies;
  }
  const project = join(c.work, "connector-io");
  await c.copy("examples/connector-io", project);
  const file = join(project, "source.json");
  const source = await json(file);
  Object.assign(
    source.objects.find((o) => o.designation === "R1"),
    JSON.parse(fence.body),
  );
  await put(file, source);
  await c.cli(["validate", project]);
}
export async function jsonPacket(c, fence) {
  const value = JSON.parse(fence.body);
  const project = join(c.work, "packet");
  if (fence.file === "docs/terminal-wiring.md") {
    const consoleProject = join(c.work, "examples/operator-console");
    await c.copy("examples/operator-console", consoleProject);
    await c.copy(
      "libraries/industrial-pilot",
      join(c.work, "libraries/industrial-pilot"),
    );
    return packet(c, consoleProject, value);
  }
  await c.copy("examples/motor-starter", project);
  await put(join(c.work, "continuity.json"), value);
  const result = await c.run(
    [
      c.entry,
      "continuity",
      "--project",
      project,
      "--input",
      join(c.work, "continuity.json"),
      "--json",
    ],
    c.work,
  );
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.format, "physical-continuity-report/0.1");
  assert.equal(report.checks.length, value.checks.length);
  assert.equal(report.counts.satisfied, value.checks.length);
}
