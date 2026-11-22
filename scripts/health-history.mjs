import { spawnSync } from "node:child_process";
import { inScope, measureSources } from "./health-measure.mjs";
import {
  SIZE_CEILINGS,
  totals,
  upgradeBudget,
  validateBudget,
} from "./health-budget.mjs";
function git(root, args, options = {}) {
  const result = spawnSync("git", ["-C", root, ...args], {
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw Error(`Health history: git ${args[0]} failed`);
  return result.stdout;
}
export function historicalSources(root, revision) {
  const paths = git(root, ["ls-tree", "-rz", "--name-only", revision])
    .toString("utf8")
    .split("\0")
    .filter(inScope);
  const bytes = git(root, ["cat-file", "--batch", "-z"], {
    input: paths.map((p) => `${revision}:${p}\0`).join(""),
  });
  let offset = 0;
  const sources = new Map();
  for (const path of paths) {
    const end = bytes.indexOf(10, offset),
      header = bytes.subarray(offset, end).toString("utf8");
    const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
    if (!match) throw Error(`Health history: cannot read ${revision}:${path}`);
    const size = Number(match[1]);
    sources.set(path, bytes.subarray(end + 1, end + 1 + size).toString("utf8"));
    offset = end + 1 + size + 1;
  }
  return sources;
}
export function historicalMetrics(root, revision) {
  const sources = historicalSources(root, revision);
  return measureSources([...sources.keys()], (path) => sources.get(path));
}
function resolveRef(root, ref) {
  const result = spawnSync(
    "git",
    ["-C", root, "rev-parse", "--verify", `${ref}^{commit}`],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : undefined;
}
function ancestor(root, first, second) {
  return (
    spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", first, second])
      .status === 0
  );
}
function allowNoBase(env) {
  return (
    env.THERMITE_HEALTH_ALLOW_NO_BASE === "1" &&
    env.CI === undefined &&
    env.GITHUB_ACTIONS === undefined
  );
}
export function baselineRef(root, env = process.env) {
  if (env.GITHUB_BASE_REF) {
    if (!["dev", "release"].includes(env.GITHUB_BASE_REF))
      throw Error("Health history: GITHUB_BASE_REF must be dev or release.");
    const name = `refs/remotes/origin/${env.GITHUB_BASE_REF}`;
    if (resolveRef(root, name)) return name;
    if (allowNoBase(env)) return undefined;
    throw Error(
      `Health history: PR baseline ${name} is missing; fetch the PR base with full history (fetch-depth: 0).`,
    );
  }
  const remote = "refs/remotes/origin/dev",
    local = "refs/heads/dev";
  const remoteCommit = resolveRef(root, remote),
    localCommit = resolveRef(root, local);
  if (remoteCommit && localCommit) {
    if (ancestor(root, localCommit, remoteCommit)) return remote;
    if (ancestor(root, remoteCommit, localCommit)) return local;
    throw Error(
      "Health history: dev and origin/dev diverge; fetch/reconcile the baseline refs.",
    );
  }
  if (remoteCommit) return remote;
  if (localCommit) return local;
  if (allowNoBase(env)) return undefined;
  throw Error(
    "Health history: no health baseline; fetch the PR base or origin/dev with full history. THERMITE_HEALTH_ALLOW_NO_BASE=1 is only for synthetic test repositories.",
  );
}
function mergeBase(root, ref) {
  const merged = spawnSync("git", ["-C", root, "merge-base", "HEAD", ref], {
    encoding: "utf8",
  });
  if (merged.status !== 0)
    throw Error(
      `Health history: no merge-base with ${ref}; fetch full history (git fetch --unshallow, or actions/checkout fetch-depth: 0).`,
    );
  return merged.stdout.trim();
}
function committedBudget(root, revision) {
  if (
    !git(root, ["ls-tree", "-z", revision, "--", "scripts/health-budget.json"])
      .length
  )
    return undefined;
  return JSON.parse(
    git(root, ["show", `${revision}:scripts/health-budget.json`]).toString(
      "utf8",
    ),
  );
}
function sourceInformation(ref, revision, metrics) {
  return {
    ref,
    revision,
    files: Object.keys(metrics.files).length,
    functions: Object.keys(metrics.functions).length,
    overCapFiles: Object.values(metrics.files).filter(
      (f) => f.lines > SIZE_CEILINGS.fileLines,
    ).length,
    overCapFunctions: Object.values(metrics.functions).filter(
      (n) => n > SIZE_CEILINGS.functionLines,
    ).length,
    ...totals(metrics),
  };
}
function devBootstrap(root, target, information) {
  const ref = "refs/remotes/origin/dev",
    revision = mergeBase(root, ref);
  const budget = committedBudget(root, revision);
  if (!budget)
    throw Error(
      `Health history: dev bootstrap ${revision} has no committed health budget; merge a current-format budget into origin/dev first.`,
    );
  try {
    // Require the committed v4 authority. Below, an absent declaration counter
    // is seeded only from this authenticated merge-base source, never PR HEAD.
    validateBudget(budget);
  } catch (error) {
    throw Error(
      `Health history: dev bootstrap requires a valid current-format budget: ${error.message}`,
    );
  }
  const metrics = historicalMetrics(root, revision);
  return {
    revision,
    ref,
    target,
    budgetSource: "dev-bootstrap",
    budget: upgradeBudget(budget, metrics),
    metrics,
    information,
  };
}
export function formatHistoryInformation(history) {
  const info = history?.information;
  if (!info) return "";
  return `Health bootstrap: committed budget at ${history.ref}@${history.revision} (merge-base of HEAD and origin/dev).\nSource information only: ${info.ref}@${info.revision}: ${info.files} files, ${info.functions} bodies; ${info.overCapFiles} files over 3000, ${info.overCapFunctions} bodies over 300; non-null assertions ${info.nonNullAssertions}, skipped tests ${info.skippedTests}.\n`;
}
export function readHistory(root, env = process.env) {
  const ref = baselineRef(root, env),
    head = resolveRef(root, "HEAD");
  if (!head) {
    if (allowNoBase(env) && !ref) return undefined;
    throw Error(
      "Health history: HEAD is missing; no authenticated baseline is available.",
    );
  }
  const revision = ref ? mergeBase(root, ref) : head;
  const metrics = historicalMetrics(root, revision),
    raw = committedBudget(root, revision);
  const target = ref?.endsWith("/release") ? "release" : "dev";
  if (raw === undefined)
    return devBootstrap(
      root,
      target,
      sourceInformation(ref, revision, metrics),
    );
  return {
    revision,
    ref: ref ?? "HEAD (explicit synthetic opt-in)",
    target,
    budgetSource: "committed",
    metrics,
    budget: upgradeBudget(raw, metrics),
  };
}
