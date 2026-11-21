import type { CircuitLabelState } from "./layout-routes.js";
import { uncoveredCaptionRuns } from "./caption-uncovered.js";
/** A fully covered native route has no separate segment for caption ownership. */
export function fullyCoincidentCaption(
  index: number,
  segments: readonly CircuitLabelState["segments"][number][],
) {
  const coverage = uncoveredCaptionRuns(index, segments);
  return coverage !== undefined && coverage.runs.length === 0;
}
