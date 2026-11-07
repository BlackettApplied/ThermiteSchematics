// Executes maintained topic examples with G1's fixture, shell and CLI-tree helpers.
// No fence may be skipped: a new shape needs a real execution recipe below.
import {
  rewriteGuideLinks,
  assertGuideLinksResolved,
} from "../src/guide-markdown.js";
import { readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { DIAGNOSTIC_CATALOG, SYMBOL_PROFILES } from "@thermite/schema";
import {
  guideCommit,
  guideDirectory,
  type GuideTopic,
} from "../src/alpha-guide.js";
import {
  copyProject,
  ctx,
  describeRun,
  editJson,
  exec,
  freshProject,
  integrity,
  makeProject,
  ok,
  readJson,
  repositoryRoot,
  scratch,
  setUpSuite,
  tearDownSuite,
  thermite,
  writeJson,
} from "./project-guide/harness.js";
import { checkCommand, splitWords } from "./project-guide/commands.js";
import { guideModel } from "./project-guide/guide-model.js";

const topics: GuideTopic[] = JSON.parse(
  readFileSync(join(repositoryRoot, "docs/topics.json"), "utf8"),
);
const documents = topics.map((topic) => ({
  topic,
  model: guideModel(readFileSync(join(repositoryRoot, topic.file), "utf8")),
}));
const jsonBlocks = (id: string) =>
  documents
    .find((d) => d.topic.id === id)!
    .model.fences.filter((f) => f.lang === "json")
    .map((f) => JSON.parse(f.body));
const wrapped = (view: unknown) => ({
  format: "schematic-packet-request/0.1",
  views: [view],
});
const compiled = new Map<string, Awaited<ReturnType<typeof compileProject>>>();
async function validate(project: string) {
  const result = await compileProject(project);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  return result;
}
async function lockAndValidate(project: string) {
  const result = await lockProject(project);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  return validate(project);
}
async function runPacket(project: string, value: any) {
  let c = compiled.get(project);
  if (!c) {
    c = await validate(project);
    compiled.set(project, c);
  }
  if (!c.ok) throw new Error("Uncompiled guide fixture");
  const result = await renderSchematicPacket(c.ir, value);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.value.sheets.length).toBeGreaterThan(0);
  return result;
}

beforeAll(setUpSuite);
afterAll(tearDownSuite);

const guideOutputs = new Map<string, ReturnType<typeof ok>>();
const guideOutput = (id: string) => {
  if (!guideOutputs.has(id)) guideOutputs.set(id, ok(["guide", id], ctx.work));
  return guideOutputs.get(id)!;
};

it("resolves the runtime documentation index offline", async () => {
  const result = await ok(["guide", "--json"], ctx.work);
  const index = JSON.parse(result.stdout);
  expect(index.map((topic: GuideTopic) => topic.id)).toEqual([
    ...topics.map((t) => t.id),
    "symbols",
    "diagnostics",
    "schema",
  ]);
  const text = (await ok(["guide"], ctx.work)).stdout;
  for (const topic of index) {
    expect(text).toContain(topic.id);
    expect(text).toContain(topic.title);
    expect(topic.tokenEstimateMethod).toBe("default-text-utf8-bytes/4-ceil");
    for (const trigger of topic.readBefore) expect(text).toContain(trigger);
    const output = await guideOutput(topic.id);
    expect(topic.approximateTokens).toBe(
      Math.ceil(Buffer.byteLength(output.stdout) / 4),
    );
  }
  expect((await ok(["guide", "--path"], ctx.work)).stdout.trim()).toBe(
    guideDirectory.replace(/[\\/]$/, ""),
  );
});

it.each(topics)(
  "resolves $id with fresh assets and pinned links",
  async (topic) => {
    const doc = await readFile(join(repositoryRoot, topic.file));
    const shipped = await readFile(
      join(guideDirectory, `${topic.id}.md`),
      "utf8",
    );
    assertGuideLinksResolved(shipped);
    const result = await guideOutput(topic.id);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      rewriteGuideLinks(doc.toString(), topic, topics, await guideCommit()),
    );
    assertGuideLinksResolved(result.stdout);
    expect(shipped).toBe(result.stdout);
    expect(result.stdout).not.toContain(repositoryRoot);
  },
);

