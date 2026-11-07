import { motorDiagnostics } from "./motor-starter-diagnostics.js";
import { withSkippedChecks } from "../../compiler/src/validation-skips.js";
import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Diagnostic } from "@thermite/schema";
import * as compiler from "@thermite/compiler";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatHumanDiagnostics,
  runCli,
  runCompile,
  runLock,
  runValidate,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = join(packageRoot, "fixtures");
const fixture = (name: string): string => join(fixtureRoot, name);
const ruleFixtureRoot = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "rules",
);
const ruleFixture = (name: string): string => join(ruleFixtureRoot, name);
const cliBin = join(packageRoot, "dist", "bin.js");
const motorStarterRoot = join(repositoryRoot, "examples", "motor-starter");
const unavailableShippedLibraryRoot = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "shipped-library-unavailable",
);
const temporaryRoots: string[] = [];

interface CliInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

async function copyValidLockFixture(): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "thermite-cli-lock-"));
  temporaryRoots.push(temporaryRoot);
  const project = join(temporaryRoot, "valid project");
  await cp(fixture("valid project"), project, { recursive: true });
  await cp(fixture("shared library"), join(temporaryRoot, "shared library"), {
    recursive: true,
  });
  await unlink(join(project, "electrical-system.lock.json"));
  return project;
}

async function copyValidCompileFixture(): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "thermite-cli-compile-"));
  temporaryRoots.push(temporaryRoot);
  const project = join(temporaryRoot, "valid project");
  await cp(fixture("valid project"), project, { recursive: true });
  await cp(fixture("shared library"), join(temporaryRoot, "shared library"), {
    recursive: true,
  });
  return project;
}

function diagnosticShape(diagnostic: Diagnostic) {
  return {
    code: diagnostic.code,
    file: diagnostic.file,
    jsonPointer: diagnostic.jsonPointer,
    line: diagnostic.line,
    column: diagnostic.column,
    ...(diagnostic.related === undefined
      ? {}
      : { related: diagnostic.related }),
  };
}

async function expectedDiagnostics(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(join(fixture(name), "expected.json"), "utf8"),
  ) as unknown;
}

async function expectedRuleDiagnostics(name: string): Promise<Diagnostic[]> {
  return JSON.parse(
    await readFile(join(ruleFixture(name), "expected.json"), "utf8"),
  ) as Diagnostic[];
}

async function runDirectCli(
  args: readonly string[],
  cwd?: string,
): Promise<CliInvocation> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    ...(cwd === undefined ? {} : { cwd }),
  });

  return { exitCode, stdout, stderr };
}

async function projectBytes(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [file, bytes] of Object.entries(await projectBytes(path)))
        files[`${entry.name}/${file}`] = bytes;
    } else files[entry.name] = (await readFile(path)).toString("base64");
  }
  return files;
}

