// Shared DQ-13 physical em floor and existing measurement tolerance.
export function minimumTextEmMm(t) {
  if (t.nativeReference) return 2.3;
  if (t.tagField != null) return t.tagField === "designation" ? 2.7 : 2.5;
  return t.secondaryReference ? 2.3 : 2.5;
}
// SVG native text lengths and CTMs pass through browser floating-point
// projections. One part per million is numerical allowance, not a fit budget.
export const TEXT_FACTOR_EPS = 1e-6;
export const MIN_TEXT_HORIZONTAL_FACTOR = 1 / 1.1;
export function hasLegibleEm(t) {
  const factor = t.tagHorizontalFactor;
  return (
    (t.fontSize === undefined || t.fontSize >= minimumTextEmMm(t) - 0.03) &&
    (factor === undefined ||
      (typeof factor === "number" &&
        Number.isFinite(factor) &&
        factor >= MIN_TEXT_HORIZONTAL_FACTOR - TEXT_FACTOR_EPS &&
        factor <= 1 + TEXT_FACTOR_EPS))
  );
}
