import { execFileSync } from "node:child_process";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { exportBuildIdentity } from "../src/alpha-export-build.js";

function buildAt(cli: string) {
  const entry = pathToFileURL(join(cli, "dist", "alpha-export-build.js")).href;
  return execFileSync(
    process.execPath,
    [
      "-e",
      `
    import { exportBuildIdentity } from ${JSON.stringify(entry)};
    console.log(exportBuildIdentity());
  `,
    ],
    { encoding: "utf8" },
  ).trim();
}

it("binds reachable dist bytes across layouts and excludes orphaned compiler outputs", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "thermite build-"));
  try {
    const scope = join(runtime, "node_modules", "@thermite");
    await mkdir(scope, { recursive: true });
    await cp("bun.lock", join(runtime, "bun.lock"));
    for (const name of await readdir("packages")) {
      const source = join("packages", name);
      const target = join(scope, name);
      await mkdir(target);
      await cp(join(source, "package.json"), join(target, "package.json"));
      await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
      for (const asset of ["assets", "schemas", "library", "versions"])
        await cp(join(source, asset), join(target, asset), {
          recursive: true,
        }).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    const cli = join(scope, "cli");
    const original = buildAt(resolve("packages/cli"));
    expect(original).toMatch(/^[a-f0-9]{64}$/u);
    expect(exportBuildIdentity()).toBe(original);
    expect(buildAt(cli)).toBe(original);
    const render = join(scope, "render", "dist");
    await writeFile(
      join(render, "orphan.js"),
      "export const removed = true;\n",
    );
    expect(buildAt(cli)).toBe(original);
    await appendFile(
      join(render, "internal", "title-data", "entry.js"),
      "\nexport const changedBuild = true;\n",
    );
    expect(buildAt(cli)).not.toBe(original);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});
