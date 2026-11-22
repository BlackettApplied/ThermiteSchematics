import { boxExtent } from "./repeat-appearances.mjs";
export const NAVIGATION_EPS_MM = 0.01;
export const boxGap = (a, b) => ({
  x: Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w),
  y: Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h),
});
export const frameDistance = (a, b) => {
  const d = boxGap(a, b);
  return Math.hypot(d.x, d.y);
};
export const anchorDistance = (p, b) =>
  Math.hypot(
    Math.max(b.x - p.x, 0, p.x - b.x - b.w),
    Math.max(b.y - p.y, 0, p.y - b.y - b.h),
  );
// Frames are drawn nested primitives, clipped to the visible viewport. Exported
// frameMm/locality flags never participate. Frameless owners use native body ink.
export function nearestOwner(g, owner, box) {
  const frames = (g.shapes ?? [])
    .filter((s) => (s.navigationFrame ?? s.outline) && s.deviceUid)
    .flatMap((s) => {
      if (s.navigationInkSegments && !s.navigationInkSegments.length) return [];
      const b = s.navigationInkSegments?.length
        ? boxExtent(
            s.navigationInkSegments.flatMap((pair) =>
              pair.map((p) => ({ bbox: { ...p, w: 0, h: 0 } })),
            ),
          )
        : s.bbox;
      return b.w > 0 && b.h > 0 ? [{ uid: s.deviceUid, bbox: b }] : [];
    });
  // Only frames enclosing this appearance own it. A framed copy elsewhere
  // cannot borrow ownership from the same native device UID.
  const encloses = (outer, inner) =>
    outer.x <= inner.x + NAVIGATION_EPS_MM &&
    outer.y <= inner.y + NAVIGATION_EPS_MM &&
    outer.x + outer.w >= inner.x + inner.w - NAVIGATION_EPS_MM &&
    outer.y + outer.h >= inner.y + inner.h - NAVIGATION_EPS_MM;
  const owners = frames.filter(
    (f) => f.uid === owner.uid && encloses(f.bbox, owner.bbox),
  );
  const localFrames = frames.filter((f) => f.uid !== owner.uid);
  localFrames.push(
    ...(owners.length ? owners : [{ uid: owner.uid, bbox: owner.bbox }]),
  );
  const distances = localFrames
    .map((f) => ({ ...f, d: frameDistance(box, f.bbox) }))
    .sort((a, b) => a.d - b.d);
  const own = distances.find((f) => f.uid === owner.uid);
  return {
    ownerNearest:
      !!own &&
      !distances.some(
        (f) => f.uid !== owner.uid && f.d <= own.d + NAVIGATION_EPS_MM,
      ),
    ownerFrameGapMm: own?.d,
    nearestFrameGapMm: distances[0]?.d,
    nearestDeviceUid: distances[0]?.uid,
  };
}
