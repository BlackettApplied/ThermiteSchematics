import { captionAssociation } from "../layout/beside-caption.js";
import { rectInkBox, routeInkDistance } from "../layout/ink-geometry.js";
import { horizontalLabelSupport } from "../layout/wire-label-support.js";
// Circuit labels already have an opaque inline plate. Keep a native vertical
// plate only when its complete glyph height lies on the owner's straight run
// and no foreign conductor enters it; do not create new plates to mask overlap.
export function existingCircuitCaption(
  ink: ReturnType<typeof rectInkBox>,
  own: readonly (readonly { x: number; y: number }[])[],
  foreign: readonly (readonly { x: number; y: number }[])[],
  strokes: readonly number[],
  stroke: number,
) {
  const association = captionAssociation(ink, own, foreign, stroke, 2, strokes);
  // Preserve the existing conductor-facing anchors of already clear circuit
  // captions inside the established 2 mm association reach. Repairs prefer
  // 0.75 mm; a legal old anchor is not moved merely to tighten its spacing.
  if (association.owner >= 0.5 && !association.needsLeader) return true;
  return (
    (horizontalLabelSupport(ink, own, 0, foreign) && association.foreign > 0) ||
    (foreign.every(
      (r, i) => routeInkDistance(ink, [r], strokes[i] ?? 0.32) > 0,
    ) &&
      own.some((r) =>
        r.some((a, i) => {
          const b = r[i + 1];
          return (
            b &&
            Math.abs(a.x - b.x) < 1e-7 &&
            a.x > ink.left &&
            a.x < ink.right &&
            Math.min(a.y, b.y) <= ink.top &&
            Math.max(a.y, b.y) >= ink.bottom
          );
        }),
      ))
  );
}