it("build assets are fresh and the manifest has unique, non-reserved IDs", async () => {
  expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
  expect(
    topics.filter((t) => ["schema", "symbols", "diagnostics"].includes(t.id)),
  ).toEqual([]);
  expect(await readFile(join(guideDirectory, "topics.json"))).toEqual(
    await readFile(join(repositoryRoot, "docs/topics.json")),
  );
  const sources = await readJson(
    join(repositoryRoot, "packages/cli/assets/guide-source.json"),
  );
  for (const { topic, model } of documents)
    expect(sources[topic.id]).toBe(model.text);
  await ok(["--help"], ctx.work);
  const check = await exec(
    [join(repositoryRoot, "scripts/build-guide.mjs"), "--check"],
    ctx.work,
  );
  expect(check.code, check.stderr).toBe(0);
});

it("makes the core terminal scheme and cable caveats discoverable offline", async () => {
  const path = "node_modules/@thermite/core-library/README.md";
  const output = await guideOutput("libraries");
  expect(output.stdout).toContain(path);
  expect(output.stdout).toContain("empty colors mean unknown");
  const readme = await readFile(join(repositoryRoot, path), "utf8");
  expect(readme).toContain("## L2 interface conventions and limits");
  expect(readme).toContain("shield/drain");
});

it("init points users to the offline guide", async () => {
  const result = await ok(
    ["init", join(await scratch("guide-init"), "project")],
    ctx.work,
  );
  expect(result.stdout).toContain(
    "Read AGENTS.md; `thermite guide` lists reference topics.",
  );
});

it("builds fresh guide assets from an exported source archive without Git", async () => {
  const root = await scratch("guide-source-archive");
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "docs"));
  await mkdir(join(root, "packages/cli/src"), { recursive: true });
  await cp(
    join(repositoryRoot, "packages/cli/src/guide-markdown.ts"),
    join(root, "packages/cli/src/guide-markdown.ts"),
  );
  await symlink(
    join(repositoryRoot, "node_modules"),
    join(root, "node_modules"),
    "junction",
  );
  const script = join(root, "scripts/build-guide.mjs");
  await cp(join(repositoryRoot, "scripts/build-guide.mjs"), script);
  const commit = "c".repeat(40);
  await writeFile(join(root, "scripts/source-commit.txt"), `${commit}\n`);
  await writeJson(join(root, "docs/topics.json"), [
    {
      id: "fixture",
      file: "docs/fixture.md",
      title: "Fixture",
      readBefore: ["before testing"],
    },
  ]);
  await writeFile(join(root, "docs/fixture.md"), "# Fixture\n");
  let run = await exec([script], root);
  expect(run.code, run.stderr).toBe(0);
  expect(
    await readJson(join(root, "packages/cli/assets/guide/source.json")),
  ).toEqual({ commit });
  run = await exec([script, "--check"], root);
  expect(run.code, run.stderr).toBe(0);
  await writeFile(join(root, "scripts/source-commit.txt"), "$Format:%H$\n");
  run = await exec([script], root);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("THERMITE_SOURCE_COMMIT=<commit> bun run build");
  await writeFile(join(root, "scripts/source-commit.txt"), `${commit}\n`);
  await writeFile(
    join(root, "scripts/source-commit.txt"),
    `${"d".repeat(40)}\n`,
  );
  run = await exec([script, "--check"], root);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("Stale guide asset: source.json");
  await writeFile(join(root, "scripts/source-commit.txt"), `${commit}\n`);
  await writeFile(join(root, "docs/fixture.md"), "# Changed\n");
  run = await exec([script, "--check"], root);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("Stale guide asset: fixture.md");
});

