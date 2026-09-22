import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format as formatWithPrettier } from "prettier";

import { runCli } from "../packages/cli/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = join(repositoryRoot, "examples", "motor-starter");
const cliGoldenRoot = join(
  repositoryRoot,
  "packages",
  "cli",
  "test",
  "goldens",
);
const renderGoldenRoot = join(
  repositoryRoot,
  "packages",
  "render",
  "test",
  "goldens",
);

const baselineCases = Object.freeze([
  {
    slug: "render-k1-control-left-to-right",
    args: ["render", "K1", "--family", "control"],
    renderer: "motor-starter/k1-control-left-to-right.svg",
  },
  {
    slug: "render-m1-power-left-to-right",
    args: ["render", "M1", "--family", "power"],
    renderer: "motor-starter/m1-power-left-to-right.svg",
  },
  {
    slug: "view-m1-power-left-to-right",
    args: ["view", "M1", "--power"],
  },
  {
    slug: "view-k1-actuation-left-to-right",
    args: ["view", "K1", "--actuation"],
  },
  {
    slug: "view-ls1-to-plc1-include-power-left-to-right",
    args: ["view", "LS1", "--to", "PLC1", "--include-power"],
    renderer: "motor-starter/ls1-to-plc1-include-power-left-to-right.svg",
  },
  {
    slug: "view-cbl1-conductors-left-to-right",
    args: ["view", "CBL1", "--conductors"],
    renderer: "motor-starter/cbl1-conductors-left-to-right.svg",
  },
  {
    slug: "view-ps1-loads-left-to-right",
    args: ["view", "PS1", "--loads"],
    renderer: "motor-starter/ps1-loads-left-to-right.svg",
  },
]);

const pnpCases = Object.freeze([
  {
    slug: "view-k1-actuation-left-to-right",
    args: ["view", "K1", "--actuation"],
    renderer: "motor-starter-pnp/k1-control-left-to-right.svg",
  },
  {
    slug: "view-ls1-to-plc1-include-power-left-to-right",
    args: ["view", "LS1", "--to", "PLC1", "--include-power"],
    renderer: "motor-starter-pnp/ls1-to-plc1-include-power-left-to-right.svg",
  },
  {
    slug: "view-cbl1-conductors-left-to-right",
    args: ["view", "CBL1", "--conductors"],
    renderer: "motor-starter-pnp/cbl1-conductors-left-to-right.svg",
  },
  {
    slug: "view-ps1-loads-left-to-right",
    args: ["view", "PS1", "--loads"],
    renderer: "motor-starter-pnp/ps1-loads-left-to-right.svg",
  },
]);

const viewSpec = Object.freeze({
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "LS1" },
  intent: {
    kind: "trace",
    to: { by: "designation", value: "PLC1" },
    includePower: true,
  },
  flow: "left-to-right",
});

