import { expect, it } from "vitest";
import { nearestOwner } from "./navigation-geometry.mjs";
import {
  printedHeader,
  scopeTables,
  documentInventory,
} from "./m3-documents.mjs";
import {
  matchesNativeEmptyState,
  nativeEmptyState,
} from "./native-empty-state.mjs";
import { fixture, ink } from "./m3-fixture.mjs";
import { summary } from "./assessment.mjs";

it("L6 missing source header table fails closed", () => {
  const row = {
    kind: "network",
    documentId: "missing",
    columnNames: ["Status"],
  };
  expect(printedHeader(row, [])).toBe(false);
  expect(
    printedHeader(row, [
      { kind: "network", documentId: "missing", columns: ["Status"] },
    ]),
  ).toBe(true);
});
it("L6 requested documents match authored identity when issued order is reversed", () => {
  const f = fixture();
  const tables = [0, 1].map((authoredOrder) => ({
    kind: "network",
    origin: "requested",
    authoredOrder,
    columns: [],
    rows: [],
  }));
  tables.universe = [];
  f.packet.navigation.documents = [1, 0].map((authoredOrder) => ({
    id: `requested-${authoredOrder}`,
    kind: "network",
    authoredOrder,
  }));
  f.packet.sheets = [1, 2].map((number) => ({
    number,
    view: { kind: "network" },
  }));
  const gs = [1, 0].map((i) => ({
    texts: [ink("Header", { documentId: `requested-${i}` })],
  }));
  expect(
    scopeTables(f.packet, gs, f.ir, tables).map((t) => t.documentId),
  ).toEqual(["requested-0", "requested-1"]);
});
it("L6 automatic documents share a complete native inventory independent of document order", () => {
  const f = fixture(),
    other = structuredClone(f.report);
  for (const t of [...other.texts, ...other.reportCells])
    if (t.documentId) t.documentId = "auto-other";
  f.packet.sheets.push({ number: 3, view: { kind: "network" } });
  const tables = [];
  tables.universe = [
    { kind: "network", columns: [], rows: [{ key: '["a","P"]' }] },
  ];
  const gs = [f.source, f.report, other];
  const scoped = scopeTables(f.packet, gs, f.ir, tables);
  expect(scoped).toHaveLength(2);
  expect(scoped.every((t) => t.rows.length === 1)).toBe(true);
  // Duplicating a source row across automatic documents must fail the union census.
  expect(
    scoped.every((t) =>
      documentInventory(t, f.packet, gs).some(
        (f) => f.kind === "report-row-inventory-mismatch",
      ),
    ),
  ).toBe(true);
});
it("L1 frameless fallback belongs to this symbol, even beside another framed copy of its device", () => {
  const box = { x: 25, y: 10, w: 8, h: 4 },
    owner = { uid: "k", bbox: { x: 10, y: 10, w: 10, h: 10 } };
  const g = {
    shapes: [
      {
        navigationFrame: true,
        deviceUid: "k",
        bbox: { x: 100, y: 10, w: 20, h: 20 },
      },
      {
        navigationFrame: true,
        deviceUid: "foreign",
        bbox: { x: 40, y: 10, w: 10, h: 10 },
      },
    ],
  };
  expect(nearestOwner(g, owner, box)).toMatchObject({
    ownerNearest: true,
    ownerFrameGapMm: 5,
  });
  // The far same-device frame cannot make a caption beside that other symbol local.
  expect(
    nearestOwner(g, owner, { x: 95, y: 10, w: 4, h: 4 }).ownerFrameGapMm,
  ).toBe(75);
});
it("L3 summary preserves a distinct not-applicable count", () => {
  expect(
    summary([{ dq: "DQ-07", status: "not-applicable" }])["DQ-07"][
      "not-applicable"
    ],
  ).toBe(1);
});
it("R2-L2 rejects a same-length forged pin-map suffix and cross-column empty states", () => {
  const state = nativeEmptyState(
    "unspecified-status",
    "Pin mapping: unresolved reason A",
  );
  expect(
    matchesNativeEmptyState(
      "Status not specified Pin mapping: unresolved reason A",
      state,
    ),
  ).toBe(true);
  expect(
    matchesNativeEmptyState(
      "Status not specified Pin mapping: unresolved reason B",
      state,
    ),
  ).toBe(false);
  for (const [kind, wrong] of [
    ["unspecified-status", "No connections"],
    ["unspecified-medium", "Status not specified"],
    ["no-same-location-connections", "Not specified"],
    ["no-other-location-connections", "Protocol / medium not specified"],
  ])
    expect(matchesNativeEmptyState(wrong, nativeEmptyState(kind))).toBe(false);
});