it("names every repository optional library and truthfully marks each unshipped", async () => {
  const actual: string[] = [];
  for (const name of await readdir(join(repositoryRoot, "libraries"))) {
    const manifest = await readJson(
      join(repositoryRoot, "libraries", name, "library.json"),
    ).catch(() => null);
    if (manifest) actual.push(manifest.name);
  }
  expect(actual).toHaveLength(11);
  const doc = documents.find(({ topic }) => topic.id === "libraries")!.model
    .text;
  const listed = [...doc.matchAll(/^\| \`([^\`]+)\` \| No \|$/gm)].map(
    (m) => m[1],
  );
  expect(listed.sort()).toEqual(actual.sort());
});
it("documents the packet view formats declared by the accepted request types", async () => {
  const sources = await Promise.all(
    [
      "render/src/types.ts",
      "render/src/communication.ts",
      "render/src/connector-assembly.ts",
      "render/src/signal-loop.ts",
      "render/src/wiring.ts",
      "render/src/circuit.ts",
      "query/src/documentation.ts",
    ].map((file) => readFile(join(repositoryRoot, "packages", file), "utf8")),
  );
  const formats = [
    ...new Set(
      sources.flatMap((source) =>
        [
          ...source.matchAll(/readonly format: "([^"\n]*-request\/[^"\n]+)"/g),
        ].map((m) => m[1]!),
      ),
    ),
  ];
  const views = documents.find(({ topic }) => topic.id === "views")!.model.text;
  for (const format of formats) expect(views).toContain(`\`${format}\``);
  expect(formats).toHaveLength(8);
});

it("uses the schema catalogs without a second catalog", async () => {
  expect(
    JSON.parse((await ok(["guide", "symbols", "--json"], ctx.work)).stdout),
  ).toEqual(SYMBOL_PROFILES);
  expect((await guideOutput("symbols")).stdout).toContain("thermite:io-module");
  expect(
    JSON.parse((await ok(["guide", "diagnostics", "--json"], ctx.work)).stdout),
  ).toEqual(DIAGNOSTIC_CATALOG);
  expect(
    JSON.parse(
      (await ok(["guide", "diagnostics", "W903", "--json"], ctx.work)).stdout,
    ),
  ).toEqual({ W903: DIAGNOSTIC_CATALOG.W903 });
  expect(
    JSON.parse(
      (await ok(["guide", "diagnostics", "w903", "--json"], ctx.work)).stdout,
    ),
  ).toEqual({ W903: DIAGNOSTIC_CATALOG.W903 });
  expect(
    (await ok(["guide", "diagnostics", "W903"], ctx.work)).stdout,
  ).toContain(DIAGNOSTIC_CATALOG.W903.meaning);
});

it("rejects unknown topics/codes, path traversal and malformed options with exit 2", async () => {
  for (const args of [
    ["not-a-topic"],
    ["../modeling"],
    ["diagnostics", "W000"],
    ["diagnostics", "toString"],
    ["modeling", "--json"],
    ["--path", "modeling"],
    ["--bogus"],
  ]) {
    const result = await thermite(["guide", ...args], ctx.work);
    expect(result.code, describeRun(args, result)).toBe(2);
    expect(result.stdout).toBe("");
  }
  const unknown = await thermite(["guide", "unknown"], ctx.work);
  for (const topic of topics) expect(unknown.stderr).toContain(topic.id);
});

it("rewrites topic, source and anchor links using source and runtime provenance", async () => {
  const sample =
    "[requests](agent-requests.md#query) [engine](../CONTRIBUTING.md#checks-and-releases) [anchor](#local) [web](https://example.org/a)";
  const a = "a".repeat(40),
    b = "b".repeat(40);
  for (const commit of [a, b]) {
    const output = rewriteGuideLinks(sample, topics[1]!, topics, commit);
    expect(output).toBe(
      `requests (\`thermite guide agent-requests\`, section \`query\`) [engine](https://github.com/BlackettApplied/ThermiteSchematics/blob/${commit}/CONTRIBUTING.md#checks-and-releases) [anchor](#local) [web](https://example.org/a)`,
    );
  }
});

// Every command token in prose and shell blocks is checked against G1's live tree.
function commandProblems(text: string) {
  const normalized = text.replace(
    /bun (?:"\$thermite_entry"|\S*thermite\.mjs)/g,
    "thermite",
  );
  return [
    ...normalized.matchAll(/\bthermite ([a-z][\w-]*)([^\n`]*)(?:`|$)/gm),
  ].flatMap((m) =>
    checkCommand(
      splitWords(`${m[1]}${m[2]}`.replace(/ < \S+$/, ""), false).words,
      m[0],
      true,
    ),
  );
}
it.each(documents)(
  "checks all command/flag tokens in $topic.id",
  ({ model }) => {
    expect(commandProblems(model.text)).toEqual([]);
  },
);
it("rejects new unexecutable shapes and fake CLI flags", async () => {
  await expect(
    executeJson("unclassified", { shape: "unknown" }),
  ).rejects.toThrow("Unexecutable unclassified JSON");
  expect(commandProblems("`thermite view PS1 --imaginary-flag`")).toEqual([
    expect.stringContaining("unknown option --imaginary-flag"),
  ]);
  expect(commandProblems("`thermite made-up --json`")).toEqual([
    expect.stringContaining("unknown command made-up"),
  ]);
});

// The fixture setup comes from the existing signal-loop test convention. Only
// inputs are copied; all locks, diagnostics and drawings are produced by the CLI.
const loops = new Map<boolean, Promise<string>>();
async function loopProject(output: boolean): Promise<string> {
  if (!loops.has(output)) loops.set(output, makeLoopProject(output));
  return loops.get(output)!;
}
async function makeLoopProject(output: boolean) {
  const project = await makeProject({
    name: output ? "analog-output" : "signal-loop",
    copy: {
      "field-interfaces": "libraries/field-interfaces",
      "industrial-pilot": "libraries/industrial-pilot",
      "source.json": `packages/cli/fixtures/${output ? "analog-output" : "signal-loop"}/source.json`,
    },
    json: {
      "system.json": {
        format: "electrical-system/0.1",
        project: { name: "Guide hookup fixture" },
        sources: ["source.json"],
        libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
          name,
          version: "0.1.0",
          path: name,
        })),
      },
    },
  });
  await lockAndValidate(project);
  return project;
}
async function addObject(project: string, object: unknown) {
  const path = join(project, "guide-object.json");
  const file = await readJson(path).catch(() => ({ objects: [] }));
  await editJson(join(project, "system.json"), (m) => {
    if (!m.sources.includes("guide-object.json"))
      m.sources.push("guide-object.json");
  });
  file.objects.push(object);
  await writeJson(path, file);
  await validate(project);
}

