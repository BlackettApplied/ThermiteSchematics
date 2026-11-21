import type { Draft } from "./types.js";
import type { RenderFailure } from "../types.js";
export function rootedPageBudget(drafts: readonly Draft[]) {
  const fits = drafts.flatMap((d) => (d.rootedFit ? [d.rootedFit] : []));
  const base =
    drafts.length - fits.reduce((n, f) => n + f.actualPages - f.basePages, 0);
  return { fits, base, limit: 2 * base };
}
/** Compare complete packets, rather than imposing a stricter per-view page cap. */
export function rootedPageCostFailure(
  drafts: readonly Draft[],
): RenderFailure | undefined {
  const { fits, base, limit } = rootedPageBudget(drafts);
  if (!fits.length) return undefined;
  if (drafts.length <= limit) return undefined;
  const context = fits
    .map((f) => f.context)
    .filter(Boolean)
    .join("; ");
  return {
    code: "R006",
    root: "packet",
    reason: "unprintable-layout",
    message: `Off-view layout needs ${drafts.length} sheets versus ${base} native sheets: exceeds the ${limit}-sheet page-cost bound by ${drafts.length - limit} sheets. ${context}. Use a larger sheet or landscape.`,
    details: {
      constraint: "page-cost-bound",
      basePages: base,
      candidatePages: drafts.length,
      maximumPages: limit,
      shortfallSheets: drafts.length - limit,
      offViewConnections: context,
    },
  };
}
