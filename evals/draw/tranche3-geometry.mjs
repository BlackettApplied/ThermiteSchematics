import { distance, routePoints } from "./checks.mjs";
export { distance, routePoints };
export { finding, extent, painted, pointDistance } from "./review-geometry.mjs";
export const terminalKey = (t) =>
  JSON.stringify([t?.deviceUid, t?.terminalKey]);
export function nativeConductors(ir) {
  return new Map([
    ...[...(ir.wires ?? []), ...(ir.jumpers ?? [])].map((w) => [
      w.uid,
      w.endpoints?.map((e) => e.terminal),
    ]),
    ...(ir.cableConductors ?? []).map((w) => [
      JSON.stringify([w.id.cableUid, w.id.conductorId]),
      w.endpoints?.map((e) => e?.terminal),
    ]),
  ]);
}
export const segments = (points) =>
  (points ?? []).slice(1).map((p, i) => [points[i], p]);
export function segmentOverlap([a, b], [c, d], width) {
  const length = Math.hypot(b.x - a.x, b.y - a.y),
    other = Math.hypot(d.x - c.x, d.y - c.y);
  if (length < 0.01 || other < 0.01) return null;
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  if (Math.abs(u.x * (d.y - c.y) - u.y * (d.x - c.x)) / other > 0.001)
    return null;
  if (Math.abs(u.x * (c.y - a.y) - u.y * (c.x - a.x)) >= width - 0.01)
    return null;
  const project = (p) => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  const lo = Math.max(0, Math.min(project(c), project(d))),
    hi = Math.min(length, Math.max(project(c), project(d)));
  return hi - lo > 0.01
    ? [
        { x: a.x + lo * u.x, y: a.y + lo * u.y },
        { x: a.x + hi * u.x, y: a.y + hi * u.y },
      ]
    : null;
}
export const inside = (p, b) =>
  p.x >= b.x - 0.01 &&
  p.x <= b.x + b.w + 0.01 &&
  p.y >= b.y - 0.01 &&
  p.y <= b.y + b.h + 0.01;
