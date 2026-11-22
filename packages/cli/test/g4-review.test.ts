import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DIAGNOSTIC_CATALOG } from "@thermite/schema";
import {
  ctx,
  entry,
  freshProject,
  ok,
  repositoryRoot,
  setUpSuite,
  tearDownSuite,
  thermite,
} from "./project-guide/harness.js";

beforeAll(setUpSuite);
afterAll(tearDownSuite);

it("explains and rejects linked snapshot parents while accepting the real path", async () => {
  const project = await freshProject("starter");
  const real = join(project, "output-real");
  const alias = join(project, "output-alias");
  await mkdir(real);
  await symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
  await writeFile(join(real, "before.json"), "sentinel");
  const rejected = await thermite(
    ["snapshot", "-o", "output-alias/before.json"],
    project,
  );
  expect(rejected.code).toBe(2);
  expect(rejected.stdout).toBe("");
  expect(JSON.parse(rejected.stderr).error).toMatchObject({
    code: "T001",
    message: expect.stringContaining("Refusing linked or non-ordinary path"),
  });
  expect(await readFile(join(real, "before.json"), "utf8")).toBe("sentinel");
  await ok(["snapshot", "-o", "output-real/before.json"], project);
  expect(
    JSON.parse(await readFile(join(real, "before.json"), "utf8")).format,
  ).toBe("thermite-snapshot/0.1");
  const topic = (await ok(["guide", "review"], project)).stdout;
  expect(topic).toContain("Output paths reject symlinked parents with T001");
  expect(topic).toContain("/private/tmp");
});

it("keeps the topic index discoverable from the project guide", async () => {
  const guide = await readFile(
    join(repositoryRoot, "packages/cli/assets/THERMITE_AGENTS.md"),
    "utf8",
  );
  expect(guide).toMatch(/`thermite guide` lists topics/);
  expect(Buffer.byteLength(guide)).toBeLessThanOrEqual(8000);
  const index = JSON.parse((await ok(["guide", "--json"], ctx.work)).stdout);
  expect(index.map((item: any) => item.id)).toContain("schema");
});

it("explains Q001 at each CLI and agent lookup site", async () => {
  const project = await freshProject("starter");
  for (const [args, input, message] of [
    [["continuity", "--input", "-"], "{}", "continuity-check-request/0.1"],
    [["diagnostics", "--location", "Nowhere"], "", "Unknown location"],
    [["diagnostics", "--device", "NOPE"], "", "Unknown device"],
    [
      ["agent", "inspect", "--input", "-"],
      JSON.stringify({
        format: "agent-tool-request/0.1",
        project: ".",
        selector: { by: "designation", value: "NOPE" },
      }),
      "No project object",
    ],
  ] as const) {
    const result = await thermite(args, project, input);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: "Q001",
      message: expect.stringContaining(message),
    });
  }
  for (const word of ["continuity", "scope", "UID", "designation"])
    expect(DIAGNOSTIC_CATALOG.Q001.meaning).toContain(word);
});

it("reports T001 from watch and keeps watching after a malformed request", async () => {
  const project = await freshProject("starter");
  await writeFile(join(project, "packet.json"), "{not json");
  const child = spawn(
    process.execPath,
    [entry, "watch", "--input", "packet.json", "-o", "drawing.html"],
    { cwd: project, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const closed = once(child, "close");
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(stderr || "watch produced no T001")),
        15000,
      );
      child.stderr.on("data", () => {
        if (stderr.includes('"code":"T001"')) {
          clearTimeout(deadline);
          resolve();
        }
      });
      child.once("error", reject);
    });
    expect(child.exitCode).toBeNull();
    for (const text of ["watch", "keeps"])
      expect(DIAGNOSTIC_CATALOG.T001.meaning).toContain(text);
  } finally {
    child.kill("SIGTERM");
    await closed;
  }
});

it("serves schema aliases as exact bytes", async () => {
  const schemas = JSON.parse(
    (await ok(["guide", "schema", "--json"], ctx.work)).stdout,
  );
  const schema = schemas.find((item: any) => item.name === "device");
  const bytes = await readFile(schema.path, "utf8");
  for (const alias of [schema.name, `${schema.name}.schema.json`, schema.$id])
    expect((await ok(["guide", "schema", alias], ctx.work)).stdout).toBe(bytes);
});

it("explains the CLI's R006 device context for multi-sheet SVG output", async () => {
  const project = await freshProject("starter");
  const request = {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
      },
      { format: "documentation-view-request/0.1", kind: "bom" },
    ],
  };
  const result = await thermite(
    ["packet", "--input", "-", "-o", "multi.svg"],
    project,
    JSON.stringify(request),
  );
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  const ps1 = {
    deviceUid: "33a15867-296b-40e4-a56b-15282f131b4c",
    designation: "PS1",
  };
  const plc1 = {
    deviceUid: "81148ad3-8c03-4c8d-8c70-6b33bb3b0266",
    designation: "PLC1",
  };
  expect(JSON.parse(result.stderr).error).toEqual({
    code: "R006",
    message: expect.stringContaining("requires 2 sheets"),
    details: { devices: [ps1, plc1] },
  });
  expect(DIAGNOSTIC_CATALOG.R006.meaning).toContain("without reason");
  expect(DIAGNOSTIC_CATALOG.R006.meaning).toContain(
    "known device designations",
  );
});
