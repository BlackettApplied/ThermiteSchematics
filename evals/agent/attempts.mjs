import { canonical } from "./source-files.mjs";
import { sha256 } from "./snapshot.mjs";
export const configurationKey = (r) => [
  r.model ?? null,
  r.effort ?? null,
  {
    model: r.modelOverrides?.model ?? null,
    effort: r.modelOverrides?.effort ?? null,
  },
];
export const runKey = (r) =>
  `${r.context}/${r.task}/${r.agent}/${r.seed}/${encodeURIComponent(canonical(configurationKey(r)))}`;
export const runDirectoryName = (r) =>
  `${r.task}-${r.agent}-${r.arm}-${r.seed}${r.agent === "reference" ? "" : "-" + sha256(canonical(configurationKey(r))).slice(0, 16)}`;
export const isComplete = (r) =>
  r.status === "complete" || r.status === "task-failure";
export const automaticInfra = (r) =>
  r.status === "infrastructure-failure" &&
  (["rate-limit", "unstructured-exit"].includes(r.infrastructureKind) ||
    (r.infrastructureKind === "provider" &&
      ["overloaded", "overloaded_error"].includes(r.agentFailure ?? r.reason)));
export const haltingInfra = (r) =>
  ["halted-infra", "infrastructure-failure"].includes(r.status) &&
  (["quota", "billing"].includes(r.infrastructureKind) || r.haltBatch === true);
export const batchHaltReason = (r) =>
  r?.status === "needs-adjudication"
    ? "needs-adjudication"
    : r && haltingInfra(r)
      ? r.infrastructureKind
      : null;
