import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { command, git } from "./lifecycle.mjs";
import { correctnessFailure, PerfFailure } from "./errors.mjs";

export function resolveBaseRevision(headPath, revision) {
  const selected =
    revision ?? git(headPath, "merge-base", "HEAD", "origin/dev");
  return git(
    headPath,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${selected}^{commit}`,
  );
}
export function verifyBase(directory, revision) {
  assert.equal(git(directory, "rev-parse", "HEAD"), revision);
  assert.equal(
    git(directory, "status", "--porcelain", "--untracked-files=all"),
    "",
    "Base source must be clean",
  );
}
export async function buildEngine(directory, side, owner, run = command) {
  const result = await run(directory, ["run", "build"], owner);
  if (result.code !== 0)
    throw correctnessFailure(
      side,
      `build failed (${result.signal ?? result.code}): ${result.stderr}`,
    );
}
export async function prepareBase(values, headPath, revision, owner) {
  if (values["record-baseline"] || values["self-check"]) return headPath;
  if (values["base-engine"]) {
    const directory = realpathSync(resolve(values["base-engine"]));
    verifyBase(directory, revision);
    await buildEngine(directory, "base", owner);
    verifyBase(directory, revision);
    return directory;
  }
  const resource = owner.resource;
  resource.temporary = mkdtempSync(
    join(realpathSync(tmpdir()), "thermite-perf-"),
  );
  resource.basePath = join(resource.temporary, "base");
  git(headPath, "worktree", "add", "--detach", resource.basePath, revision);
  const installed = await command(
    resource.basePath,
    ["install", "--frozen-lockfile"],
    owner,
  );
  if (installed.code !== 0)
    throw new PerfFailure(`Base install failed: ${installed.stderr}`);
  verifyBase(resource.basePath, revision);
  await buildEngine(resource.basePath, "base", owner);
  verifyBase(resource.basePath, revision);
  return resource.basePath;
}
