import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileInventory, json, listFiles } from "./common.mjs";

export async function verifyGuideProvenance({
  runtime,
  guideProvenance,
  wrongCommit,
  before,
  invoke,
  check,
}) {
  const originalProvenance = await readFile(guideProvenance);
  await writeFile(guideProvenance, json({ commit: wrongCommit }));
  for (const args of [
    ["guide", "modeling"],
    ["guide", "--json"],
  ]) {
    const refusal = invoke(args, undefined, 2);
    assert.equal(refusal.stdout, "");
    assert.match(refusal.stderr, /commit mismatch/);
  }
  await writeFile(guideProvenance, originalProvenance);
  assert.deepEqual(await fileInventory(runtime), before);
  check("mismatched guide/build commit refused; original provenance restored");
}

export async function verifyReadOnlyRuntime({
  runtime,
  manifest,
  execution,
  invoke,
  check,
}) {
  // Read-only files prove the CLI does not update its installation or libraries.
  for (const file of await listFiles(runtime))
    await chmod(join(runtime, file), 0o444);
  assert.equal(invoke(["--version"]).stdout.trim(), manifest.version);
  assert.match(invoke(["--help"]).stdout, /Thermite/);
  check(
    `relocated, read-only package; Bun only; network isolation: ${execution.networkIsolation}; version and help`,
  );
}
