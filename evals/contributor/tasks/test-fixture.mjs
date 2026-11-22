import { afterEach } from "vitest";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contributorBuildOutputs,
  contributorRealpath,
  contributorSourceDigest,
} from "../../agent/contributor-bun.mjs";
import { contributorCommandEnvironment } from "../../agent/contributor-commands.mjs";
import { focus, git, ordering, run, seedPatch } from "./support.mjs";

export const root = fileURLToPath(new URL("../../../", import.meta.url));

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
export function temp() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "thermite-k-")));
  roots.push(root);
  return root;
}
export function put(dir, file, text) {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function initializeFixture(ctx, engine, seeded) {
  mkdirSync(engine);
  git(ctx, engine, "init", "--quiet");
  const clean = readFileSync(new URL("../../../" + ordering, import.meta.url));
  put(engine, ordering, clean);
  put(engine, "packages/cli/src/alpha.ts", "export const api = 1;\n");
  put(engine, "README.md", "Fixture source.\n");
  copy(engine, focus);
  put(engine, ".gitignore", "node_modules/\ndist/\ncoverage/\n");
  if (seeded) git(ctx, engine, "apply", seedPatch);
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
    "fixture",
  );
  put(
    ctx.evidence,
    "contributor-seed.json",
    JSON.stringify({
      revision: git(ctx, engine, "rev-parse", "HEAD").trim(),
    }),
  );
  return clean.toString();
}

export function fixture(seeded = false) {
  const projectInput = temp();
  const project = contributorRealpath(projectInput),
    evidence = join(project, "evidence"),
    engine = join(project, "engine"),
    ctx = { project: projectInput, evidence, env: process.env };
  const clean = initializeFixture(ctx, engine, seeded);
  put(project, "contributor-friction.md", "Run receipts recorded.");
  const repository = seeded ? engine : join(project, "worktree");
  if (!seeded) git(ctx, engine, "worktree", "add", "--detach", repository);
  for (const root of new Set([repository, engine]))
    for (const name of ["typescript", "vitest", "elkjs"])
      put(root, `node_modules/${name}/package.json`, "{}\n");
  const at = Date.now() - 1000;
  for (const { file } of contributorBuildOutputs(repository))
    put(repository, file, "built\n");
  const rows = [
    {
      cwd: repository,
      kind: "install",
      argv: ["install", "--frozen-lockfile"],
      exit: 0,
      started: at,
      ended: at + 1,
    },
    {
      cwd: repository,
      kind: "focused",
      argv: ["scripts/test.mjs", focus],
      exit: 0,
      started: at + 1,
      ended: at + 2,
      sourceSha256: contributorSourceDigest(repository),
      tests: {
        total: 7,
        passed: 7,
        failed: 0,
        files: [join(repository, focus)],
      },
    },
    {
      cwd: repository,
      kind: "build",
      argv: ["run", "build"],
      exit: 0,
      started: at + 2,
      outputs: contributorBuildOutputs(repository),
    },
  ];
  const save = () =>
    put(
      evidence,
      "contributor-commands.jsonl",
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  save();
  return { ctx, engine, repository, rows, save, clean };
}

export function copy(dir, path) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  cpSync(join(root, path), join(dir, path), { recursive: true, force: true });
}

export function observeIn(f, cwd, ...args) {
  return process.platform === "win32"
    ? run(f.ctx, cwd, "cmd.exe", ["/d", "/c", "bun", ...args])
    : run(f.ctx, cwd, "bun", args);
}

export function observer(f, checkout) {
  f.ctx.task = { contributor: { checkout, focused: focus } };
  f.ctx.env = {
    ...f.ctx.env,
    ...contributorCommandEnvironment(f.ctx, join(f.ctx.project, "bin")),
  };
  f.rows.splice(0);
  f.save();
}
