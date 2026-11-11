// Shared DQ-13 physical em floor and existing measurement tolerance.
export function minimumTextEmMm(t) {
  if (t.tagField != null) return t.tagField === "designation" ? 2.7 : 2.5;
  return t.secondaryReference ? 2.3 : 2.5;
}
export function hasLegibleEm(t) {
  return t.fontSize === undefined || t.fontSize >= minimumTextEmMm(t) - 0.03;
}