async function executeJson(id: string, value: any): Promise<void> {
  if (
    value.format === "schematic-packet-request/0.1" ||
    value.format?.endsWith("view-request/0.1")
  ) {
    let project: string;
    const view = value.views?.[0] ?? value;
    if (view.format === "signal-loop-view-request/0.1")
      project = await loopProject(view.from.device === "AQ1");
    else if (value.family)
      project = await copyProject(
        join(repositoryRoot, "examples/motor-starter"),
      );
    else project = await freshProject("starter");
    if (id === "report-filtering") project = await filterProject();
    await runPacket(project, value.views ? value : wrapped(value));
    return;
  }
  if (id === "modeling") {
    const project = await freshProject(
      value.kind === "cable" ? "cabinets" : "starter",
    );
    if (value.format?.startsWith("project-presentation/")) {
      await writeJson(join(project, "presentation.json"), value);
      await validate(project);
    } else if (value.kind === "relation") {
      await addObject(
        await copyProject(join(repositoryRoot, "examples/motor-starter")),
        value,
      );
    } else if (value.kind === "potential") {
      await editJson(join(project, "potentials/potentials.json"), (file) => {
        file.objects = file.objects.filter((o: any) => o.name !== value.name);
        file.objects.push(value);
      });
      await validate(project);
    } else if (value.kind === "wire" || value.device) {
      await addObject(
        project,
        jsonBlocks("modeling").find((v) => v.kind === "device"),
      );
      await addObject(
        project,
        value.device
          ? {
              uid: "0195f2cc-9999-7123-8123-123456789abc",
              kind: "wire",
              designation: "W-GUIDE",
              endpoints: [value, { device: "PLC1", terminal: "X2.0" }],
            }
          : value,
      );
    } else if (value.io) {
      await editJson(join(project, "devices/equipment.json"), (file) =>
        Object.assign(
          file.objects.find((o: any) => o.designation === "PLC1"),
          value,
        ),
      );
      await validate(project);
    } else if (value.kind) await addObject(project, value);
    else
      throw new Error(`Unexecutable modeling shape: ${JSON.stringify(value)}`);
    return;
  }
  if (id === "libraries") {
    const project = await freshProject("starter");
    if (Array.isArray(value)) {
      await editJson(join(project, "system.json"), (m) => {
        m.libraries = value;
      });
      await writeJson(join(project, "libraries/plant/library.json"), {
        name: "plant-library",
        version: "1.0.0",
        sources: ["types.json"],
      });
      await writeJson(join(project, "libraries/plant/types.json"), {
        types: [
          {
            kind: "device_type",
            id: "plant-library:interface",
            terminals: { P: {} },
            functions: { p: { kind: "bus", terminals: ["P"] } },
          },
        ],
      });
    } else {
      await writeJson(
        join(project, "libraries/core/types/contactor-3p-1no.json"),
        { types: [value] },
      );
      await addObjectWithoutValidation(project, {
        uid: "0195f2cc-1234-7123-8123-123456789abc",
        kind: "device",
        designation: "K1",
        type: value.id,
      });
    }
    await lockAndValidate(project);
    return;
  }
  if (id === "completeness") {
    const project = await freshProject("starter");
    const fragment = jsonBlocks("completeness").find((v) => v.terminals);
    await writeJson(join(project, "libraries/core/types/guide-review.json"), {
      types: [
        {
          kind: "device_type",
          id: "core:guide-review",
          ...fragment,
          functions: {},
          ports: {
            ETH1: { medium: "ethernet", connector: "RJ45" },
            ETH2: { medium: "ethernet", connector: "RJ45" },
          },
        },
      ],
    });
    await addObjectWithoutValidation(project, {
      kind: "device",
      uid: "0195f2cc-7777-7123-8123-123456789abc",
      designation: "G1",
      type: "core:guide-review",
      ...(value.connectionReview ? value : {}),
    });
    await lockAndValidate(project);
    return;
  }
  if (value.circuitSymbols) {
    const project = await freshProject("starter");
    const contact = (a: string, b: string, state: string) => ({
      kind: "contact",
      terminals: [a, b],
      normal_state: state,
    });
    // Five explicitly declared synthetic contacts satisfy the documented fragment.
    const functions = Object.fromEntries(
      Object.keys(value.circuitSymbols).map((key, i) => [
        key,
        contact(
          `${i}a`,
          `${i}b`,
          value.circuitSymbols[key].endsWith("-nc") ? "closed" : "open",
        ),
      ]),
    );
    await writeJson(join(project, "libraries/core/types/guide.json"), {
      types: [
        {
          kind: "device_type",
          id: "core:guide-symbols",
          ...value,
          functions,
          terminals: Object.fromEntries(
            Object.values(functions)
              .flatMap((f) => f.terminals)
              .map((key) => [key, {}]),
          ),
        },
      ],
    });
    await addObjectWithoutValidation(project, {
      uid: "0195f2cc-1234-7123-8123-123456789abc",
      kind: "device",
      designation: "G1",
      type: "core:guide-symbols",
    });
    await lockAndValidate(project);
    await runPacket(
      project,
      wrapped({
        format: "circuit-view-request/0.1",
        title: "Synthetic symbol fragment",
        groups: [
          {
            id: "guide",
            functions: Object.keys(functions).map((key) => ({
              device: { by: "designation", value: "G1" },
              key,
            })),
            conductors: [],
          },
        ],
      }),
    );
    return;
  }
  if (id === "views" && value.format?.startsWith("project-presentation/")) {
    const project = await freshProject("starter");
    await writeJson(join(project, "presentation.json"), value);
    await ok(["view", "PS1", "--loads", "--json"], project);
    return;
  }
  if (id === "report-filtering" && value.locations) {
    await runPacket(
      await filterProject(),
      wrapped({
        format: "documentation-view-request/0.1",
        kind: "bom",
        filter: value,
      }),
    );
    return;
  }
  throw new Error(`Unexecutable ${id} JSON: ${JSON.stringify(value)}`);
}
async function executeModelingExamples() {
  const values = jsonBlocks("modeling");
  const project = await freshProject("starter");
  const deviceExamples = values.filter((v) => v.kind === "device");
  await addObject(project, deviceExamples[0]);
  // The second device block is the same occurrence, with a location added.
  await writeJson(join(project, "guide-object.json"), {
    objects: [deviceExamples[1]],
  });
  await validate(project);
  const wire = values.find((v) => v.kind === "wire");
  const endpoint = values.find((v) => v.device);
  expect(wire.endpoints).toContainEqual(endpoint);
  for (const wireExample of values.filter((v) => v.kind === "wire"))
    await addObject(project, wireExample);
  const assignment = values.find((v) => v.io);
  await editJson(join(project, "devices/equipment.json"), (file) =>
    Object.assign(
      file.objects.find((o: any) => o.designation === "PLC1"),
      assignment,
    ),
  );
  const potential = values.find((v) => v.kind === "potential");
  await editJson(join(project, "potentials/potentials.json"), (file) => {
    file.objects = file.objects.filter((o: any) => o.name !== potential.name);
    file.objects.push(potential);
  });
  await writeJson(
    join(project, "presentation.json"),
    values.find((v) => v.format),
  );
  const covered = new Set([
    ...deviceExamples,
    ...values.filter((v) => v.kind === "wire"),
    endpoint,
    assignment,
    potential,
    values.find((v) => v.format),
    values.find((v) => v.kind === "cable"),
    values.find((v) => v.kind === "relation"),
  ]);
  expect(
    values.filter((value) => !covered.has(value)),
    "unexecuted modeling blocks",
  ).toEqual([]);
  const result = await validate(project);
  // Starter feed deferrals remain honest. The added coil/output net has no
  // authored potential, so I304 discloses that assessment limit.
  expect(
    result.diagnostics
      .filter((d) => d.code !== "I304")
      .map((d) => [d.code, d.uid]),
  ).toEqual(
    (await validate(ctx.pristine.starter)).diagnostics
      .filter((d) => d.code !== "I304")
      .map((d) => [d.code, d.uid]),
  );
  expect(
    result.diagnostics.filter((d) => d.code === "I304").length,
  ).toBeLessThanOrEqual(1);
  // Negative control reproduces the old contradictory spare/unused assignment.
  const old = structuredClone(assignment);
  old.io.channels.do0 = old.io.channels.do1;
  delete old.io.channels.do1;
  old.connectionReview.terminals["X2.0"] =
    old.connectionReview.terminals["X2.1"];
  delete old.connectionReview.terminals["X2.1"];
  await editJson(join(project, "devices/equipment.json"), (file) =>
    Object.assign(
      file.objects.find((o: any) => o.designation === "PLC1"),
      old,
    ),
  );
  expect(
    (await validate(project)).diagnostics.some(
      (d) => d.code === "W905" && d.message.includes("PLC1.X2.0"),
    ),
  ).toBe(true);
  await executeJson(
    "modeling",
    values.find((v) => v.kind === "cable"),
  );
  await executeJson(
    "modeling",
    values.find((v) => v.kind === "relation"),
  );
}

