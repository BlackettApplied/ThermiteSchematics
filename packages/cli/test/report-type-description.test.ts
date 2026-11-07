import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { runQuery } from "../src/index.js";

it("exposes full device/cable type text through opt-in human inspect without changing JSON or default output", async () => {
  const c = await compileProject(
    "packages/core-library/test/fixtures/dol-starter",
  );
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  for (const [designation, types] of [
    ["SRC1", c.ir.deviceTypes],
    ["CBL1", c.ir.cableTypes],
  ] as const) {
    const object = [...c.ir.devices, ...c.ir.cables].find(
      (d) => d.designation === designation,
    )!;
    const type = types.find((t) => t.id === object.typeId)!;
    type.description = "Full type text.\n" + "W".repeat(2000);
    const compile = async () => c;
    const request = { command: "inspect", designation } as const;
    const original = await runQuery(request, { compile });
    const full = await runQuery(request, { compile, typeDescription: true });
    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain(
      `  type-description ${JSON.stringify(type.description)}\n`,
    );
    expect(original.stdout).not.toContain("type-description");
    const json = await runQuery(request, { compile, json: true });
    const jsonWithFlag = await runQuery(request, {
      compile,
      json: true,
      typeDescription: true,
    });
    expect(jsonWithFlag).toEqual(json);
  }
});

it("exports full type text and Manufacturer through the actual CSV command", async () => {
  const project = "packages/core-library/test/fixtures/dol-starter";
  const c = await compileProject(project);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const directory = await mkdtemp(join(tmpdir(), "thermite-d1-csv-"));
  try {
    const output = join(directory, "bom.csv");
    await promisify(execFile)(process.execPath, [
      "thermite.mjs",
      "report",
      "bom",
      "--project",
      project,
      "-o",
      output,
    ]);
    const csv = await readFile(output, "utf8");
    expect(csv.split("\r\n")[0]).toContain('"Manufacturer"');
    expect(csv.split("\r\n")[0]).not.toContain('"Mfr."');
    for (const type of [
      c.ir.deviceTypes.find((t) => t.id === "core:estop-nc")!,
      c.ir.cableTypes.find((t) => t.id === "core:cable-power-4core")!,
    ])
      expect(csv).toContain(`"${type.description!.replaceAll('"', '""')}"`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
