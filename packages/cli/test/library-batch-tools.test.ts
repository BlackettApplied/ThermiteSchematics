import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../..", import.meta.url));

describe("component research batch tools", () => {
  it("checks queue lifecycle, candidate validation and reviewed promotion", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "scripts/library-batch/prepare.check.mjs",
        "scripts/library-batch/run.check.mjs",
        "scripts/library-batch/verify.check.mjs",
        "scripts/library-batch/promote.check.mjs",
      ],
      { cwd: repository, encoding: "utf8", timeout: 120_000 },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.error).toBeUndefined();
  }, 125_000);
});
