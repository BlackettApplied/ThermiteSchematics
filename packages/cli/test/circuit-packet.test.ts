import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  controlCircuitView,
  motorCircuitView,
} from "../../render/test/circuit-fixture.js";

const execute = promisify(execFileCallback);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

describe("circuit packet CLI", () => {
  it("exports the complete source-selected packet and preserves the prior artifact on an invalid selection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "thermite-circuit-cli-"));
    temporary.push(directory);
    const input = join(directory, "packet.request.json");
    const output = join(directory, "packet.json");
    const request = {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [motorCircuitView(), controlCircuitView()],
    };
    await writeFile(input, JSON.stringify(request));
    const args = [
      resolve("thermite.mjs"),
      "packet",
      "--project",
      resolve("examples/motor-starter"),
      "--input",
      input,
      "-o",
      output,
    ];
    const success = await execute(process.execPath, args);
    const report = JSON.parse(success.stderr);
    expect(report.error).toBeNull();
    const bytes = await readFile(output, "utf8");
    const packet = JSON.parse(bytes);
    expect(packet.sheets).toHaveLength(2);
    expect(packet.sheets.map((s: { number: number }) => s.number)).toEqual([
      1, 2,
    ]);
    const { document } = parseHTML(packet.html);
    expect(document.querySelectorAll("[data-circuit-conductor]")).toHaveLength(
      17,
    );
    expect(
      document.querySelectorAll('[data-circuit-mark="motor"]'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-circuit-mark="coil"]'),
    ).toHaveLength(1);
    expect(packet.sheets[0].svg).toContain("coil: 200");

    request.views[0] = {
      ...request.views[0]!,
      groups: [
        { ...request.views[0]!.groups[0]!, conductors: ["UNKNOWN-WIRE"] },
      ],
    };
    await writeFile(input, JSON.stringify(request));
    let failure: { code?: number; stderr?: string } | undefined;
    try {
      await execute(process.execPath, args);
    } catch (error) {
      failure = error as { code?: number; stderr?: string };
    }
    expect(failure?.code).toBe(1);
    const rejected = JSON.parse(failure!.stderr!);
    expect(rejected.error.code).toBe("R006");
    expect(rejected.error.message).toContain("UNKNOWN-WIRE");
    expect(await readFile(output, "utf8")).toBe(bytes);
  });
});
