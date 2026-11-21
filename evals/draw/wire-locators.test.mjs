import { evaluateSheet } from "./evaluate.mjs";
import { expect, it } from "vitest";
import { fixture, ink } from "./m3-fixture.mjs";
import { wireLocatorAudit, pinListAppearances } from "./wire-locators.mjs";

export function locatorFixture(stacked = false) {
  const f = fixture(),
    ir = f.ir;
  ir.devices = [
    { uid: "a", designation: "A", typeId: "t" },
    { uid: "b", designation: "B", typeId: "t" },
  ];
  ir.deviceTypes[0].terminals = [{ key: "1", description: "Native terminal" }];
  ir.wires = [
    {
      uid: "w",
      designation: "W1",
      endpoints: [
        { terminal: { deviceUid: "a", terminalKey: "1" } },
        { terminal: { deviceUid: "b", terminalKey: "1" } },
      ],
    },
  ];
  const source = {
    texts: f.report.texts.filter((t) => t.sheetText),
    wireTerminals: [
      { terminal: ["a", "1"], bbox: { x: 29, y: 49, w: 2, h: 2 } },
      { terminal: ["b", "1"], bbox: { x: 89, y: 89, w: 2, h: 2 } },
    ],
    reportCells: [],
  };
  const values = ["W1", "A.1", "B.1", "", "Connected", "01.A1", "01.B3"];
  const cells = values.map((value, i) => ({
    row: "w",
    documentId: "doc",
    reportRowScope: "row",
    columnIndex: i,
    bbox: {
      x: 20 + (stacked && i >= 5 ? i - 4 : i) * 20,
      y: 140 + (stacked && i >= 5 ? 6 : 0),
      w: 20,
      h: stacked && (i === 1 || i === 2 || i >= 5) ? 6 : 12,
    },
  }));
  const report = {
    texts: values.map((v, i) =>
      ink(v, {
        row: "w",
        documentId: "doc",
        reportRowScope: "row",
        columnIndex: i,
        bbox: cells[i].bbox,
      }),
    ),
    reportCells: cells,
  };
  const packet = {
    sheets: [
      { number: 1, view: { kind: "wiring", format: "documentation-view/0.1" } },
      { number: 2, view: { kind: "wires", format: "documentation-view/0.1" } },
    ],
  };
  return { ir, packet, source, report, geometries: [source, report] };
}
const audit = (f) => wireLocatorAudit(f.packet, f.geometries, f.ir);
const cell = (f, end) => f.report.texts.find((t) => t.columnIndex === end + 5);
it.each(["no rows", "other report"])(
  "does not read native conductors without issued wire rows (%s)",
  (scope) => {
    const f = locatorFixture();
    if (scope === "no rows") f.report.texts = [];
    else f.packet.sheets[1].view.kind = "bom";
    let reads = 0;
    Object.defineProperty(f.ir, "wires", {
      get() {
        reads++;
        throw Error("Endpoint reconstruction must not run");
      },
    });
    expect(audit(f)).toEqual({ findings: [], measurements: [] });
    expect(reads).toBe(0);
  },
);
it.each([false, true])(
  "audits issued requested and automatic wire inventories even without source endpoints (%s)",
  (auto) => {
    const f = locatorFixture();
    for (const t of f.report.texts)
      t.documentOrigin = auto ? "auto" : "requested";
    delete f.ir.wires[0].endpoints;
    const result = audit(f);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: "wire-locator-measurement-gap",
      row: "w",
      sheet: 2,
      reason: "Native conductor w has incomplete endpoints",
    });
    expect(result.measurements).toEqual([]);
  },
);
it.each(
  [null, [], Array(2), [{}], [{ terminal: {} }, { terminal: {} }]].map(
    (endpoints) => ({ endpoints }),
  ),
)(
  "fails closed for malformed native endpoint data ($endpoints)",
  ({ endpoints }) => {
    const f = locatorFixture();
    f.ir.wires[0].endpoints = endpoints;
    expect(audit(f).findings.map((r) => r.kind)).toEqual([
      "wire-locator-measurement-gap",
    ]);
  },
);
it("fails closed for missing jumper endpoints and incomplete cable terminal identities", () => {
  const f = locatorFixture();
  f.ir.jumpers = f.ir.wires;
  f.ir.wires = [];
  delete f.ir.jumpers[0].endpoints;
  expect(audit(f).findings[0].kind).toBe("wire-locator-measurement-gap");
  f.ir.jumpers = [];
  f.ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [{ id: "1", endpoints: [{ terminal: {} }, null] }],
    },
  ];
  f.ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  for (const t of [...f.report.texts, ...f.report.reportCells])
    t.row = '["c","1"]';
  expect(audit(f).findings[0].kind).toBe("wire-locator-measurement-gap");
});
it("fails closed when an issued wire row has no native source", () => {
  const f = locatorFixture();
  f.ir.wires = [];
  expect(audit(f).findings).toHaveLength(1);
  expect(audit(f).findings[0].kind).toBe("wire-locator-measurement-gap");
});
it.each([false, true])(
  "checks every printed locator in ordinary and stacked geometry (%s)",
  (stacked) => {
    const f = locatorFixture(stacked);
    expect(audit(f).findings).toEqual([]);
    expect(audit(f).measurements).toHaveLength(2);
    for (const wrong of ["not drawn", "02.A1", "01.D6", ""]) {
      cell(f, 0).text = wrong;
      expect(audit(f).findings).toHaveLength(1);
    }
  },
);
it("not drawn is valid exactly when the native endpoint has no drawn appearance", () => {
  const f = locatorFixture();
  f.source.wireTerminals.pop();
  cell(f, 1).text = "not drawn";
  expect(audit(f).findings).toEqual([]);
  cell(f, 1).text = "01.B3";
  expect(audit(f).findings[0].kind).toBe("wire-locator-without-appearance");
  f.source.wireTerminals.push({
    terminal: ["b", "1"],
    bbox: { x: 89, y: 89, w: 2, h: 2 },
  });
  cell(f, 1).text = "not drawn";
  expect(audit(f).findings[0].kind).toBe("wire-locator-undrawn-claim");
});
it("uses zone-label anchors instead of glyph centres at a near-boundary landing", () => {
  const f = locatorFixture();
  f.source.texts = f.source.texts.map((t) => ({
    ...t,
    bbox: { ...t.bbox, y: t.anchor.y + 0.4, h: 1 },
  }));
  f.source.wireTerminals[0].bbox = { x: 29, y: 62.09, w: 2, h: 0.02 };
  cell(f, 0).text = "01.B1";
  expect(audit(f).findings).toEqual([]);
});
it("accepts any zone spanned by measured ink", () => {
  const f = locatorFixture();
  f.source.wireTerminals[0].bbox = { x: 40, y: 49, w: 10, h: 2 };
  cell(f, 0).text = "01.A1";
  expect(audit(f).findings).toEqual([]);
  expect(audit(f).measurements[0].allowed).toEqual(["01.A1", "01.A2"]);
  cell(f, 0).text = "01.A3";
  expect(audit(f).findings).toHaveLength(1);
});
it("accepts a valid later drawn sheet without requiring the renderer's canonical choice", () => {
  const f = locatorFixture();
  f.packet.sheets.push({ number: 3, view: { kind: "wiring" } });
  f.geometries.push({
    ...f.source,
    wireTerminals: [
      { terminal: ["a", "1"], bbox: { x: 119, y: 129, w: 2, h: 2 } },
    ],
  });
  cell(f, 0).text = "03.C4";
  expect(audit(f).findings).toEqual([]);
});
it("report page ink is measured regardless of its view kind", () => {
  const f = locatorFixture();
  f.source.wireTerminals[0].terminal = ["a", "OTHER"];
  f.report.wireTerminals = [
    { terminal: ["a", "1"], bbox: { x: 29, y: 49, w: 2, h: 2 } },
  ];
  f.report.texts.push(...f.source.texts.map((t) => structuredClone(t)));
  cell(f, 0).text = "02.A1";
  expect(audit(f).findings).toEqual([]);
  f.report.wireTerminals[0].terminal = ["a", "OTHER"];
  expect(audit(f).findings[0].kind).toBe("wire-locator-without-appearance");
});
it("reconstructs wrapped native pin rows without trusting a pin-row flag", () => {
  const f = locatorFixture();
  f.source.wireTerminals = [];
  for (const [uid, x] of [
    ["a", 29],
    ["b", 89],
  ])
    f.source.texts.push(
      ink("1: Native", {
        deviceUid: uid,
        textContainer: uid,
        anchor: { x, y: 50 },
        bbox: { x, y: 48, w: 12, h: 2 },
      }),
      ink("terminal", {
        deviceUid: uid,
        textContainer: uid,
        anchor: { x, y: 53.7 },
        bbox: { x, y: 51.7, w: 12, h: 2 },
      }),
    );
  cell(f, 1).text = "01.A3";
  expect(pinListAppearances(f.source, f.ir)).toHaveLength(2);
  expect(audit(f).findings).toEqual([]);
  f.source.texts.find((t) => t.deviceUid === "a").reviewPainted = false;
  expect(audit(f).findings).toHaveLength(1);
});
it("binds single-ended core markers to their native endpoint slot", () => {
  const f = locatorFixture();
  f.ir.wires = [];
  f.ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [
        {
          id: "1",
          endpoints: [null, { terminal: { deviceUid: "a", terminalKey: "1" } }],
        },
      ],
    },
  ];
  f.ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  f.source.wireTerminals = [
    {
      cableUid: "c",
      conductorId: "1",
      cableScope: "single-core",
      slot: 0,
      markerCount: 1,
      bbox: { x: 29, y: 49, w: 2, h: 2 },
    },
  ];
  for (const c of [...f.report.texts, ...f.report.reportCells])
    c.row = '["c","1"]';
  f.source.texts.push(
    ink("A.1", {
      cableScope: "single-core",
      bbox: { x: 29, y: 44, w: 8, h: 2 },
    }),
  );
  cell(f, 0).text = "not drawn";
  cell(f, 1).text = "01.A1";
  expect(audit(f).findings).toEqual([]);
});

