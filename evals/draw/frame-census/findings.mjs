/** Each paint obligation is independent. Incomplete metrics fail closed. */
export function compactFindings(row) {
  return (
    (row.nativeCutFindings?.length ?? 1) +
    row.inkCollisions.length +
    row.nearInk.length +
    row.laneViolations.length +
    row.titleRuleCollisions.length +
    row.zoneShapeCollisions.length +
    row.labelWireCollisions.length +
    row.cutGapFailures +
    row.raggedBanks.length +
    (!Number.isFinite(row.bottomRuleClearanceMm) ||
    row.bottomRuleClearanceMm < 0.5
      ? 1
      : 0)
  );
}