describe.each(["validate", "lock"])("%s project path aliases", (name) => {
  const flags = name === "lock" ? ["--check", "--json"] : ["--json"];
  it("accepts directory/manifest, absolute/relative and spaced paths with identical streams", async () => {
    const project = await copyValidCompileFixture();
    if (name === "lock") expect((await runLock(project)).exitCode).toBe(0);
    const before = await projectBytes(dirname(project));
    for (const path of [
      project,
      join(project, "system.json"),
      "valid project",
      "valid project/system.json",
    ]) {
      for (const selected of [
        flags,
        flags.filter((flag) => flag !== "--json"),
      ]) {
        const positional = await runDirectCli(
          [name, path, ...selected],
          dirname(project),
        );
        const alias = await runDirectCli(
          [name, "--project", path, ...selected],
          dirname(project),
        );
        expect(positional.exitCode).toBe(0);
        expect(alias).toEqual(positional);
        expect(alias.stderr).toBe("");
        if (selected.includes("--json"))
          expect(Array.isArray(JSON.parse(alias.stdout))).toBe(true);
      }
    }
    const defaulted = await runDirectCli([name, ...flags], project);
    expect(defaulted).toEqual(
      await runDirectCli([name, "--project", ".", ...flags], project),
    );
    expect(defaulted.exitCode).toBe(0);
    expect(await projectBytes(dirname(project))).toEqual(before);
  });

  it("rejects both forms before loading or writing, even when equal and in either order", async () => {
    const first = await copyValidLockFixture();
    const second = await copyValidLockFixture();
    const cwd = await copyValidLockFixture();
    const roots = [first, second, cwd].map(dirname);
    const before = await Promise.all(roots.map(projectBytes));
    const loading = vi.spyOn(
      compiler,
      name === "validate" ? "compileProject" : "lockProject",
    );
    try {
      for (const other of [first, second, join(first, "system.json")]) {
        for (const paths of [
          [first, "--project", other],
          ["--project", other, first],
        ]) {
          const result = await runDirectCli([name, ...paths, "--json"], cwd);
          expect(loading).not.toHaveBeenCalled();
          expect(await Promise.all(roots.map(projectBytes))).toEqual(before);
          expect(result).toEqual({
            exitCode: 2,
            stdout: "",
            stderr:
              "error: specify either [path] or --project <path>, not both\n",
          });
        }
      }
      const missing = join(cwd, "missing");
      expect(
        await runDirectCli([name, missing, "--project", missing], cwd),
      ).toEqual({
        exitCode: 2,
        stdout: "",
        stderr: "error: specify either [path] or --project <path>, not both\n",
      });
      expect(loading).not.toHaveBeenCalled();
    } finally {
      loading.mockRestore();
    }
  });

  it("pins alias/default help and keeps help/version and usage streams", async () => {
    const help = await runDirectCli([name, "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    const text = help.stdout.replace(/\s+/g, " ");
    expect(text).toContain("--project <path>");
    expect(text).toContain(
      "alias for [path]: project directory or direct manifest path; use only one form",
    );
    expect(text).toContain(
      "Defaults to the current directory. Supply [path] or --project <path>, not both.",
    );
    for (const args of [
      [name, "--project"],
      [name, "--unknown"],
    ]) {
      const result = await runDirectCli(args);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^error:/);
    }
    const version = await runDirectCli(["--version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).not.toBe("");
    expect(version.stderr).toBe("");
  });

  it("preserves human/JSON authored and tool failure exits", async () => {
    for (const [project, exit] of [
      [fixture("missing manifest"), 2],
      [fixture("duplicate uid cross scopes"), 1],
    ] as const) {
      for (const extra of [[], ["--json"]]) {
        const check = name === "lock" ? ["--check"] : [];
        const positional = await runDirectCli([
          name,
          project,
          ...check,
          ...extra,
        ]);
        expect(positional.exitCode).toBe(exit);
        expect(
          await runDirectCli([name, "--project", project, ...check, ...extra]),
        ).toEqual(positional);
      }
    }
  });
});

it("keeps compile positional-only", async () => {
  const result = await runDirectCli(["compile", "--project", "."]);
  expect(result).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: "error: unknown option '--project'\n",
  });
});

it("lock --project writes only the selected project and --check stays read-only", async () => {
  const project = await copyValidLockFixture();
  const cwd = await copyValidLockFixture();
  const before = await projectBytes(dirname(cwd));
  const selected = await projectBytes(dirname(project));
  const checked = await runDirectCli(
    ["lock", "--project", project, "--check", "--json"],
    cwd,
  );
  expect(checked.exitCode).toBe(1);
  expect(await projectBytes(dirname(project))).toEqual(selected);
  expect(checked.stderr).toBe("");
  const written = await runDirectCli(
    ["lock", "--project", project, "--json"],
    cwd,
  );
  expect(written).toEqual({ exitCode: 0, stdout: "[]\n", stderr: "" });
  expect(
    await readFile(join(project, "electrical-system.lock.json"), "utf8"),
  ).toContain('"lockfile_version": 1');
  expect(await projectBytes(dirname(cwd))).toEqual(before);
});

it("validate --project preserves strict warning severity and human/JSON streams", async () => {
  const project = fixture("unmatched glob");
  for (const extra of [[], ["--json"]]) {
    const normal = await runDirectCli(["validate", project, ...extra]);
    const strict = await runDirectCli([
      "validate",
      project,
      "--strict",
      ...extra,
    ]);
    expect(normal.exitCode).toBe(0);
    expect(strict.exitCode).toBe(1);
    expect(strict.stdout).toBe(normal.stdout);
    expect(
      await runDirectCli([
        "validate",
        "--project",
        project,
        "--strict",
        ...extra,
      ]),
    ).toEqual(strict);
  }
});

async function runCliSubprocess(
  args: readonly string[],
): Promise<CliInvocation> {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", rejectInvocation);
    child.once("close", (exitCode, signal) => {
      if (signal !== null) {
        rejectInvocation(new Error(`thermite exited from signal ${signal}.`));
        return;
      }
      if (exitCode === null) {
        rejectInvocation(new Error("thermite exited without a status code."));
        return;
      }
      resolveInvocation({ exitCode, stdout, stderr });
    });
  });
}