export function automaticFailures(prior) {
  const reset = prior.findLastIndex((r) => r.reopenInfra);
  return prior.slice(Math.max(0, reset)).filter(automaticInfra).length;
}
export function planAttempt(
  prior,
  forceRerun = false,
  { reopenInfra = null } = {},
) {
  const ordered = [...prior].sort(
      (a, b) => (a.attempt ?? 1) - (b.attempt ?? 1),
    ),
    first = ordered.find(isComplete),
    last = ordered.at(-1);
  if (last?.status === "needs-adjudication" && !reopenInfra)
    return { kind: "adjudicate", run: last, attempt: last.attempt };
  if (last?.status === "checker-error")
    return { kind: "recheck", run: last, attempt: last.attempt };
  if (first && !forceRerun)
    return { kind: "skip", run: first, attempt: first.attempt };
  if (
    !reopenInfra &&
    automaticInfra(last ?? {}) &&
    automaticFailures(ordered) >= 3
  )
    return {
      kind: "exhausted",
      run: last,
      attempt: last.attempt,
      reason: "infra-retry-limit",
    };
  return {
    kind: "run",
    attempt: (last?.attempt ?? 0) + 1,
    forceRerun: !!first && forceRerun,
    reopenInfra: reopenInfra
      ? {
          request: reopenInfra,
          previousAutomaticFailures: automaticFailures(ordered),
        }
      : null,
    reopenedHalt: !!last && haltingInfra(last),
  };
}
export function selectAttempts(runs) {
  const groups = new Map(),
    errors = [],
    history = [];
  for (const run of runs) {
    const key = `${run.arm}/${runKey(run)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const selected = [];
  for (const [key, rows] of groups) {
    const attempts = new Map();
    for (const run of rows) {
      const attempt = run.attempt ?? 1;
      if (!attempts.has(attempt)) attempts.set(attempt, []);
      attempts.get(attempt).push(run);
    }
    const resolved = [];
    for (const [attempt, copies] of attempts) {
      const originals = copies.filter((r) => !r.adjudication),
        judged = copies.filter((r) => r.adjudication);
      if (originals.length > 1)
        errors.push(`Duplicate ${key} attempt ${attempt}`);
      const strip = (r) => {
        const { judges, judgement, adjudication, ...base } = r;
        return canonical(base);
      };
      if (judged.some((r) => originals[0] && strip(r) !== strip(originals[0])))
        errors.push(
          `Adjudication changes original facts ${key} attempt ${attempt}`,
        );
      const revisions = judged.map((r) => r.adjudication.revision ?? 1);
      if (new Set(revisions).size !== revisions.length)
        errors.push(`Duplicate adjudication ${key} attempt ${attempt}`);
      resolved.push(
        [...copies].sort(
          (a, b) =>
            (b.adjudication?.revision ?? 0) - (a.adjudication?.revision ?? 0),
        )[0],
      );
    }
    for (const r of resolved)
      if (r.status === "needs-adjudication")
        errors.push(`Unresolved adjudication ${key} attempt ${r.attempt ?? 1}`);
    const ordered = resolved.sort(
        (a, b) => (a.attempt ?? 1) - (b.attempt ?? 1),
      ),
      complete = ordered.filter(isComplete),
      chosen = complete[0] ?? ordered.at(-1);
    if (chosen) selected.push(chosen);
    history.push({
      key,
      arm: chosen?.arm,
      selectedAttempt: chosen?.attempt ?? 1,
      attempts: ordered.map((r) => ({
        attempt: r.attempt ?? 1,
        status: r.status,
        outcome: r.outcome?.pass ?? false,
        infrastructureKind:
          r.infrastructureKind ??
          (r.status === "checker-error" ? "checker" : "other"),
      })),
      forcedReruns: ordered
        .filter((r) => r.forceRerun)
        .map((r) => r.attempt ?? 1),
      adjudications: ordered
        .filter((r) => r.infraAdjudication)
        .map((r) => ({ attempt: r.attempt, ...r.infraAdjudication })),
      reopenedHalts: ordered
        .filter((r) => r.reopenedHalt)
        .map((r) => r.attempt),
      exitWarnings: ordered
        .filter((r) => r.exitAfterCompletion)
        .map((r) => ({
          attempt: r.attempt,
          exit: r.agentExit,
          signal: r.agentSignal,
        })),
      pendingAdjudications: ordered
        .filter((r) => r.status === "needs-adjudication")
        .map((r) => r.attempt),
      infraReopens: ordered
        .filter((r) => r.reopenInfra)
        .map((r) => ({ attempt: r.attempt, ...r.reopenInfra })),
      multipleCompleteAttempts: complete.length > 1,
      unresolvedInfrastructure: complete.length === 0,
    });
  }
  return { selected, errors, history };
}
export function classifyAgent(result, normalized) {
  if (result.operatorSignal)
    return {
      status: "interrupted",
      taskFailure: false,
      reason: "operator-interruption",
    };
  if (result.notStarted)
    return {
      status: "not-started",
      taskFailure: false,
      reason: "batch-halted-before-launch",
    };
  if (normalized.successfulCompletion) {
    const exitAfterCompletion =
      result.exit !== 0 || !!result.signal || !!result.timedOut;
    return {
      status: "complete",
      taskFailure: false,
      reason: null,
      exitAfterCompletion,
      warnings: exitAfterCompletion
        ? [
            {
              code: "exit-after-completion",
              exit: result.exit,
              ...(result.signal ? { signal: result.signal } : {}),
            },
          ]
        : [],
    };
  }
  if (result.timedOut)
    return { status: "complete", taskFailure: true, reason: "timeout" };
  const haltBatch = [
    "account_on_hold",
    "oauth_org_not_allowed",
    "verification_required",
    "cloud_credential_error",
  ].includes(normalized.infrastructureError);
  if (normalized.needsAdjudication)
    return {
      status: "needs-adjudication",
      haltBatch: true,
      taskFailure: false,
      reason: "unrecognized-terminal-error",
    };
  const infra = () => ({
    haltBatch,
    status:
      haltBatch || ["quota", "billing"].includes(normalized.infrastructureKind)
        ? "halted-infra"
        : "infrastructure-failure",
    taskFailure: false,
    infrastructureKind: normalized.infrastructureKind ?? "provider",
    reason: normalized.infrastructureError,
    retryAt: normalized.retryAt ?? null,
  });
  if (normalized.terminalError)
    return normalized.infrastructureError
      ? infra()
      : { status: "complete", taskFailure: true, reason: "agent-error-result" };
  if (result.spawnError || result.signal)
    return {
      status: "infrastructure-failure",
      taskFailure: false,
      infrastructureKind: "cli-crash",
      reason: result.spawnError ?? result.signal,
    };
  if (normalized.infrastructureError) return infra();
  if (
    normalized.agentError &&
    (normalized.terminalError !== false || result.exit === 0)
  )
    return {
      status: "complete",
      taskFailure: true,
      reason: "agent-error-result",
    };
  if (result.exit !== 0)
    return {
      status: "infrastructure-failure",
      taskFailure: false,
      infrastructureKind: "unstructured-exit",
      reason: "cli-crash-or-unstructured-exit",
    };
  return {
    status: "complete",
    taskFailure: true,
    reason: "missing-completion",
  };
}
