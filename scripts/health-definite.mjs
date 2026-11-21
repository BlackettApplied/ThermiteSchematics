import { appendReason } from "./health-reasons.mjs";
// A separate counter keeps historical non-null-expression totals comparable.
// Unlike expression assertions, declaration assertions also count in tests.
export function seedDefiniteAssignments(budget, metrics) {
  if (budget.definiteAssignments !== undefined) return budget;
  const entries = Object.entries(metrics.files)
    .map(([path, file]) => [path, file.definiteAssignments ?? 0])
    .filter(([, count]) => count > 0);
  const next = structuredClone(budget);
  next.definiteAssignments = Object.fromEntries(entries);
  next.ceilings.definiteAssignments = entries.reduce((n, [, v]) => n + v, 0);
  for (const [path, count] of entries) {
    const identity = "definiteAssignments:" + path;
    appendReason(next, identity, {
      identity,
      from: 0,
      to: count,
      reason:
        "Measured initial definite-assignment declaration baseline (#288); includes test helpers and cannot raise the global ceiling.",
    });
  }
  return next;
}