describe("thermite validate loader", () => {
  it("validates a project and local library in paths with spaces", async () => {
    const project = fixture("valid project");
    const directoryResult = await runValidate(project);
    const manifestResult = await runValidate(join(project, "system.json"));
    const cwdResult = await runValidate(undefined, { cwd: project });

    expect(directoryResult).toMatchObject({
      diagnostics: [],
      exitCode: 0,
      output: "",
    });
    expect(manifestResult.diagnostics).toEqual([]);
    expect(manifestResult.exitCode).toBe(0);
    expect(cwdResult.exitCode).toBe(0);
  });

  it("reports a missing manifest as E001 at 1:1 with exit 2", async () => {
    const result = await runValidate(fixture("missing manifest"));

    expect(result.exitCode).toBe(2);
    expect(result.diagnostics).toMatchObject([
      {
        code: "E001",
        file: "system.json",
        line: 1,
        column: 1,
        jsonPointer: "",
      },
      { code: "I208" },
    ]);
  });

  it.each([
    ["bad absolute glob", "absolute source globs"],
    ["bad parent glob", "may not contain '..'"],
    ["bad library glob", "escapes the library root"],
  ])("rejects unsafe globs in %s", async (name, message) => {
    const result = await runValidate(fixture(name));

    expect(result.exitCode).toBe(2);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      code: "E001",
      line: 1,
      column: 1,
      jsonPointer: "",
    });
    expect(result.diagnostics[0]?.message).toContain(message);
  });

  it("anchors unmatched project globs at the glob string and honors strict mode", async () => {
    const project = fixture("unmatched glob");
    const normal = await runValidate(project);
    const strict = await runValidate(project, { strict: true });

    expect(normal.exitCode).toBe(0);
    expect(strict.exitCode).toBe(1);
    expect(normal.diagnostics).toMatchObject([
      {
        code: "W901",
        severity: "warning",
        file: "system.json",
        line: 4,
        column: 15,
        jsonPointer: "/sources/0",
      },
    ]);
    expect(normal.diagnostics.map(diagnosticShape)).toEqual(
      await expectedDiagnostics("unmatched glob"),
    );
  });

  it("reports whole-library E022, E027, E028, and E029 with D4 anchors", async () => {
    const result = await runValidate(fixture("library issues"));
    const byCode = (code: string) =>
      result.diagnostics.filter((diagnostic) => diagnostic.code === code);

    expect(result.exitCode).toBe(1);
    expect(
      result.diagnostics.filter((d) => d.code !== "I208").map(diagnosticShape),
    ).toEqual(await expectedDiagnostics("library issues"));
    expect(byCode("E027")).toHaveLength(2);
    expect(byCode("E027")[0]).toMatchObject({
      file: "../problem libraries/mismatched/types/01-first.json",
      line: 5,
      column: 13,
      jsonPointer: "/types/0/id",
    });

    expect(byCode("E022")).toMatchObject([
      {
        file: "../problem libraries/mismatched/types/02-second.json",
        line: 5,
        column: 13,
        jsonPointer: "/types/0/id",
        related: [
          {
            file: "../problem libraries/mismatched/types/01-first.json",
            line: 5,
            column: 13,
          },
        ],
      },
    ]);

    expect(byCode("E028")).toMatchObject([
      {
        file: "system.json",
        line: 7,
        column: 15,
        jsonPointer: "/libraries/0/name",
        related: [
          {
            file: "../problem libraries/mismatched/library.json",
            line: 2,
            column: 11,
          },
        ],
      },
      {
        file: "system.json",
        line: 8,
        column: 18,
        jsonPointer: "/libraries/0/version",
        related: [
          {
            file: "../problem libraries/mismatched/library.json",
            line: 3,
            column: 14,
          },
        ],
      },
    ]);

    expect(byCode("E029")).toMatchObject([
      {
        file: "system.json",
        line: 11,
        column: 5,
        jsonPointer: "/libraries/1",
      },
    ]);
  });

  it("runs E020 across project and library documents", async () => {
    const result = await runValidate(fixture("duplicate uid cross scopes"));
    const duplicate = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "E020",
    );

    expect(result.exitCode).toBe(1);
    expect(duplicate).toMatchObject({
      file: "../problem libraries/uid-bearing/types/types.json",
      line: 9,
      column: 24,
      jsonPointer: "/objects/0/uid",
      related: [
        {
          file: "sources/project.json",
          line: 4,
          column: 14,
        },
      ],
    });
  });

  it("emits a verbatim parseable Diagnostic array for --json with no ANSI", async () => {
    const result = await runValidate(fixture("library issues"), {
      json: true,
      color: true,
    });

    expect(result.output).not.toMatch(/\u001b\[/u);
    expect(JSON.parse(result.output)).toEqual(result.diagnostics);
  });

  it("uses grouped human lines and manifest-relative forward-slash paths", async () => {
    const result = await runValidate(fixture("library issues"));
    const nonemptyLines = result.output
      .split("\n")
      .filter((line) => line !== "");

    expect(result.output).toContain("\n\nsystem.json:");
    expect(result.output).not.toContain("\\");
    expect(
      nonemptyLines.every((line) => /:\d+:\d+ [EI]\d{3} /u.test(line)),
    ).toBe(true);
    expect(
      result.diagnostics.every((diagnostic) => !diagnostic.file.includes("\\")),
    ).toBe(true);
  });

  it("renders the exact E032 rows through human and JSON CLI modes", async () => {
    const diagnostics = withSkippedChecks("project loading/structural", [
      {
        code: "E032",
        severity: "error",
        message: 'Shipped library "unknown" at version "9.9.9" is unavailable.',
        file: "system.json",
        line: 1,
        column: 108,
        jsonPointer: "/libraries/0/name",
      },
      {
        code: "E032",
        severity: "error",
        message:
          'Shipped library "core" does not provide version "9.9.9"; available versions are "0.1.0", "0.2.0".',
        file: "system.json",
        line: 1,
        column: 162,
        jsonPointer: "/libraries/1/version",
      },
    ]);
    const [human, json] = await Promise.all([
      runDirectCli(["validate", unavailableShippedLibraryRoot]),
      runDirectCli(["validate", unavailableShippedLibraryRoot, "--json"]),
    ]);
    expect(human).toEqual({
      exitCode: 1,
      stdout: formatHumanDiagnostics(diagnostics) + "\n",
      stderr: "",
    });
    expect(json).toEqual({
      exitCode: 1,
      stdout: JSON.stringify(diagnostics, undefined, 2) + "\n",
      stderr: "",
    });
  });
});

