import type { LayoutPoint } from "../types.js";
import {
  pointInsideBox,
  routeSegments,
  routeInkDistance,
  type InkBox,
} from "./ink-geometry.js";
import {
  horizontalLabelSupport,
  type LabelSupportContext,
} from "./wire-label-support.js";
import { clearOwnedPlate } from "./label-plate.js";
export function captionAssociation(
  ink: InkBox,
  own: readonly (readonly LayoutPoint[])[],
  foreign: readonly (readonly LayoutPoint[])[],
  stroke: number,
  reach: number,
  foreignStrokes?: readonly number[],
) {
  const owner = routeInkDistance(ink, own, stroke),
    other = Math.min(
      ...foreign.map((r, i) =>
        routeInkDistance(ink, [r], foreignStrokes?.[i] ?? stroke),
      ),
    );
  return {
    owner,
    foreign: other,
    needsLeader: owner > reach + 1e-7 || other <= owner + 1e-7,
  };
}
function translated(ink: InkBox, left: number, top: number): InkBox {
  return {
    left,
    top,
    right: left + ink.right - ink.left,
    bottom: top + ink.bottom - ink.top,
  };
}
function clear(ink: InkBox, reservation: InkBox, context: LabelSupportContext) {
  const pad = context.strokeClearance ?? 0;
  return (
    pointInsideBox({ x: ink.left, y: ink.top }, reservation) &&
    pointInsideBox({ x: ink.right, y: ink.bottom }, reservation) &&
    pointInsideBox({ x: ink.left, y: ink.top }, context.bounds) &&
    pointInsideBox({ x: ink.right, y: ink.bottom }, context.bounds) &&
    !context.obstacles.some(
      (o) =>
        ink.left < o.right + pad - 1e-7 &&
        ink.right > o.left - pad + 1e-7 &&
        ink.top < o.bottom + pad - 1e-7 &&
        ink.bottom > o.top - pad + 1e-7,
    )
  );
}
function proposals(
  ink: InkBox,
  own: readonly (readonly LayoutPoint[])[],
  distance: number,
  reservation?: InkBox,
) {
  const width = ink.right - ink.left,
    height = ink.bottom - ink.top;
  return own.flatMap((route) =>
    routeSegments(route).flatMap(({ a, b }) => {
      if (Math.abs(a.x - b.x) < 1e-7) {
        const y0 = Math.max(
          Math.min(a.y, b.y) - height / 2,
          Math.min(Math.max(a.y, b.y) - height / 2, ink.top),
        );
        const ys = [y0];
        if (reservation) {
          const topY = Math.max(
            Math.min(a.y, b.y) - height / 2,
            Math.min(Math.max(a.y, b.y) - height / 2, reservation.top),
          );
          if (Math.abs(topY - y0) > 1e-7) ys.push(topY);
        }
        return ys.flatMap((y) => [
          translated(ink, a.x - distance - width, y),
          translated(ink, a.x + distance, y),
        ]);
      }
      const x0 = Math.max(
        Math.min(a.x, b.x) - width / 2,
        Math.min(Math.max(a.x, b.x) - width / 2, ink.left),
      );
      const xs = [x0];
      if (reservation) {
        const leftX = Math.max(
          Math.min(a.x, b.x) - width / 2,
          Math.min(Math.max(a.x, b.x) - width / 2, reservation.left),
        );
        if (Math.abs(leftX - x0) > 1e-7) xs.push(leftX);
      }
      return xs.flatMap((x) => [
        translated(ink, x, a.y - distance - height),
        translated(ink, x, a.y + distance),
      ]);
    }),
  );
}
function evaluateCandidate(
  p: InkBox,
  own: readonly (readonly LayoutPoint[])[],
  context: LabelSupportContext,
  stroke: number,
  reach: number,
  margin: number,
) {
  const a = captionAssociation(
    p,
    own,
    context.foreign,
    stroke,
    reach,
    context.foreignStrokes,
  );
  const marginOk =
    margin > 0 ? a.foreign >= a.owner + margin - 1e-7 : a.foreign > 0;
  return {
    ink: p,
    inline: false,
    ...a,
    needsLeader: a.needsLeader || !marginOk,
  };
}

