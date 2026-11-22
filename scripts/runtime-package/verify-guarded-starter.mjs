import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function verifyGuardedStarter(invoke, project) {
  const guide = (await invoke(["guide", "agent-requests"])).stdout;
  const { example, from, to } = parseRecipe(guide);
  const cli = (args) => invoke(args, undefined, 0, project);
  const agent = (tool, request, expected = 0) =>
    invoke(
      ["agent", tool, "--input", "-"],
      JSON.stringify(request),
      expected,
      project,
    );
  const requestFor = (value) => ({
    ...example,
    selector: { ...example.selector, value },
  });
  const inspect = async (designation) =>
    JSON.parse((await agent("inspect", requestFor(designation))).stdout).value
      .object.source;
  const read = async (name) =>
    JSON.parse(await readFile(join(project, name), "utf8"));
  const write = (name, value) =>
    writeFile(join(project, name), JSON.stringify(value, null, 2) + "\n");

  await invoke(["init", project]);
  await rejectExtraToolField(agent, requestFor("PLC1"));
  const original = await inspect("PLC1");
  const equipment = await read(original.file);

  const { plc, hmiFile, hmi } = await stageFiles(
    project,
    read,
    write,
    cli,
    equipment.$schema,
  );
  assert.deepEqual(await read(original.file), equipment);
  const plcSource = await inspect("PLC1");
  const hmiSource = await inspect("HMI1");
  const { patch, relation } = starterPatch(
    example,
    plc.id,
    plcSource,
    hmiSource,
    from,
    to,
  );
  await applyStarterPatch({
    project,
    patch,
    agent,
    read,
    equipment,
    plcSource,
    hmiFile,
    hmi,
    relation,
    plc,
  });
  await cli(["validate", "."]);
  await cli(["lock", ".", "--check"]);
  await undoRegistration(
    project,
    hmiFile,
    read,
    write,
    agent,
    requestFor("HMI1"),
  );
}

async function rejectExtraToolField(agent, request) {
  const rejected = await agent("inspect", { ...request, tool: "inspect" }, 1);
  const { error } = JSON.parse(rejected.stderr);
  assert.equal(rejected.stdout, "");
  assert.equal(error.code, "A001");
  assert.equal(error.field, "/tool");
}

function parseRecipe(guide) {
  const recipe = guide.split("### Extend a starter\n")[1]?.split("\n### ")[0];
  assert(recipe?.includes("A001 at `/tool`"));
  const prose = recipe.replace(/\s+/g, " ");
  assert(
    prose.includes(
      "Write new files completely before listing them in `sources` in `system.json`.",
    ),
  );
  assert(
    prose.includes(
      "Once listed, use guarded patches for every edit, including E011 repairs, except for JSON syntax repair.",
    ),
  );
  assert(
    prose.includes(
      "remove it from `sources` in `system.json`, confirm no source glob still matches it, then delete the unregistered file.",
    ),
  );
  assert(prose.includes("`core:hmi`") && prose.includes("Local libraries"));

  const example = JSON.parse(
    /^\x60{3}json inspect-source\.request\.json\n([\s\S]*?)^\x60{3}$/m.exec(
      guide,
    )[1],
  );
  const from = JSON.parse(/"from": (\{"device": "PLC1"\})/.exec(recipe)[1]);
  const to = JSON.parse(/"to": (\{"device": "HMI1"\})/.exec(recipe)[1]);
  return { example, from, to };
}

async function stageFiles(project, read, write, cli, schema) {
  const library = "starter-extension";
  const libraryPath = "libraries/" + library;
  const manifest = await read("system.json");
  const typeFile = await read("libraries/core/types/plc-compact.json");
  const plc = typeFile.types[0];
  plc.id = library + ":plc-compact-eth";
  plc.ports = { ETH: { medium: "ethernet", connector: "unspecified" } };
  await mkdir(join(project, libraryPath));
  await write(libraryPath + "/types.json", typeFile);
  await write(libraryPath + "/library.json", {
    name: library,
    version: "0.1.0",
    sources: ["types.json"],
  });
  manifest.libraries.push({
    name: library,
    path: libraryPath,
    version: "0.1.0",
  });
  await write("system.json", manifest);
  await cli(["lock", "."]);

  const hmiFile = "devices/hmi.json";
  const hmi = {
    uid: randomUUID(),
    kind: "device",
    designation: "HMI1",
    type: "core:hmi",
  };
  await write(hmiFile, { $schema: schema, objects: [hmi] });
  manifest.sources.push(hmiFile);
  await write("system.json", manifest);
  await cli(["validate", "."]);

  return { plc, hmiFile, hmi };
}

function starterPatch(example, type, plcSource, hmiSource, from, to) {
  const guard = (source, edit) => {
    assert.equal(source.patchEligible, true);
    return {
      path: source.file,
      expectedIntegrity: source.integrity,
      operations: [
        { op: "test", path: source.pointer + "/uid", value: source.uid },
        edit,
      ],
    };
  };
  const relation = {
    uid: randomUUID(),
    kind: "relation",
    relation: "associated_with",
    from,
    to,
    connection: {
      fromPort: "ETH",
      toPort: "ETH",
      medium: "ethernet",
      protocol: "unspecified",
      status: "planned",
    },
  };
  const patch = {
    format: example.format,
    project: example.project,
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: [
      guard(plcSource, {
        op: "replace",
        path: plcSource.pointer + "/type",
        value: type,
      }),
      guard(hmiSource, { op: "add", path: "/objects/-", value: relation }),
    ],
  };
  return { patch, relation };
}

async function applyStarterPatch({
  project,
  patch,
  agent,
  read,
  equipment,
  plcSource,
  hmiFile,
  hmi,
  relation,
  plc,
}) {
  const lock = await readFile(join(project, "electrical-system.lock.json"));
  const partial = await agent(
    "apply-source-patch",
    { ...patch, files: [patch.files[1]] },
    1,
  );
  assert.equal(partial.stdout, "");
  assert(
    JSON.parse(partial.stderr).diagnostics.some(({ code }) => code === "E204"),
  );
  const dry = JSON.parse(
    (await agent("apply-source-patch", patch)).stdout,
  ).value;
  assert.equal(dry.applied, false);
  assert.deepEqual(await read(plcSource.file), equipment);
  assert.deepEqual((await read(hmiFile)).objects, [hmi]);
  const applied = JSON.parse(
    (await agent("apply-source-patch", { ...patch, dryRun: false })).stdout,
  ).value;
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.files, dry.files);
  assert.equal(
    (await read(plcSource.file)).objects.find(
      (object) => object.uid === plcSource.uid,
    ).type,
    plc.id,
  );
  assert.deepEqual((await read(hmiFile)).objects, [hmi, relation]);
  assert.deepEqual(
    await readFile(join(project, "electrical-system.lock.json")),
    lock,
  );
}

async function undoRegistration(project, hmiFile, read, write, agent, request) {
  const manifest = await read("system.json");
  assert(manifest.sources.includes(hmiFile));
  manifest.sources = manifest.sources.filter((file) => file !== hmiFile);
  await write("system.json", manifest);
  const absent = await agent("inspect", request, 1);
  assert.equal(JSON.parse(absent.stderr).error.code, "Q001");
  await rm(join(project, hmiFile));
}
