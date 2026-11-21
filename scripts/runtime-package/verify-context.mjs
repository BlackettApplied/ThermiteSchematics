import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { fileInventory } from "./common.mjs";
import { join } from "node:path";

async function createRestrictedEnvironment(temporary) {
  const tools = join(temporary, "restricted-bin");
  const home = join(temporary, "home");
  await mkdir(tools);
  await mkdir(home);
  for (const name of ["node", "npm", "npx", "git", "tsc", "bun"]) {
    await writeFile(
      join(tools, process.platform === "win32" ? `${name}.cmd` : name),
      process.platform === "win32"
        ? "@echo Unexpected development tool invocation 1>&2\r\n@exit /b 97\r\n"
        : '#!/bin/sh\necho "Unexpected development tool invocation" >&2\nexit 97\n',
    );
    if (process.platform !== "win32") await chmod(join(tools, name), 0o755);
  }
  // Keep development tools and caches out of consumer processes. Preserve
  // only Windows system locations needed to load OS libraries. Network
  // isolation is measured and reported separately on each platform.
  const env = {
    PATH: tools,
    HOME: home,
    USERPROFILE: home,
    TEMP: temporary,
    TMP: temporary,
    ...(process.platform === "win32"
      ? {
          SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
          WINDIR: process.env.WINDIR,
          ComSpec: process.env.ComSpec,
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
          LOCALAPPDATA: home,
          APPDATA: home,
        }
      : {}),
    TMPDIR: temporary,
    BUN_INSTALL_CACHE_DIR: join(home, "empty-cache"),
    NODE_PATH: "",
    LANG: "en_US.UTF-8",
  };
  return env;
}

async function createConsumerInvoker(temporary, runtime, execution) {
  const env = await createRestrictedEnvironment(temporary);
  const cli = join(runtime, "thermite.mjs");
  const invoke = (args, input, expected = 0, cwd = temporary) => {
    const result = spawnSync(
      execution.command,
      [...execution.prefix, cli, ...args],
      {
        cwd,
        env,
        input,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      expected,
      `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
    return result;
  };
  return { invoke, env };
}

export async function createConsumerContext(
  temporary,
  runtime,
  execution,
  entries,
  manifest,
  check,
  sourceCli,
) {
  // A mismatched build commit must be refused, then the original bytes restored.
  const guideProvenance = join(
    runtime,
    "node_modules/@thermite/cli/assets/guide/source.json",
  );
  const wrongCommit =
    manifest.commit === "a".repeat(40) ? "b".repeat(40) : "a".repeat(40);
  const before = await fileInventory(runtime);
  const { invoke, env } = await createConsumerInvoker(
    temporary,
    runtime,
    execution,
  );
  const context = {
    temporary,
    runtime,
    execution,
    entries,
    manifest,
    guideProvenance,
    wrongCommit,
    before,
    invoke,
    env,
    check,
    sourceCli,
  };
  return context;
}
