import { execFileSync } from "node:child_process";
import {
  compareDeclarations,
  publicDeclarations,
} from "./agent-contract-declarations.mjs";
import { compareValidator } from "./agent-contract-validator.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareInstances,
  compareSchemas,
  requestExamples,
  compareExamples,
} from "./agent-contract-compare.mjs";

export const CONTRACT_BASELINE = JSON.parse(
  readFileSync(
    new URL("./agent-contract-baseline.json", import.meta.url),
    "utf8",
  ),
);
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 << 20,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();

function readRevision(cwd, revision, path) {
  try {
    return git(cwd, "show", `${revision}:${path}`);
  } catch (error) {
    if (
      String(error.stderr).includes("does not exist") ||
      String(error.stderr).includes("exists on disk, but not in")
    )
      return undefined;
    throw error;
  }
}

// Many edges reuse a commit's blob as their next parent, and merge parents and
// distinct surfaces also share commit subjects. Keep the cache within one audit.
function revisionReader(cwd) {
  const blobs = new Map(),
    subjects = new Map();
  return {
    read(revision, path) {
      const key = `${revision}:${path}`;
      if (!blobs.has(key)) blobs.set(key, readRevision(cwd, revision, path));
      return blobs.get(key);
    },
    subject(commit) {
      if (!subjects.has(commit))
        subjects.set(commit, git(cwd, "show", "-s", "--format=%s", commit));
      return subjects.get(commit);
    },
  };
}

