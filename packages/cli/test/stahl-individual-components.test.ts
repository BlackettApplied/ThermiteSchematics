import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const exec = promisify(execFile);

test.each([
  ["23d01ba05", "23D01BA05"],
  ["8570-11-407", "8570/11-407"],
  ["8570-12-407", "8570/12-407"],
])(
  "STAHL %s preserves its researched component behavior",
  async (example, order) => {
    const result = await exec(process.execPath, [
      resolve(`libraries/stahl-pilot/examples/${example}/verify.mjs`),
    ]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(order);
  },
  30_000,
);
