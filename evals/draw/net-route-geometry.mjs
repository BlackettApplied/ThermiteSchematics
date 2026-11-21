// Join measured pieces by geometry, never DOM order or renderer route flags.
import { pointDistance } from "./review-geometry.mjs";
const finite = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);
const touches = (a, b) => pointDistance(a, b) <= 0.001;
function sourceAnchor(routes) {
  const anchors = routes.flatMap((r) =>
    (r.ownedLandings ?? []).filter(
      (p) => p.end === "source" && finite(p.anchor),
    ),
  );
  if (!anchors.length)
    return {
      reason: "Net-label route direction has no verified source anchor",
    };
  const first = anchors[0];
  if (
    anchors.some(
      (p) =>
        !touches(p.anchor, first.anchor) ||
        p.deviceUid !== first.deviceUid ||
        p.terminal !== first.terminal,
    )
  )
    return { reason: "Net-label route direction has ambiguous source anchors" };
  return { anchor: first.anchor };
}
function continueRoute(points, remaining) {
  while (remaining.length) {
    const end = points.at(-1),
      next = remaining.filter(
        (p) => touches(p[0], end) || touches(p.at(-1), end),
      );
    if (next.length !== 1)
      return { reason: "Net-label route pieces are disconnected or ambiguous" };
    const piece = next[0],
      forward = touches(piece[0], end);
    if (forward && touches(piece.at(-1), end))
      return { reason: "Net-label route piece direction is ambiguous" };
    points.push(...(forward ? piece : piece.toReversed()).slice(1));
    remaining.splice(remaining.indexOf(piece), 1);
  }
  return { points };
}
export function sourceOrderedRoute(routes) {
  const source = sourceAnchor(routes);
  if (source.reason) return source;
  const pieces = routes.map((r) => r.points ?? []);
  if (!pieces.length || pieces.some((p) => p.length < 2 || !p.every(finite)))
    return { reason: "Net-label route direction lacks a measured polyline" };
  const starts = pieces.filter(
    (p) => pointDistance(p[0], source.anchor) <= 0.05,
  );
  if (!starts.length)
    return {
      mismatch: { pathStart: pieces[0][0], claimedSourceAnchor: source.anchor },
    };
  if (starts.length !== 1)
    return { reason: "Net-label route source piece is ambiguous" };
  return continueRoute(
    [...starts[0]],
    pieces.filter((p) => p !== starts[0]),
  );
}
