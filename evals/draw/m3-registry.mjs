import { registryRowFindings, sameSet } from "./m3-registry-row.mjs";
import { autoOriginLineage } from "./m3-auto-lineage.mjs";
import { packetNativeNeeds } from "./m3-needs-context.mjs";
// The exported registry is a third set of locators. Neither an entry nor its
// absence establishes a native fact or suppresses a visible issued row.
import { finding, painted } from "./review-geometry.mjs";
import { compact } from "./m3-native.mjs";
import { rowMatchesFact, requestedSupplies } from "./m3-documents.mjs";
const labels = {
  wires: "wire inventory",
  terminals: "terminal inventory",
  network: "network inventory",
  assemblies: "assembly inventory",
};
export function registryFindings(
  packet,
  geometries,
  ir,
  catalog,
  rows,
  context,
) {
  const nav = packet.navigation,
    findings = [],
    documents = nav.documents ?? [],
    allNeeds = packetNativeNeeds(
      packet,
      geometries,
      ir,
      catalog,
      context.request,
    ),
    binding = context.binding;
  const add = (kind, evidence) => findings.push(finding(kind, {}, evidence));
  const ids = documents.map((d) => d.id);
  if (new Set(ids).size !== ids.length)
    add("document-registry-duplicate-id", { ids });
  for (const doc of documents.filter((d) => labels[d.kind])) {
    const actual = rows.filter((r) => r.documentId === doc.id),
      table = context.tables?.find((t) => t.documentId === doc.id);
    if (
      !binding ||
      !["snapshotDigest", "presentationDigest", "revision"].every(
        (k) => doc[k] === binding[k],
      )
    )
      add("document-registry-source-mismatch", { documentId: doc.id });
    if (
      doc.label !== labels[doc.kind] ||
      actual.some((r) => r.kind !== doc.kind || r.auto !== !!doc.autoOrigin)
    )
      add("document-registry-origin-mismatch", { documentId: doc.id });
    if (
      doc.autoOrigin
        ? doc.authoredOrder !== undefined
        : table && doc.authoredOrder !== table.authoredOrder
    )
      add("document-registry-authored-scope-mismatch", { documentId: doc.id });
    if (doc.autoOrigin) {
      const auto =
          nav.autoDocuments?.filter((a) => a.documentId === doc.id) ?? [],
        lineage = autoOriginLineage(doc, nav.dependencies ?? [], allNeeds),
        native = lineage.native,
        requested = (context.tables ?? []).filter(
          (t) => t.origin === "requested" && t.kind === doc.kind,
        );
      if (
        auto.length !== 1 ||
        !sameSet(auto[0].dependencyIds, doc.autoOrigin.dependencyIds) ||
        !sameSet(auto[0].sheets, [...new Set(actual.map((r) => r.sheet))]) ||
        !lineage.valid
      )
        add("document-auto-origin-mismatch", { documentId: doc.id });
      for (const row of actual) {
        const source = catalog.find(
          (r) => r.kind === row.kind && r.key === row.key,
        );
        if (
          !source ||
          !native.some((n) => n.facts.some((f) => rowMatchesFact(source, f))) ||
          requestedSupplies(source, requested, rows)
        )
          add("document-auto-row-without-missing-native-need", {
            documentId: doc.id,
            key: row.key,
          });
      }
    }
    const rowIds = (doc.rows ?? []).map((r) => r.id);
    if (new Set(rowIds).size !== rowIds.length)
      add("document-registry-duplicate-row", { documentId: doc.id });
    for (const entry of doc.rows ?? [])
      registryRowFindings(doc, entry, actual, catalog, context.tables, add);
    for (const row of actual)
      if (
        (doc.rows ?? []).filter(
          (r) =>
            r.nativeKey === row.key &&
            r.sheet === row.sheet &&
            row.primitiveIds.includes(r.primitiveId),
        ).length !== 1
      )
        add("document-visible-row-without-registry-entry", {
          documentId: doc.id,
          key: row.key,
        });
    for (const number of [...new Set(actual.map((r) => r.sheet))]) {
      const g = geometries[packet.sheets.findIndex((s) => s.number === number)];
      if (
        !g.texts.some(
          (t) =>
            !t.row &&
            painted(t) &&
            compact(t.text).includes(compact(labels[doc.kind])),
        )
      )
        add("document-visible-short-label-missing", {
          documentId: doc.id,
          targetSheet: number,
        });
    }
  }
  for (const row of rows.filter((r) => labels[r.kind]))
    if (!documents.some((d) => d.id === row.documentId))
      add("document-visible-row-without-issued-document", {
        sheet: row.sheet,
        key: row.key,
      });
  for (const origin of nav.autoDocuments ?? [])
    if (!documents.some((d) => d.id === origin.documentId && d.autoOrigin))
      add("document-auto-origin-without-document", {
        documentId: origin.documentId,
      });
  return findings;
}
