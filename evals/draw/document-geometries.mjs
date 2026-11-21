// Partition measured document identities, never inferred table titles or page order.
// Leave ordinary single-document geometry untouched for observation stability.
export function documentGeometries(g) {
  const ids = [
    ...new Set((g.texts ?? []).map((t) => t.documentId).filter(Boolean)),
  ];
  if (ids.length <= 1) return [g];
  const rows = (id) => [
    ...new Set([
      ...g.texts.filter((t) => t.documentId === id && t.row).map((t) => t.row),
      ...(g.reportCells ?? [])
        .filter((c) => c.documentId === id)
        .map((c) => c.row),
    ]),
  ];
  const owned = new Set(ids.flatMap(rows));
  const unowned = g.reportRows.filter((r) => !owned.has(r));
  if (unowned.length || g.texts.some((t) => t.row && !t.documentId))
    ids.push(undefined);
  return ids.map((id) => ({
    ...g,
    texts: g.texts.filter((t) => t.documentId === id),
    reportCells: g.reportCells?.filter((c) => c.documentId === id),
    reportRows:
      id === undefined ? [...new Set([...rows(id), ...unowned])] : rows(id),
  }));
}
const documentId = (g) => g.texts.find((t) => t.documentId)?.documentId;
export function mediumDocuments(g, html, medium) {
  const required = documentGeometries(g);
  if (medium !== "html")
    return required.map((geometry) => ({ source: geometry, geometry }));
  const actual = documentGeometries(html),
    ids = required.map(documentId);
  return [
    ...required.map((source) => ({
      source,
      geometry: actual.find((part) => documentId(part) === documentId(source)),
    })),
    ...actual
      .filter((part) => !ids.includes(documentId(part)))
      .map((geometry) => ({ source: geometry, geometry })),
  ];
}
