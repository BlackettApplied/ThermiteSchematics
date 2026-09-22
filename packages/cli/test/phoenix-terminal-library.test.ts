import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFileCallback);

describe("Phoenix terminal catalog fixture", () => {
  it("preserves documented commons, knife separation, passive requirements and complete rendered coverage", async () => {
    const result = await execute(process.execPath, [
      resolve(
        "libraries/phoenix-terminal-pilot/examples/terminal-wiring/verify.mjs",
      ),
    ]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("four rendered sheets, knife separation");
  });
});
