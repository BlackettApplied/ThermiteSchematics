import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  compileProject,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import {
  createQueryEngine,
  serializeQueryResult,
  type QueryCommandResult,
  type QueryError,
} from "@thermite/query";
import type { Diagnostic } from "@thermite/schema";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  formatHumanDiagnostics,
  runCli,
  type RunCliOptions,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const queryProject = join(packageRoot, "fixtures", "query project");
const queryLibrary = join(packageRoot, "fixtures", "query library");
const ruleFixtureRoot = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "rules",
);
const cliModuleUrl = pathToFileURL(join(packageRoot, "dist", "index.js")).href;
const compilerModuleUrl = pathToFileURL(
  join(repositoryRoot, "packages", "compiler", "dist", "index.js"),
).href;
const temporaryRoots: string[] = [];

interface Invocation {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let queryIr: ElectricalIr;

beforeAll(async () => {
  const compiled = await compileProject(queryProject);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  queryIr = compiled.ir;
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function invoke(
  args: readonly string[],
  options: Omit<RunCliOptions, "stdout" | "stderr"> = {},
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    ...options,
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

async function subprocess(args: readonly string[]): Promise<Invocation> {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(
      process.execPath,
      [join(packageRoot, "dist", "bin.js"), ...args],
      {
        cwd: repositoryRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", rejectInvocation);
    child.once("close", (exitCode, signal) => {
      if (signal !== null || exitCode === null) {
        rejectInvocation(new Error(`query subprocess failed: ${signal}`));
      } else {
        resolveInvocation({ exitCode, stdout, stderr });
      }
    });
  });
}

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

function report(
  diagnostics: readonly Diagnostic[],
  error: QueryError | null,
): string {
  return `${JSON.stringify({ diagnostics, error }, undefined, 2)}\n`;
}

const corruptIrDiagnostic: Diagnostic = {
  code: "E001",
  severity: "error",
  message:
    "Query tool failure (Invalid ElectricalIr: terminalIdsByDeviceUid has an incorrect number of entries.).",
  file: "system.json",
  line: 1,
  column: 1,
  jsonPointer: "",
};

async function copyQueryFixture(): Promise<{
  root: string;
  project: string;
  library: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "thermite-schematics-query-cli-"));
  temporaryRoots.push(root);
  const project = join(root, "query project");
  const library = join(root, "query library");
  await Promise.all([
    cp(queryProject, project, { recursive: true }),
    cp(queryLibrary, library, { recursive: true }),
  ]);
  return { root, project, library };
}

async function expectCompilerStopsQuery(
  project: string,
  diagnostics: readonly Diagnostic[],
  exitCode: 1 | 2,
): Promise<void> {
  const [human, json] = await Promise.all([
    invoke(["inspect", "__QUERY_MUST_NOT_EXECUTE__", "--project", project]),
    invoke([
      "inspect",
      "__QUERY_MUST_NOT_EXECUTE__",
      "--project",
      project,
      "--json",
    ]),
  ]);
  expect(human).toEqual({
    exitCode,
    stdout: "",
    stderr: `${formatHumanDiagnostics(diagnostics)}\n`,
  });
  expect(json).toEqual({
    exitCode,
    stdout: "",
    stderr: report(diagnostics, null),
  });
  expect(human.stderr).not.toContain("Q001");
  expect(json.stderr).not.toContain("__QUERY_MUST_NOT_EXECUTE__");
}

function queryValue(
  operation: "inspect" | "neighbors" | "trace" | "net" | "cable",
): QueryCommandResult {
  const engine = createQueryEngine(queryIr);
  const result =
    operation === "inspect"
      ? engine.inspect({ by: "designation", value: "Panel A" })
      : operation === "neighbors"
        ? engine.neighbors({ by: "designation", value: "A" })
        : operation === "trace"
          ? engine.trace({ by: "designation", value: "K1" })
          : operation === "net"
            ? engine.net({ by: "display", value: "K1.13/NO" })
            : engine.cable({ by: "designation", value: "Cable A" });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const humanCases = [
  {
    command: "inspect",
    args: ["inspect", "Panel A"],
    expected: `device "Panel A"
  uid 40000000-0000-4000-8000-000000000007
  type query:panel
  description "Panel device with spaces"
  aliases:
    alias "main panel"
  location "Bay 1"
  terminals:
    terminal "Panel A.13 NO"
      id {"deviceUid":"40000000-0000-4000-8000-000000000007","terminalKey":"13 NO"}
      device-designation "Panel A"
      net net:sha256:4964ada9211bbdef548b60cce89f706b751756fef7b4ab9e58fa110d9ecb6803
      potentials:
        (none)
      elements:
        (none)
  functions:
    (none)
  ganged-groups:
    (none)
  internal-relations:
    (none)
  project-relations:
    (none)
`,
  },
  {
    command: "neighbors",
    args: ["neighbors", "A"],
    expected: `neighbors A
  uid 40000000-0000-4000-8000-000000000001
  conductive:
    A.C -- W1 --> A.B.C device=A.B uid=40000000-0000-4000-8000-000000000002
  relations:
    outgoing controls A.B uid=40000000-0000-4000-8000-000000000002 via REL1
`,
  },
  {
    command: "trace",
    args: ["trace", "K1"],
    expected: `trace K1
  uid 40000000-0000-4000-8000-000000000006
  components:
    component net:sha256:b0bec620129f729334c5cc8b21fac1cde8d38657ed87bee63e7cbd3b0f259098
      roots:
        terminal K1.13/NO
      potentials:
        (none)
      visits:
        visit 0 K1.13/NO
      edges:
        (none)
`,
  },
  {
    command: "net",
    args: ["net", "K1.13/NO"],
    expected: `net net:sha256:b0bec620129f729334c5cc8b21fac1cde8d38657ed87bee63e7cbd3b0f259098
  selected K1.13/NO
  potentials:
    (none)
  terminals:
    terminal K1.13/NO
  elements:
    (none)
`,
  },
  {
    command: "cable",
    args: ["cable", "Cable A"],
    expected: `cable "Cable A"
  uid 40000000-0000-4000-8000-000000000013
  description "Cable with spaces"
  aliases:
    alias "main cable"
  type query:cable
  cable-type query:cable
  shield false
  construction {"conductor_material":"copper","jacket_material":"test jacket"}
  conductors:
    conductor "Cable A.1" id={"cableUid":"40000000-0000-4000-8000-000000000013","conductorId":"1"}
      color blue
      size "1 mm2"
      net net:sha256:c1364f7fe8967fc2f32a7ac70e2ed4092a9a4c3f621e37e74920fb2d12dfe7bb
      potentials:
        (none)
      endpoints:
        terminal D1.T
          id {"deviceUid":"40000000-0000-4000-8000-000000000009","terminalKey":"T"}
          device-designation D1
        terminal D2.T
          id {"deviceUid":"40000000-0000-4000-8000-000000000010","terminalKey":"T"}
          device-designation D2
`,
  },
] as const;

const inspectHumanCases = [
  { designation: "Panel A", expected: humanCases[0].expected },
  {
    designation: "W1",
    expected: `wire W1
  uid 40000000-0000-4000-8000-000000000011
  aliases:
    (none)
  endpoints:
    terminal A.C
      id {"deviceUid":"40000000-0000-4000-8000-000000000001","terminalKey":"C"}
      device-designation A
    terminal A.B.C
      id {"deviceUid":"40000000-0000-4000-8000-000000000002","terminalKey":"C"}
      device-designation A.B
  net net:sha256:ab9dfb503908f392226b306c9ad9b718997c1c358ad104f99f7974748650a40c
    potentials:
      (none)
`,
  },
  {
    designation: "JP1",
    expected: `jumper JP1
  uid 40000000-0000-4000-8000-000000000015
  designation JP1
  aliases:
    (none)
  endpoints:
    terminal D1.T
      id {"deviceUid":"40000000-0000-4000-8000-000000000009","terminalKey":"T"}
      device-designation D1
    terminal D2.T
      id {"deviceUid":"40000000-0000-4000-8000-000000000010","terminalKey":"T"}
      device-designation D2
  net net:sha256:c1364f7fe8967fc2f32a7ac70e2ed4092a9a4c3f621e37e74920fb2d12dfe7bb
    potentials:
      (none)
`,
  },
  {
    designation: "Cable A",
    expected: `cable "Cable A"
  uid 40000000-0000-4000-8000-000000000013
  description "Cable with spaces"
  aliases:
    alias "main cable"
  type query:cable
  cable-type query:cable
  shield false
  construction {"conductor_material":"copper","jacket_material":"test jacket"}
  conductor-count 1
  conductor-ids:
    conductor {"cableUid":"40000000-0000-4000-8000-000000000013","conductorId":"1"}
`,
  },
  {
    designation: "REL1",
    expected: `relation REL1
  uid 40000000-0000-4000-8000-000000000012
  designation REL1
  aliases:
    (none)
  verb controls
  from A uid=40000000-0000-4000-8000-000000000001
  to A.B uid=40000000-0000-4000-8000-000000000002
`,
  },
  {
    designation: "POT1",
    expected: `potential POT1
  uid 40000000-0000-4000-8000-000000000016
  designation POT1
  aliases:
    (none)
  name +24V
  electrical {"nominal_voltage":24,"polarity":"positive","voltage_type":"DC"}
  selected-terminal:
    terminal PLC1.X1.0
      id {"deviceUid":"40000000-0000-4000-8000-000000000004","terminalKey":"X1.0"}
      device-designation PLC1
  net net:sha256:cd63029eb5e685e39e861b7bcb222d5b52296d4f55b3757f1f88e1040c7f2b01
    potentials:
      potential +24V uid=40000000-0000-4000-8000-000000000016 electrical={"nominal_voltage":24,"polarity":"positive","voltage_type":"DC"}
`,
  },
] as const;

describe("Task 7 query command success output", () => {
  it("fresh-compiles exactly once for every query invocation", async () => {
    let compileCalls = 0;
    const compile = async (
      inputPath: string | undefined,
      cwd: string,
    ): Promise<CompileResult> => {
      compileCalls += 1;
      expect(inputPath).toBe(queryProject);
      expect(cwd).toBe(repositoryRoot);
      return { ok: true, diagnostics: [], ir: queryIr };
    };
    for (const { args } of humanCases) {
      const result = await invoke([...args, "--project", queryProject], {
        cwd: repositoryRoot,
        queryCompileProject: compile,
      });
      expect(result.exitCode).toBe(0);
    }
    expect(compileCalls).toBe(humanCases.length);
  });
  it.each(humanCases)(
    "renders exact $command human output",
    async ({ args, expected }) => {
      const result = await invoke([...args, "--project", queryProject]);
      expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      expect(result.stdout).not.toContain("\r");
    },
  );

  it.each(humanCases)(
    "emits exact $command DTO on stdout and clean report on stderr",
    async ({ command, args }) => {
      const result = await invoke([
        ...args,
        "--project",
        queryProject,
        "--json",
      ]);
      expect(result).toEqual({
        exitCode: 0,
        stdout: serializeQueryResult(queryValue(command)),
        stderr: report([], null),
      });
    },
  );

  it.each(humanCases)(
    "accepts cwd, directory, and direct-manifest project forms for $command",
    async ({ command, args }) => {
      const [cwd, directory, manifest] = await Promise.all([
        invoke([...args, "--json"], { cwd: queryProject }),
        invoke([...args, "--project", queryProject, "--json"]),
        invoke([
          ...args,
          "--project",
          join(queryProject, "system.json"),
          "--json",
        ]),
      ]);
      for (const result of [cwd, directory, manifest]) {
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ command });
        expect(result.stderr).toBe(report([], null));
      }
    },
  );

  it.each(inspectHumanCases)(
    "renders exact inspect $designation human output",
    async ({ designation, expected }) => {
      const result = await invoke([
        "inspect",
        designation,
        "--project",
        queryProject,
      ]);
      expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      expect(result.stdout).not.toContain("\r");
    },
  );
});

describe("Task 7 exact query errors and compiler boundaries", () => {
  const errors = [
    {
      args: ["inspect", "UNKNOWN"],
      error: {
        code: "Q001",
        message: 'No project object has designation "UNKNOWN".',
        input: "UNKNOWN",
      },
    },
    {
      args: ["cable", "K1"],
      error: {
        code: "Q002",
        message: 'Object "K1" is a device; cable requires a cable.',
        input: "K1",
        expectedKind: "cable",
        actualKind: "device",
      },
    },
    {
      args: ["net", "NO_DOT"],
      error: {
        code: "Q003",
        message:
          'Cannot parse terminal reference "NO_DOT"; use a dotted device-and-terminal reference or --device/--terminal.',
        input: "NO_DOT",
      },
    },
    {
      args: ["net", "A.B.C.D"],
      error: {
        code: "Q004",
        message: 'Device "A.B" has no terminal "C.D".',
        input: "C.D",
        deviceDesignation: "A.B",
        terminalKey: "C.D",
      },
    },
  ] as const;

  it.each(errors)(
    "renders exact $error.code human and JSON failures",
    async ({ args, error }) => {
      const [human, json] = await Promise.all([
        invoke([...args, "--project", queryProject]),
        invoke([...args, "--project", queryProject, "--json"]),
      ]);
      expect(human).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `${error.code} ${error.message}\n`,
      });
      expect(json).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: report([], error),
      });
    },
  );

  it.each([
    ["E200", "invalid-cable-conductor"],
    ["E300", "conflicting-potential-name"],
  ] as const)(
    "passes authored %s through and stops before query execution",
    async (_code, fixtureName) => {
      const project = join(ruleFixtureRoot, fixtureName);
      const diagnostics = JSON.parse(
        await readFile(join(project, "expected.json"), "utf8"),
      ) as Diagnostic[];
      await expectCompilerStopsQuery(project, diagnostics, 1);
    },
  );

  it("preserves exact missing-lock E105 streams and stops the query", async () => {
    const { project } = await copyQueryFixture();
    await rm(join(project, "electrical-system.lock.json"));
    const diagnostics: Diagnostic[] = [
      {
        code: "E105",
        severity: "error",
        message:
          'Project declares libraries but "electrical-system.lock.json" is missing.',
        file: "system.json",
        line: 6,
        column: 16,
        jsonPointer: "/libraries",
      },
    ];
    await expectCompilerStopsQuery(project, diagnostics, 1);
  });

  it("preserves exact stale-lock E108 streams and stops the query", async () => {
    const { project, library } = await copyQueryFixture();
    const typePath = join(library, "types", "types.json");
    const bytes = await readFile(typePath, "utf8");
    await writeFile(typePath, `${bytes}\n`, "utf8");
    const diagnostics: Diagnostic[] = [
      {
        code: "E108",
        severity: "error",
        message:
          'Library "query" file "types/types.json" integrity does not match the lock.',
        file: "../query library/types/types.json",
        line: 1,
        column: 1,
        jsonPointer: "",
        related: [
          {
            file: "electrical-system.lock.json",
            line: 12,
            column: 29,
            note: 'Locked integrity is "sha256-C5VTDSfA9J4hSTnzkpV7zIoAgGJUSeWoqVtIQL10X0M=".',
          },
        ],
      },
    ];
    await expectCompilerStopsQuery(project, diagnostics, 1);
  });

  it("preserves exact duplicate-designation E100 streams and stops the query", async () => {
    const { project } = await copyQueryFixture();
    const sourcePath = join(project, "sources", "objects.json");
    const source = await readFile(sourcePath, "utf8");
    const changed = source.replace(
      '"designation": "-K1"',
      '"designation": "Panel A"',
    );
    expect(changed).not.toBe(source);
    await writeFile(sourcePath, changed, "utf8");
    const diagnostics: Diagnostic[] = [
      {
        code: "E100",
        severity: "error",
        message: 'Duplicate project designation "Panel A".',
        file: "sources/objects.json",
        line: 52,
        column: 22,
        jsonPointer: "/objects/7/designation",
        uid: "40000000-0000-4000-8000-000000000008",
        related: [
          {
            file: "sources/objects.json",
            line: 43,
            column: 22,
            note: "First declaration of this designation.",
          },
        ],
      },
    ];
    await expectCompilerStopsQuery(project, diagnostics, 1);
  });

  it("preserves exact authored-terminal E102 streams and stops the query", async () => {
    const { project } = await copyQueryFixture();
    const sourcePath = join(project, "sources", "objects.json");
    const source = await readFile(sourcePath, "utf8");
    const changed = source.replace(
      '{ "device": "A.B", "terminal": "C" }',
      '{ "device": "A.B", "terminal": "UNKNOWN" }',
    );
    expect(changed).not.toBe(source);
    await writeFile(sourcePath, changed, "utf8");
    const diagnostics: Diagnostic[] = [
      {
        code: "E102",
        severity: "error",
        message:
          'Device "A.B" of type "query:a-dot-b" has no terminal "UNKNOWN".',
        file: "sources/objects.json",
        line: 73,
        column: 40,
        jsonPointer: "/objects/10/endpoints/1/terminal",
        uid: "40000000-0000-4000-8000-000000000011",
        related: [
          {
            file: "../query library/types/types.json",
            line: 18,
            column: 13,
            note: 'Resolved device type "query:a-dot-b" is declared here.',
          },
        ],
      },
    ];
    await expectCompilerStopsQuery(project, diagnostics, 1);
  });

  it("preserves exact loader E001 streams, exit 2, and stops the query", async () => {
    const diagnostics: Diagnostic[] = [
      {
        code: "E001",
        severity: "error",
        message: 'Unable to read "system.json" (ENOENT).',
        file: "system.json",
        line: 1,
        column: 1,
        jsonPointer: "",
      },
    ];
    await expectCompilerStopsQuery(
      join(packageRoot, "fixtures", "missing manifest"),
      diagnostics,
      2,
    );
  });

  it("answers through W902 and surfaces the unchanged warning", async () => {
    const project = join(ruleFixtureRoot, "exact-duplicate-potential");
    const diagnostics = JSON.parse(
      await readFile(join(project, "expected.json"), "utf8"),
    ) as Diagnostic[];
    const [human, json, miss] = await Promise.all([
      invoke(["inspect", "NODE", "--project", project]),
      invoke(["inspect", "NODE", "--project", project, "--json"]),
      invoke(["inspect", "UNKNOWN", "--project", project]),
    ]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout.startsWith("device NODE\n")).toBe(true);
    expect(human.stderr).toBe(`${formatHumanDiagnostics(diagnostics)}\n`);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ command: "inspect" });
    expect(json.stderr).toBe(report(diagnostics, null));
    expect(miss).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `${formatHumanDiagnostics(diagnostics)}\n\nQ001 No project object has designation "UNKNOWN".\n`,
    });
  });

  it("maps corrupt successful IR hydration to exact E001 in both modes", async () => {
    const compiled = await compileProject(queryProject);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const corrupt = structuredClone(compiled.ir);
    corrupt.indexes.terminalIdsByDeviceUid.pop();
    const injected: CompileResult = {
      ok: true,
      diagnostics: [],
      ir: corrupt,
    };
    const compile = async () => injected;
    const [human, json] = await Promise.all([
      invoke(["inspect", "A", "--project", queryProject], {
        queryCompileProject: compile,
      }),
      invoke(["inspect", "A", "--project", queryProject, "--json"], {
        queryCompileProject: compile,
      }),
    ]);
    expect(human).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `${formatHumanDiagnostics([corruptIrDiagnostic])}\n`,
    });
    expect(json).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: report([corruptIrDiagnostic], null),
    });
  });
});

