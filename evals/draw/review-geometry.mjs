// Small geometry helpers shared by independent drawing-review predicates.
export const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = ([a, b]) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export const extent = (points) => {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
export const finding = (kind, item = {}, evidence = {}) => ({
  kind,
  element: item.element ?? "sheet",
  designation: item.designation ?? item.text ?? item.deviceUid ?? "sheet",
  ...(item.bbox ? { bbox: item.bbox } : { sheetLevel: true }),
  ...evidence,
});
export const painted = (t) => t.reviewPainted !== false && t.painted !== false;
export const segment = (s) =>
  s.points?.length >= 2 ? [s.points[0], s.points.at(-1)] : null;
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function crosses(a, b) {
  return (
    cross(...a, b[0]) * cross(...a, b[1]) <= 1e-8 &&
    cross(...b, a[0]) * cross(...b, a[1]) <= 1e-8 &&
    Math.max(Math.min(a[0].x, a[1].x), Math.min(b[0].x, b[1].x)) <=
      Math.min(Math.max(a[0].x, a[1].x), Math.max(b[0].x, b[1].x)) + 0.01 &&
    Math.max(Math.min(a[0].y, a[1].y), Math.min(b[0].y, b[1].y)) <=
      Math.min(Math.max(a[0].y, a[1].y), Math.max(b[0].y, b[1].y)) + 0.01
  );
}
export function mergedIntervals(intervals) {
  const result = [];
  for (const [a, b] of intervals.slice().sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
export function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const k = key(item);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}
