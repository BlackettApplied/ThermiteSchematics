import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { fileStateAsync } from "./audit.mjs";
import { score } from "./score-log.mjs";

const real = fileURLToPath(new URL("../../thermite.mjs", import.meta.url));

it.each([
  ["syntax", "{", "E002", true],
  ["duplicate key", '{"objects":[],"objects":[]}', "E003", true],
  ["schema", '{"objects":[],"unexpected":true}', "E012", false],
  ["non-object root", "null", "E011", false],
  ["authored parser marker", '{"$invalidJSON":true}', "E012", false],
])("V1 JSON repair exemption: %s", async (_name, bytes, code, exempt) => {
  const project = mkdtempSync(join(tmpdir(), "eval-json-repair-"));
  try {
    writeFileSync(
      join(project, "system.json"),
      JSON.stringify({ sources: ["source.json"] }),
    );
    writeFileSync(join(project, "source.json"), bytes);
    const capture = async () => ({
      status: 1,
      stdout: JSON.stringify([{ code, file: "source.json" }]),
      stderr: "",
    });
    const before = await fileStateAsync(project, real, {}, undefined, capture);
    expect(before.invalidJsonFiles.includes("source.json")).toBe(exempt);
    const unchanged = await fileStateAsync(
      project,
      real,
      { THERMITE_EVAL_SCHEMA_VALIDATE: "0" },
      before,
    );
    expect(unchanged.invalidJsonFiles.includes("source.json")).toBe(exempt);
    writeFileSync(join(project, "source.json"), '{"objects":[]}');
    const after = await fileStateAsync(
      project,
      real,
      { THERMITE_EVAL_SCHEMA_VALIDATE: "0" },
      before,
    );
    expect(after.invalidJsonFiles).toEqual([]);
    const violations = score({ initial: before, final: after }).violations;
    expect(violations.filter((v) => v.rule === "V1")).toHaveLength(
      exempt ? 0 : 1,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

it("invalid JSON never exempts a hand-edited lock", () => {
  const before = {
    files: { "electrical-system.lock.json": "a" },
    invalidJsonFiles: ["electrical-system.lock.json"],
  };
  const after = { ...before, files: { "electrical-system.lock.json": "b" } };
  expect(
    score({ initial: before, final: after }).violations.map((v) => v.rule),
  ).toEqual(["V2"]);
});
