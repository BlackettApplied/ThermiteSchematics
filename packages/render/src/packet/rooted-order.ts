import type { RootedCandidate } from "./rooted-build.js";
import { actualChoices } from "../off-view/choices.js";
/** Integer score precision: 0.001 mm and 0.000001 utilisation. The useful
 * guard uses the unrounded value, so rounding never crosses its 0.40 boundary. */
export const DISTANCE_UNITS = 1000;
export const UTILISATION_UNITS = 1_000_000;
export const USEFUL_UTILISATION = 0.4;
export function economyTerms(c: RootedCandidate, utilisation: number) {
  const excess = Math.round(
    (c.localityExcess ?? Math.max(0, c.proximity - 15)) * DISTANCE_UNITS,
  );
  const util = -Math.round(utilisation * UTILISATION_UNITS);
  const total = Math.round(c.proximity * DISTANCE_UNITS);
  return [excess, utilisation >= USEFUL_UTILISATION ? 0 : 1, util, total];
}
/** Exact keys finish a total order; no pairwise almost-equal comparisons.
 * Authored card identities order their placement tuple before grid/composition. */
export function candidateOrder(c: RootedCandidate) {
  const choices = c.prepared?.graph?.nodes ? actualChoices(c.prepared) : {};
  return JSON.stringify([
    [undefined, "compact", "dense"].indexOf(c.profile),
    Object.entries(choices).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    c.grid,
    c.drafts.map((d) => d.rootedSections),
    c.bank,
  ]);
}
export function compareTerms(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
