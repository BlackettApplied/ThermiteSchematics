import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { json, put, shell } from "./docs-example-context.mjs";

export async function agentWorkflow(c, fence) {
  if (!c.agentRun) c.agentRun = runWorkflow(c);
  const consumed = await c.agentRun;
  assert.ok(
    consumed.has(fence.hash),
    `Unconsumed agent fence ${fence.ordinal}`,
  );
}
async function runWorkflow(c) {
  const fences = c.fences.filter((f) => f.file === "docs/agent-requests.md");
  const consumed = new Set();
  const find = (lang, needle) => {
    const f = fences.find((f) => f.lang === lang && f.body.includes(needle));
    assert.ok(f, `Missing ${lang} agent example: ${needle}`);
    return f;
  };
  const project = join(c.work, "project");
  await c.cli(["init", project]);
  const save = async (needle, name) => {
    const f = find("json", needle);
    await put(join(project, f.meta || name), f.body);
    consumed.add(f.hash);
  };
  const execute = async (needle) => {
    const f = find("sh", needle);
    const result = await shell(c, f.body, project);
    consumed.add(f.hash);
    return result;
  };
  await save('"project": "."\n}', "validate.request.json");
  await execute("agent validate --input validate.request.json");
  await save('"target"', "resolve.request.json");
  await execute("agent resolve");
  await save(
    '"selector": { "by": "designation", "value": "PS1" }\n}',
    "inspect.request.json",
  );
  await execute("--input inspect.request.json");
  await save('"include"', "inspect-source.request.json");
  const inspection = JSON.parse(
    (await execute("--input inspect-source.request.json")).stdout,
  );
  const script = find("js", "const guardedPatch");
  await put(
    join(project, "guard.mjs"),
    `const inspection = ${JSON.stringify(inspection)};\n${script.body}\nawait Bun.write("guard.json", JSON.stringify(guardedPatch));`,
  );
  const run = await c.run(["guard.mjs"], project);
  assert.equal(run.code, 0, run.stderr);
  consumed.add(script.hash);
  const guarded = await json(join(project, "guard.json"));
  assert.equal(
    guarded.files[0].expectedIntegrity,
    inspection.value.object.source.integrity,
  );
  await execute("createHash");
  await save('"query"', "query.request.json");
  await execute("agent query");
  await patchAndRepair({
    c,
    project,
    find,
    consumed,
    save,
    execute,
    inspection,
  });
  return consumed;
}
async function patchAndRepair({
  c,
  project,
  find,
  consumed,
  save,
  execute,
  inspection,
}) {
  // This digest substitution is explicitly required by the surrounding prose;
  // the literal reference JSON remains classified as illustrative.
  const reference = JSON.parse(find("json", '"dryRun": true').body);
  reference.files[0].expectedIntegrity =
    inspection.value.object.source.integrity;
  await put(join(project, "patch-dry-run.request.json"), reference);
  const before = await readFile(join(project, "devices/equipment.json"));
  await execute("--input patch-dry-run.request.json");
  assert.deepEqual(
    await readFile(join(project, "devices/equipment.json")),
    before,
  );
  await put(join(project, "patch-apply.request.json"), {
    ...reference,
    dryRun: false,
  });
  await execute("--input patch-apply.request.json");
  const equipment = await json(join(project, "devices/equipment.json"));
  assert.equal(
    equipment.objects[0].description,
    "24 VDC starter control power supply",
  );
  equipment.objects[0].uid = equipment.objects[0].uid.toUpperCase();
  equipment.objects[0].unexpected = true;
  await put(join(project, "devices/equipment.json"), equipment);
  const repair = find("js", 'const file = "devices/equipment.json"');
  await put(join(project, repair.meta || "repair-schema.mjs"), repair.body);
  consumed.add(repair.hash);
  const invalidBytes = await readFile(join(project, "devices/equipment.json"));
  await execute("bun repair-schema.mjs");
  assert.deepEqual(
    await readFile(join(project, "devices/equipment.json")),
    invalidBytes,
  );
  const request = await json(join(project, "repair-schema.request.json"));
  await put(join(project, "repair-schema-apply.request.json"), {
    ...request,
    dryRun: false,
  });
  await execute("--input repair-schema-apply.request.json");
  await save('"spec"', "create-view.request.json");
  const view = JSON.parse((await execute("agent create-view")).stdout);
  assert.equal(view.format, "agent-tool-result/0.1");
  assert.equal(view.tool, "create-view");
}
