import { CONTINUATION_BLOCK_GAP } from "./continuation-label.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { DrawingBounds, Link } from "./types.js";
import type { InkBox } from "./rooted-ink.js";
import { reserveContinuationSources } from "./continuation-source.js";
import {
  rootedConstraint,
  leastRootedConstraint,
  type RootedConstraint,
} from "./rooted-constraint.js";
import { required } from "../presentation/util.js";

export function continuationGridConstraint(
  p: PreparedSchematicDrawing,
  bounds: readonly DrawingBounds[],
  scale: number,
): RootedConstraint {
  const ids = reserveContinuationSources(p.graph).map((s) => s.conductor);
  const constraint = required(
    leastRootedConstraint(bounds.map((b) => rootedConstraint(p, b, scale))),
    "Missing bank constraint",
  );
  return {
    ...constraint,
    message: ids.length
      ? `${constraint.message} Continuation identities: ${ids.join(", ")}.`
      : constraint.message,
  };
}

/** Largest additional separation needed for one mm of clear ink. */
export function continuationShortfall(rows: InkBox[], occupied: InkBox[]) {
  return Math.max(
    0,
    ...rows.flatMap((a) =>
      occupied.map((b) =>
        Math.max(
          0,
          1 -
            Math.max(
              a.x - b.x - b.w,
              b.x - a.x - a.w,
              a.y - b.y - b.h,
              b.y - a.y - a.h,
            ),
        ),
      ),
    ),
  );
}

export function continuationPackingConstraint(links: Link[]) {
  const ids = links.map((l) => `${l.id} (${l.conductor})`).join(", ");
  return `Continuations ${ids} cannot keep ${CONTINUATION_BLOCK_GAP} mm between blocks within the 3.5 mm placement range. Use a larger sheet, landscape or another flow.`;
}