async function addObjectWithoutValidation(project: string, value: unknown) {
  await editJson(join(project, "system.json"), (m) =>
    m.sources.push("guide-object.json"),
  );
  await writeJson(join(project, "guide-object.json"), { objects: [value] });
}
let filterFixture: Promise<string> | undefined;
async function filterProject() {
  return (filterFixture ??= makeFilterProject());
}
async function makeFilterProject() {
  const project = await copyProject(
    join(repositoryRoot, "examples/report-filtering"),
  );
  // The maintained doc uses an illustrative excluded type. Define exactly that
  // library-qualified ID in a small local library so unknown selectors still fail.
  await writeJson(join(project, "example/library.json"), {
    name: "example",
    version: "0.1.0",
    sources: ["types.json"],
  });
  await writeJson(join(project, "example/types.json"), {
    types: [
      {
        kind: "device_type",
        id: "example:documentary-node",
        terminals: { P: {} },
        functions: { p: { kind: "bus", terminals: ["P"] } },
      },
    ],
  });
  await editJson(join(project, "system.json"), (m) =>
    m.libraries.push({ name: "example", version: "0.1.0", path: "example" }),
  );
  await editJson(join(project, "source.json"), (file) => {
    file.objects.find((o: any) => o.designation === "PLC1").location =
      "Main cabinet";
  });
  await lockAndValidate(project);
  return project;
}

