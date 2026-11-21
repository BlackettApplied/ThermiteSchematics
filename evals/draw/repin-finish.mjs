import assert from "node:assert/strict";
import { json } from "./support.mjs";
import { fontPairs } from "./repin-reconcile.mjs";
export function finishRepin(context, notMoves) {
  const {
    report,
    next,
    specs,
    reassess,
    receipts,
    reportSha256,
    registrySha256,
    checkerSha256,
    sourceClaims,
    targetClaims,
    inventory,
  } = context;
  const projected = reassess(report, next, specs);
  assert(
    projected.exitCode === 0,
    `Unlisted findings/scopes remain: ${projected.rows
      .filter((r) => ["fail", "xpass"].includes(r.status))
      .map((r) => r.id)
      .join(", ")}`,
  );
  assert(
    !projected.drift.length,
    `Unlisted or incompletely reconciled envelope drift remains: ${projected.drift.map((d) => `${d.marker}: ${d.changes.map((c) => c.metric).join(", ")}`).join("; ")}`,
  );
  receipts.sort((a, b) => (json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0));
  return {
    registry: next,
    receipts,
    expected: {
      exitCode: 0,
      drift: [],
      summary: projected.summary,
      policy: projected.rows
        .filter((r) => r.classification === "policy-gap")
        .map((r) => ({ id: r.id, status: r.status })),
      notMeasuredRetirements: receipts.filter(
        (r) => r.action === "retire" && r.cause === "not-measured",
      ).length,
      outcomes: {
        superseded: receipts.filter((r) => r.action === "superseded").length,
        supersededSurvivors: receipts.filter(
          (r) => r.action === "superseded" && r.successor?.form === "survivor",
        ).length,
        notMove: notMoves.length,
        fixes: receipts.filter(
          (r) => r.action === "retire" && r.cause === "fixed",
        ).length,
        moves: receipts.filter((r) => r.action === "rename").length,
        additions: receipts.filter((r) => r.action === "scope-added").length,
        newDefects: receipts.filter((r) => r.action === "new-defect").length,
        removals: receipts.filter(
          (r) => r.action === "retire" && r.cause === "removed",
        ).length,
        notMeasured: receipts.filter(
          (r) => r.action === "retire" && r.cause === "not-measured",
        ).length,
        changedHeaderMoves: receipts.filter(
          (r) => r.action === "rename" && r.changedHeader,
        ).length,
      },
      toolProved: {
        reportSha256,
        registrySha256,
        checkerSha256,
        sourceInstances: sourceClaims.size,
        targetInstances: targetClaims.size,
        fontPairs: fontPairs(next, inventory),
      },
      reviewerJudged: {
        signOff:
          "reviewed:true signs off crops and causes; each recorded sign-off kind identifies agent review or person review; identity and independence are not tool-proved",
        causesAndCrops: receipts.length,
        notMove: notMoves,
        scoreCredit: 0,
      },
    },
  };
}
