#!/usr/bin/env bun
try {
  const { runThermite } = await import("./packages/cli/dist/alpha.js");
  process.exitCode = await runThermite();
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND") {
    process.stderr.write(
      "Thermite needs its source dependencies and build. From this checkout, run bun install --frozen-lockfile && bun run build, then retry.\n",
    );
    process.exitCode = 2;
  } else throw error;
}
