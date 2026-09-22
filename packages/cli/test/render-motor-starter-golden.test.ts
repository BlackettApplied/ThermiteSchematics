import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createMotorStarterPnpExperiment,
  type MotorStarterPnpExperiment,
} from "../../render/test/motor-starter-pnp-fixture.js";
import { runCli, type RunCliOptions } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const motorProject = join(repositoryRoot, "examples", "motor-starter");
const motorManifest = join(motorProject, "system.json");
const goldenRoot = join(packageRoot, "test", "goldens", "motor-starter");
const pnpGoldenRoot = join(packageRoot, "test", "goldens", "motor-starter-pnp");
const rendererGoldenRoot = join(
  repositoryRoot,
  "packages",
  "render",
  "test",
  "goldens",
  "motor-starter",
);
const pnpRendererGoldenRoot = join(
  repositoryRoot,
  "packages",
  "render",
  "test",
  "goldens",
  "motor-starter-pnp",
);
const cliPath = join(packageRoot, "dist", "bin.js");

const cases = [
  {
    slug: "render-k1-control-left-to-right",
    args: ["render", "K1", "--family", "control"],
    command: "render",
    rendererGolden: "k1-control-left-to-right.svg",
  },
  {
    slug: "render-m1-power-left-to-right",
    args: ["render", "M1", "--family", "power"],
    command: "render",
    rendererGolden: "m1-power-left-to-right.svg",
  },
  {
    slug: "view-m1-power-left-to-right",
    args: ["view", "M1", "--power"],
    command: "view",
    rendererGolden: "m1-power-left-to-right.svg",
  },
  {
    slug: "view-k1-actuation-left-to-right",
    args: ["view", "K1", "--actuation"],
    command: "view",
    rendererGolden: "k1-control-left-to-right.svg",
  },
  {
    slug: "view-ls1-to-plc1-include-power-left-to-right",
    args: ["view", "LS1", "--to", "PLC1", "--include-power"],
    command: "view",
    rendererGolden: "ls1-to-plc1-include-power-left-to-right.svg",
  },
  {
    slug: "view-cbl1-conductors-left-to-right",
    args: ["view", "CBL1", "--conductors"],
    command: "view",
    rendererGolden: "cbl1-conductors-left-to-right.svg",
  },
  {
    slug: "view-ps1-loads-left-to-right",
    args: ["view", "PS1", "--loads"],
    command: "view",
    rendererGolden: "ps1-loads-left-to-right.svg",
  },
] as const;

const pnpCases = [
  {
    slug: "view-k1-actuation-left-to-right",
    args: ["view", "K1", "--actuation"],
    rendererGolden: "k1-control-left-to-right.svg",
  },
  {
    slug: "view-ls1-to-plc1-include-power-left-to-right",
    args: ["view", "LS1", "--to", "PLC1", "--include-power"],
    rendererGolden: "ls1-to-plc1-include-power-left-to-right.svg",
  },
  {
    slug: "view-cbl1-conductors-left-to-right",
    args: ["view", "CBL1", "--conductors"],
    rendererGolden: "cbl1-conductors-left-to-right.svg",
  },
  {
    slug: "view-ps1-loads-left-to-right",
    args: ["view", "PS1", "--loads"],
    rendererGolden: "ps1-loads-left-to-right.svg",
  },
] as const;

interface ByteInvocation {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

async function invoke(
  args: readonly string[],
  options: Omit<RunCliOptions, "stdout" | "stderr"> = {},
): Promise<ByteInvocation> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const exitCode = await runCli(["node", "thermite", ...args], {
    ...options,
    stdout: { write: (text) => stdout.push(Buffer.from(text, "utf8")) },
    stderr: { write: (text) => stderr.push(Buffer.from(text, "utf8")) },
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr),
  };
}