it("L3 a fully determined absent return is not-applicable and a spurious caption still fails", async () => {
  const { mirrorFixture, text } = await import("./mirror-fixture.mjs");
  const { evaluateSheet } = await import("./evaluate.mjs");
  const make = () => {
    const f = mirrorFixture();
    f.ir.functions = f.ir.functions.filter((fn) => fn.kind !== "coil");
    f.ir.internalRelations = [];
    f.packet.navigation.occurrences = f.packet.navigation.occurrences.filter(
      (o) => o.id === "o1",
    );
    f.packet.navigation.seeds = f.packet.navigation.seeds.filter(
      (s) => s.source.functionKey === "no",
    );
    f.packet.navigation.annotations = [];
    for (const g of f.geometries)
      g.texts = g.texts.filter((t) => !t.navigationAnnotation);
    f.geometries[0].shapes = [];
    f.geometries[0].terminals = [];
    f.ir.nets = [];
    for (const g of f.geometries)
      for (const shape of g.shapes) {
        shape.cls = "";
        shape.points = [];
      }
    for (const s of f.packet.sheets) {
      Object.assign(s, { references: [], continuations: [] });
      s.view.format = "documentation-view/0.1";
    }
    for (const g of f.geometries)
      Object.assign(g, {
        reportRows: [],
        devices: [],
        catalogs: [],
        connectors: [],
        width: 300,
        height: 200,
      });
    return f;
  };
  const status = (f) =>
    evaluateSheet(
      { id: "absence" },
      f.packet.sheets[1],
      f.packet,
      f.geometries[1],
      f.ir,
      [],
      [],
      [],
      [],
      f.geometries,
      f.request,
    ).find((r) => r.id.includes("/return-"));
  const f = make();
  expect(status(f).status).toBe("not-applicable");
  const broken = make();
  broken.packet.navigation.annotations.push({
    id: "extra",
    role: "return",
    ownerOccurrence: "o1",
    ownerOccurrences: ["o1"],
  });
  broken.geometries[1].texts.push(
    text("K1 /01.A1", 30, 70, {
      navigationAnnotation: "extra",
      navigationRole: "return",
    }),
  );
  expect(status(broken).status).toBe("fail");
});

it("L6 split automatic documents pass together and cannot hide a dropped row", () => {
  const f = fixture(),
    other = structuredClone(f.report);
  f.ir.devices.push({ uid: "b", designation: "B", typeId: "t" });
  f.source.devices.push({ deviceUid: "b" });
  for (const t of [...other.texts, ...other.reportCells]) {
    if (t.documentId) t.documentId = "auto-other";
    if (t.row) t.row = '["b","P"]';
  }
  other.texts.find((t) => t.row && t.columnIndex === 2).text = "B: P";
  f.packet.sheets.push({ number: 3, view: { kind: "network" } });
  const tables = [];
  tables.universe = [
    {
      kind: "network",
      columns: [],
      rows: [{ key: '["a","P"]' }, { key: '["b","P"]' }],
    },
  ];
  const gs = [f.source, f.report, other],
    scoped = scopeTables(f.packet, gs, f.ir, tables);
  expect(scoped).toHaveLength(2);
  for (const table of scoped)
    expect(documentInventory(table, f.packet, gs)).toEqual([]);
  other.texts = other.texts.filter((t) => !t.row);
  for (const table of scoped)
    expect(documentInventory(table, f.packet, gs)[0].differences).toEqual([
      { key: '["b","P"]', expected: 1, actual: 0 },
    ]);
});

it("R2 horizontal factor obeys compression policy independently of the vertical em", async () => {
  const { hasLegibleEm } = await import("./text-legibility.mjs");
  for (const [factor, allowed] of [
    [0.5, false],
    [0.95, true],
    [1.05, false],
    [0.909, false],
    [1 / 1.1, true],
    [0.91, true],
    [1, true],
  ]) {
    const row = {
      fontSize: 2.5,
      tagEmMm: 2.5 * Math.min(1, factor),
      tagHorizontalFactor: factor,
    };
    expect(hasLegibleEm(row), `factor ${factor}`).toBe(allowed);
  }
  expect(hasLegibleEm({ fontSize: 2.46, tagHorizontalFactor: 0.95 })).toBe(
    false,
  );
  expect(hasLegibleEm({ fontSize: 2.5, tagHorizontalFactor: NaN })).toBe(false);
});
