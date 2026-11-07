import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { compileLoadedProject, loadProject, engineRoot } from "./engine.mjs";
import { corpus, probe, temporary, readJson } from "./support.mjs";
import { synthetic } from "./generate.mjs";
import { mutate, assertBaselineDiagnostics } from "./validation.mjs";
import { exampleDiagnostics } from "./example-diagnostics.mjs";
import { assertLocations } from "./diagnostic-policy.mjs";

const key = (uid, terminal) => JSON.stringify([uid, terminal]);
const canonical = (groups) =>
  groups.map((group) => [...group].sort().join("|")).sort();

// Independent union-find over AUTHORED documents and library terminal keys.
// Never read compiler expansion, graph indexes, resolved edges or net IDs.
export function authoredPartition(objects, types) {
  for (const object of objects)
    assert(
      ["device", "wire", "jumper", "cable", "potential", "relation"].includes(
        object.kind,
      ),
      `Oracle must decide semantics for unknown kind ${object.kind}`,
    );
  const devices = new Map(
    objects.filter((o) => o.kind === "device").map((d) => [d.designation, d]),
  );
  const parent = new Map();
  for (const device of devices.values()) {
    const type = types.get(device.type);
    assert(type, `Missing authored type ${device.type}`);
    for (const terminal of Object.keys(type.terminals))
      parent.set(key(device.uid, terminal), key(device.uid, terminal));
  }
  function find(item) {
    assert(parent.has(item), `Unknown authored endpoint ${item}`);
    let current = item;
    while (parent.get(current) !== current) current = parent.get(current);
    while (parent.get(item) !== item) {
      const next = parent.get(item);
      parent.set(item, current);
      item = next;
    }
    return current;
  }
  const endpoint = (e) => {
    assert(devices.has(e.device), `Unknown device ${e.device}`);
    return key(devices.get(e.device).uid, e.terminal);
  };
  let edges = 0;
  for (const object of objects) {
    const pairs = ["wire", "jumper"].includes(object.kind)
      ? [object.endpoints]
      : object.kind === "cable"
        ? object.conductors.map((c) => c.endpoints)
        : [];
    for (const pair of pairs) {
      if (pair.some((e) => e === null)) continue;
      assert.equal(pair.length, 2);
      parent.set(find(endpoint(pair[0])), find(endpoint(pair[1])));
      edges++;
    }
  }
  const groups = new Map();
  for (const item of parent.keys()) {
    const representative = find(item);
    if (!groups.has(representative)) groups.set(representative, []);
    groups.get(representative).push(item);
  }
  return {
    partition: canonical([...groups.values()]),
    terminals: parent.size,
    edges,
    potentialAttachments: objects
      .filter((o) => o.kind === "potential")
      .map((o) => [o.uid, [...groups.get(find(endpoint(o.at)))].sort()])
      .sort(),
  };
}

export async function compareProject(project) {
  const loaded = await loadProject(project);
  assert(loaded.ok, JSON.stringify(loaded.diagnostics));
  const objects = loaded.project.sources.flatMap(
    (document) => document.value.objects,
  );
  const types = new Map(
    loaded.project.libraries
      .flatMap((library) =>
        library.sources.flatMap((document) => document.value.types),
      )
      .map((type) => [type.id, type]),
  );
  const oracle = authoredPartition(objects, types);
  const compiled = compileLoadedProject(loaded.project);
  assert(compiled.ok, JSON.stringify(compiled.diagnostics));
  const actual = canonical(
    compiled.ir.nets.map((net) =>
      net.terminalIds.map((id) => key(id.deviceUid, id.terminalKey)),
    ),
  );
  assert.deepEqual(
    actual,
    oracle.partition,
    "Authored/compiler net partitions differ",
  );
  const attachments = compiled.ir.nets
    .flatMap((net) =>
      net.potentialUids.map((uid) => [
        uid,
        net.terminalIds.map((id) => key(id.deviceUid, id.terminalKey)).sort(),
      ]),
    )
    .sort();
  assert.deepEqual(
    attachments,
    oracle.potentialAttachments,
    "Potential must attach only to its authored terminal's component",
  );
  const netById = new Map(compiled.ir.nets.map((n) => [n.id, n]));
  for (const potential of compiled.ir.potentials)
    assert(
      netById.has(potential.netId),
      "Potential refers to a missing compiler net",
    );
  assert.deepEqual(
    compiled.ir.potentials
      .map((p) => [
        p.uid,
        netById
          .get(p.netId)
          .terminalIds.map((id) => key(id.deviceUid, id.terminalKey))
          .sort(),
      ])
      .sort(),
    oracle.potentialAttachments,
  );
  assertLocations(compiled.diagnostics);
  return {
    terminals: oracle.terminals,
    conductiveEdges: oracle.edges,
    nets: actual.length,
    diagnostics: compiled.diagnostics,
    potentials: attachments.length,
  };
}

export async function exampleProjects(
  directory = join(engineRoot, "examples"),
) {
  const projects = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "out" || entry.name === "legacy-cad-examples") continue;
    if (entry.isFile() && entry.name === "system.json")
      projects.push(directory);
    if (entry.isDirectory())
      projects.push(...(await exampleProjects(join(directory, entry.name))));
  }
  return projects.sort();
}

export function assertSyntheticDiagnostics(diagnostics) {
  assert.deepEqual(
    diagnostics.map(({ code, severity, file, jsonPointer }) => ({
      code,
      severity,
      file,
      jsonPointer,
    })),
    [
      {
        code: "W111",
        severity: "warning",
        file: "library/types.json",
        jsonPointer: "/types/0/symbol",
      },
    ],
    "The generated bus type must emit exactly one aggregated W111",
  );
}

export async function oracle() {
  const rows = [];
  for (const project of [
    ...(await exampleProjects()),
    join(corpus, "topology"),
  ]) {
    rows.push(
      await probe(`oracle/${basename(project)}`, async () => {
        const result = await compareProject(project);
        if (project !== join(corpus, "topology")) {
          const policy = exampleDiagnostics[basename(project)];
          assert(
            policy,
            "Example must have an explicit diagnostic classification",
          );
          assert.deepEqual(
            result.diagnostics.map(
              ({ code, severity, file, jsonPointer, message }) => ({
                code,
                severity,
                file,
                jsonPointer,
                message,
              }),
            ),
            policy.diagnostics,
          );
          result.diagnosticClassification = policy.classification;
          result.falsePositives = 0;
        } else assert.deepEqual(result.diagnostics, []);
        return result;
      }),
    );
  }
  rows.push(
    await probe("oracle/synthetic-300-1500", () =>
      temporary(async (project) => {
        await synthetic(project);
        const result = await compareProject(project);
        assert.equal(result.terminals, 2400);
        assert.equal(result.conductiveEdges, 1500);
        assert.equal(result.nets, 1142);
        assertSyntheticDiagnostics(result.diagnostics);
        return result;
      }, null),
    ),
  );
  for (const baseline of (await readJson(join(corpus, "baselines.json"))).cases)
    rows.push(
      await probe(`oracle/baseline/${baseline.id}`, () =>
        temporary(async (project) => {
          await mutate(project, baseline);
          const result = await compareProject(project);
          assertBaselineDiagnostics(baseline.id, result.diagnostics);
          return result;
        }),
      ),
    );
  return rows;
}