async function invokeSubprocess(
  args: readonly string[],
): Promise<ByteInvocation> {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectInvocation);
    child.once("close", (exitCode, signal) => {
      if (signal !== null || exitCode === null) {
        rejectInvocation(new Error(`render subprocess failed: ${signal}`));
      } else {
        resolveInvocation({
          exitCode,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
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

function expectPortableStream(
  bytes: Buffer,
  allowEmpty: boolean,
  additionalForbiddenPaths: readonly string[] = [],
): void {
  expect(bytes.includes(0x0d)).toBe(false);
  if (bytes.length === 0) {
    expect(allowEmpty).toBe(true);
    return;
  }
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
  const text = bytes.toString("utf8");
  expect(Buffer.from(text, "utf8")).toEqual(bytes);
  expect(text).not.toMatch(/\u001b\[[0-?]*[ -/]*[@-~]/u);
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
  expect(text).not.toMatch(
    /\b(?:locale|timezone|timestamp|process-id|processId|pid|random)\b/iu,
  );
  for (const path of [
    repositoryRoot,
    motorProject,
    tmpdir(),
    ...additionalForbiddenPaths,
  ].flatMap((path) => [path, path.replaceAll(String.fromCharCode(92), "/")])) {
    expect(text).not.toContain(path);
  }
  expect(text).not.toMatch(
    /(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\\\\[^\\]|\/(?:home|tmp|Users)\//u,
  );
}

async function golden(
  slug: string,
  stream: "stdout" | "stderr",
  extension: "svg" | "txt" | "json",
): Promise<Buffer> {
  return readFile(join(goldenRoot, `${slug}.${stream}.${extension}`));
}

describe("M5 Task 8 and M6 Task 6 reviewed schematic CLI goldens", () => {
  it.each(cases)(
    "byte-compares all four split streams for $slug",
    async ({ slug, args, command, rendererGolden }) => {
      for (const json of [false, true]) {
        const actual = await invoke([
          ...args,
          "--project",
          motorProject,
          ...(json ? ["--json"] : []),
        ]);
        const expectedStdout = await golden(
          slug,
          "stdout",
          json ? "json" : "svg",
        );
        const expectedStderr = await golden(
          slug,
          "stderr",
          json ? "json" : "txt",
        );

        expect(actual).toEqual({
          exitCode: 0,
          stdout: expectedStdout,
          stderr: expectedStderr,
        });
        expectPortableStream(actual.stdout, false);
        expectPortableStream(actual.stderr, !json);

        if (json) {
          const result = JSON.parse(expectedStdout.toString("utf8")) as {
            command: string;
            artifact: { kind: string; svg: string };
          };
          expect(result.command).toBe(command);
          expect(result.artifact.kind).toBe("inline");
          expect(Buffer.from(result.artifact.svg, "utf8")).toEqual(
            await readFile(join(rendererGoldenRoot, rendererGolden)),
          );
          expect(JSON.parse(expectedStderr.toString("utf8"))).toEqual({
            diagnostics: [],
            error: null,
          });
        } else {
          expect(expectedStdout).toEqual(
            await readFile(join(rendererGoldenRoot, rendererGolden)),
          );
          expect(expectedStderr.byteLength).toBe(0);
        }
      }
    },
  );

  it.each([
    ["render-m1-power-left-to-right", "view-m1-power-left-to-right"],
    ["render-k1-control-left-to-right", "view-k1-actuation-left-to-right"],
  ] as const)(
    "keeps the %s and %s normalized view, summary, and SVG exact aliases",
    async (renderSlug, viewSlug) => {
      const renderJson = JSON.parse(
        (await golden(renderSlug, "stdout", "json")).toString("utf8"),
      ) as Record<string, unknown>;
      const viewJson = JSON.parse(
        (await golden(viewSlug, "stdout", "json")).toString("utf8"),
      ) as Record<string, unknown>;
      expect({ ...viewJson, command: "render" }).toEqual(renderJson);
      expect(await golden(viewSlug, "stdout", "svg")).toEqual(
        await golden(renderSlug, "stdout", "svg"),
      );
    },
  );

  it.each(cases)(
    "keeps $slug bytes identical from cwd, directory, and manifest forms",
    async ({ slug, args }) => {
      for (const json of [false, true]) {
        const suffix = json ? ["--json"] : [];
        const expectedStdout = await golden(
          slug,
          "stdout",
          json ? "json" : "svg",
        );
        const expectedStderr = await golden(
          slug,
          "stderr",
          json ? "json" : "txt",
        );
        const forms = [
          await invoke([...args, ...suffix], { cwd: motorProject }),
          await invoke([...args, "--project", motorProject, ...suffix], {
            cwd: repositoryRoot,
          }),
          await invoke([...args, "--project", motorManifest, ...suffix], {
            cwd: repositoryRoot,
          }),
        ];
        for (const actual of forms) {
          expect(actual).toEqual({
            exitCode: 0,
            stdout: expectedStdout,
            stderr: expectedStderr,
          });
        }
      }
    },
  );

  it(
    "matches both split-stream goldens across repeated fresh CLI processes",
    { timeout: 120_000 },
    async ({ skip }) => {
      for (const { slug, args: commandArgs } of cases) {
        for (const json of [false, true]) {
          const args = [
            ...commandArgs,
            "--project",
            motorProject,
            ...(json ? ["--json"] : []),
          ];
          let first: ByteInvocation;
          let second: ByteInvocation;
          try {
            first = await invokeSubprocess(args);
            second = await invokeSubprocess(args);
          } catch (error) {
            if (isChildProcessDenied(error)) {
              skip("The execution sandbox denied child-process creation.");
              return;
            }
            throw error;
          }
          expect(first).toEqual(second);
          expect(first).toEqual({
            exitCode: 0,
            stdout: await golden(slug, "stdout", json ? "json" : "svg"),
            stderr: await golden(slug, "stderr", json ? "json" : "txt"),
          });
        }
      }
    },
  );
});

describe("M6 amended Task 7 reviewed PNP schematic CLI goldens", () => {
  let experiment: MotorStarterPnpExperiment;

  beforeAll(async () => {
    experiment = await createMotorStarterPnpExperiment();
    await experiment.applyTypeOnlyEdit();
    await experiment.applyCompletedEdit();
  });

  afterAll(async () => {
    await experiment.cleanup();
  });

  it.each(pnpCases)(
    "byte-compares both split-stream modes for $slug",
    async ({ slug, args, rendererGolden }) => {
      for (const json of [false, true]) {
        const actual = await invoke([
          ...args,
          "--project",
          experiment.projectRoot,
          ...(json ? ["--json"] : []),
        ]);
        const expectedStdout = await readFile(
          join(pnpGoldenRoot, `${slug}.stdout.${json ? "json" : "svg"}`),
        );
        const expectedStderr = await readFile(
          join(pnpGoldenRoot, `${slug}.stderr.${json ? "json" : "txt"}`),
        );

        expect(actual).toEqual({
          exitCode: 0,
          stdout: expectedStdout,
          stderr: expectedStderr,
        });
        const experimentPaths = [
          experiment.root,
          experiment.projectRoot,
          experiment.libraryRoot,
        ];
        expectPortableStream(actual.stdout, false, experimentPaths);
        expectPortableStream(actual.stderr, !json, experimentPaths);
        if (json) {
          const result = JSON.parse(expectedStdout.toString("utf8")) as {
            artifact: { kind: string; svg: string };
          };
          expect(result.artifact.kind).toBe("inline");
          expect(Buffer.from(result.artifact.svg, "utf8")).toEqual(
            await readFile(join(pnpRendererGoldenRoot, rendererGolden)),
          );
          expect(JSON.parse(expectedStderr.toString("utf8"))).toEqual({
            diagnostics: [],
            error: null,
          });
        } else {
          expect(expectedStdout).toEqual(
            await readFile(join(pnpRendererGoldenRoot, rendererGolden)),
          );
          expect(expectedStderr.byteLength).toBe(0);
        }
      }
    },
  );

  it(
    "matches the four PNP split-stream goldens across repeated fresh CLI processes",
    { timeout: 120_000 },
    async ({ skip }) => {
      for (const { slug, args: commandArgs } of pnpCases) {
        for (const json of [false, true]) {
          const args = [
            ...commandArgs,
            "--project",
            experiment.projectRoot,
            ...(json ? ["--json"] : []),
          ];
          let first: ByteInvocation;
          let second: ByteInvocation;
          try {
            first = await invokeSubprocess(args);
            second = await invokeSubprocess(args);
          } catch (error) {
            if (isChildProcessDenied(error)) {
              skip("The execution sandbox denied child-process creation.");
              return;
            }
            throw error;
          }
          expect(first).toEqual(second);
          expect(first).toEqual({
            exitCode: 0,
            stdout: await readFile(
              join(pnpGoldenRoot, `${slug}.stdout.${json ? "json" : "svg"}`),
            ),
            stderr: await readFile(
              join(pnpGoldenRoot, `${slug}.stderr.${json ? "json" : "txt"}`),
            ),
          });
        }
      }
    },
  );
});
