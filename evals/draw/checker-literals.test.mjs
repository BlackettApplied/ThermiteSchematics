import { expect, it } from "vitest";
import { hasLegibleEm } from "./text-legibility.mjs";
import { classifyReferenceTags } from "./device-tags.mjs";
import { scopeTables } from "./m3-documents.mjs";
import { fixture } from "./m3-fixture.mjs";
import { criteria } from "./criteria.mjs";

it("262.1 rejects a literal null horizontal factor while retaining the historical absent field", () => {
  expect(hasLegibleEm({ fontSize: 2.7, tagHorizontalFactor: null })).toBe(
    false,
  );
  expect(hasLegibleEm({ fontSize: 2.7 })).toBe(true);
  expect(hasLegibleEm({ fontSize: 2.7, tagHorizontalFactor: 0.95 })).toBe(true);
});
function referenceFixture() {
  const ir = {
    devices: [
      {
        uid: "a",
        designation: "A",
        typeId: "t",
        description: "Native description",
      },
    ],
    deviceTypes: [
      { id: "t", catalog: { orderNumber: "P-1" }, terminals: [{ key: "1" }] },
    ],
  };
  const row = (tagField, text, tagBlock, extra = {}) => ({
    tagField,
    text,
    tagBlock,
    tagContainer: tagBlock,
    tagOwnerUid: "a",
    tagKind: "reference",
    tagOwnershipValid: true,
    tagPainted: true,
    fontSize: 2.3,
    order: 1,
    ...extra,
  });
  const qualified = row("designation", "A.1", "qualified", {
    tagTerminal: { deviceUid: "a", terminalKey: "1" },
  });
  const entry = [
    ["designation", "A"],
    ["description", "Native description"],
    ["part", "P-1"],
  ].map(([field, text]) =>
    row(field, text, "entry", { tagReferenceEntry: true }),
  );
  return {
    ir,
    g: { texts: [qualified, ...entry], devices: [] },
    qualified,
    entry,
  };
}
it("262.2 absent-body complete reference entries receive the reference floor", () => {
  const f = referenceFixture();
  classifyReferenceTags(f.g, f.ir);
  expect(f.entry.every((t) => t.nativeReference && hasLegibleEm(t))).toBe(true);
});
it("262.2 a present body prevents the absent-body reference floor", () => {
  const f = referenceFixture();
  f.g.devices.push({ deviceUid: "a", tagKind: "body" });
  classifyReferenceTags(f.g, f.ir);
  expect(f.qualified.nativeReference).toBe(true);
  expect(f.entry.every((t) => !t.nativeReference && !hasLegibleEm(t))).toBe(
    true,
  );
});
it.each(["description", "part"])(
  "262.2 missing %s prevents the absent-body reference floor",
  (field) => {
    const f = referenceFixture();
    f.g.texts = f.g.texts.filter(
      (t) => t.tagBlock !== "entry" || t.tagField !== field,
    );
    classifyReferenceTags(f.g, f.ir);
    expect(f.qualified.nativeReference).toBe(true);
    expect(
      f.g.texts
        .filter((t) => t.tagBlock === "entry")
        .every((t) => !t.nativeReference && !hasLegibleEm(t)),
    ).toBe(true);
  },
);
function legacyTables() {
  const f = fixture();
  f.packet.navigation.documents = [];
  for (const t of [...f.report.texts, ...f.report.reportCells])
    delete t.documentOrigin;
  const tables = [
    {
      kind: "network",
      origin: "requested",
      authoredOrder: 0,
      columns: [],
      rows: [],
    },
  ];
  tables.universe = [];
  return { f, tables, gs: [f.source, f.report] };
}
it("262.3 single requested document uses the historical fallback without a registry match", () => {
  const { f, tables, gs } = legacyTables();
  expect(
    scopeTables(f.packet, gs, f.ir, tables, f.request).map((t) => t.documentId),
  ).toEqual([f.report.texts.find((t) => t.documentId).documentId]);
});
it("262.3 historical fallback refuses ambiguous requested documents", () => {
  const { f, tables, gs } = legacyTables();
  tables.push({ ...tables[0], authoredOrder: 1 });
  expect(
    scopeTables(f.packet, gs, f.ir, tables, f.request).map((t) => t.documentId),
  ).toEqual([undefined, undefined]);
});
it("256.R2L4 criterion names explicit native empty states, never blank nulls", () => {
  expect(criteria["DQ-19"]).toContain("explicit native empty states");
  expect(criteria["DQ-19"]).not.toMatch(/blank nulls/i);
});
