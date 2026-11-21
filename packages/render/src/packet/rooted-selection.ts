import { frameBudgetOrder } from "./frame-budget.js";
import type { RootedCandidate } from "./rooted-build.js";
import type { PaperPage } from "./types.js";

/** Composition is an alternative to the already legal materialized winner. */
export function selectRootedComposition(
  winner: RootedCandidate,
  composed: RootedCandidate,
  page: PaperPage,
): RootedCandidate {
  return frameBudgetOrder(composed, winner, page) <= 0 ? composed : winner;
}
