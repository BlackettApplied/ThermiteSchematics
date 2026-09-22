import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CableResult,
  InspectResult,
  NeighborsResult,
  NetResult,
  QueryCommandResult,
  TraceResult,
} from "@thermite/query";
import { describe, expect, it } from "vitest";

import { runCli, type RunCliOptions } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const motorProject = join(repositoryRoot, "examples", "motor-starter");
const motorManifest = join(motorProject, "system.json");
const goldenRoot = join(packageRoot, "test", "goldens", "motor-starter");
const cliPath = join(packageRoot, "dist", "bin.js");

const cases = [
  { slug: "inspect-k1", args: ["inspect", "K1"] },
  { slug: "neighbors-k1", args: ["neighbors", "K1"] },
  { slug: "trace-ls1", args: ["trace", "LS1"] },
  { slug: "net-plc1-x1-0", args: ["net", "PLC1.X1.0"] },
  { slug: "cable-cbl1", args: ["cable", "CBL1"] },
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
  cwd = repositoryRoot,
): Promise<ByteInvocation> {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
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
        rejectInvocation(new Error(`query subprocess failed: ${signal}`));
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

function expectPortableStream(bytes: Buffer, allowEmpty: boolean): void {
  expect(bytes.includes(0x0d)).toBe(false);
  if (bytes.length === 0) {
    expect(allowEmpty).toBe(true);
    return;
  }
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
  expect(Buffer.from(bytes.toString("utf8"), "utf8")).toEqual(bytes);
}

async function golden(
  slug: string,
  stream: "stdout" | "stderr",
  format: "txt" | "json",
): Promise<Buffer> {
  return readFile(join(goldenRoot, `${slug}.${stream}.${format}`));
}

async function reviewedResult(slug: string): Promise<QueryCommandResult> {
  return JSON.parse(
    (await golden(slug, "stdout", "json")).toString("utf8"),
  ) as QueryCommandResult;
}

describe("Task 8 reviewed motor-starter goldens", () => {
  it.each(cases)(
    "byte-compares all four split streams for $slug",
    async ({ slug, args }) => {
      for (const json of [false, true]) {
        const format = json ? "json" : "txt";
        const actual = await invoke(
          [...args, "--project", motorProject, ...(json ? ["--json"] : [])],
          { cwd: repositoryRoot },
        );
        const expectedStdout = await golden(slug, "stdout", format);
        const expectedStderr = await golden(slug, "stderr", format);

        expect(actual.exitCode).toBe(0);
        expect(actual.stdout).toEqual(expectedStdout);
        expect(actual.stderr).toEqual(expectedStderr);
        expectPortableStream(actual.stdout, false);
        expectPortableStream(actual.stderr, !json);
        expectPortableStream(expectedStdout, false);
        expectPortableStream(expectedStderr, !json);

        if (json) {
          expect(JSON.parse(expectedStderr.toString("utf8"))).toEqual({
            diagnostics: [],
            error: null,
          });
        } else {
          expect(expectedStderr.byteLength).toBe(0);
        }
      }
    },
  );

  it("reviews K1 inspection counts, relations, and gang identity", async () => {
    const result = (await reviewedResult("inspect-k1")) as InspectResult;
    expect(result.command).toBe("inspect");
    expect(result.object).toMatchObject({
      kind: "device",
      typeId: "core:contactor-3p-1no",
    });
    if (result.object.kind !== "device") throw new Error("Expected K1 device");
    expect(result.object.terminals).toHaveLength(10);
    expect(result.object.functions).toHaveLength(5);
    expect(result.object.internalRelations).toHaveLength(6);
    expect(result.object.projectRelations).toHaveLength(1);
    expect(result.object.gangedGroups).toEqual([
      {
        id: "gang:sha256:5773084aeee691fec9a44d5d5b388662b42cb5d85e50af67ea24b559d6ec928a",
        functionKeys: ["pole1", "pole2", "pole3"],
      },
    ]);
  });

  it("reviews K1 physical and project-relation neighbors", async () => {
    const result = (await reviewedResult("neighbors-k1")) as NeighborsResult;
    expect(result.command).toBe("neighbors");
    expect(result.conductive).toHaveLength(8);
    const representedTerminals = result.conductive.map(
      ({ terminal }) => terminal.id.terminalKey,
    );
    expect(representedTerminals).not.toContain("13");
    expect(representedTerminals).not.toContain("14");
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      direction: "incoming",
      otherDevice: { designation: "PLC1" },
      relation: {
        designation: "REL-CONTROLS-001",
        display: "REL-CONTROLS-001",
        verb: "controls",
        from: { designation: "PLC1" },
        to: { designation: "K1" },
      },
    });
  });

  it("reviews both LS1 conductive components", async () => {
    const result = (await reviewedResult("trace-ls1")) as TraceResult;
    expect(result.command).toBe("trace");
    expect(result.components).toHaveLength(2);
    const [supply, switchedReturn] = result.components;
    expect(supply?.roots.map(({ display }) => display)).toEqual(["LS1.13"]);
    expect(supply?.net.potentials.map(({ name }) => name)).toEqual(["+24VDC"]);
    expect(supply?.visits).toHaveLength(6);
    expect(supply?.elements).toHaveLength(5);
    expect(switchedReturn?.roots.map(({ display }) => display)).toEqual([
      "LS1.14",
    ]);
    expect(switchedReturn?.visits).toHaveLength(4);
    expect(switchedReturn?.elements).toHaveLength(3);
  });

  it("reviews the complete PLC1.X1.0 net", async () => {
    const result = (await reviewedResult("net-plc1-x1-0")) as NetResult;
    expect(result.command).toBe("net");
    expect(result.selectedTerminal.display).toBe("PLC1.X1.0");
    expect(result.net.potentials).toEqual([]);
    expect(result.net.terminals.map(({ display }) => display)).toEqual([
      "JB1.X1.2",
      "LS1.14",
      "PLC1.X1.0",
      "TB1.3",
    ]);
    expect(result.net.elements.map(({ element }) => element.display)).toEqual([
      "W-FLD-001",
      "W-FLD-003",
      "CBL1.1-",
    ]);
  });

  it("reviews CBL1 conductor metadata and potentials", async () => {
    const result = (await reviewedResult("cable-cbl1")) as CableResult;
    expect(result.command).toBe("cable");
    expect(
      result.conductors.map(({ id, color, size, net }) => ({
        id: id.conductorId,
        color,
        size,
        potentials: net.potentials.map(({ name }) => name),
      })),
    ).toEqual([
      { id: "1+", color: "black", size: "18AWG", potentials: ["+24VDC"] },
      { id: "1-", color: "white", size: "18AWG", potentials: [] },
      { id: "2+", color: "red", size: "18AWG", potentials: ["0VDC"] },
      { id: "2-", color: "green", size: "18AWG", potentials: [] },
    ]);
  });
});

