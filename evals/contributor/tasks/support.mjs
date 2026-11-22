import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { read, write } from "../../agent/task-support.mjs";

import {
  contributorRealpath,
  ordering,
  sameContributorPath,
} from "../../agent/contributor-bun.mjs";

export { ordering };
export const focus = "packages/query/test/views-and-ordering.test.ts";
export const seedPatch = fileURLToPath(
  new URL("./R02/seed.patch", import.meta.url),
);
const isolatedGit = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
};
export function run(ctx, cwd, executable, argv) {
  const result = spawnSync(executable, argv, {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    env: { ...ctx.env, ...isolatedGit, VITEST_MAX_WORKERS: "1" },
  });
  if (result.error) throw result.error;
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}
export function git(ctx, repository, ...args) {
  const result = run(ctx, repository, "git", args);
  assert.equal(result.exit, 0, result.stderr);
  return result.stdout;
}
export const bun = (ctx, cwd, ...argv) => run(ctx, cwd, process.execPath, argv);

export function setup(ctx, seeded = false) {
  assert(
    existsSync(join(ctx.runtime, ordering)),
    "R tasks require --context source",
  );
  const testScript = join(ctx.runtime, "scripts/test.mjs");
  const testSource = existsSync(testScript)
    ? readFileSync(testScript, "utf8")
    : "";
  for (const feature of ["THERMITE_CONTRIBUTOR_BUN", "THERMITE_TEST_TIMINGS"])
    assert(
      testSource.includes(feature),
      `R tasks require a pinned --commit with ${feature} support in scripts/test.mjs`,
    );
  const engine = join(ctx.project, "engine");
  cpSync(ctx.runtime, engine, {
    recursive: true,
    filter: (p) => {
      const name = basename(p);
      return (
        !["node_modules", "dist", ".git", "coverage"].includes(name) &&
        !name.endsWith(".tsbuildinfo") &&
        !name.startsWith("eval-") &&
        name !== "thermite.real.mjs" &&
        p !== join(ctx.runtime, "evals/contributor")
      );
    },
  });
  cpSync(join(ctx.runtime, "thermite.real.mjs"), join(engine, "thermite.mjs"));
  cpSync(join(engine, "AGENTS.md"), join(ctx.project, "AGENTS.md"));
  git(ctx, engine, "init", "--quiet");
  if (seeded) seedQuery(ctx, engine);
  git(ctx, engine, "add", ".");
  git(
    ctx,
    engine,
    "-c",
    "user.name=Eval",
    "-c",
    "user.email=eval@invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "Frozen contributor fixture",
  );
  // Warm only this run's Bun cache. R01 still has to install into its new
  // worktree. R02 starts with a working install so its first result is red.
  const installed = bun(ctx, engine, "install", "--frozen-lockfile");
  assert.equal(installed.exit, 0, installed.stderr);
  write(join(ctx.evidence, "contributor-setup-install.json"), installed);
  if (seeded) {
    const red = bun(ctx, engine, "scripts/test.mjs", focus);
    write(join(ctx.evidence, "contributor-seed-test.json"), red);
    assert.equal(red.exit, 1, "Seeded test must fail before the agent");
    assert.match(red.stdout + red.stderr, /to be less than 0/);
  }
  write(join(ctx.evidence, "contributor-seed.json"), {
    revision: git(ctx, engine, "rev-parse", "HEAD").trim(),
    seeded,
  });
}

export function seedQuery(ctx, engine) {
  git(ctx, engine, "apply", seedPatch);
  // The runtime's compiled CLI remains available to the harness. Hide the
  // clean source and its maps before taking the read-only runtime snapshot.
  for (const file of [
    ordering,
    "packages/query/dist/ordering.js.map",
    "packages/query/dist/ordering.d.ts.map",
  ])
    rmSync(join(ctx.runtime, file), { force: true });
}

export function contributorState(ctx) {
  return read(join(ctx.evidence, "contributor-seed.json"));
}
export function trackedChanges(ctx, repository, revision) {
  const paths = (flags) =>
    git(
      ctx,
      repository,
      "diff",
      "--no-ext-diff",
      "--no-renames",
      "--name-only",
      "-z",
      ...flags,
      revision,
    ).split("\0");
  return [
    ...new Set([...paths([]), ...paths(["--cached"])].filter(Boolean)),
  ].sort();
}

export function sourceChanges(ctx, repository, revision) {
  return [
    ...new Set([
      ...trackedChanges(ctx, repository, revision),
      ...git(
        ctx,
        repository,
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      )
        .split("\0")
        .filter(Boolean),
    ]),
  ].sort();
}
export function regularInside(repository, path) {
  const target = join(repository, path);
  return (
    existsSync(target) &&
    sameContributorPath(contributorRealpath(target), target) &&
    lstatSync(target).isFile()
  );
}

export function ownInstall(repository) {
  const dependencies = join(repository, "node_modules");
  return (
    existsSync(dependencies) &&
    lstatSync(dependencies).isDirectory() &&
    sameContributorPath(contributorRealpath(dependencies), dependencies) &&
    ["typescript", "vitest", "elkjs"].every((name) => {
      const manifest = join(dependencies, name, "package.json");
      if (!existsSync(manifest) || !lstatSync(manifest).isFile()) return false;
      const within = relative(dependencies, contributorRealpath(manifest));
      return (
        !!within &&
        within !== ".." &&
        !within.startsWith(".." + sep) &&
        !isAbsolute(within)
      );
    })
  );
}
export function reported(ctx) {
  const project = contributorRealpath(ctx.project);
  return (
    regularInside(project, "contributor-friction.md") &&
    readFileSync(join(project, "contributor-friction.md"), "utf8").trim()
      .length > 0
  );
}
