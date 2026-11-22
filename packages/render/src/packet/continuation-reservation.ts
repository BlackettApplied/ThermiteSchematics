import type { PreparedSchematicDrawing } from "../renderer.js";
import { MAX_CUTS } from "./safe-cuts.js";
/** Pass one uses a conservative envelope. An orthogonal segment can cross
 * at most MAX_CUTS-1 interior cuts on its axis; final folding/omission cannot
 * add crossings. The authored-view offset already counts all earlier pairs.
 * Destination width remains conservatively reserved through sheet 100. Thus
 * no optimistic tightening or unbounded numbering replay is needed. */
export function maximumContinuationSerial(
  p: PreparedSchematicDrawing,
  offset: number,
) {
  return Math.max(
    1,
    offset +
      (MAX_CUTS - 1) *
        p.layout.edges.reduce(
          (n, e) => n + Math.max(0, e.points.length - 1),
          0,
        ),
  );
}