describe("Task 8 project-form and repeated-run determinism", () => {
  it.each(cases)(
    "keeps $slug bytes identical from cwd, directory, and manifest forms",
    async ({ slug, args }) => {
      for (const json of [false, true]) {
        const format = json ? "json" : "txt";
        const suffix = json ? ["--json"] : [];
        const expectedStdout = await golden(slug, "stdout", format);
        const expectedStderr = await golden(slug, "stderr", format);
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
          expect(actual.exitCode).toBe(0);
          expect(actual.stdout).toEqual(expectedStdout);
          expect(actual.stderr).toEqual(expectedStderr);
        }
      }
    },
  );

  it(
    "matches goldens across repeated fresh CLI processes",
    { timeout: 120_000 },
    async ({ skip }) => {
      for (const { slug, args } of cases) {
        for (const json of [false, true]) {
          const format = json ? "json" : "txt";
          const invocationArgs = [
            ...args,
            "--project",
            motorProject,
            ...(json ? ["--json"] : []),
          ];
          let first: ByteInvocation;
          let second: ByteInvocation;
          try {
            first = await invokeSubprocess(invocationArgs);
            second = await invokeSubprocess(invocationArgs);
          } catch (error) {
            if (isChildProcessDenied(error)) {
              skip("The execution sandbox denied child-process creation.");
              return;
            }
            throw error;
          }
          const expectedStdout = await golden(slug, "stdout", format);
          const expectedStderr = await golden(slug, "stderr", format);
          expect(first).toEqual(second);
          expect(first).toEqual({
            exitCode: 0,
            stdout: expectedStdout,
            stderr: expectedStderr,
          });
        }
      }
    },
  );
});
