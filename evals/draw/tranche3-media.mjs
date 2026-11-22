import { groupBy, extent, painted, finding } from "./review-geometry.mjs";
// PDF owners are reconstructed spatially from measured cell regions. Matching
// text is deliberately not a condition: changing NC to NO must remain visible.
export function pdfOracleTexts(g, select) {
  const texts = [],
    missing = [];
  for (const ts of groupBy(
    g.texts.filter((t) => painted(t) && select(t)),
    (t) =>
      t.row != null
        ? JSON.stringify([t.documentId, t.row, t.columnIndex])
        : t.element,
  ).values()) {
    const t = ts[0],
      cell = g.reportCells?.find(
        (c) =>
          c.documentId === t.documentId &&
          c.row === t.row &&
          c.columnIndex === t.columnIndex &&
          c.reportRowScope === t.reportRowScope,
      );
    const box =
      cell?.bbox ??
      extent(
        ts.flatMap((t) => [
          t.bbox,
          { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
        ]),
      );
    const runs = (g.pdfTexts ?? [])
      .filter((p) => {
        const x = p.bbox.x + p.bbox.w / 2,
          y = p.bbox.y + p.bbox.h / 2;
        return (
          x >= box.x - 0.17 &&
          x <= box.x + box.w + 0.17 &&
          y >= box.y - 0.17 &&
          y <= box.y + box.h + 0.17
        );
      })
      .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    if (!runs.length && ts.some((t) => t.text.trim()))
      missing.push(
        finding("oracle-pdf-field-unavailable", t, { medium: "pdf" }),
      );
    texts.push({
      ...t,
      text: runs.map((p) => p.text).join(" "),
      medium: "pdf",
    });
  }
  return { texts, missing };
}
