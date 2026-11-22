import { crosses, pointDistance } from "./review-geometry.mjs";

const INK_MM = 0.17; // Two pixels at 300 dpi, as in the distance check.
const PLATE_GAP_MM = 0.75 + INK_MM;
const DASH_GAP_MM = 0.375 + 2 * 0.025; // Printed dash gap and sampling steps.

function enclosingPlate(g, block) {
  const ids = new Set(block.map((t) => t.element));
  return g.tranche3?.wirePlatePaint?.plates?.find(
    (p) =>
      ids.has(p.text) &&
      p.clip &&
      block.every(
        ({ bbox: b }) =>
          b.x >= p.bbox.x - INK_MM &&
          b.y >= p.bbox.y - INK_MM &&
          b.x + b.w <= p.bbox.x + p.bbox.w + INK_MM &&
          b.y + b.h <= p.bbox.y + p.bbox.h + INK_MM,
      ),
  );
}

function joinsPlate(leader, plate) {
  const { start, end, segments } = leader;
  const p = plate.bbox;
  return (
    Math.hypot(
      Math.max(p.x - start.x, 0, start.x - p.x - p.w),
      Math.max(p.y - start.y, 0, start.y - p.y - p.h),
    ) <= PLATE_GAP_MM &&
    segments.length > 0 &&
    pointDistance(start, segments[0][0]) <= INK_MM &&
    pointDistance(end, segments.at(-1)[1]) <= INK_MM &&
    segments.every(
      ([a], i) =>
        !i || pointDistance(segments[i - 1][1], a) <= DASH_GAP_MM + 1e-5,
    )
  );
}

/** Verify an offset label's annotation using the painted plate, leader and
 * landing. The declared owner locates a candidate and supplies no exemption. */
export function measuredPlateLeader(g, block, own, foreign, distance) {
  const plate = enclosingPlate(g, block);
  if (!plate) return false;
  const { wirePlatePaint, routeInk } = g.tranche3;
  const ink = (routes) => routes.flatMap((r) => routeInk?.[r.element] ?? []);
  return (
    wirePlatePaint.leaders?.some(
      (leader) =>
        leader.wire === block[0].wire &&
        joinsPlate(leader, plate) &&
        ink(own).some((run) => distance(leader.end, ...run) <= INK_MM) &&
        !ink(foreign).some(
          (run) =>
            distance(leader.end, ...run) <= INK_MM ||
            leader.segments.some((segment) => crosses(segment, run)),
        ),
    ) ?? false
  );
}

export function wirePlacementCoverage(g) {
  if (g.texts.some((t) => t.wire) || !g.shapes.some((s) => s.conductor))
    return {};
  const unowned = g.texts.some(
    (t) =>
      ["net", "conductor"].includes(t.labelRole) ||
      /(?:^|\s)label-(?:net|conductor)(?:\s|$)/.test(t.role ?? "") ||
      t.wireBlock,
  );
  return {
    status: "not-implemented",
    reasonCode: unowned
      ? "label-identity-unavailable"
      : "no-visible-conductor-labels",
    reason: unowned
      ? "Visible conductor labels need exported label-to-conductor identity."
      : "No visible conductor labels to measure on this sheet.",
  };
}

export function wireLabelBlock(g, t) {
  return t.wireBlock
    ? g.texts.filter((q) => q.wireBlock === t.wireBlock && q.wire === t.wire)
    : [t];
}
