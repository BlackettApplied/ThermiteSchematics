import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect } from "vitest";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

export const manifestName = "export-manifest.json";
export async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
export async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function fixture(name = "conveyor-line") {
  const parent = await mkdtemp(
    join(realpathSync.native(tmpdir()), "thermite-fresh-"),
  );
  temporary.push(parent);
  const project = join(parent, "project");
  await cp(resolve("examples", name), project, { recursive: true });
  const input = join(project, "delivery.json");
  const out = join(project, "drawings");
  const plan = async (...jobs: unknown[]) =>
    writeJson(input, { format: "export-delivery-request/1", jobs });
  const cliFor = (root: string, ...args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn(
          process.execPath,
          [resolve("thermite.mjs"), ...args, "--project", root],
          {
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.setEncoding("utf8").on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code === null) reject(new Error(`CLI terminated by ${signal}.`));
          else done({ code, stdout, stderr });
        });
      },
    );
  const cli = (...args: string[]) => cliFor(project, ...args);
  const exportArgs = (verb: string, ...options: string[]) => [
    "export",
    verb,
    "--input",
    input,
    "--out-dir",
    out,
    ...options,
  ];
  const bundle = async () => cli(...exportArgs("bundle"));
  const check = async (...options: string[]) => {
    const result = await cli(...exportArgs("check", "--json", ...options));
    return { ...result, findings: JSON.parse(result.stdout) };
  };
  return {
    parent,
    project,
    input,
    out,
    plan,
    cli,
    cliFor,
    exportArgs,
    bundle,
    check,
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function mustSucceed(result: Awaited<ReturnType<Fixture["cli"]>>) {
  expect(result.code, result.stderr).toBe(0);
}

export function reportJob(report: string, filter?: string) {
  return {
    kind: "report",
    report,
    ...(filter ? { filter } : {}),
    outputs: { csv: report + ".csv" },
  };
}

export function reportView(kind: string) {
  return { format: "documentation-view-request/0.1", kind };
}
export function powerView(flow = "left-to-right") {
  return {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "M1" },
    family: "power",
    flow,
  };
}

export async function motorPacket(
  project: string,
  views: unknown[] = [powerView()],
) {
  await writeJson(join(project, "packet.json"), {
    format: "schematic-packet-request/0.1",
    views,
  });
}
export async function makeStandaloneDir(project: string) {
  const directory = join(project, "standalone");
  await mkdir(directory);
  return directory;
}