/** Keep valid inline plates and already clear nearby captions. Otherwise choose
 * a clear beside-run position inside the existing clip. Distances use glyph
 * bounds and conductor ink, not owner tags or a text anchor's closest corner. */
export function besideCaption(
  ink: InkBox,
  reservation: InkBox,
  own: readonly (readonly LayoutPoint[])[],
  context: LabelSupportContext,
  mmPerUnit: number,
  stroke: number,
  ownershipMarginMm = 0,
  admissible?: (candidate: InkBox) => boolean,
) {
  const allowed = (candidate: InkBox) => !admissible || admissible(candidate);
  const reach = 2 / mmPerUnit,
    margin = ownershipMarginMm / mmPerUnit,
    current = evaluateCandidate(ink, own, context, stroke, reach, margin);
  if (
    allowed(ink) &&
    horizontalLabelSupport(ink, own, 0, context.foreign) &&
    clearOwnedPlate(ink, own, stroke / 2 + 0.01 / mmPerUnit, true) &&
    current.foreign > 0
  )
    return { ink, inline: true, needsLeader: false };
  if (
    allowed(ink) &&
    current.owner >= 0.5 / mmPerUnit - 1e-7 &&
    current.owner <= 1 / mmPerUnit + 1e-7 &&
    !current.needsLeader
  )
    return { ink, inline: false, needsLeader: false };
  const options = proposals(
    ink,
    own,
    0.75 / mmPerUnit + stroke / 2,
    admissible ? reservation : undefined,
  )
    .filter((p) => allowed(p) && clear(p, reservation, context))
    .map((p) => evaluateCandidate(p, own, context, stroke, reach, margin))
    .filter((p) => p.owner > 1e-7 && p.foreign > 1e-7)
    .sort(
      (a, b) =>
        Number(a.needsLeader) - Number(b.needsLeader) ||
        Math.hypot(a.ink.left - ink.left, a.ink.top - ink.top) -
          Math.hypot(b.ink.left - ink.left, b.ink.top - ink.top),
    );
  const found = options[0];
  if (found) return found;
  if (
    allowed(ink) &&
    current.owner > 0 &&
    current.foreign > 0 &&
    clear(ink, reservation, context)
  )
    return current;
  // Last, try the fixed nine corners/edge-centres of the existing clip. This
  // handles a foreign corner crossing without enlarging the reservation. A
  // remote or ambiguous result still requires a checked leader at emission.
  return clippedCaption(
    ink,
    reservation,
    own,
    context,
    stroke,
    reach,
    margin,
    admissible,
  );
}
function clippedCaption(
  ink: InkBox,
  reservation: InkBox,
  own: readonly (readonly LayoutPoint[])[],
  context: LabelSupportContext,
  stroke: number,
  reach: number,
  margin = 0,
  admissible?: (candidate: InkBox) => boolean,
) {
  const right = reservation.right - (ink.right - ink.left),
    bottom = reservation.bottom - (ink.bottom - ink.top);
  if (right < reservation.left || bottom < reservation.top) return undefined;
  return [reservation.left, (reservation.left + right) / 2, right]
    .flatMap((x) =>
      [reservation.top, (reservation.top + bottom) / 2, bottom].map((y) =>
        translated(ink, x, y),
      ),
    )
    .filter(
      (p) => (!admissible || admissible(p)) && clear(p, reservation, context),
    )
    .map((p) => {
      const a = captionAssociation(
        p,
        own,
        context.foreign,
        stroke,
        reach,
        context.foreignStrokes,
      );
      return {
        ink: p,
        inline: false,
        ...a,
        needsLeader:
          a.needsLeader ||
          (margin > 0 ? a.foreign < a.owner + margin - 1e-7 : a.foreign <= 0),
      };
    })
    .filter((p) => p.owner > 0 && p.foreign > 0)
    .sort(
      (a, b) =>
        Number(a.needsLeader) - Number(b.needsLeader) ||
        a.owner - b.owner ||
        Math.hypot(a.ink.left - ink.left, a.ink.top - ink.top) -
          Math.hypot(b.ink.left - ink.left, b.ink.top - ink.top),
    )[0];
}
