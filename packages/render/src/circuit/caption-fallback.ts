import type { CircuitLabelState } from "./layout-routes.js";
import { uncoveredCaptionRuns } from "./caption-uncovered.js";
type Label = Pick<
  CircuitLabelState["labels"][number],
  "index" | "width" | "height"
>;
/** #359: retain base only after every bounded recovery fails, no checked leader
 * is found, and every uncovered run is too short for the unchanged whole block.
 * A hostable run remains fail-closed; net membership supplies no exemption. */
export function unhostableCaptionFallback(
  label: Label,
  segments: readonly CircuitLabelState["segments"][number][],
  recoveryFailed: boolean,
  checkedLeaderFound: boolean,
) {
  if (!recoveryFailed || checkedLeaderFound) return false;
  const coverage = uncoveredCaptionRuns(label.index, segments);
  if (
    !coverage ||
    coverage.uncoveredLength <= 1e-7 ||
    coverage.ownedLength - coverage.uncoveredLength <= 1e-7
  )
    return false;
  return coverage.runs.every(
    ({ a, b }) =>
      Math.hypot(b.x - a.x, b.y - a.y) <
      (Math.abs(a.y - b.y) < 1e-7 ? label.width : label.height) - 1e-7,
  );
}