const completePatchRequest = Object.freeze({
  format: "agent-tool-request/0.1",
  project: ".",
  patchFormat: "json-patch/0.1",
  dryRun: false,
  files: [
    {
      path: "devices/equipment.json",
      expectedIntegrity: "sha256-NORh7LZPQdPLk7cGwHOwZjAjADVy+YVsJJEU13oOx7Y=",
      operations: [
        {
          op: "test",
          path: "/objects/8/uid",
          value: "596f728b-1445-4c4b-8974-a3b4ea703636",
        },
        {
          op: "test",
          path: "/objects/8/type",
          value: "core:limit-switch-2wire",
        },
        {
          op: "replace",
          path: "/objects/8/type",
          value: "core:prox-pnp-3wire",
        },
        {
          op: "test",
          path: "/objects/8/description",
          value: "Normally open field limit switch permissive",
        },
        {
          op: "replace",
          path: "/objects/8/description",
          value: "Three-wire PNP field proximity sensor permissive",
        },
      ],
    },
    {
      path: "connections/field-terminations.json",
      expectedIntegrity: "sha256-uH5wquZl1n/aAVaxmhG7cdvaUl7sOUBVYKjQOaYKvmE=",
      operations: [
        {
          op: "test",
          path: "/objects/1/uid",
          value: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
        },
        {
          op: "test",
          path: "/objects/1/endpoints/1/terminal",
          value: "13",
        },
        {
          op: "replace",
          path: "/objects/1/endpoints/1/terminal",
          value: "1",
        },
        {
          op: "test",
          path: "/objects/2/uid",
          value: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
        },
        {
          op: "test",
          path: "/objects/2/endpoints/0/terminal",
          value: "14",
        },
        {
          op: "replace",
          path: "/objects/2/endpoints/0/terminal",
          value: "4",
        },
        {
          op: "test",
          path: "/objects/2/properties/label",
          value: "LS1-SWITCHED-RETURN",
        },
        {
          op: "replace",
          path: "/objects/2/properties/label",
          value: "LS1-PNP-OUT-PLC1-DI0",
        },
        {
          op: "test",
          path: "/objects/3/uid",
          value: "7bdee01c-ec15-4747-9208-ee650da1e681",
        },
        {
          op: "add",
          path: "/objects/3",
          value: {
            uid: "4afbc8b2-5bd7-4b92-8f9d-dcf124b85d01",
            kind: "wire",
            designation: "W-FLD-004",
            endpoints: [
              { device: "JB1", terminal: "X1.3" },
              { device: "LS1", terminal: "3" },
            ],
            properties: {
              label: "0V-JB1-LS1",
              size: "18AWG",
              color: "blue/white",
            },
          },
        },
      ],
    },
  ],
});

function posixPath(path) {
  return path.replaceAll(String.fromCharCode(92), "/");
}

function destination(path) {
  return posixPath(relative(repositoryRoot, path));
}

async function invoke(args, options = {}) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    ...options,
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return {
    exitCode,
    stdout: Buffer.from(stdout, "utf8"),
    stderr: Buffer.from(stderr, "utf8"),
  };
}

function inputStream(bytes) {
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

async function invokeAgent(cwd, tool, request) {
  const bytes = Buffer.from(
    `${JSON.stringify(request, undefined, 2)}\n`,
    "utf8",
  );
  return invoke(["agent", tool, "--input", "-"], {
    cwd,
    agentStdin: inputStream(bytes),
  });
}

function requireSuccess(invocation, context) {
  if (invocation.exitCode !== 0) {
    throw new Error(
      `${context} failed with exit ${invocation.exitCode}: ${invocation.stderr.toString("utf8")}`,
    );
  }
}

async function addCliCase(candidates, rootName, project, testCase) {
  const relativeRoot = join(cliGoldenRoot, rootName);
  const raw = await invoke([...testCase.args, "--project", project]);
  const json = await invoke([...testCase.args, "--project", project, "--json"]);
  requireSuccess(raw, `${rootName}/${testCase.slug} raw`);
  requireSuccess(json, `${rootName}/${testCase.slug} JSON`);
  if (raw.stderr.length !== 0) {
    throw new Error(`${rootName}/${testCase.slug} raw stderr is not empty.`);
  }
  const report = JSON.parse(json.stderr.toString("utf8"));
  if (
    JSON.stringify(report) !== JSON.stringify({ diagnostics: [], error: null })
  ) {
    throw new Error(`${rootName}/${testCase.slug} JSON report changed.`);
  }
  candidates.set(
    destination(join(relativeRoot, `${testCase.slug}.stdout.svg`)),
    raw.stdout,
  );
  candidates.set(
    destination(join(relativeRoot, `${testCase.slug}.stdout.json`)),
    json.stdout,
  );
  if (testCase.renderer !== undefined) {
    candidates.set(
      destination(join(renderGoldenRoot, testCase.renderer)),
      raw.stdout,
    );
  }
}

function viewRequest(root = "LS1") {
  return {
    format: "agent-tool-request/0.1",
    project: ".",
    spec: {
      ...viewSpec,
      root: { by: "designation", value: root },
    },
  };
}

async function jsonFiles(root) {
  const paths = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) paths.push(path);
      else if (!entry.isFile()) {
        throw new Error(
          `Task 4 updater rejected non-file project entry ${path}.`,
        );
      }
    }
  }
  await visit(root);
  return paths;
}

