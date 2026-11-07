import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { computeFileIntegrity } from "@thermite/compiler";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const launcher = join(root, "thermite.mjs");
const sourceFile = "devices/equipment.json";

async function cli(project: string, tool: string, request: unknown) {
  const input = join(project, "test.request.json");
  await writeFile(input, JSON.stringify(request));
  try {
    const result = await execute(
      "bun",
      [launcher, "agent", tool, "--input", input],
      { cwd: project },
    );
    return { code: 0, ...result, report: JSON.parse(result.stderr) };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { ...result, report: JSON.parse(result.stderr) };
  } finally {
    await rm(input);
  }
}

async function snapshot(project: string) {
  const result: Record<string, string> = {};
  for (const file of (await readdir(project, { recursive: true })).sort()) {
    const path = join(project, file);
    if ((await stat(path)).isFile())
      result[file.replaceAll("\\", "/")] = computeFileIntegrity(
        await readFile(path),
      );
  }
  return result;
}

it("executes the guide's schema repair example through the built CLI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thermite-schema-guide-"));
  const project = join(directory, "project");
  try {
    await execute("bun", [launcher, "init", project]);
    const path = join(project, sourceFile);
    const source = JSON.parse(await readFile(path, "utf8"));
    const uid = source.objects[0].uid;
    expect(uid.toUpperCase()).not.toBe(uid);
    source.objects[0].uid = uid.toUpperCase();
    source.objects[0].unexpected = true;
    await writeFile(path, `${JSON.stringify(source, null, 2)}\n`);
    const base = { format: "agent-tool-request/0.1", project: "." };
    const invalid = await cli(project, "validate", base);
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toBe("");
    expect(
      invalid.report.diagnostics.map((d: { code: string }) => d.code).sort(),
    ).toEqual(["E012", "E013", "I208"]);

    const guide = await readFile(join(root, "docs/agent-requests.md"), "utf8");
    const example = [
      ...guide.matchAll(/```js repair-schema\.mjs\n([\s\S]*?)```/gu),
    ];
    expect(example).toHaveLength(1);
    await writeFile(join(project, "repair-schema.mjs"), example[0]![1]!);
    await execute("bun", ["repair-schema.mjs"], { cwd: project });
    const input = JSON.parse(
      await readFile(join(project, "repair-schema.request.json"), "utf8"),
    );
    expect(input.files[0].expectedIntegrity).toBe(
      computeFileIntegrity(await readFile(path)),
    );
    expect(input.files[0].operations[0]).toEqual({
      op: "test",
      path: "/objects/0/uid",
      value: uid.toUpperCase(),
    });
    const before = await snapshot(project);
    const dry = await cli(project, "apply-source-patch", input);
    expect(dry.code, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).value).toMatchObject({
      dryRun: true,
      applied: false,
    });
    expect(await snapshot(project)).toEqual(before);
    const applied = await cli(project, "apply-source-patch", {
      ...input,
      dryRun: false,
    });
    expect(applied.code, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout).value.files).toEqual(
      JSON.parse(dry.stdout).value.files,
    );
    const after = await snapshot(project);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(
      Object.keys(after).filter((file) => before[file] !== after[file]),
    ).toEqual([sourceFile]);
    expect(JSON.parse(await readFile(path, "utf8")).objects[0].uid).toBe(uid);
    const valid = await cli(project, "validate", base);
    expect(valid.code, valid.stderr).toBe(0);
    expect(JSON.parse(valid.stdout).value.valid).toBe(true);
    expect(valid.report.error).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([true, false])(
  "reports A006 with the parser's file and coordinates (dryRun=%s)",
  async (dryRun) => {
    const directory = await mkdtemp(join(tmpdir(), "thermite-schema-syntax-"));
    const project = join(directory, "project");
    try {
      await execute("bun", [launcher, "init", project]);
      const path = join(project, sourceFile);
      await writeFile(path, '{\n  "objects": [\n}\n');
      const before = await snapshot(project);
      const outcome = await cli(project, "apply-source-patch", {
        format: "agent-tool-request/0.1",
        project: ".",
        patchFormat: "json-patch/0.1",
        dryRun,
        files: [
          {
            path: sourceFile,
            expectedIntegrity: before[sourceFile],
            operations: [{ op: "test", path: "", value: {} }],
          },
        ],
      });
      expect(outcome.code).toBe(1);
      expect(outcome.stdout).toBe("");
      const parserError = outcome.report.diagnostics.find(
        (d: { code: string }) => d.code === "E002",
      );
      expect(outcome.report.error).toMatchObject({
        code: "A006",
        file: sourceFile,
        line: parserError.line,
        column: parserError.column,
      });
      expect(outcome.report.error.message).toContain(
        "thermite guide agent-requests",
      );
      expect(await snapshot(project)).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
