export const measuredBox = (b) =>
  b &&
  ["x", "y", "w", "h"].every((k) => Number.isFinite(b[k])) &&
  b.w > 0 &&
  b.h > 0;
export function measuredRows(geometries) {
  return (
    Array.isArray(geometries) &&
    geometries.every(
      (g) =>
        Array.isArray(g?.texts) &&
        Array.isArray(g?.reportCells) &&
        g.texts.every((t) => measuredBox(t.bbox)) &&
        g.reportCells.every((c) => measuredBox(c.bbox)),
    )
  );
}
