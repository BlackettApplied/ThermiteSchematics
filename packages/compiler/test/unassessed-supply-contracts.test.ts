import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { compileProject, serializeIr } from "../src/index.js";
import {
  device,
  end,
  node,
  potential,
  project,
  wire,
} from "./validation-fixture.js";

const launcher = resolve("thermite.mjs");
const dc = { voltage_type: "DC", nominal_voltage: 24 };
const objects = [device(1, "K1"), wire(2, end("K1", "A1"), end("K1", "other"))];
const types = [
  node({
    A1: { rating: dc },
    other: {},
    a: { rating: dc },
    b: { rating: { voltage_type: "AC", nominal_voltage: 480 } },
  }),
];
const run = (
  args: string[],
  input?: unknown,
  env = process.env,
  cwd = tmpdir(),
) => {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    cwd,
    env,
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
  });
  expect(result.error).toBeUndefined();
  return result;
};

it("keeps strict info-only exit 0, warning/error exit 1 and infrastructure exit 2", async () => {
  const root = await project(objects, types);
  const info = run(["validate", root, "--strict", "--json"]);
  expect(info.status).toBe(0);
  expect(info.stderr).toBe("");
  expect(JSON.parse(info.stdout).map((d: any) => [d.code, d.severity])).toEqual(
    [["I305", "info"]],
  );
  for (const [TZ, LC_ALL] of [
    ["UTC", "C"],
    ["Pacific/Auckland", "tr_TR.UTF-8"],
  ]) {
    const changed = run(
      ["validate", root, "--strict", "--json"],
      undefined,
      { ...process.env, TZ, LC_ALL },
      root,
    );
    expect([changed.status, changed.stdout, changed.stderr]).toEqual([
      info.status,
      info.stdout,
      info.stderr,
    ]);
  }
  const source = join(root, "objects.json");
  const bad = [...objects, wire(3, end("K1", "a"), end("K1", "b"))];
  await writeFile(source, JSON.stringify({ objects: bad }, null, 2) + "\n");
  const warning = run(["validate", root, "--strict", "--json"]);
  expect(warning.status).toBe(1);
  expect(JSON.parse(warning.stdout).map((d: any) => d.code)).toEqual([
    "W303",
    "I304",
    "I305",
  ]);
  await writeFile(
    source,
    JSON.stringify(
      {
        objects: [...bad, potential(4, end("K1", "b"), { voltage_type: "AC" })],
      },
      null,
      2,
    ) + "\n",
  );
  const error = run(["validate", root, "--json"]);
  expect(error.status).toBe(1);
  expect(JSON.parse(error.stdout).map((d: any) => d.code)).toEqual([
    "E301",
    "I208",
    "I305",
  ]);
  const missing = run(["validate", join(root, "missing"), "--json"]);
  expect(missing.status).toBe(2);
  expect(JSON.parse(missing.stdout).map((d: any) => d.code)).toEqual([
    "E001",
    "I208",
  ]);
});

it("preserves split agent streams and guarded dry-run/apply with unchanged IR", async () => {
  const root = await project(objects, types);
  const before = await compileProject(root);
  if (!before.ok) throw Error(JSON.stringify(before.diagnostics));
  const bytes = await readFile(join(root, "objects.json"));
  const request = {
    format: "agent-tool-request/0.1",
    project: root,
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: [
      {
        path: "objects.json",
        expectedIntegrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
        operations: [
          { op: "test", path: "/objects/1/designation", value: "W2" },
          { op: "replace", path: "/objects/1/designation", value: "W2" },
        ],
      },
    ],
  };
  for (const dryRun of [true, false]) {
    const result = run(["agent", "apply-source-patch", "--input", "-"], {
      ...request,
      dryRun,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: "agent-tool-result/0.1",
      tool: "apply-source-patch",
      // The idempotent replacement has no bytes to write in either mode.
      value: { dryRun, applied: false, atomicity: "per-file" },
    });
    expect(JSON.parse(result.stderr)).toMatchObject({
      format: "agent-tool-report/0.1",
      error: null,
      diagnostics: [
        expect.objectContaining({ code: "I305", severity: "info" }),
      ],
    });
    expect(await readFile(join(root, "objects.json"))).toEqual(bytes);
    const after = await compileProject(root);
    if (!after.ok) throw Error(JSON.stringify(after.diagnostics));
    expect(serializeIr(after.ir)).toBe(serializeIr(before.ir));
  }
});
