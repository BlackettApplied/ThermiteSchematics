import { routeGrowth } from "./rooted-clipped-routes.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { RootedSearch } from "./rooted-search.js";
import { nativeWinner, rootedWinner } from "./rooted-search.js";
import { materializeRootedCandidate } from "./rooted-build.js";
import { rootedPageCostFailure } from "./rooted-bound.js";
import type { PaperPage } from "./types.js";
import { resolveRootedContinuations } from "./continuation-resolve.js";
import { PacketDraftError } from "./errors.js";
import {
  ContinuationLabelError,
  continuationLabelSvg,
} from "./continuation-label.js";

export const STANDARD_ECONOMY_ATTEMPTS = 4;
/** Only already-printable standard views spend this optimisation budget.
 * Recovery keeps the unchanged 48-layout budget; exhaustion never settles. */
export function economyExhausted(run: RootedSearch) {
  return (
    run.economyStartedAt !== undefined &&
    run.attempts - run.economyStartedAt + Number(!!run.jogRetryReserved) >=
      STANDARD_ECONOMY_ATTEMPTS
  );
}
/** Printable means materialized emitter/ink/content/reciprocity checks passed
 * and a sufficient view-local page-cost check passed. This does NOT introduce
 * a view refusal bound: over-bound views retain ordinary recovery and the final
 * packet-level 2x check. A saved validated candidate survives exhaustion. */
export function validateEconomyCandidate(
  ir: Readonly<ElectricalIr>,
  run: RootedSearch,
  page: PaperPage,
) {
  if (!run.standardEconomy && run.localityReference) return;
  const candidate = rootedWinner(run, page),
    native = nativeWinner(run);
  if (!candidate || !native || candidate === run.validatedCandidate) return;
  const result = materializeRootedCandidate(ir, candidate, page);
  if (!result.ok) return;
  const probe = structuredClone(result.value);
  const first = probe[0];
  if (!first) return;
  first.rootedFit = {
    basePages: native.drafts.length,
    actualPages: probe.length,
    context: "economy eligibility",
  };
  if (rootedPageCostFailure(probe)) return;
  try {
    resolveRootedContinuations(probe, page);
    for (const draft of probe)
      for (const link of draft.links) continuationLabelSvg(link);
  } catch (error) {
    if (
      error instanceof PacketDraftError ||
      error instanceof ContinuationLabelError
    )
      return;
    throw error;
  }
  candidate.printableDrafts = result.value;
  // Ink/page-cost eligibility starts economy unchanged. Locality needs the
  // stronger route-safe reference; an unsafe first layout cannot bind it.
  if (
    !run.localityReference &&
    routeGrowth(candidate, native, false).every((n) => n === 0) &&
    routeGrowth(candidate, native).every((n) => n === 0)
  )
    run.localityReference = candidate;
  if (!run.standardEconomy) return;
  run.validatedCandidate = candidate;
  run.economyStartedAt ??= run.attempts;
}
