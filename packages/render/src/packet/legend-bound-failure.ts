import type { RenderFailure } from "../types.js";
import type { Draft } from "./types.js";
import type { LegendSearchFailure } from "./legend-pagination.js";
import { rootedPageBudget } from "./rooted-bound.js";
import { MAX_AXIS_PLANS, MAX_GAP_POINTS, MAX_CUTS } from "./safe-cuts.js";
import { LEGEND_PACKET_SHEET_LIMIT } from "./legend-search-limits.js";

const capNames = new Map<string, string>([
  ["axis-plans", `${MAX_AXIS_PLANS} retained axis plans per search state`],
  ["gap-points", `${MAX_GAP_POINTS} gap points`],
  ["cuts", `${MAX_CUTS} cuts`],
  ["sheet-limit", `${LEGEND_PACKET_SHEET_LIMIT}-sheet packet limit`],
]);
/** Report the unresolved terminal span, rather than an unrelated failed trial
 * selected solely for having a larger free rectangle. Search/cost caps stay intact. */
export function legendBoundFailure(
  failures: LegendSearchFailure,
  drafts: readonly Draft[],
  title: string,
  fallback?: RenderFailure,
): RenderFailure | undefined {
  const tail = failures.tail?.failure ?? fallback;
  if (
    !tail ||
    tail.code !== "R006" ||
    tail.details?.capacityKind !== "free-region"
  )
    return failures.bound;
  const entries = tail.details.legendEntries as
    { designation: string; kind: string }[] | undefined;
  if (!entries?.length) return failures.bound;
  const { base, limit } = rootedPageBudget(drafts),
    devices = entries.map((e) => `${e.designation} (${e.kind})`).join(", ");
  const bounded =
    failures.bound?.code === "R006" &&
    failures.bound.details?.constraint === "page-cost-bound";
  const caps = [...(failures.stops ?? [])].sort();
  const stop = bounded
    ? `exhausted the ${limit}-sheet packet page-cost bound (${base} native sheets)`
    : caps.length
      ? `recorded pruning at the ${caps.map((cap) => capNames.get(cap)).join(", ")}`
      : "exhausted its feasible protected-gap candidates";
  return {
    ...tail,
    root: "packet",
    message: `Legend pagination ${stop}. ${failures.tail ? "The final sheet" : "A sheet"} of ${title} cannot fit complete entries for ${devices}: requires ${Number(tail.details.requiredWidthMm).toFixed(2)} × ${Number(tail.details.requiredHeightMm).toFixed(2)} mm; largest tried free region is ${Number(tail.details.availableWidthMm).toFixed(2)} × ${Number(tail.details.availableHeightMm).toFixed(2)} mm after 3 mm ink clearance.${bounded ? ` Further pagination must stay within ${limit} sheets.` : ""} Use larger paper, another flow, or split the view.`,
    details: {
      ...tail.details,
      constraint: bounded
        ? "legend-pagination-bound"
        : caps.length
          ? "legend-search-limit"
          : "legend-search-exhausted",
      ...(bounded
        ? { basePages: base, maximumPages: limit }
        : { searchCaps: caps }),
      sheet: failures.tail ? "final" : (tail.details.sheet ?? "unresolved"),
      viewTitle: title,
    },
  };
}