async function shellLine(line: string, project: string, id: string) {
  // Substitute only launcher and project placeholders, never request contents.
  const normalized = line
    .replace(/^bun (?:"\$thermite_entry"|\S*thermite\.mjs) /, "thermite ")
    .replace(/--project <project>/, "--project .");
  const redirect = / --input - < (\S+)$/.exec(normalized);
  const clean = redirect ? normalized.replace(/ < \S+$/, "") : normalized;
  const words = splitWords(clean, false).words;
  if (words[0] === "bun" && words[1] === "-e") {
    const run = await exec(words.slice(1), project);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(
      integrity(await readFile(join(project, words.at(-1)!))),
    );
    return;
  }
  if (words[0] !== "thermite")
    throw new Error(`Unexecutable ${id} shell: ${line}`);
  expect(checkCommand(words.slice(1), line)).toEqual([]);
  const run = await thermite(
    words.slice(1),
    project,
    redirect ? await readFile(join(project, redirect[1]!), "utf8") : undefined,
  );
  expect(run.code, describeRun(words, run)).toBe(0);
  const outputAt = words.findIndex(
    (word) => word === "-o" || word === "--output",
  );
  if (outputAt >= 0)
    expect(
      (await readFile(join(project, words[outputAt + 1]!))).length,
    ).toBeGreaterThan(0);
}

