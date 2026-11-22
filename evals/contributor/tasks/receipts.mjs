import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  contributorBuildOutputs,
  contributorSourceDigest,
  matchesContributorPath,
} from "../../agent/contributor-bun.mjs";
import { write } from "../../agent/task-support.mjs";
import { verifyDirectBuild } from "./direct-build.mjs";
import { transcriptInvocations } from "./direct-commands.mjs";
import { focus } from "./support.mjs";

export function observedCommands(ctx, repository) {
  const log = join(ctx.evidence, "contributor-commands.jsonl");
  const rows = existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  return rows.filter((r) => matchesContributorPath(r.cwd, repository));
}

function passedFocus(tests, repository) {
  return (
    tests?.total > 0 &&
    tests.total === tests.passed &&
    tests.failed === 0 &&
    tests.files.length === 1 &&
    matchesContributorPath(resolve(tests.files[0]), join(repository, focus))
  );
}

function sameFile(current, observed) {
  return (
    observed?.file === current.file &&
    observed.sha256 === current.sha256 &&
    observed.input?.sha256 === current.input.sha256
  );
}

function hasMatchingBuild(rows, outputs) {
  const builds = rows.filter((r) => r.kind === "build" && r.exit === 0);
  // Check each artifact's origin, then bind the current inputs and bytes to
  // the observed build. Incremental builds can retain outputs.
  const fresh = outputs.every(
    (file) =>
      file.sha256 &&
      file.input.sha256 &&
      builds.some((build) =>
        build.outputs.some(
          (old) => old.modified >= build.started - 1 && sameFile(file, old),
        ),
      ),
  );
  return (
    fresh &&
    builds.some(({ outputs: observed }) =>
      outputs.every((file) => observed.some((old) => sameFile(file, old))),
    )
  );
}

const installedBefore = (rows, time) =>
  rows.some(
    (row) => row.kind === "install" && row.exit === 0 && row.ended <= time,
  );

function hasFreshBuild(ctx, repository, rows, outputs, invocations) {
  if (hasMatchingBuild(rows, outputs)) return true;
  // A PATH lookup can bypass the shim, but the transcript must name its checkout.
  if (
    !invocations.some(
      ({ kind, direct, explicitCwd }) =>
        kind === "build" && (direct || explicitCwd),
    )
  )
    return false;
  const verification = verifyDirectBuild(
    repository,
    outputs,
    ctx.pinnedTypeScript,
  );
  write(join(ctx.evidence, "contributor-direct-build.json"), verification);
  return verification.matches;
}

export function completedWorkflow(
  ctx,
  repository,
  { install = false, queryRepair = false } = {},
) {
  // The implementation-only repair is verified by executing the current CLI.
  // Its declaration and downstream CLI JS can remain unchanged across builds.
  const outputs = contributorBuildOutputs(repository).filter(
    ({ file }) => !queryRepair || file === "packages/query/dist/ordering.js",
  );
  const rows = observedCommands(ctx, repository);
  const source = queryRepair ? contributorSourceDigest(repository) : null;
  const tests = rows.filter(
    (r) =>
      r.kind === "focused" &&
      r.exit === 0 &&
      !r.uncreditedReason &&
      passedFocus(r.tests, repository) &&
      (!queryRepair || (source && r.sourceSha256 === source)),
  );
  const focused = tests.length > 0;
  const invocations = focused ? transcriptInvocations(ctx, repository) : [];
  const testIndex = invocations.findLastIndex(({ kind }) => kind === "focused");
  const directInstall =
    testIndex >= 0 &&
    invocations
      .slice(0, testIndex)
      .some(({ kind, direct }) => direct && kind === "install");
  return {
    ...(install && {
      installed:
        tests.some(({ started }) => installedBefore(rows, started)) ||
        directInstall,
    }),
    focused,
    freshBuild:
      focused && hasFreshBuild(ctx, repository, rows, outputs, invocations),
  };
}
