import { contractMutants } from "./c5-contract-mutants.mjs";
import { twoViewInline } from "./c5-inline-fixture.mjs";
import { geometry4, text } from "./tranche4-fixtures.mjs";
import { beforeAll, expect, it } from "vitest";
import { resolve } from "node:path";
import { compileProject } from "../../packages/compiler/dist/index.js";
import {
  buildDocumentation,
  buildConnectorAssemblyInventory,
} from "../../packages/query/dist/index.js";
import { contractCandidate, inlineCandidate } from "./c5-contract-fixture.mjs";
import {
  nativeNeeds,
  nativeRows,
  factKey,
  semanticColumns,
  nativeRequestForSheet,
} from "./m3-native.mjs";
import { m3Delivery } from "./m3-delivery.mjs";
import { assemblyNoteAudit } from "./assembly-note-oracle.mjs";
import { sufficient } from "./document-dependencies.mjs";
let ir, table, relation, view;
beforeAll(async () => {
  const c = await compileProject(resolve("examples/topology-coverage"));
  if (!c.ok) throw Error("Native topology fixture failed");
  ir = c.ir;
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
const check = (x) =>
  m3Delivery(
    x.packet.sheets[0],
    x.packet,
    x.geometries[0],
    x.geometries,
    x.ir,
    x.request,
    { binding: x.binding, tables: x.tables },
  );
const errors = (x) => [...check(x).findings, ...check(x).targetFindings];
it("C5 real CAP-X2 has a native reason need and no invented pin tuples", () => {
  const x = candidate(),
    n = nativeNeeds(
      x.packet.sheets[0],
      x.geometries[0],
      x.ir,
      nativeRows(x.ir),
      x.request,
      { packet: x.packet, geometries: x.geometries, request: x.request },
    );
  expect(relation.assembly.pinMapping).toEqual({
    status: "not-applicable",
    reason: "Protective cap, no electrical pins.",
  });
  expect(n.find((a) => a.need === "assembly-pin-map")).toMatchObject({
    noteId: "assembly-reasons",
    facts: [{ kind: "assembly-pin-map", relationUid: relation.uid }],
  });
  expect(n.filter((a) => a.need === "connector-port-status").length).toBe(3);
  expect(errors(x)).toEqual([]);
  expect(
    assemblyNoteAudit(x.packet, x.geometries, x.ir, x.request).findings,
  ).toEqual([]);
});
it("C5 all three real native unoccupied rows carry only their distinct port-status fact", () => {
  const inventory = buildConnectorAssemblyInventory(ir),
    rows = nativeRows(ir),
    unoccupied = inventory.ports.filter((p) => p.assemblyUid === null);
  expect(unoccupied).toHaveLength(3);
  for (const p of unoccupied) {
    const r = rows.find((r) => r.key === JSON.stringify([p.deviceUid, p.key]));
    expect(r.facts).toEqual([
      { kind: "connector-port-status", deviceUid: p.deviceUid, portKey: p.key },
    ]);
    expect(r.columns).toEqual(["identity", "endpoints", "status"]);
    expect(r.required[0]).toEqual(["--"]);
    expect(r.required[3]).toEqual(["Unoccupied"]);
  }
  expect(semanticColumns["connector-port-status"]).toEqual([
    "identity",
    "endpoints",
    "status",
  ]);
  expect(
    factKey({ kind: "connector-port-status", deviceUid: "a", portKey: "J" }),
  ).not.toBe(
    factKey({ kind: "port-link-status", deviceUid: "a", portKey: "J" }),
  );
});
it.each(Object.entries(contractMutants))(
  "C5 mutant killed: %s",
  (_name, mutate) => {
    const x = candidate();
    expect(errors(x)).toEqual([]);
    mutate(x);
    expect(errors(x).length).toBeGreaterThan(0);
  },
);
it("C5 S1: a native port drawn on any other issued assembly sheet is not omitted", () => {
  const x = candidate(),
    uid = relation.fromDeviceUid,
    g = geometry4();
  g.devices = [{ deviceUid: uid }];
  g.tranche4.ports = [
    {
      kind: "assembly",
      deviceUid: uid,
      key: "X3",
      point: { x: 30, y: 40 },
      radius: 1,
      texts: [text("X3")],
    },
  ];
  x.packet.sheets.push({ number: 3, view: { kind: "connector-assembly" } });
  x.geometries.push(g);
  const needs = () =>
    nativeNeeds(
      x.packet.sheets[0],
      x.geometries[0],
      x.ir,
      nativeRows(x.ir),
      x.request,
      { packet: x.packet, geometries: x.geometries, request: x.request },
    );
  expect(
    needs().some((n) =>
      n.facts.some(
        (f) => f.kind === "connector-port-status" && f.portKey === "X3",
      ),
    ),
  ).toBe(false);
  g.tranche4.ports[0].texts[0].painted = false;
  expect(
    needs().some((n) =>
      n.facts.some(
        (f) => f.kind === "connector-port-status" && f.portKey === "X3",
      ),
    ),
  ).toBe(true);
});
it("C5 selected reason follows its real part and does not vanish if its ink is hidden everywhere", () => {
  const x = candidate(),
    g = structuredClone(x.geometries[0]);
  x.packet.sheets.push({ number: 3, view: { kind: "connector-assembly" } });
  x.geometries.push(g);
  x.geometries[0].tranche4.assemblies = [];
  const needs = (i) =>
    nativeNeeds(
      x.packet.sheets[i],
      x.geometries[i],
      x.ir,
      nativeRows(x.ir),
      x.request,
      { packet: x.packet, geometries: x.geometries, request: x.request },
    );
  expect(needs(0).some((n) => n.need === "assembly-pin-map")).toBe(false);
  expect(needs(2).find((n) => n.need === "assembly-pin-map").facts).toEqual([
    { kind: "assembly-pin-map", relationUid: relation.uid },
  ]);
  g.tranche4.assemblies = [];
  expect(needs(0).find((n) => n.need === "assembly-pin-map").facts).toEqual([
    { kind: "assembly-pin-map", relationUid: relation.uid },
  ]);
});
it("C5 missing native reason and native view scope fail closed", () => {
  const x = candidate();
  x.ir.relations.find(
    (r) => r.uid === relation.uid,
  ).assembly.pinMapping.reason = "";
  expect(
    errors(x).some(
      (f) => f.kind === "document-native-assembly-source-unavailable",
    ),
  ).toBe(true);
  const y = candidate();
  y.geometries[0].navigationViews = ["forged"];
  expect(
    errors(y).some(
      (f) => f.kind === "document-native-assembly-source-unavailable",
    ),
  ).toBe(true);
});
it("C5 connector compact caption uses a native device owner, never a cable owner", () => {
  const x = candidate(),
    dep = x.packet.navigation.dependencies.find(
      (d) => d.requiredFacts[0]?.portKey === "X3",
    ),
    doc = x.packet.navigation.documents[0];
  const row = doc.rows.find((r) => dep.resolution[0].rows.includes(r.id)),
    fact = dep.requiredFacts[0];
  dep.caption.text = `R1.X3 → connector port status: assembly inventory 02.${row.zone} (R1: 1 port).`;
  x.geometries[0].texts.find((t) =>
    t.primitiveIds?.includes(dep.caption.primitiveId),
  ).text = dep.caption.text;
  dep.caption.form = "compact";
  dep.caption.groups = [
    {
      documentId: doc.id,
      rows: [row.id],
      sheet: 2,
      zone: row.zone,
      owner: { kind: "device", uid: fact.deviceUid },
      count: 1,
      unit: "ports",
      factKeys: [factKey(fact)],
    },
  ];
  expect(errors(x)).toEqual([]);
  expect(
    assemblyNoteAudit(x.packet, x.geometries, x.ir, x.request).findings,
  ).toEqual([]);
  dep.caption.groups[0].owner = { kind: "cable", uid: fact.deviceUid };
  expect(errors(x).length).toBeGreaterThan(0);
});
it("C5 port-status schema refuses invented cable, mapping or protocol fields", () => {
  const f = {
    kind: "connector-port-status",
    deviceUid: relation.fromDeviceUid,
    portKey: "X3",
  };
  for (const extra of [
    { cableUid: "invented" },
    { relationUid: relation.uid },
    { protocol: "Ethernet" },
    { pins: [1, 2] },
  ])
    expect(() => factKey({ ...f, ...extra })).toThrow("Invalid M3 fact fields");
});
it("C5 a complete native declaration and precise rows can share the graphical source sheet", () => {
  const x = inlineCandidate(candidate());
  expect(errors(x)).toEqual([]);
  expect(
    assemblyNoteAudit(x.packet, x.geometries, x.ir, x.request).findings,
  ).toEqual([]);
});
it("C5 inline kind is only a locator: lying about the actual printed header fails", () => {
  const x = inlineCandidate(candidate());
  expect(errors(x)).toEqual([]);
  x.geometries[0].texts.find((t) => t.columnName === "Assembly / cable").text =
    "Protocol";
  expect(errors(x).length).toBeGreaterThan(0);
});
it("C5 an inline native row cannot disappear by hiding the issued-document registry", () => {
  const x = inlineCandidate(candidate());
  x.packet.navigation.documents = [];
  x.packet.navigation.dependencies = [];
  x.packet.navigation.autoDocuments = [];
  expect(errors(x).map((f) => f.kind)).toContain(
    "document-visible-row-without-issued-document",
  );
});
it("C5 two-view inline inventory preserves both native scopes and the other sheet's delivery", () => {
  const x = twoViewInline(ir, view, relation, table);
  for (const i of [0, 1]) {
    const sheet = x.packet.sheets[i],
      scoped = nativeRequestForSheet(x.packet, x.geometries, x.request, sheet),
      result = m3Delivery(
        sheet,
        x.packet,
        x.geometries[i],
        x.geometries,
        x.ir,
        x.request,
        { binding: x.binding, tables: x.tables },
      );
    expect(scoped.m3AuthoredViewIndex).toBe(i);
    expect(scoped.m3ViewScopeGap).toBeUndefined();
    expect([...result.findings, ...result.targetFindings]).toEqual([]);
    expect(result.measurement.requiredFacts).toBeGreaterThan(0);
  }
});
it("C5 a mislabelled inline graphical sheet cannot suppress its native producer", () => {
  const x = twoViewInline(ir, view, relation, table);
  x.packet.sheets[0].view.kind = "communication";
  expect(errors(x).map((f) => f.kind)).toContain(
    "document-source-view-kind-mismatch",
  );
});
it("C5 an unexpected auto-document navigation key fails closed instead of shifting native scopes", () => {
  const x = twoViewInline(ir, view, relation, table);
  x.geometries[2].navigationViews = ["unbound-auto-view"];
  const scoped = nativeRequestForSheet(
    x.packet,
    x.geometries,
    x.request,
    x.packet.sheets[1],
  );
  expect(scoped.m3AuthoredViewIndex).toBeUndefined();
  expect(scoped.m3ViewScopeGap).toMatchObject({
    expectedViews: 2,
    issuedViews: 3,
  });
});
it("C5 absent native pin mapping fails closed without requiring invented undefined text", () => {
  const x = candidate();
  delete x.ir.relations.find((r) => r.uid === relation.uid).assembly.pinMapping;
  const row = nativeRows(x.ir).find((r) => r.key === relation.uid);
  expect(row.sourceGap).toContain("Native assembly pin mapping");
  expect(JSON.stringify(row.required)).not.toContain("undefined");
  expect(sufficient({ kind: row.kind, key: row.key, cells: {} }, row)).toBe(
    false,
  );
  expect(errors(x).map((f) => f.kind)).toContain(
    "document-native-assembly-source-unavailable",
  );
});
it("C5 one unoccupied export migration yields one diagnostic naming both mismatches", () => {
  const x = candidate(),
    entry = x.packet.navigation.documents[0].rows.find((r) =>
      r.nativeKey.includes('"X3"'),
    );
  entry.facts = [];
  entry.columns = ["identity", "endpoints", "status", "pin-map"];
  const findings = errors(x).filter(
    (f) => f.rowId === entry.id && f.kind.startsWith("document-registry-"),
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    kind: "document-registry-row-mismatch",
    reasons: ["native-facts-mismatch", "semantic-columns-mismatch"],
    expectedFacts: [{ kind: "connector-port-status", portKey: "X3" }],
    actualFacts: [],
    expectedColumns: ["identity", "endpoints", "status"],
    actualColumns: entry.columns,
  });
});