it.each(documents.filter(({ topic }) => topic.id !== "agent-requests"))(
  "executes every json/sh fence in $topic.id",
  async ({ topic, model }) => {
    const fences = model.fences.filter((f) => ["json", "sh"].includes(f.lang));
    expect(fences.length).toBeGreaterThan(0);
    if (topic.id === "modeling") return executeModelingExamples();
    for (const fence of fences) {
      if (fence.lang === "json")
        await executeJson(topic.id, JSON.parse(fence.body));
      else {
        const project =
          topic.id === "signal-loops"
            ? await loopProject(false)
            : topic.id === "report-filtering"
              ? await filterProject()
              : await freshProject("starter");
        if (["views", "circuit-views", "signal-loops"].includes(topic.id)) {
          const request = jsonBlocks(topic.id).find(
            (v) => v.format === "schematic-packet-request/0.1",
          );
          const name =
            topic.id === "views"
              ? "packet.json"
              : topic.id === "circuit-views"
                ? "circuit.request.json"
                : "loop.request.json";
          await writeJson(join(project, name), request);
        }
        if (topic.id === "report-filtering")
          await writeJson(
            join(project, "main.filter.json"),
            jsonBlocks(topic.id)[0],
          );
        await mkdir(join(project, "drawings"), { recursive: true });
        await mkdir(join(project, "output"), { recursive: true });
        for (const line of fence.body.split("\n").filter((line) => line.trim()))
          await shellLine(line, project, topic.id);
      }
    }
  },
  120000,
);

it("explains R007 remedies for SVG and packet HTML in the offline guide", async () => {
  const r = await ok(["guide", "diagnostics", "R007"], ctx.work);
  expect(r.stdout).toContain("For SVG, export .html or .pdf instead");
  expect(r.stdout).toContain("for packet HTML, export .pdf instead");
  expect(r.stdout).toContain("without writing the requested file");
});