it("verifies a keyed pin row with no native description against its printed native key", () => {
  const f = locatorFixture();
  delete f.ir.deviceTypes[0].terminals[0].description;
  f.source.wireTerminals.shift();
  f.source.texts.push(
    ink("1", {
      deviceUid: "a",
      pinTerminal: '["a","1"]',
      bbox: { x: 29, y: 49, w: 2, h: 2 },
    }),
  );
  expect(audit(f).findings).toEqual([]);
  f.source.texts.at(-1).text = "OTHER";
  expect(audit(f).findings).toHaveLength(1);
});

it("D1b right pin key with a wrong native description is no appearance", () => {
  const f = locatorFixture();
  f.source.texts.push(
    ink("1: Foreign terminal", { deviceUid: "a", textContainer: "pin" }),
  );
  expect(pinListAppearances(f.source, f.ir)).toEqual([]);
  f.source.texts.at(-1).text = "1: Native terminal";
  expect(pinListAppearances(f.source, f.ir)).toHaveLength(1);
});
it("D1b table view kind cannot hide actual native terminal ink", () => {
  const f = locatorFixture();
  f.packet.sheets[0].view.kind = "bom";
  expect(wireLocatorAudit(f.packet, f.geometries, f.ir).findings).toEqual([]);
});

it("D1b cable marker identity follows painted native endpoint labels, never circle order", () => {
  const f = locatorFixture();
  f.ir.wires = [];
  f.ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [
        {
          id: "1",
          endpoints: [
            { terminal: { deviceUid: "a", terminalKey: "1" } },
            { terminal: { deviceUid: "b", terminalKey: "1" } },
          ],
        },
      ],
    },
  ];
  f.ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  f.source.wireTerminals = f.source.wireTerminals.map((t, slot) => ({
    ...t,
    terminal: undefined,
    cableUid: "c",
    conductorId: "1",
    cableScope: "core-row",
    slot: 1 - slot,
    markerCount: 2,
  }));
  f.source.texts.push(
    ink("A.1", { cableScope: "core-row", bbox: { x: 29, y: 44, w: 8, h: 2 } }),
    ink("B.1", { cableScope: "core-row", bbox: { x: 89, y: 84, w: 8, h: 2 } }),
  );
  for (const c of [...f.report.texts, ...f.report.reportCells])
    c.row = '["c","1"]';
  expect(audit(f).findings).toEqual([]);
  // A forged label cannot borrow the endpoint identity from circle slot order.
  f.source.texts.at(-2).text = "FOREIGN.1";
  expect(audit(f).findings[0].kind).toBe("wire-locator-without-appearance");
});
it("256.upstream rejects a mislabelled documentation kind from painted locator headers", () => {
  const f = locatorFixture();
  f.packet.sheets[1].view.kind = "bom";
  f.report.texts.push(
    ink("From sheet.zone", { columnName: "From sheet.zone", columnIndex: 5 }),
    ink("To sheet.zone", { columnName: "To sheet.zone", columnIndex: 6 }),
  );
  expect(audit(f).findings.map((r) => r.kind)).toEqual([
    "wire-locator-report-kind-mismatch",
  ]);
});
it("256.upstream fails closed for a sparse native cable endpoint array", () => {
  const f = locatorFixture();
  f.ir.wires = [];
  f.ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [
        {
          id: "1",
          endpoints: [{ terminal: { deviceUid: "a", terminalKey: "1" } }],
        },
      ],
    },
  ];
  f.ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  for (const t of [...f.report.texts, ...f.report.reportCells])
    t.row = '["c","1"]';
  cell(f, 1).text = "not drawn";
  expect(audit(f).findings.map((r) => r.kind)).toEqual([
    "wire-locator-measurement-gap",
  ]);
});
it("256.upstream records authored null cable ends as explicit absence, never a silently measured landing", () => {
  const f = locatorFixture();
  f.ir.wires = [];
  f.ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [{ id: "1", usage: "spare", endpoints: [null, null] }],
    },
  ];
  f.ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  for (const t of [...f.report.texts, ...f.report.reportCells])
    t.row = '["c","1"]';
  cell(f, 0).text = cell(f, 1).text = "not drawn";
  const result = audit(f);
  expect(result.findings).toEqual([]);
  expect(result.measurements.map((r) => [r.status, r.nativeAbsence])).toEqual([
    ["not-applicable", "explicit-unterminated"],
    ["not-applicable", "explicit-unterminated"],
  ]);
  f.ir.functions = [];
  for (const g of f.geometries)
    Object.assign(g, {
      width: 240,
      height: 220,
      shapes: [],
      terminals: [],
      devices: [],
      catalogs: [],
      reportRows: [],
    });
  for (const s of f.packet.sheets)
    Object.assign(s, { references: [], continuations: [] });
  const observed = evaluateSheet(
    { id: "explicit-absence", flow: "left-to-right" },
    f.packet.sheets[1],
    f.packet,
    f.report,
    f.ir,
    [],
    [],
    [],
    [],
    f.geometries,
  ).find((r) => r.id === "explicit-absence/DQ-19/sheet-002");
  expect(
    observed.evidence.nativeEndAbsences?.map((r) => r.nativeAbsence),
  ).toEqual(["explicit-unterminated", "explicit-unterminated"]);
  delete f.ir.cables[0].assignments[0].endpoints;
  expect(audit(f).findings.map((r) => r.kind)).toEqual([
    "wire-locator-measurement-gap",
  ]);
});
