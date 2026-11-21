#!/usr/bin/env bun
if (globalThis.Bun?.version !== "1.4.2") {
  process.stderr.write(
    "This Thermite package requires Bun 1.4.2. Run: bun /path/to/thermite/thermite.mjs <command>\n",
  );
  process.exitCode = 2;
} else {
  let runThermite;
  try {
    ({ runThermite } =
      await import("./node_modules/@thermite/cli/dist/alpha.js"));
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(
      "This Thermite runtime package is incomplete. Verify the download checksum and extract a fresh copy into a new folder.\n",
    );
    process.exitCode = 2;
  }
  if (runThermite) process.exitCode = await runThermite();
}