describe("Stage D engineering content", () => {
  it("reports motor-starter assessment info without failing normal, strict, or compile flows", async () => {
    const [normal, strict, compiled] = await Promise.all([
      runValidate(motorStarterRoot),
      runValidate(motorStarterRoot, { strict: true }),
      runCompile(motorStarterRoot),
    ]);

    expect(normal).toMatchObject({
      diagnostics: motorDiagnostics,
      exitCode: 0,
      output: formatHumanDiagnostics(motorDiagnostics),
    });
    expect(strict).toMatchObject({
      diagnostics: motorDiagnostics,
      exitCode: 0,
      output: formatHumanDiagnostics(motorDiagnostics),
    });
    expect(compiled).toMatchObject({
      diagnostics: motorDiagnostics,
      exitCode: 0,
      stderr: formatHumanDiagnostics(motorDiagnostics),
      written: false,
    });
    // API fields omit the line ending; the CLI adds it at the stream boundary.
    const human = `${formatHumanDiagnostics(motorDiagnostics)}\n`;
    for (const flags of [[], ["--strict"]]) {
      expect(
        await runDirectCli(["validate", motorStarterRoot, ...flags]),
      ).toEqual({
        exitCode: 0,
        stdout: human,
        stderr: "",
      });
    }
    expect(await runDirectCli(["compile", motorStarterRoot])).toEqual({
      exitCode: 0,
      stdout: compiled.stdout,
      stderr: human,
    });
    expect(JSON.parse(compiled.stdout)).toMatchObject({
      format: "electrical-ir/0.1",
      project: { name: "Motor Starter Reference System" },
    });
  });

  it("loads and validates shipped core through the pinned example dependency", async () => {
    const manifest = JSON.parse(
      await readFile(join(motorStarterRoot, "system.json"), "utf8"),
    ) as {
      libraries: Array<{ name: string; version: string; path?: string }>;
    };
    const result = await runValidate(join(motorStarterRoot, "system.json"));

    expect(manifest.libraries).toContainEqual({
      name: "core",
      version: "0.1.0",
    });
    expect(result.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["I305", "info"],
    ]);
    expect(result.exitCode).toBe(0);
  });
});

