import { expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { buildDocumentation } from "../../packages/query/dist/index.js";
import { contractCandidate, inlineCandidate } from "./c5-contract-fixture.mjs";
import { tableForSheet } from "./m3-documents.mjs";
import { identifierTable } from "./identifier-tables.mjs";
import { m3Delivery } from "./m3-delivery.mjs";
let ir, relation, table, view;
beforeAll(async () => {
  const compiled = await compileProject(resolve("examples/topology-coverage"));
  if (!compiled.ok) throw Error("Native fixture compilation failed");
  ir = compiled.ir;
  relation = ir.relations.find((r) => r.designation === "CAP-X2");
  view = {
    format: "connector-assembly-view-request/0.1",
    assemblies: ["CAP-X2"],
  };
  table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "assemblies",
  });
});
const candidate = () =>
  contractCandidate(structuredClone(ir), view, relation, table);
it("C6 locates a native inline assembly table on its graphical sheet", () => {
  const x = inlineCandidate(candidate()),
    s = x.packet.sheets[0],
    g = x.geometries[0];
  expect(s.view.kind).toBe("connector-assembly");
  expect(tableForSheet(s, g, x.tables)).toBe(x.tables[0]);
  expect(identifierTable(s, x.packet, g, x.ir, x.tables)).toBe(x.tables[0]);
});
it.each(["network", ""])(
  "C6 a mislabelled inline kind %j cannot select the assembly table",
  (kind) => {
    const x = inlineCandidate(candidate()),
      s = x.packet.sheets[0],
      g = x.geometries[0];
    for (const t of [...g.texts, ...g.reportCells])
      if (t.row) t.documentKind = kind;
    g.reportRows = [relation.uid];
    expect(tableForSheet(s, g, x.tables)).toBeUndefined();
    expect(() => identifierTable(s, x.packet, g, x.ir, x.tables)).toThrow(
      "source table missing",
    );
  },
);
function repeated() {
  const x = candidate();
  for (const d of x.packet.navigation.dependencies) {
    d.caption.text = d.caption.text.replace("02.", "03.");
    x.geometries[0].texts.find((t) =>
      t.primitiveIds?.includes(d.caption.primitiveId),
    ).text = d.caption.text;
  }
  const second = structuredClone(x.geometries[0]);
  x.geometries.splice(1, 0, second);
  x.packet.sheets.splice(1, 0, {
    number: 2,
    view: { kind: "connector-assembly" },
  });
  x.packet.sheets[2].number = 3;
  for (const r of x.packet.navigation.documents[0].rows) r.sheet = 3;
  x.packet.navigation.autoDocuments[0].sheets = [3];
  x.packet.navigation.dependencies.push(
    ...structuredClone(x.packet.navigation.dependencies).map((d) => ({
      ...d,
      owner: { ...d.owner, sheet: 2 },
    })),
  );
  return x;
}
const findings = (x, i = 0) => {
  const r = m3Delivery(
    x.packet.sheets[i],
    x.packet,
    x.geometries[i],
    x.geometries,
    x.ir,
    x.request,
    { binding: x.binding, tables: x.tables },
  );
  return [...r.findings, ...r.targetFindings];
};
it("C6 two physical parts may share logical need IDs with complete native lineage", () => {
  const x = repeated();
  expect(x.packet.navigation.dependencies.length).toBe(
    2 * new Set(x.packet.navigation.dependencies.map((d) => d.id)).size,
  );
  expect(findings(x)).toEqual([]);
  expect(findings(x, 1)).toEqual([]);
});
it("C6 a missing physical part record fails even when its logical ID remains", () => {
  const x = repeated();
  x.packet.navigation.dependencies.pop();
  expect(findings(x).map((f) => f.kind)).toContain(
    "document-auto-origin-mismatch",
  );
});
it("C6 duplicate physical records cannot substitute for the other part", () => {
  const x = repeated(),
    ds = x.packet.navigation.dependencies;
  ds[ds.length - 1] = structuredClone(ds[0]);
  expect(findings(x).map((f) => f.kind)).toContain(
    "document-auto-origin-mismatch",
  );
});