export function contractInventory(cwd, base, head) {
  const paths = new Set([
    ...git(cwd, "ls-tree", "-r", "--name-only", base).split("\n"),
    ...git(cwd, "ls-tree", "-r", "--name-only", head).split("\n"),
    ...git(cwd, "log", "--format=", "--name-only", `${base}..${head}`).split(
      "\n",
    ),
    ...(head === "HEAD"
      ? git(
          cwd,
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
        ).split("\n")
      : []),
  ]);
  return [...paths]
    .flatMap((path) => {
      if (
        path.startsWith(CONTRACT_BASELINE.goldenRoot) &&
        path.endsWith(".json")
      )
        return [{ path, kind: "instance" }];
      if (
        CONTRACT_BASELINE.schemaNames.some(
          (name) => path === `packages/schema/schemas/${name}.schema.json`,
        )
      )
        return [{ path, kind: "schema" }];
      if (CONTRACT_BASELINE.examples.includes(path))
        return [{ path, kind: "examples" }];
      if (CONTRACT_BASELINE.validatorSources.includes(path))
        return [{ path, kind: "validator-source" }];
      if (
        CONTRACT_BASELINE.declarations.includes(path) ||
        path in CONTRACT_BASELINE.transitiveDeclarations
      )
        return [{ path, kind: "declarations" }];
      if (CONTRACT_BASELINE.helpSources.includes(path))
        return [{ path, kind: "help-source" }];
      return [];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function compareContent(kind, before, after, publicNames) {
  if (before === undefined)
    return [{ classification: "additive", path: "", reason: "new surface" }];
  if (after === undefined)
    return [{ classification: "removal", path: "", reason: "deleted surface" }];
  if (before === after) return [];
  if (kind === "declarations")
    return compareDeclarations(before, after, publicNames);
  if (kind === "validator-source") return compareValidator(before, after);
  if (kind === "help-source")
    return [
      {
        classification: "meaning-change",
        path: "",
        reason: "Request generator changed; review the generated requests",
      },
    ];
  if (kind === "examples")
    return compareExamples(requestExamples(before), requestExamples(after));
  if (!before.trim() || !after.trim())
    return before.trim() === after.trim()
      ? []
      : [
          {
            classification: "type-change",
            path: "",
            reason: "empty/JSON stream changed",
          },
        ];
  const a = JSON.parse(before),
    b = JSON.parse(after);
  return kind === "schema" ? compareSchemas(a, b) : compareInstances(a, b);
}

/** Follow renames newest-to-oldest, then compare every authored edge, not just endpoints. */
export function followHistory(
  cwd,
  base,
  head,
  surface,
  revisions = revisionReader(cwd),
) {
  const text = git(
    cwd,
    "log",
    "--follow",
    "--full-history",
    "-m",
    "--format=COMMIT %H %P",
    "--name-status",
    `${base}..${head}`,
    "--",
    surface.path,
  );
  let path = surface.path;
  const entries = text
    .split("COMMIT ")
    .slice(1)
    .map((chunk) => {
      const [header, ...lines] = chunk.trim().split("\n");
      const [commit, ...parents] = header.split(" ");
      const rename = lines.find((line) => /^R\d*\t/u.test(line))?.split("\t");
      const current = path,
        prior = rename?.[1] ?? path;
      path = prior;
      return { commit, parents, current, prior };
    });
  const unique = [
    ...new Map(
      entries.map((entry) => [`${entry.commit}:${entry.current}`, entry]),
    ).values(),
  ];
  return unique
    .reverse()
    .flatMap((entry) =>
      entry.parents.map((parent) =>
        historyEdge(revisions, surface, entry, parent),
      ),
    );
}

function historyEdge(revisions, surface, { commit, current, prior }, parent) {
  const before = revisions.read(parent, prior),
    after = revisions.read(commit, current);
  const publicNames = CONTRACT_BASELINE.transitiveDeclarations[surface.path]
    ? new Set(CONTRACT_BASELINE.transitiveDeclarations[surface.path])
    : surface.kind === "declarations" &&
        surface.path !== "packages/agent-tools/src/index.ts"
      ? new Set(
          [parent, commit].flatMap((revision) =>
            publicDeclarations(
              revisions.read(revision, "packages/agent-tools/src/index.ts"),
              current,
            ),
          ),
        )
      : undefined;
  const changes = compareContent(surface.kind, before, after, publicNames);
  if (prior !== current)
    changes.unshift({
      classification: "rename",
      path: prior,
      to: current,
      scope: "surface path",
    });
  return {
    commit,
    parent,
    path: current,
    previousPath: prior,
    kind: surface.kind,
    subject: revisions.subject(commit),
    changes,
  };
}

export function auditContractHistory(
  cwd = resolve("."),
  head = "HEAD",
  base = CONTRACT_BASELINE.base,
) {
  git(cwd, "merge-base", "--is-ancestor", base, head);
  const inventory = contractInventory(cwd, base, head);
  const revisions = revisionReader(cwd);
  const history = inventory.flatMap((surface) =>
    followHistory(cwd, base, head, surface, revisions),
  );
  if (head === "HEAD")
    history.push(...workingTreeEdges(cwd, inventory, revisions));
  const violations = history.flatMap((edge) =>
    edge.changes
      .filter((change) => !["additive"].includes(change.classification))
      .map((change) => ({
        commit: edge.commit,
        subject: edge.subject,
        file: edge.path,
        ...change,
      })),
  );
  return {
    base: git(cwd, "rev-parse", base),
    head: git(cwd, "rev-parse", head),
    inventory,
    history,
    violations,
    additiveOnly: violations.length === 0,
  };
}

function workingTreeEdges(cwd, inventory, revisions) {
  const disk = (path) =>
    existsSync(resolve(cwd, path))
      ? readFileSync(resolve(cwd, path), "utf8").trimEnd()
      : undefined;
  return inventory.flatMap((surface) => {
    const before = revisions.read("HEAD", surface.path),
      after = disk(surface.path);
    if (before === after) return [];
    const publicNames = CONTRACT_BASELINE.transitiveDeclarations[surface.path]
      ? new Set(CONTRACT_BASELINE.transitiveDeclarations[surface.path])
      : surface.kind === "declarations" &&
          surface.path !== "packages/agent-tools/src/index.ts"
        ? new Set(
            [
              revisions.read("HEAD", "packages/agent-tools/src/index.ts"),
              disk("packages/agent-tools/src/index.ts"),
            ].flatMap((index) => publicDeclarations(index, surface.path)),
          )
        : undefined;
    return [
      {
        commit: "WORKTREE",
        parent: "HEAD",
        path: surface.path,
        kind: surface.kind,
        subject: "uncommitted contract change",
        changes: compareContent(surface.kind, before, after, publicNames),
      },
    ];
  });
}