describe("thermite lock", () => {
  it("writes a canonical lock and accepts directory, manifest, and cwd check inputs", async () => {
    const project = await copyValidLockFixture();
    const generated = await runLock(project, { json: true });
    const manifestCheck = await runLock(join(project, "system.json"), {
      check: true,
    });
    const cwdCheck = await runLock(undefined, { cwd: project, check: true });
    const lockBytes = await readFile(
      join(project, "electrical-system.lock.json"),
      "utf8",
    );

    expect(generated).toMatchObject({
      diagnostics: [],
      exitCode: 0,
      output: "[]",
      written: true,
    });
    expect(manifestCheck).toMatchObject({
      diagnostics: [],
      exitCode: 0,
      output: "",
      written: false,
    });
    expect(cwdCheck.exitCode).toBe(0);
    expect(lockBytes.endsWith("\n")).toBe(true);
    expect(lockBytes).not.toContain("\r");
    expect(lockBytes).not.toContain("types\\");
  });

  it("keeps --check read-only for missing and noncanonical locks", async () => {
    const missingProject = await copyValidLockFixture();
    const validation = await runValidate(missingProject);
    const missing = await runLock(missingProject, { check: true, json: true });

    expect(validation).toMatchObject({
      exitCode: 1,
      diagnostics: [
        { code: "E105", jsonPointer: "/libraries" },
        { code: "I208" },
      ],
    });
    expect(missing).toMatchObject({
      exitCode: 1,
      written: false,
      diagnostics: [{ code: "E105", jsonPointer: "/libraries" }],
    });
    expect(JSON.parse(missing.output)).toEqual(missing.diagnostics);
    await expect(
      readFile(join(missingProject, "electrical-system.lock.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const driftProject = await copyValidLockFixture();
    await runLock(driftProject);
    const lockPath = join(driftProject, "electrical-system.lock.json");
    const canonical = await readFile(lockPath, "utf8");
    await writeFile(lockPath, canonical.replaceAll("\n", "\r\n"), "utf8");
    const before = await readFile(lockPath);
    const drift = await runLock(driftProject, { check: true });

    expect(drift).toMatchObject({
      exitCode: 1,
      written: false,
      diagnostics: [
        {
          code: "E110",
          file: "electrical-system.lock.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
    });
    expect(await readFile(lockPath)).toEqual(before);
  });

  it("parses thermite lock [path] --check --json at the command boundary", async () => {
    const project = await copyValidLockFixture();
    await runLock(project);
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(
      ["node", "thermite", "lock", project, "--check", "--json"],
      {
        stdout: { write: (text) => (stdout += text) },
        stderr: { write: (text) => (stderr += text) },
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(stderr).toBe("");
  });
});

describe("thermite compile", () => {
  it("emits byte-identical canonical IR to stdout or an atomic output file", async () => {
    const project = await copyValidCompileFixture();
    const stdoutResult = await runCompile(project);
    const output = join(dirname(project), "compiled.ir.json");
    const fileResult = await runCompile(project, { output });

    expect(stdoutResult).toMatchObject({
      diagnostics: [],
      exitCode: 0,
      stderr: "",
      written: false,
    });
    expect(stdoutResult.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(stdoutResult.stdout)).toMatchObject({
      format: "electrical-ir/0.1",
      project: { name: "Valid project in a path with spaces" },
    });
    expect(fileResult).toMatchObject({
      diagnostics: [],
      exitCode: 0,
      stdout: "",
      stderr: "",
      written: true,
    });
    expect(await readFile(output, "utf8")).toBe(stdoutResult.stdout);
  });

  it("keeps successful IR on stdout and exact JSON diagnostics on stderr", async () => {
    const project = await copyValidCompileFixture();
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(
      ["node", "thermite", "compile", project, "--diagnostics-json"],
      {
        stdout: { write: (text) => (stdout += text) },
        stderr: { write: (text) => (stderr += text) },
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ format: "electrical-ir/0.1" });
    expect(JSON.parse(stderr)).toEqual([]);
    expect(stdout).not.toContain('"code":');
  });

  it("emits warnings on stderr while still producing IR and exit 0", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(
      ["node", "thermite", "compile", fixture("unmatched glob")],
      {
        stdout: { write: (text) => (stdout += text) },
        stderr: { write: (text) => (stderr += text) },
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ format: "electrical-ir/0.1" });
    expect(stderr).toContain("W901");
    expect(stderr).not.toContain("electrical-ir/0.1");
  });

  it("writes diagnostics only to stderr in human and JSON failure modes", async () => {
    const project = await copyValidLockFixture();

    for (const json of [false, true]) {
      let stdout = "";
      let stderr = "";
      const exitCode = await runCli(
        [
          "node",
          "thermite",
          "compile",
          project,
          ...(json ? ["--diagnostics-json"] : []),
        ],
        {
          stdout: { write: (text) => (stdout += text) },
          stderr: { write: (text) => (stderr += text) },
        },
      );

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      if (json) {
        expect(JSON.parse(stderr)).toMatchObject([
          { code: "E105" },
          { code: "I208" },
        ]);
      } else {
        expect(stderr).toContain("E105");
        expect(stderr).toContain("system.json:");
      }
    }
  });

  it("never creates or replaces requested output when compilation fails", async () => {
    const project = await copyValidLockFixture();
    const existing = join(dirname(project), "existing.ir.json");
    const absent = join(dirname(project), "absent.ir.json");
    await writeFile(existing, "preserve me\n", "utf8");

    const replace = await runCompile(project, { output: existing });
    const create = await runCompile(project, {
      output: absent,
      diagnosticsJson: true,
    });

    expect(replace).toMatchObject({ exitCode: 1, stdout: "", written: false });
    expect(create).toMatchObject({ exitCode: 1, stdout: "", written: false });
    expect(JSON.parse(create.stderr)).toMatchObject([
      { code: "E105" },
      { code: "I208" },
    ]);
    expect(await readFile(existing, "utf8")).toBe("preserve me\n");
    await expect(readFile(absent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports output I/O failures as exit 2 without emitting IR", async () => {
    const project = await copyValidCompileFixture();
    const output = join(dirname(project), "missing-directory", "result.json");
    const result = await runCompile(project, {
      output,
      diagnosticsJson: true,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      stdout: "",
      written: false,
      diagnostics: [{ code: "E001" }],
    });
    expect(JSON.parse(result.stderr)).toEqual(result.diagnostics);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces an output symlink itself while preserving its former target", async ({
    skip,
  }) => {
    const project = await copyValidCompileFixture();
    const directory = dirname(project);
    const target = join(directory, "target.ir.json");
    const output = join(directory, "linked.ir.json");
    await writeFile(target, "former target\n", "utf8");

    try {
      await symlink(target, output, "file");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        skip("The filesystem denied file-symlink creation.");
        return;
      }
      throw error;
    }

    const result = await runCompile(project, { output });
    expect(result.exitCode).toBe(0);
    expect((await lstat(output)).isSymbolicLink()).toBe(false);
    expect(await readFile(target, "utf8")).toBe("former target\n");
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      format: "electrical-ir/0.1",
    });
  });

  it("does not accept --strict on compile", async () => {
    const project = await copyValidCompileFixture();
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(
      ["node", "thermite", "compile", project, "--strict"],
      {
        stdout: { write: (text) => (stdout += text) },
        stderr: { write: (text) => (stderr += text) },
      },
    );
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown option '--strict'");
  });
});

describe("full-pipeline thermite validate", () => {
  it("reports semantic compiler diagnostics after a clean structural load and lock", async () => {
    const project = await copyValidCompileFixture();
    const sourcePath = join(project, "sources", "devices.json");
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      objects: Array<{ type?: string }>;
    };
    source.objects[0]!.type = "mini:missing";
    await writeFile(sourcePath, `${JSON.stringify(source, undefined, 2)}\n`);

    const human = await runValidate(project);
    const json = await runValidate(project, { json: true });
    expect(human).toMatchObject({
      exitCode: 1,
      diagnostics: [{ code: "E103" }, { code: "I208" }],
    });
    expect(human.output).toContain("E103");
    expect(JSON.parse(json.output)).toEqual(json.diagnostics);
  });
});

describe("M3 rule-aware CLI integration", () => {
  it.each([
    ["E200", "invalid-cable-conductor"],
    ["E201", "exclusive-terminal-second-wire"],
    ["E300", "conflicting-potential-name"],
    ["E301", "voltage-type-mismatch"],
    ["E302", "nominal-voltage-mismatch"],
  ] as const)(
    "reports %s through validate human and JSON modes with exit 1",
    async (code, name) => {
      const project = ruleFixture(name);
      const expected = await expectedRuleDiagnostics(name);
      const [human, json] = await Promise.all([
        runDirectCli(["validate", project]),
        runDirectCli(["validate", project, "--json"]),
      ]);

      expect(expected.filter((d) => d.severity === "error")).toHaveLength(1);
      expect(expected[0]).toMatchObject({ code, severity: "error" });
      expect(human).toEqual({
        exitCode: 1,
        stdout: formatHumanDiagnostics(expected) + "\n",
        stderr: "",
      });
      expect(json.exitCode).toBe(1);
      expect(json.stderr).toBe("");
      expect(json.stdout).toBe(`${JSON.stringify(expected, undefined, 2)}\n`);
      expect(JSON.parse(json.stdout)).toEqual(expected);
    },
  );

  it("keeps W902 a warning while strict changes only validate's exit policy", async () => {
    const project = ruleFixture("exact-duplicate-potential");
    const expected = await expectedRuleDiagnostics("exact-duplicate-potential");
    const [normalHuman, strictHuman, normalJson, strictJson] =
      await Promise.all([
        runDirectCli(["validate", project]),
        runDirectCli(["validate", project, "--strict"]),
        runDirectCli(["validate", project, "--json"]),
        runDirectCli(["validate", project, "--strict", "--json"]),
      ]);

    expect(expected).toMatchObject([{ code: "W902", severity: "warning" }]);
    expect(normalHuman.exitCode).toBe(0);
    expect(strictHuman.exitCode).toBe(1);
    expect(normalHuman.stdout).toBe(strictHuman.stdout);
    expect(normalHuman.stdout).toContain("W902");
    expect(normalHuman.stderr).toBe("");
    expect(strictHuman.stderr).toBe("");

    expect(normalJson.exitCode).toBe(0);
    expect(strictJson.exitCode).toBe(1);
    expect(normalJson.stdout).toBe(
      `${JSON.stringify(expected, undefined, 2)}\n`,
    );
    expect(strictJson.stdout).toBe(normalJson.stdout);
    expect(JSON.parse(normalJson.stdout)).toEqual(expected);
    expect(JSON.parse(strictJson.stdout)).toEqual(expected);
    expect(normalJson.stderr).toBe("");
    expect(strictJson.stderr).toBe("");
  });

  it("compiles through W902 to stdout and --output while warning on stderr", async () => {
    const project = ruleFixture("exact-duplicate-potential");
    const expected = await expectedRuleDiagnostics("exact-duplicate-potential");
    const stdoutResult = await runDirectCli([
      "compile",
      project,
      "--diagnostics-json",
    ]);
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-cli-rules-warning-"),
    );
    temporaryRoots.push(temporaryRoot);
    const output = join(temporaryRoot, "compiled.ir.json");
    const fileResult = await runDirectCli([
      "compile",
      project,
      "--output",
      output,
    ]);

    expect(stdoutResult.exitCode).toBe(0);
    expect(JSON.parse(stdoutResult.stdout)).toMatchObject({
      format: "electrical-ir/0.1",
    });
    expect(stdoutResult.stdout).not.toContain('"code":');
    expect(stdoutResult.stderr).toBe(
      `${JSON.stringify(expected, undefined, 2)}\n`,
    );
    expect(JSON.parse(stdoutResult.stderr)).toEqual(expected);
    expect(stdoutResult.stderr).not.toContain("electrical-ir/0.1");

    expect(fileResult.exitCode).toBe(0);
    expect(fileResult.stdout).toBe("");
    expect(fileResult.stderr).toContain("W902");
    expect(fileResult.stderr).not.toContain("electrical-ir/0.1");
    expect(await readFile(output, "utf8")).toBe(stdoutResult.stdout);
  });

  it("suppresses IR and never creates or replaces --output for a rule error", async () => {
    const project = ruleFixture("invalid-cable-conductor");
    const expected = await expectedRuleDiagnostics("invalid-cable-conductor");
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-cli-rules-error-"),
    );
    temporaryRoots.push(temporaryRoot);
    const absent = join(temporaryRoot, "absent.ir.json");
    const existing = join(temporaryRoot, "existing.ir.json");
    const priorBytes = Buffer.from([0x00, 0x45, 0x53, 0xff, 0x0a]);
    await writeFile(existing, priorBytes);

    const [stdoutFailure, create, replace] = await Promise.all([
      runDirectCli(["compile", project]),
      runDirectCli([
        "compile",
        project,
        "--output",
        absent,
        "--diagnostics-json",
      ]),
      runDirectCli([
        "compile",
        project,
        "--output",
        existing,
        "--diagnostics-json",
      ]),
    ]);

    expect(stdoutFailure.exitCode).toBe(1);
    expect(stdoutFailure.stdout).toBe("");
    expect(stdoutFailure.stderr).toContain("E200");
    expect(stdoutFailure.stderr).not.toContain("electrical-ir/0.1");

    for (const result of [create, replace]) {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${JSON.stringify(expected, undefined, 2)}\n`);
      expect(result.stderr).not.toContain("electrical-ir/0.1");
    }
    await expect(readFile(absent)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(existing)).toEqual(priorBytes);
  });

  it("keeps subprocess diagnostics JSON isolated from successful warning IR", async ({
    skip,
  }) => {
    const project = ruleFixture("exact-duplicate-potential");
    const expected = await expectedRuleDiagnostics("exact-duplicate-potential");
    let result: CliInvocation;

    try {
      result = await runCliSubprocess([
        "compile",
        project,
        "--diagnostics-json",
      ]);
    } catch (error) {
      if (isChildProcessDenied(error)) {
        skip("The execution sandbox denied child-process creation.");
        return;
      }
      throw error;
    }

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: "electrical-ir/0.1",
    });
    expect(result.stdout).not.toContain('"code":');
    expect(result.stderr).toBe(`${JSON.stringify(expected, undefined, 2)}\n`);
    expect(JSON.parse(result.stderr)).toEqual(expected);
    expect(result.stderr).not.toContain("electrical-ir/0.1");
  });

  it("keeps subprocess rule-error diagnostics on stderr with no stdout IR", async ({
    skip,
  }) => {
    const project = ruleFixture("invalid-cable-conductor");
    const expected = await expectedRuleDiagnostics("invalid-cable-conductor");
    let result: CliInvocation;

    try {
      result = await runCliSubprocess([
        "compile",
        project,
        "--diagnostics-json",
      ]);
    } catch (error) {
      if (isChildProcessDenied(error)) {
        skip("The execution sandbox denied child-process creation.");
        return;
      }
      throw error;
    }

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${JSON.stringify(expected, undefined, 2)}\n`);
    expect(JSON.parse(result.stderr)).toEqual(expected);
  });

  it.each([
    [["check"], "unknown command 'check'"],
    [["rules"], "unknown command 'rules'"],
    [
      ["validate", ruleFixture("exact-duplicate-potential"), "--no-rules"],
      "unknown option '--no-rules'",
    ],
    [
      ["compile", ruleFixture("exact-duplicate-potential"), "--no-rules"],
      "unknown option '--no-rules'",
    ],
    [
      ["compile", ruleFixture("exact-duplicate-potential"), "--strict"],
      "unknown option '--strict'",
    ],
  ] as const)(
    "rejects nonexistent CLI surface: thermite %s",
    async (args, message) => {
      const result = await runDirectCli(args);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
    },
  );

  it("rejects all nonexistent CLI surface in subprocesses", async ({
    skip,
  }) => {
    const cases = [
      [["check"], "unknown command 'check'"],
      [["rules"], "unknown command 'rules'"],
      [
        ["validate", ruleFixture("exact-duplicate-potential"), "--no-rules"],
        "unknown option '--no-rules'",
      ],
      [
        ["compile", ruleFixture("exact-duplicate-potential"), "--no-rules"],
        "unknown option '--no-rules'",
      ],
      [
        ["compile", ruleFixture("exact-duplicate-potential"), "--strict"],
        "unknown option '--strict'",
      ],
    ] as const;

    for (const [args, message] of cases) {
      let result: CliInvocation;

      try {
        result = await runCliSubprocess(args);
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip("The execution sandbox denied child-process creation.");
          return;
        }
        throw error;
      }

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
    }
  });
});