async function projectVariant(rename: "A" | "A."): Promise<string> {
  const { project } = await copyQueryFixture();
  const sourcePath = join(project, "sources", "objects.json");
  const document = JSON.parse(await readFile(sourcePath, "utf8")) as {
    objects: Array<{
      kind: string;
      designation?: string;
      endpoints?: Array<{ device: string }>;
      from?: { device: string };
      to?: { device: string };
    }>;
  };
  const replacement = rename === "A" ? "ALT-A" : "ALT-A-DOT";
  document.objects.find(
    (object) => object.kind === "device" && object.designation === rename,
  )!.designation = replacement;
  if (rename === "A") {
    for (const object of document.objects) {
      for (const endpoint of object.endpoints ?? []) {
        if (endpoint.device === "A") endpoint.device = replacement;
      }
      if (object.from?.device === "A") object.from.device = replacement;
      if (object.to?.device === "A") object.to.device = replacement;
    }
  }
  await writeFile(sourcePath, `${JSON.stringify(document, undefined, 2)}\n`);
  return project;
}

describe("Task 7 exact dotted grammar and Commander addressing", () => {
  it.each(["--ir", "--strict", "--output"])(
    "rejects unsupported query option %s before compilation",
    async (option) => {
      let compileCalls = 0;
      const result = await invoke(["inspect", "A", option, "value"], {
        queryCompileProject: async () => {
          compileCalls += 1;
          throw new Error("compile must not run");
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`unknown option '${option}'`);
      expect(compileCalls).toBe(0);
    },
  );
  it("implements longest-prefix, suffix, slash, IEC, and structured escape cases", async () => {
    const cases = [
      [["net", "PLC1.X1.0"], "PLC1", "X1.0"],
      [["net", "=F1+P1-K1.A1"], "=F1+P1-K1", "A1"],
      [["net", "A.B.C"], "A.B", "C"],
      [["net", "--device", "A", "--terminal", "B.C"], "A", "B.C"],
      [["net", "A.B"], "A", "B"],
      [["net", "K1.13/NO"], "K1", "13/NO"],
      [["net", "A..C"], "A.", "C"],
      [["net", "Panel A.13 NO"], "Panel A", "13 NO"],
    ] as const;
    for (const [args, designation, terminalKey] of cases) {
      const result = await invoke([
        ...args,
        "--project",
        queryProject,
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        command: "net",
        selectedTerminal: {
          deviceDesignation: designation,
          id: { terminalKey },
        },
      });
      expect(result.stderr).toBe(report([], null));
    }
  });

  it("never backtracks and rejects empty/whole/non-prefix displays as Q003/Q004", async () => {
    const withoutA = await projectVariant("A");
    const cases = [
      [queryProject, "A.B.C.D", "Q004"],
      [queryProject, "A.", "Q003"],
      [queryProject, ".A1", "Q003"],
      [queryProject, "MISSING.A1", "Q003"],
      [withoutA, "A.B", "Q003"],
    ] as const;
    for (const [project, reference, code] of cases) {
      const result = await invoke([
        "net",
        reference,
        "--project",
        project,
        "--json",
      ]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        diagnostics: [],
        error: { code },
      });
    }
  });

  it("distinguishes both A..C structural parses and option Q001/Q004", async () => {
    const withoutADot = await projectVariant("A.");
    const display = await invoke([
      "net",
      "A..C",
      "--project",
      withoutADot,
      "--json",
    ]);
    const unknownDevice = await invoke([
      "net",
      "--device",
      "UNKNOWN",
      "--terminal",
      "A1",
      "--project",
      queryProject,
      "--json",
    ]);
    const unknownTerminal = await invoke([
      "net",
      "--device",
      "PLC1",
      "--terminal",
      "X9.9",
      "--project",
      queryProject,
      "--json",
    ]);
    expect(JSON.parse(display.stdout)).toMatchObject({
      selectedTerminal: {
        deviceDesignation: "A",
        id: { terminalKey: ".C" },
      },
    });
    expect(JSON.parse(unknownDevice.stderr)).toMatchObject({
      error: { code: "Q001" },
    });
    expect(JSON.parse(unknownTerminal.stderr)).toMatchObject({
      error: {
        code: "Q004",
        deviceDesignation: "PLC1",
        terminalKey: "X9.9",
      },
    });
  });

  it.each([
    ["net"],
    ["net", "A.B", "--device", "A", "--terminal", "B"],
    ["net", "--device", "A"],
    ["net", "--terminal", "B"],
    ["net", "A.B", "--device", "A"],
  ])("rejects usage before compilation: thermite %s", async (...args) => {
    let compileCalls = 0;
    const result = await invoke(args, {
      queryCompileProject: async () => {
        compileCalls += 1;
        throw new Error("compile must not run");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "exactly one net addressing form is required",
    );
    expect(compileCalls).toBe(0);
  });

  it(
    "handles quoted-space and leading-dash operands in subprocesses",
    { timeout: 120_000 },
    async ({ skip }) => {
      const cases = [
        ["inspect", "Panel A", "--project", queryProject],
        ["neighbors", "Panel A", "--project", queryProject],
        ["trace", "Panel A", "--project", queryProject],
        ["net", "Panel A.13 NO", "--project", queryProject],
        ["cable", "Cable A", "--project", queryProject],
        ["inspect", "--project", queryProject, "--", "-K1"],
        ["neighbors", "--project", queryProject, "--", "-K1"],
        ["trace", "--project", queryProject, "--", "-K1"],
        ["net", "--project", queryProject, "--", "-K1.A1"],
        ["cable", "--project", queryProject, "--", "-CBL"],
      ] as const;
      for (const args of cases) {
        let result: Invocation;
        try {
          result = await subprocess(args);
        } catch (error) {
          if (isChildProcessDenied(error)) {
            skip("The execution sandbox denied child-process creation.");
            return;
          }
          throw error;
        }
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toBe("");
        expect(result.stderr).toBe("");
      }
    },
  );
});

describe("Task 7 corrupt-IR subprocess boundary", () => {
  it.for([false, true] as const)(
    "emits E001 with no stdout when json=%s",
    async (json, { skip }) => {
      const args = [
        "inspect",
        "A",
        "--project",
        queryProject,
        ...(json ? ["--json"] : []),
      ];
      const script = `
        import { compileProject } from ${JSON.stringify(compilerModuleUrl)};
        import { runCli } from ${JSON.stringify(cliModuleUrl)};
        const compiled = await compileProject(${JSON.stringify(queryProject)});
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
        compiled.ir.indexes.terminalIdsByDeviceUid.pop();
        process.exitCode = await runCli(
          ${JSON.stringify(["node", "thermite", ...args])},
          { queryCompileProject: async () => compiled },
        );
      `;
      let result: Invocation;
      try {
        result = await new Promise((resolveInvocation, rejectInvocation) => {
          const child = spawn(
            process.execPath,
            ["--input-type=module", "--eval", script],
            {
              cwd: repositoryRoot,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => (stdout += chunk));
          child.stderr.on("data", (chunk: string) => (stderr += chunk));
          child.once("error", rejectInvocation);
          child.once("close", (exitCode) => {
            if (exitCode === null) {
              rejectInvocation(new Error("subprocess had no exit status"));
            } else {
              resolveInvocation({ exitCode, stdout, stderr });
            }
          });
        });
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip("The execution sandbox denied child-process creation.");
          return;
        }
        throw error;
      }
      expect(result).toEqual({
        exitCode: 2,
        stdout: "",
        stderr: json
          ? report([corruptIrDiagnostic], null)
          : `${formatHumanDiagnostics([corruptIrDiagnostic])}\n`,
      });
    },
  );
});
