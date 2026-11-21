import { expect, it } from "vitest";
import { registryRowFindings } from "./m3-registry-row.mjs";
function fixture() {
  const fact = { kind: "connector-port-status", deviceUid: "a", portKey: "J" },
    columns = ["identity", "endpoints", "status"],
    doc = { id: "doc", kind: "assemblies" },
    entry = {
      id: "row",
      nativeKey: "key",
      sheet: 1,
      primitiveId: "ink",
      facts: [fact],
      columns,
    },
    actual = [
      {
        kind: doc.kind,
        key: "key",
        sheet: 1,
        primitiveIds: ["ink"],
        documentId: doc.id,
        columnNames: ["Identity"],
        cells: { 0: "Native" },
      },
    ],
    catalog = [
      {
        kind: doc.kind,
        key: "key",
        facts: [fact],
        columns,
        required: { 0: ["Native"] },
        exactColumns: [0],
      },
    ],
    tables = [{ kind: doc.kind, documentId: doc.id, columns: ["Identity"] }];
  return { doc, entry, actual, catalog, tables };
}
const check = (x) => {
  const findings = [];
  registryRowFindings(
    x.doc,
    x.entry,
    x.actual,
    x.catalog,
    x.tables,
    (kind, evidence) => findings.push({ kind, ...evidence }),
  );
  return findings;
};
it("accepts native values, header, locator, facts and columns together", () => {
  expect(check(fixture())).toEqual([]);
});
it.each([
  [
    "native-row-unavailable",
    (x) => {
      x.catalog = [];
    },
  ],
  [
    "visible-row-count",
    (x) => {
      x.actual = [];
    },
  ],
  [
    "visible-row-count",
    (x) => {
      x.actual.push(structuredClone(x.actual[0]));
    },
  ],
  [
    "native-values-insufficient",
    (x) => {
      x.actual[0].cells[0] = "Invented";
    },
  ],
  [
    "printed-header-mismatch",
    (x) => {
      x.actual[0].columnNames = ["Wrong"];
    },
  ],
  [
    "native-facts-mismatch",
    (x) => {
      x.entry.facts = [];
    },
  ],
  [
    "native-data-unavailable",
    (x) => {
      x.catalog[0].sourceGap = "Missing native data";
    },
  ],
])("names the failed registry condition: %s", (reason, mutate) => {
  const x = fixture();
  mutate(x);
  expect(check(x)).toMatchObject([
    {
      kind: "document-registry-row-mismatch",
      reasons: [reason],
      actualFacts: x.entry.facts,
    },
  ]);
});
it("keeps a standalone columns defect visible without a spurious row mismatch", () => {
  const x = fixture();
  x.entry.columns = ["pin-map"];
  expect(check(x)).toMatchObject([
    { kind: "document-registry-columns-mismatch" },
  ]);
});
