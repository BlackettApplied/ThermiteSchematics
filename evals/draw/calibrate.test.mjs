import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["path", "url"])(
  "loads a calibration browser module from a %s with spaces and URL characters",
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "thermite calibrate-"));
    try {
      const modulePath = join(directory, "browser #%.mjs");
      await writeFile(
        modulePath,
        'export function launch() { throw new Error("calibration import reached"); }',
      );
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL("./calibrate.mjs", import.meta.url)), directory],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            BROWSER_MODULE:
              kind === "path" ? modulePath : pathToFileURL(modulePath).href,
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("calibration import reached");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
