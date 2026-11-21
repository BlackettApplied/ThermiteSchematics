import { pointDistance } from "./review-geometry.mjs";
// Dashes may end before a port circle. Require nonempty painted ink and actual
// transformed path endpoints, rather than imposing a new maximum dash gap.
// The existing 0.17 mm uncertainty is added to the measured circle radius.
export function nativePortInk(edge, ports, kind) {
  if (!Array.isArray(edge.ends) || edge.ends.length !== 2 || !edge.ink?.length)
    return false;
  const native = edge.ends.map((end) => {
    const matches = ports.filter(
      (p) =>
        p.kind === kind &&
        p.deviceUid === end.deviceUid &&
        p.key === end.portKey,
    );
    return matches.length === 1 &&
      matches[0].point &&
      Number.isFinite(matches[0].radius)
      ? matches[0]
      : null;
  });
  return (
    native.every(Boolean) &&
    edge.paths?.some(
      (path) =>
        path.ends?.length === 2 &&
        [path.ends, path.ends.slice().reverse()].some((ends) =>
          ends.every(
            (p, i) =>
              pointDistance(native[i].point, p) <= native[i].radius + 0.17,
          ),
        ),
    )
  );
}
