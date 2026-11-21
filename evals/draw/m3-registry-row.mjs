import { factKeys, semanticColumns } from "./m3-facts.mjs";
import { printedHeader } from "./m3-documents.mjs";
import { sufficient } from "./document-dependencies.mjs";
export const sameSet = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
function rowProblems(entry, found, source, tables) {
  const reasons = [];
  if (!source) reasons.push("native-row-unavailable");
  if (source?.sourceGap) reasons.push("native-data-unavailable");
  if (found.length !== 1) reasons.push("visible-row-count");
  if (source && found.length === 1) {
    if (!source.sourceGap && !sufficient(found[0], source))
      reasons.push("native-values-insufficient");
    if (!printedHeader(found[0], tables))
      reasons.push("printed-header-mismatch");
  }
  if (source && !sameSet(factKeys(entry.facts ?? []), factKeys(source.facts)))
    reasons.push("native-facts-mismatch");
  return reasons;
}
export function registryRowFindings(doc, entry, actual, catalog, tables, add) {
  const found = actual.filter(
      (r) =>
        r.key === entry.nativeKey &&
        r.sheet === entry.sheet &&
        r.primitiveIds.includes(entry.primitiveId),
    ),
    source = catalog.find(
      (r) => r.kind === doc.kind && r.key === entry.nativeKey,
    ),
    reasons = rowProblems(entry, found, source, tables),
    columns =
      source &&
      (source.columns ?? [
        ...new Set(source.facts.flatMap((f) => semanticColumns[f.kind])),
      ]),
    columnMismatch = source && !sameSet(entry.columns, columns);
  const evidence = {
    documentId: doc.id,
    rowId: entry.id,
    nativeKey: entry.nativeKey,
  };
  if (reasons.length) {
    add("document-registry-row-mismatch", {
      ...evidence,
      reasons: columnMismatch
        ? [...reasons, "semantic-columns-mismatch"]
        : reasons,
      visibleMatches: found.length,
      expectedFacts: source?.facts ?? null,
      actualFacts: entry.facts ?? [],
      ...(source?.sourceGap ? { nativeSourceGap: source.sourceGap } : {}),
      ...(columnMismatch
        ? { expectedColumns: columns, actualColumns: entry.columns }
        : {}),
    });
  } else if (columnMismatch)
    add("document-registry-columns-mismatch", {
      documentId: doc.id,
      rowId: entry.id,
      expected: columns,
      actual: entry.columns,
    });
}
