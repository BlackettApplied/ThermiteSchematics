import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const exec = promisify(execFile);

test("STAHL catalog fixture preserves switches, factory links, cap and PE requirements", async () => {
  const result = await exec(process.execPath, [
    resolve("libraries/stahl-pilot/examples/component-check/verify.mjs"),
  ]);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Verified five STAHL catalog entries");
}, 30_000);