function replaceExactStrings(value, before, after) {
  if (typeof value === "string") return value === before ? after : value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceExactStrings(item, before, after));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceExactStrings(item, before, after),
      ]),
    );
  }
  return value;
}

async function mutateProject(root, mutate) {
  for (const path of await jsonFiles(root)) {
    if (path.endsWith("electrical-system.lock.json")) continue;
    const value = JSON.parse(await readFile(path, "utf8"));
    const changed = mutate(value, posixPath(relative(root, path)));
    await writeFile(path, `${JSON.stringify(changed, undefined, 2)}\n`, "utf8");
  }
}

function expectedR005(error) {
  return Buffer.from(
    `${JSON.stringify(
      {
        format: "agent-tool-report/0.1",
        tool: "create-view",
        diagnostics: [],
        error,
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
}

async function addR005Case(candidates, temporaryRoot, testCase) {
  const project = join(temporaryRoot, `r005-${testCase.slug}`);
  await cp(exampleRoot, project, { recursive: true, dereference: true });
  await mutateProject(project, testCase.mutate);
  const invocation = await invokeAgent(
    project,
    "create-view",
    viewRequest(testCase.requestRoot),
  );
  if (invocation.exitCode !== 1 || invocation.stdout.length !== 0) {
    throw new Error(
      `${testCase.slug} did not produce exit 1 and empty stdout.`,
    );
  }
  const expected = expectedR005(testCase.error);
  if (!invocation.stderr.equals(expected)) {
    throw new Error(`${testCase.slug} R005 stderr bytes changed.`);
  }
  const root = join(cliGoldenRoot, "m8-r005");
  candidates.set(
    destination(join(root, `${testCase.slug}.stdout.txt`)),
    invocation.stdout,
  );
  candidates.set(
    destination(join(root, `${testCase.slug}.stderr.json`)),
    invocation.stderr,
  );
}

const r005Cases = Object.freeze([
  {
    slug: "project-empty",
    requestRoot: "LS1",
    mutate(value, path) {
      if (path === "system.json") value.project.name = "";
      return value;
    },
    error: {
      code: "R005",
      message:
        "Invalid render text: project project field project.name is empty.",
      family: "control",
      ownerKind: "project",
      ownerId: "project",
      field: "project.name",
      reason: "empty-string",
      root: "LS1",
    },
  },
  {
    slug: "view-single-line",
    requestRoot: "LS1\u2028BROKEN",
    mutate(value) {
      return replaceExactStrings(value, "LS1", "LS1\u2028BROKEN");
    },
    error: {
      code: "R005",
      message:
        "Invalid render text: view normalized-view field title.view-line contains forbidden-single-line-code-point.",
      family: "control",
      ownerKind: "view",
      ownerId: "normalized-view",
      field: "title.view-line",
      reason: "forbidden-single-line-code-point",
      root: "LS1\u2028BROKEN",
    },
  },
  {
    slug: "presentation-surrogate",
    requestRoot: "LS1",
    mutate(value, path) {
      if (path === "presentation.json") value.titleBlock.lines = ["\ud800"];
      return value;
    },
    error: {
      code: "R005",
      message:
        "Invalid render text: presentation presentation.titleBlock.lines[0] field title.authored-line contains unpaired-surrogate.",
      family: "control",
      ownerKind: "presentation",
      ownerId: "presentation.titleBlock.lines[0]",
      field: "title.authored-line",
      reason: "unpaired-surrogate",
      root: "LS1",
    },
  },
]);

async function generate() {
  const candidates = new Map();
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-task4-"),
  );
  try {
    const project = join(temporaryRoot, "motor-starter-pnp");
    await cp(exampleRoot, project, { recursive: true, dereference: true });

    for (const testCase of baselineCases) {
      await addCliCase(candidates, "motor-starter", exampleRoot, testCase);
    }
    const baselineView = await invokeAgent(
      project,
      "create-view",
      viewRequest(),
    );
    requireSuccess(baselineView, "baseline agent view");
    candidates.set(
      destination(
        join(cliGoldenRoot, "motor-starter-agent", "baseline-view.stdout.json"),
      ),
      baselineView.stdout,
    );

    const patched = await invokeAgent(
      project,
      "apply-source-patch",
      completePatchRequest,
    );
    requireSuccess(patched, "complete PNP source patch");
    for (const testCase of pnpCases) {
      await addCliCase(candidates, "motor-starter-pnp", project, testCase);
    }
    const pnpView = await invokeAgent(project, "create-view", viewRequest());
    requireSuccess(pnpView, "PNP agent view");
    candidates.set(
      destination(
        join(cliGoldenRoot, "motor-starter-agent", "pnp-view.stdout.json"),
      ),
      pnpView.stdout,
    );

    for (const testCase of r005Cases) {
      await addR005Case(candidates, temporaryRoot, testCase);
    }
    return candidates;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function task4LedgerPaths(candidates) {
  return [...candidates.keys()].filter((path) => !path.includes("/m8-r005/"));
}

async function expectedTask4LedgerPaths() {
  const manifest = JSON.parse(
    await readFile(
      join(repositoryRoot, "scripts", "m8-golden-migration.json"),
      "utf8",
    ),
  );
  const task2 = new Set([
    "examples/motor-starter/electrical-system.lock.json",
    "packages/compiler/test/goldens/motor-starter.ir.json",
    "packages/cli/test/goldens/motor-starter-agent/type-only-patch.stderr.json",
  ]);
  return manifest
    .filter(
      ({ path, classification }) =>
        classification === "regenerate" && !task2.has(path),
    )
    .map(({ path }) => path)
    .sort();
}

async function assertR005PrettierIdentity() {
  for (const testCase of r005Cases) {
    const path = join(cliGoldenRoot, "m8-r005", `${testCase.slug}.stderr.json`);
    const before = await readFile(path, "utf8");
    const formatted = await formatWithPrettier(before, { filepath: path });
    if (formatted !== before) {
      throw new Error(
        `Prettier changes ignored R005 fixture ${destination(path)}.`,
      );
    }
  }
}

export async function updateTask4Goldens(mode) {
  if (mode !== "--write" && mode !== "--check") {
    throw new Error(
      "Usage: node scripts/update-task4-goldens.mjs --write|--check",
    );
  }
  const candidates = await generate();
  const assigned = task4LedgerPaths(candidates).sort();
  const expectedAssigned = await expectedTask4LedgerPaths();
  if (
    assigned.length !== 33 ||
    candidates.size !== 39 ||
    JSON.stringify(assigned) !== JSON.stringify(expectedAssigned)
  ) {
    throw new Error(
      `Task 4 updater generated ${assigned.length} ledger paths and ${candidates.size - assigned.length} R005 paths.`,
    );
  }
  for (const [path, bytes] of candidates) {
    const absolute = join(repositoryRoot, ...path.split("/"));
    if (mode === "--write") {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
    } else {
      const current = await readFile(absolute);
      if (!current.equals(bytes)) {
        throw new Error(`Task 4 golden differs: ${path}.`);
      }
    }
  }
  await assertR005PrettierIdentity();
  return Object.freeze({
    mode: mode.slice(2),
    ledgerPaths: assigned.length,
    r005Paths: candidates.size - assigned.length,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3) {
      throw new Error(
        "Usage: node scripts/update-task4-goldens.mjs --write|--check",
      );
    }
    const result = await updateTask4Goldens(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
