import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { contributorRealpath } from "./contributor-bun.mjs";
import { shellCommand } from "./launch.mjs";

// Only contributor tasks use the observer. The normal Thermite shim and
// transcript scorers still handle T/D runs exactly as before.
export function contributorCommandEnvironment(ctx, bin) {
  const { checkout, focused } = ctx.task.contributor;
  mkdirSync(bin);
  const worker = join(bin, "observe-bun.mjs");
  copyFileSync(new URL("./contributor-bun.mjs", import.meta.url), worker);
  writeFileSync(
    join(bin, "contributor.json"),
    JSON.stringify({
      checkout: join(contributorRealpath(ctx.project), checkout),
      focused,
      log: join(ctx.evidence, "contributor-commands.jsonl"),
    }),
  );
  const argv = [process.execPath, worker];
  if (process.platform === "win32")
    writeFileSync(
      join(bin, "bun.cmd"),
      `@echo off\r\n"${argv[0]}" "${argv[1]}" %*\r\n`,
    );
  else
    writeFileSync(
      join(bin, "bun"),
      `#!/bin/sh\nexec ${shellCommand(argv)} "$@"\n`,
      { mode: 0o755 },
    );
  return {
    THERMITE_CONTRIBUTOR_BUN: worker,
    PATH: [bin, ctx.env.PATH].filter(Boolean).join(delimiter),
    VITEST_MAX_WORKERS: "1",
  };
}
