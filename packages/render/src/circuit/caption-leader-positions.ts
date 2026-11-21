import type { ElkLabel } from "elkjs/lib/elk-api.js";
import type { CircuitLabelState } from "./layout-routes.js";
import { uncoveredCaptionRuns } from "./caption-uncovered.js";
import { required } from "../presentation/util.js";
export const CAPTION_POSITIONS_PER_UNCOVERED_RUN = 30;
/** Fixed candidates beside/at both ends of each actual uncovered run. The
 * final glyph, reach, stroke and whole-plate checks decide admission. */
export function leaderCaptionPositions(
  index: number,
  label: Readonly<ElkLabel>,
  state: CircuitLabelState,
) {
  const coverage = uncoveredCaptionRuns(index, state.segments),
    width = required(label.width, "Missing caption width"),
    height = required(label.height, "Missing caption height"),
    reach = 2;
  return (coverage?.runs ?? []).flatMap(({ a, b }) => {
    const horizontal = Math.abs(a.y - b.y) < 1e-7,
      low = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      high = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      size = horizontal ? width : height,
      along = [
        low - size,
        low,
        (low + high - size) / 2,
        high - size,
        high,
        Math.max(
          low - size,
          Math.min(
            high,
            required(horizontal ? label.x : label.y, "Unplaced caption"),
          ),
        ),
      ],
      cross = horizontal ? a.y : a.x,
      depth = horizontal ? height : width;
    return along.flatMap((p) =>
      [
        cross - depth - reach,
        cross - depth,
        cross - depth / 2,
        cross,
        cross + reach,
      ].map((q) => (horizontal ? { x: p, y: q } : { x: q, y: p })),
    );
  });
}
