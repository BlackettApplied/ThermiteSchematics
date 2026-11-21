import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  contributorRealpath,
  sameContributorPath,
} from "../../../agent/contributor-bun.mjs";
import {
  contributorState,
  ownInstall,
  reported,
  run,
  sourceChanges,
} from "../support.mjs";
import { completedWorkflow } from "../receipts.mjs";

function gitPath(ctx, repository, option) {
  const { exit, stdout } = run(ctx, repository, "git", [
    "rev-parse",
    "--path-format=absolute",
    option,
  ]);
  if (exit !== 0) return null;
  try {
    return contributorRealpath(resolve(repository, stdout.trimEnd()));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function registered(ctx, engine, checkout) {
  const marker = join(checkout, ".git");
  if (
    !existsSync(marker) ||
    !lstatSync(checkout).isDirectory() ||
    !lstatSync(marker).isFile()
  )
    return false;

  const engineCommon = gitPath(ctx, engine, "--git-common-dir");
  const admin = gitPath(ctx, checkout, "--absolute-git-dir");
  if (!engineCommon || !admin) return false;
  const backlink = join(admin, "gitdir");
  // A linked checkout has a private Git directory in the engine's registry.
  // Git records a pointer back to the checkout's .git file in that directory.
  if (
    !sameContributorPath(dirname(admin), join(engineCommon, "worktrees")) ||
    !existsSync(backlink) ||
    !lstatSync(backlink).isFile()
  )
    return false;
  const registeredMarker = resolve(
    admin,
    readFileSync(backlink, "utf8").trimEnd(),
  );
  return (
    existsSync(registeredMarker) &&
    sameContributorPath(
      contributorRealpath(registeredMarker),
      contributorRealpath(marker),
    ) &&
    sameContributorPath(
      gitPath(ctx, checkout, "--show-toplevel"),
      contributorRealpath(checkout),
    ) &&
    sameContributorPath(
      gitPath(ctx, checkout, "--git-common-dir"),
      engineCommon,
    )
  );
}

export default function check(ctx) {
  const project = contributorRealpath(ctx.project),
    engine = join(project, "engine"),
    repository = join(project, "worktree"),
    worktree = registered(ctx, engine, repository);
  if (!worktree) return { pass: false, checks: { worktree } };
  const { revision } = contributorState(ctx);
  const checks = {
    worktree,
    sourceUnchanged: [engine, repository].every(
      (dir) => sourceChanges(ctx, dir, revision).length === 0,
    ),
    ownInstall: ownInstall(repository),
    ...completedWorkflow(ctx, repository, {
      install: true,
    }),
    report: reported(ctx),
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}
