import { assemblyFixture } from "./m3-assembly-fixture.mjs";
import { createHash } from "node:crypto";
const hashForTest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
import { expect, it } from "vitest";
import { reports } from "./checks.mjs";
import { sufficient } from "./document-dependencies.mjs";
import { nativeRows, nativeNeeds, factKey, factKeys } from "./m3-native.mjs";
import { m3Delivery } from "./m3-delivery.mjs";
import {
  scopeTables,
  documentInventory,
  tableForSheet,
  rowRegion,
} from "./m3-documents.mjs";
import { fixture, binding, clone, point, ink } from "./m3-fixture.mjs";
function check(f) {
  return m3Delivery(
    f.packet.sheets[0],
    f.packet,
    f.source,
    [f.source, f.report],
    f.ir,
    f.request,
    { binding, tables: f.tables },
  );
}
const errors = (f) => [...check(f).findings, ...check(f).targetFindings];
it("delivers a native port state at the measured center of the complete row", () => {
  const f = fixture();
  expect(errors(f)).toEqual([]);
  expect(check(f).measurement.obligations).toMatchObject([
    {
      requiredFacts: 1,
      deliveredFacts: 1,
      rows: [{ zone: "A3", anchor: point(90, 45) }],
    },
  ]);
  expect(rowRegion(f.report.reportCells)).toEqual({
    x: 25,
    y: 40,
    w: 130,
    h: 10,
  });
});
it.each([
  "dropped-row",
  "wrong-device",
  "stale-snapshot",
  "hidden-row",
  "clipped-row",
  "tiny-row",
  "json-only",
  "caption-no-delivery",
  "wrong-status",
  "wrong-header",
  "forged-resolution",
  "wrong-zone",
  "wrong-anchor",
  "forged-facts",
  "extra-fact",
  "dropped-dependency",
  "dropped-caption",
  "dotted-selector",
])("rejects %s without accepting export claims", (mutation) => {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    row = f.packet.navigation.documents[0].rows[0];
  if (["dropped-row", "json-only", "caption-no-delivery"].includes(mutation))
    f.report.texts = f.report.texts.filter((t) => !t.row);
  if (mutation === "wrong-device")
    f.report.texts.find((t) => t.row && t.columnIndex === 2).text =
      "FOREIGN: P";
  if (mutation === "stale-snapshot")
    f.packet.navigation.documents[0].snapshotDigest = "old";
  if (["hidden-row", "clipped-row"].includes(mutation))
    for (const t of f.report.texts.filter((t) => t.row))
      t.reviewPainted = false;
  if (mutation === "tiny-row")
    for (const t of f.report.texts.filter((t) => t.row)) t.fontSize = 0.5;
  if (mutation === "wrong-status")
    f.report.texts.find((t) => t.row && t.columnIndex === 3).text = "Connected";
  if (mutation === "wrong-header")
    f.report.texts.find((t) => t.columnName === "Status").text = "Forged";
  if (mutation === "forged-resolution") dep.resolution[0].rows = ["imaginary"];
  if (mutation === "wrong-zone") {
    dep.caption.text = dep.caption.text.replace("02.A3", "02.B1");
    f.source.texts[0].text = dep.caption.text;
  }
  if (mutation === "wrong-anchor") row.anchorMm.x = 30;
  if (mutation === "forged-facts") dep.requiredFacts[0].deviceUid = "foreign";
  if (mutation === "extra-fact")
    dep.requiredFacts.push({
      kind: "port-link-status",
      deviceUid: "foreign",
      portKey: "P",
    });
  if (mutation === "dropped-dependency") f.packet.navigation.dependencies = [];
  if (mutation === "dropped-caption") f.source.texts = [];
  if (mutation === "dotted-selector") {
    dep.caption.text = dep.caption.text.replace("A: P", "A.P");
    f.source.texts[0].text = dep.caption.text;
  }
  expect(errors(f).length).toBeGreaterThan(0);
});
it("independently counts native compact groups, and rejects a count/owner/partition lie", () => {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0];
  dep.caption.text =
    "Port protocol, status and unconnected ports: network inventory 02.A3 (A: 1 port).";
  f.source.texts[0].text = dep.caption.text;
  dep.caption.form = "compact";
  dep.caption.groups = [
    {
      documentId: doc.id,
      rows: [doc.rows[0].id],
      sheet: 2,
      zone: "A3",
      owner: { kind: "device", uid: "a" },
      count: 1,
      unit: "ports",
      factKeys: ['["port-link-status","a","P"]'],
    },
  ];
  expect(errors(f)).toEqual([]);
  for (const edit of [
    (x) => {
      x.source.texts[0].text = x.source.texts[0].text.replace(
        "1 port",
        "2 ports",
      );
      x.packet.navigation.dependencies[0].caption.text = x.source.texts[0].text;
    },
    (x) => {
      x.packet.navigation.dependencies[0].caption.groups[0].owner.uid =
        "foreign";
    },
    (x) => {
      x.packet.navigation.dependencies[0].caption.groups[0].factKeys = [];
    },
  ]) {
    const bad = clone(f);
    edit(bad);
    expect(errors(bad).length).toBeGreaterThan(0);
  }
});
it("does not erase a native obligation with standalone omission wording or missing exports", () => {
  const f = fixture();
  delete f.packet.navigation;
  f.source.texts[0].text =
    "Port protocol, status and unconnected ports are outside this selected view; no companion inventory is included.";
  f.report.texts = [];
  expect(
    errors(f).some((x) => x.kind === "printed-document-target-insufficient"),
  ).toBe(true);
  const empty = fixture();
  empty.source.devices = [];
  empty.source.texts = [
    ink(
      "Selected path only; other authored connections may be outside this view.",
    ),
  ];
  delete empty.packet.navigation;
  expect(errors(empty)).toEqual([]);
});
it("keeps requested filtered reports separate from an automatic companion of the same kind", () => {
  const f = fixture(),
    table = {
      kind: "network",
      origin: "requested",
      documentId: "requested",
      rows: [{ key: "requested-row" }],
      columns: [],
    };
  expect(
    documentInventory(table, f.packet, [f.source, f.report]),
  ).toMatchObject([{ expectedRows: 1, actualRows: 0 }]);
  const auto = {
    ...table,
    documentId: "auto-document/1/native",
    origin: "auto",
    rows: [{ key: '["a","P"]' }],
  };
  expect(documentInventory(auto, f.packet, [f.source, f.report])).toEqual([]);
  expect(tableForSheet(f.packet.sheets[1], f.report, [table, auto])).toBe(auto);
  f.report.texts.push(
    ...f.report.texts
      .filter((t) => t.row)
      .map((t) => ({ ...t, row: "extra-native", reportRowScope: "extra" })),
  );
  expect(documentInventory(auto, f.packet, [f.source, f.report])).toMatchObject(
    [{ actualRows: 2 }],
  );
});
it("derives automatic source rows from native needs, excluding requested rows", () => {
  const f = fixture(),
    requested = { kind: "network", origin: "requested", rows: [], columns: [] };
  const tables = [requested];
  tables.universe = [
    {
      kind: "network",
      columns: [],
      rows: [{ key: '["a","P"]' }, { key: "unrelated" }],
    },
  ];
  expect(
    scopeTables(f.packet, [f.source, f.report], f.ir, tables).find(
      (t) => t.origin === "auto",
    ).rows,
  ).toEqual([{ key: '["a","P"]' }]);
  requested.rows = [{ key: '["a","P"]' }];
  // A native query row alone is not an actually issued sufficient document.
  expect(
    scopeTables(f.packet, [f.source, f.report], f.ir, tables).find(
      (t) => t.origin === "auto",
    ).rows,
  ).toEqual([{ key: '["a","P"]' }]);
  const issued = clone(f.report);
  for (const t of issued.texts.filter((t) => t.documentId)) {
    t.documentId = "requested";
    delete t.documentOrigin;
  }
  for (const c of issued.reportCells) {
    c.documentId = "requested";
    delete c.documentOrigin;
  }
  f.packet.sheets.splice(1, 0, { number: 3, view: { kind: "network" } });
  expect(
    scopeTables(f.packet, [f.source, issued, f.report], f.ir, tables).find(
      (t) => t.origin === "auto",
    ).rows,
  ).toEqual([]);
  for (const t of issued.texts.filter((t) => t.row)) t.reviewPainted = false;
  expect(
    scopeTables(f.packet, [f.source, issued, f.report], f.ir, tables).find(
      (t) => t.origin === "auto",
    ).rows,
  ).toEqual([{ key: '["a","P"]' }]);
});
it("typed keys preserve native slot ordinals and reject duplicate or foreign fields", () => {
  const fact = {
    kind: "conductor-incidence",
    element: { kind: "cable_conductor", cableUid: "c", conductorId: "1" },
    end: 1,
    terminal: { deviceUid: "a", terminalKey: "T" },
  };
  expect(factKey(fact)).toBe(
    '["conductor-incidence","cable_conductor",["c","1"],1,"a","T"]',
  );
  expect(
    factKey({
      terminal: { terminalKey: "T", deviceUid: "a" },
      end: 1,
      element: { conductorId: "1", cableUid: "c", kind: "cable_conductor" },
      kind: "conductor-incidence",
    }),
  ).toBe(factKey(fact));
  expect(factKeys([fact, fact])).toBe(null);
  expect(factKeys([{ ...fact, extra: true }])).toBe(null);
  expect(factKeys([{ ...fact, end: 2 }])).toBe(null);
});
it("native incidence and terminal omissions use different count units and persistent source note ids", () => {
  const ir = {
    devices: [
      { uid: "a", designation: "A" },
      { uid: "b", designation: "B" },
    ],
    terminals: ["T", "U"].map((terminalKey) => ({
      id: { deviceUid: "a", terminalKey },
    })),
    wires: [
      {
        uid: "w",
        designation: "W",
        endpoints: [
          { terminal: { deviceUid: "a", terminalKey: "T" } },
          { terminal: { deviceUid: "b", terminalKey: "T" } },
        ],
      },
    ],
    jumpers: [],
    cables: [],
  };
  const needs = nativeNeeds(
    { view: { kind: "wiring" } },
    {
      devices: [{ deviceUid: "a" }],
      terminals: [{ deviceUid: "a", terminal: "T" }],
      shapes: [],
    },
    ir,
  );
  expect(needs).toEqual([
    {
      need: "conductor-incidence",
      noteId: 'wiring-incidence/["a","T"]',
      facts: [
        {
          kind: "conductor-incidence",
          element: { kind: "wire", uid: "w" },
          end: 0,
          terminal: { deviceUid: "a", terminalKey: "T" },
        },
      ],
      subject: "A.T",
    },
    {
      need: "terminal-inventory",
      noteId: "wiring-terminals/a",
      facts: [
        {
          kind: "terminal-inventory",
          terminal: { deviceUid: "a", terminalKey: "U" },
        },
      ],
      subject: "A",
    },
  ]);
  expect(nativeRows(ir).find((r) => r.key === '["a","U"]').required[6]).toEqual(
    ["Unconnected"],
  );
});
it("singly terminated cores keep authored endpoint slot and unresolved state", () => {
  const ir = {
    devices: [{ uid: "a", designation: "A" }],
    cables: [
      {
        uid: "c",
        designation: "C",
        typeId: "t",
        assignments: [
          {
            id: "1",
            usage: "spare",
            endpoints: [
              null,
              { terminal: { deviceUid: "a", terminalKey: "T" } },
            ],
          },
        ],
      },
    ],
    cableTypes: [{ id: "t", conductors: [{ id: "1" }, { id: "2" }] }],
  };
  const rows = nativeRows(ir);
  expect(rows[0].facts).toEqual([
    {
      kind: "conductor-incidence",
      element: { kind: "cable_conductor", cableUid: "c", conductorId: "1" },
      end: 1,
      terminal: { deviceUid: "a", terminalKey: "T" },
    },
    { kind: "core-inventory", cableUid: "c", conductorId: "1" },
  ]);
  expect(rows[0].required[4]).toEqual(["spare; partially-terminated"]);
  expect(rows[1].required[4]).toEqual(["unassigned; unassigned"]);
});
it("wire delivery checks both native endpoints and status, not just the promised endpoint", () => {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0],
    row = doc.rows[0];
  f.ir = {
    devices: [
      { uid: "a", designation: "A" },
      { uid: "b", designation: "B" },
    ],
    terminals: [{ id: { deviceUid: "a", terminalKey: "T" } }],
    wires: [
      {
        uid: "w",
        designation: "W",
        endpoints: [
          { terminal: { deviceUid: "a", terminalKey: "T" } },
          { terminal: { deviceUid: "b", terminalKey: "U" } },
        ],
      },
    ],
    jumpers: [],
    cables: [],
  };
  f.packet.sheets[0].view.kind = "wiring";
  f.request = { views: [{ format: "wiring-view-request/0.1" }] };
  f.source.terminals = [{ deviceUid: "a", terminal: "T" }];
  f.source.shapes = [];
  doc.kind = f.packet.sheets[1].view.kind = "wires";
  doc.label = "wire inventory";
  const fact = {
    kind: "conductor-incidence",
    element: { kind: "wire", uid: "w" },
    end: 0,
    terminal: { deviceUid: "a", terminalKey: "T" },
  };
  dep.need = "conductor-incidence";
  dep.owner.noteId = 'wiring-incidence/["a","T"]';
  dep.id = `dependency/1/${hashForTest([dep.owner.viewKey, dep.owner.noteId])}`;
  doc.autoOrigin.dependencyIds = [dep.id];
  f.packet.navigation.autoDocuments[0].dependencyIds = [dep.id];
  dep.requiredFacts = [fact];
  dep.requiredColumns = ["identity", "endpoints", "status"];
  dep.count = 1;
  dep.caption.text =
    "[+1] other physical connections: wire inventory 02.A3 (A.T; W).";
  f.source.texts[0].text = dep.caption.text;
  row.columns = ["identity", "endpoints", "status"];
  row.nativeKey = "w";
  row.displayName = "W";
  row.facts = [
    fact,
    { ...fact, end: 1, terminal: { deviceUid: "b", terminalKey: "U" } },
  ];
  for (const c of f.report.reportCells) c.row = "w";
  const values = ["W", "A.T", "B.U", "", "Connected"];
  for (const t of f.report.texts.filter((t) => t.row)) {
    t.row = "w";
    t.text = values[t.columnIndex];
  }
  f.report.texts.find((t) => t.text === "network inventory").text =
    "wire inventory";
  f.tables = [{ kind: doc.kind, documentId: doc.id, columns: [] }];
  expect(errors(f)).toEqual([]);
  const wrongCount = clone(f);
  wrongCount.packet.navigation.dependencies[0].caption.text =
    wrongCount.source.texts[0].text = wrongCount.source.texts[0].text.replace(
      "[+1]",
      "[+2]",
    );
  expect(
    errors(wrongCount).some(
      (x) => x.kind === "document-caption-native-count-mismatch",
    ),
  ).toBe(true);
  const missingCount = clone(f);
  delete missingCount.packet.navigation.dependencies[0].count;
  expect(
    errors(missingCount).some(
      (x) => x.kind === "document-dependency-inventory-mismatch",
    ),
  ).toBe(true);
  for (const value of ["FOREIGN.U", "B.V", "B.U + UNKNOWN"]) {
    const bad = clone(f);
    bad.report.texts.find((t) => t.row && t.columnIndex === 2).text = value;
    expect(
      errors(bad).some(
        (x) => x.kind === "printed-document-target-insufficient",
      ),
    ).toBe(true);
  }
});
it.each([
  "missing-row-export",
  "extra-row-export",
  "stripped-row-owner",
  "missing-short-label",
  "wrong-semantic-columns",
  "wrong-auto-origin",
  "forged-requested-origin",
  "stale-dependency",
])("three-set reconciliation rejects %s", (mutation) => {
  const f = fixture(),
    nav = f.packet.navigation;
  if (mutation === "missing-row-export") nav.documents[0].rows = [];
  if (mutation === "extra-row-export")
    nav.documents[0].rows.push({
      ...clone(nav.documents[0].rows[0]),
      id: "extra",
      nativeKey: "foreign",
    });
  if (mutation === "stripped-row-owner")
    for (const t of f.report.texts.filter((t) => t.row)) delete t.documentId;
  if (mutation === "missing-short-label")
    f.report.texts = f.report.texts.filter(
      (t) => t.text !== "network inventory",
    );
  if (mutation === "wrong-semantic-columns")
    nav.documents[0].rows[0].columns = ["identity"];
  if (mutation === "wrong-auto-origin")
    nav.autoDocuments[0].dependencyIds = ["foreign"];
  if (mutation === "forged-requested-origin")
    nav.documents[0].authoredOrder = 0;
  if (mutation === "stale-dependency")
    nav.dependencies[0].snapshotDigest = "stale";
  expect(errors(f).length).toBeGreaterThan(0);
});
it("dotted selectors remain a specific caption finding", () => {
  const f = fixture();
  f.packet.navigation.dependencies[0].caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.A3 (A.P).";
  expect(
    errors(f).some((x) => x.kind === "document-caption-dotted-port-selector"),
  ).toBe(true);
});
function terminalFixture() {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0],
    row = doc.rows[0];
  f.ir = {
    devices: [{ uid: "a", designation: "A" }],
    terminals: ["T", "U"].map((terminalKey) => ({
      id: { deviceUid: "a", terminalKey },
    })),
    wires: [],
    jumpers: [],
    cables: [],
  };
  f.packet.sheets[0].view.kind = "wiring";
  f.request = { views: [{ format: "wiring-view-request/0.1" }] };
  f.source.terminals = [{ deviceUid: "a", terminal: "T" }];
  f.source.shapes = [];
  doc.kind = f.packet.sheets[1].view.kind = "terminals";
  doc.label = "terminal inventory";
  const fact = {
    kind: "terminal-inventory",
    terminal: { deviceUid: "a", terminalKey: "U" },
  };
  dep.need = "terminal-inventory";
  dep.owner.noteId = "wiring-terminals/a";
  dep.id = `dependency/1/${hashForTest([dep.owner.viewKey, dep.owner.noteId])}`;
  doc.autoOrigin.dependencyIds = [dep.id];
  f.packet.navigation.autoDocuments[0].dependencyIds = [dep.id];
  dep.requiredFacts = [fact];
  dep.requiredColumns = ["identity", "connections", "status"];
  dep.count = 1;
  dep.caption.text = "1 other terminals: terminal inventory 02.A3 (A.U).";
  f.source.texts[0].text = dep.caption.text;
  row.nativeKey = '["a","U"]';
  row.displayName = "A.U";
  row.facts = [fact];
  row.columns = ["identity", "connections", "status"];
  const prototype = f.report.texts.find((t) => t.row);
  f.report.texts = f.report.texts.filter((t) => !t.row);
  f.report.texts.find((t) => t.text === "network inventory").text =
    "terminal inventory";
  f.report.texts.push(
    ...["A", "", "U", "", "None", "None", "Unconnected"].map((text, i) => ({
      ...prototype,
      row: row.nativeKey,
      columnIndex: i,
      text,
    })),
  );
  f.report.reportCells = Array.from({ length: 7 }, (_, i) => ({
    row: row.nativeKey,
    documentId: doc.id,
    reportRowScope: "row",
    bbox: { x: 25 + (i * 130) / 7, y: 40, w: 130 / 7, h: 10 },
  }));
  f.tables = [{ kind: doc.kind, documentId: doc.id, columns: [] }];
  return f;
}
it("delivers omitted native terminals and rejects invented unconnected-terminal connections", () => {
  const f = terminalFixture();
  expect(errors(f)).toEqual([]);
  f.report.texts.find((t) => t.row && t.columnIndex === 4).text =
    "INVENTED -> B.T";
  expect(
    errors(f).some((x) => x.kind === "printed-document-target-insufficient"),
  ).toBe(true);
});
it("communication scopes include the selected medium of all visible component devices", () => {
  const ir = {
    devices: [
      { uid: "a", designation: "A", typeId: "t" },
      { uid: "b", designation: "B", typeId: "t" },
    ],
    deviceTypes: [
      {
        id: "t",
        ports: { P: { medium: "ethernet" }, Q: { medium: "ethernet" } },
      },
    ],
    relations: [
      {
        uid: "z",
        designation: "FIRST",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        connection: { fromPort: "P", toPort: "P", medium: "ethernet" },
      },
    ],
  };
  const needs = nativeNeeds(
    { view: { kind: "communication" } },
    { devices: [{ deviceUid: "b" }, { deviceUid: "a" }] },
    ir,
    nativeRows(ir),
    {
      views: [
        {
          format: "communication-view-request/0.1",
          devices: ["A"],
          medium: "ethernet",
        },
      ],
    },
  );
  expect(needs[0].noteId).toBe(
    `communication-status/${hashForTest([["a", "b"], ["z"]])}`,
  );
  expect(factKeys(needs[0].facts)).toEqual([
    '["port-link-status","a","P"]',
    '["port-link-status","a","Q"]',
    '["port-link-status","b","P"]',
    '["port-link-status","b","Q"]',
  ]);
});
it("checks every distinct captioned row region of a spanning document", () => {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0];
  f.ir.deviceTypes[0].ports.Q = { kind: "communication", medium: "ethernet" };
  const fact = { kind: "port-link-status", deviceUid: "a", portKey: "Q" };
  dep.requiredFacts.push(fact);
  const second = {
    ...clone(doc.rows[0]),
    id: `${doc.id}/row/second`,
    nativeKey: '["a","Q"]',
    displayName: "A: Q",
    facts: [fact],
    zone: "B3",
    anchorMm: point(90, 85),
    rectMm: { x: 25, y: 80, w: 130, h: 10 },
    primitiveId: "second-ink",
  };
  doc.rows.push(second);
  dep.resolution[0].rows.push(second.id);
  f.report.texts.push(
    ...f.report.texts
      .filter((t) => t.row)
      .map((t) => ({
        ...t,
        row: second.nativeKey,
        reportRowScope: "second-row",
        primitiveIds: ["second-ink"],
        text: t.columnIndex === 2 ? "A: Q" : t.text,
        bbox: { ...t.bbox, y: t.bbox.y + 40 },
      })),
  );
  f.report.reportCells.push(
    ...f.report.reportCells.map((c) => ({
      ...c,
      row: second.nativeKey,
      reportRowScope: "second-row",
      bbox: { ...c.bbox, y: c.bbox.y + 40 },
    })),
  );
  dep.caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.A3 (A: P); 02.B3 (A: Q).";
  expect(errors(f)).toEqual([]);
  dep.caption.text = f.source.texts[0].text = dep.caption.text.replace(
    "02.B3",
    "02.A3",
  );
  expect(
    check(f).targetFindings.some(
      (x) => x.kind === "printed-document-target-location-missing",
    ),
  ).toBe(true);
});
it("rejects a foreign identity added to an otherwise delivered caption", () => {
  const f = fixture();
  f.packet.navigation.dependencies[0].caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.A3 (A: P, FOREIGN: Q).";
  expect(
    errors(f).some((x) => x.kind === "document-caption-extra-native-identity"),
  ).toBe(true);
});
it("NAV3 L4 accepts a caption in any spanned row zone, while keeping the measured center", () => {
  const f = fixture();
  f.packet.navigation.dependencies[0].caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.A1 (A: P).";
  expect(errors(f)).toEqual([]);
  expect(check(f).measurement.obligations[0].rows[0]).toMatchObject({
    zone: "A1",
    anchor: point(90, 45),
  });
  f.packet.navigation.dependencies[0].caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.B1 (A: P).";
  expect(check(f).targetFindings.length).toBeGreaterThan(0);
});
it("keeps an automatic terminal inventory outside the requested graphical terminal-plan population", async () => {
  const { requestedTerminalPlan } = await import("./m3-documents.mjs");
  const f = fixture(),
    table = {
      kind: "terminals",
      documentId: "auto-document/1/native",
      origin: "auto",
    };
  f.packet.sheets[1].view.kind = "terminals";
  expect(requestedTerminalPlan(f.packet.sheets[1], f.report, [table])).toBe(
    false,
  );
  expect(
    requestedTerminalPlan(f.packet.sheets[1], f.report, [
      { ...table, origin: "requested" },
    ]),
  ).toBe(true);
});
it("row-region zone spans use half-open boundaries on the 0.01 mm lattice", async () => {
  const { rowZones } = await import("./m3-zones.mjs"),
    f = fixture();
  expect(rowZones(f.report, { x: 45, y: 40, w: 30, h: 10 })).toEqual(["A2"]);
  expect(rowZones(f.report, { x: 44.996, y: 40, w: 30.004, h: 10 })).toEqual([
    "A2",
  ]);
  expect(rowZones(f.report, { x: 44.994, y: 40, w: 30.006, h: 10 })).toEqual([
    "A1",
    "A2",
  ]);
});
it("retained caption ink cannot conceal a stripped locator or a forged source-view locator", () => {
  const f = fixture();
  f.source.texts[0].primitiveIds = [];
  expect(
    errors(f).some((x) => x.kind === "document-caption-locator-mismatch"),
  ).toBe(true);
  const forged = fixture();
  forged.source.navigationViews = ["foreign-view"];
  expect(
    errors(forged).some((x) => x.kind === "document-caption-locator-mismatch"),
  ).toBe(true);
});
it("discovers a requested document with zero body rows from its actual header ancestry", () => {
  const f = fixture(),
    tables = [{ kind: "network", origin: "requested", rows: [], columns: [] }];
  tables.universe = [
    { kind: "network", rows: [{ key: '["a","P"]' }], columns: [] },
  ];
  const header = {
    texts: [ink("network inventory", { documentId: "requested-empty" })],
    devices: [],
    terminals: [],
    shapes: [],
  };
  f.packet.sheets.splice(1, 0, { number: 3, view: { kind: "network" } });
  const scoped = scopeTables(
    f.packet,
    [f.source, header, f.report],
    f.ir,
    tables,
  );
  expect(scoped.find((t) => t.origin === "requested").documentId).toBe(
    "requested-empty",
  );
  expect(scoped.find((t) => t.origin === "auto").rows).toEqual([
    { key: '["a","P"]' },
  ]);
});
it("assembly delivery preserves unresolved native pin-map state and singular compact counts", () => {
  const f = assemblyFixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0],
    row = doc.rows[0];
  expect(errors(f)).toEqual([]);
  const unspecified = clone(f);
  delete unspecified.ir.relations[0].assembly.status;
  for (const status of [
    "Unspecified",
    "Not specified",
    "Status not specified",
  ]) {
    unspecified.report.texts.find((t) => t.row && t.columnIndex === 4).text =
      `${status} Pin mapping: unresolved Native mapping unknown`;
    expect(errors(unspecified)).toEqual([]);
  }
  for (const status of [
    "",
    "verified",
    "Status not specified Pin mapping: resolved",
  ]) {
    unspecified.report.texts.find((t) => t.row && t.columnIndex === 4).text =
      status;
    expect(
      errors(unspecified).some(
        (x) => x.kind === "printed-document-target-insufficient",
      ),
    ).toBe(true);
  }
  const stale = clone(f);
  stale.report.texts.find((t) => t.row && t.columnIndex === 4).text +=
    " resolved";
  expect(
    errors(stale).some(
      (x) => x.kind === "printed-document-target-insufficient",
    ),
  ).toBe(true);
  dep.caption.form = "compact";
  dep.caption.groups = [
    {
      documentId: doc.id,
      rows: [row.id],
      sheet: 2,
      zone: "A3",
      owner: { kind: "device", uid: "a" },
      count: 1,
      unit: "assemblies",
      factKeys: ['["assembly-pin-map","rel"]'],
    },
  ];
  dep.caption.text = f.source.texts[0].text =
    "Assembly pin maps: assembly inventory 02.A3 (A: 1 assembly).";
  expect(errors(f)).toEqual([]);
  dep.caption.text = f.source.texts[0].text = dep.caption.text.replace(
    "1 assembly",
    "1 assemblys",
  );
  expect(errors(f).length).toBeGreaterThan(0);
});
it("complete-looking native ink cannot erase the missing third set by stripping the export extension", () => {
  const f = fixture();
  delete f.packet.navigation.documentFormat;
  expect(
    errors(f).some((x) => x.kind === "document-export-measurement-gap"),
  ).toBe(true);
  delete f.packet.navigation;
  expect(
    errors(f).some((x) => x.kind === "document-export-measurement-gap"),
  ).toBe(true);
});

it("rejects a form claim that disagrees with visible ink and malformed semantic-column claims", () => {
  const f = fixture();
  f.packet.navigation.dependencies[0].caption.form = "compact";
  expect(
    errors(f).some((x) => x.kind === "document-caption-form-mismatch"),
  ).toBe(true);
  const malformed = fixture();
  malformed.packet.navigation.dependencies[0].requiredColumns = "identity";
  expect(
    errors(malformed).some(
      (x) => x.kind === "document-dependency-inventory-mismatch",
    ),
  ).toBe(true);
});
it("a native port marking that reads like a count remains an identity", () => {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    row = f.packet.navigation.documents[0].rows[0];
  f.ir.deviceTypes[0].ports = {
    "1 port": { kind: "communication", medium: "ethernet" },
  };
  const fact = { kind: "port-link-status", deviceUid: "a", portKey: "1 port" };
  dep.requiredFacts = [fact];
  row.facts = [fact];
  row.nativeKey = '["a","1 port"]';
  row.displayName = "A: 1 port";
  dep.caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.A3 (A: 1 port).";
  for (const t of f.report.texts.filter((t) => t.row)) {
    t.row = row.nativeKey;
    if (t.columnIndex === 2) t.text = "A: 1 port";
  }
  for (const c of f.report.reportCells) c.row = row.nativeKey;
  expect(errors(f)).toEqual([]);
});
it("reconstructs each authored communication medium and source scope independently", async () => {
  const { nativeRequestForSheet } = await import("./m3-native.mjs");
  const request = {
    views: [
      {
        format: "communication-view-request/0.1",
        medium: "ethernet",
        devices: ["A"],
      },
      { format: "communication-view-request/0.1", medium: "bus" },
      {
        format: "communication-view-request/0.1",
        medium: "ethernet",
        devices: ["C"],
      },
    ],
  };
  const packet = {
    sheets: [1, 2, 3]
      .map((number) => ({ number, view: { kind: "communication" } }))
      .concat([{ number: 4, view: { kind: "network" } }]),
  };
  const gs = ["eth", "bus", "isolated"].map((key) => ({
    navigationViews: [key],
    devices: [{ deviceUid: "a" }, { deviceUid: "b" }],
    texts: [],
  }));
  gs.push({
    navigationViews: [],
    texts: [{ documentOrigin: "auto" }],
  });
  const selected = nativeRequestForSheet(packet, gs, request, packet.sheets[1]);
  expect(selected.views).toEqual([request.views[1]]);
  expect(
    nativeRequestForSheet(packet, gs, request, packet.sheets[2]).views,
  ).toEqual([request.views[2]]);
  const ir = {
    devices: [
      { uid: "a", designation: "A", typeId: "t" },
      { uid: "b", designation: "B", typeId: "t" },
      { uid: "c", designation: "C", typeId: "t" },
    ],
    deviceTypes: [
      { id: "t", ports: { E: { medium: "ethernet" }, R: { medium: "bus" } } },
    ],
    relations: [
      {
        uid: "eth-link",
        designation: "ETH",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        connection: { medium: "ethernet", fromPort: "E", toPort: "E" },
      },
      {
        uid: "bus-link",
        designation: "BUS",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        connection: { medium: "bus", fromPort: "R", toPort: "R" },
      },
    ],
  };
  const needs = nativeNeeds(
    packet.sheets[1],
    gs[1],
    ir,
    nativeRows(ir),
    selected,
  );
  expect(factKeys(needs[0].facts)).toEqual([
    '["port-link-status","a","R"]',
    '["port-link-status","b","R"]',
  ]);
  expect(needs[0].noteId).toBe(
    `communication-status/${hashForTest([["a", "b"], ["bus-link"]])}`,
  );
  expect(needs[0].scopeMismatch).toEqual([]);
  const wrong = fixture();
  wrong.request.views[0].devices = ["NONEXISTENT"];
  expect(
    errors(wrong).some((x) => x.kind === "document-source-view-scope-mismatch"),
  ).toBe(true);
  const gap = fixture();
  gap.request.views.push({ ...gap.request.views[0] });
  expect(
    errors(gap).some((x) => x.kind === "document-native-view-scope-unresolved"),
  ).toBe(true);
  const kind = fixture();
  kind.packet.sheets[0].view.kind = "wires";
  expect(
    errors(kind).some((x) => x.kind === "document-source-view-kind-mismatch"),
  ).toBe(true);
});
it("native unoccupied connector rows have no assembly fact and cannot invent a pin map", () => {
  const f = fixture(),
    doc = f.packet.navigation.documents[0],
    row = doc.rows[0];
  f.ir = {
    devices: [{ uid: "a", designation: "A", typeId: "t" }],
    deviceTypes: [{ id: "t", connectorPorts: { J: { connector: "M12" } } }],
    relations: [],
  };
  f.request = {
    views: [{ format: "documentation-view-request/0.1", kind: "assemblies" }],
  };
  f.source.devices = [];
  f.source.texts = [];
  f.packet.sheets[0].view.kind = "assemblies";
  doc.kind = f.packet.sheets[1].view.kind = "assemblies";
  doc.label = "assembly inventory";
  delete doc.autoOrigin;
  doc.authoredOrder = 0;
  f.packet.navigation.autoDocuments = [];
  f.packet.navigation.dependencies = [];
  row.nativeKey = '["a","J"]';
  row.displayName = "A / J";
  row.facts = [{ kind: "connector-port-status", deviceUid: "a", portKey: "J" }];
  row.columns = ["identity", "endpoints", "status"];
  const values = ["--", "M12", "A.J", "Unoccupied", "No assembly declared"];
  for (const t of f.report.texts.filter((t) => t.documentId)) {
    delete t.documentOrigin;
    if (t.row) {
      t.row = row.nativeKey;
      t.text = values[t.columnIndex];
    }
  }
  for (const c of f.report.reportCells) {
    c.row = row.nativeKey;
    delete c.documentOrigin;
  }
  f.report.texts.find((t) => t.text === "network inventory").text =
    "assembly inventory";
  f.tables = [{ kind: doc.kind, documentId: doc.id, columns: [] }];
  f.tables[0].authoredOrder = 0;
  expect(nativeRows(f.ir).map((r) => r.facts)).toEqual([
    [{ kind: "connector-port-status", deviceUid: "a", portKey: "J" }],
  ]);
  expect(errors(f)).toEqual([]);
  row.facts = [{ kind: "assembly-pin-map", relationUid: "invented" }];
  expect(
    errors(f).some((x) => x.kind === "document-registry-row-mismatch"),
  ).toBe(true);
});
it("a complete native row for a foreign component cannot replace the authored component", () => {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0],
    row = doc.rows[0];
  f.ir.devices.push({ uid: "c", designation: "C", typeId: "t" });
  f.request.views[0].devices = ["A"];
  f.request.views[0].medium = "ethernet";
  f.source.devices = [{ deviceUid: "c" }];
  const fact = { kind: "port-link-status", deviceUid: "c", portKey: "P" };
  dep.owner.noteId = `communication-status/${hashForTest([["c"], []])}`;
  dep.id = `dependency/1/${hashForTest([dep.owner.viewKey, dep.owner.noteId])}`;
  dep.requiredFacts = [fact];
  doc.autoOrigin.dependencyIds = [dep.id];
  f.packet.navigation.autoDocuments[0].dependencyIds = [dep.id];
  row.nativeKey = '["c","P"]';
  row.displayName = "C: P";
  row.facts = [fact];
  dep.caption.text = f.source.texts[0].text =
    "Port protocol: network inventory 02.A3 (C: P).";
  for (const t of f.report.texts.filter((t) => t.row)) {
    t.row = row.nativeKey;
    if (t.columnIndex === 2) t.text = "C: P";
  }
  for (const c of f.report.reportCells) c.row = row.nativeKey;
  expect(errors(f).map((x) => x.kind)).toEqual([
    "document-source-view-scope-mismatch",
  ]);
  f.request.views[0].devices = ["C"];
  expect(errors(f)).toEqual([]);
});

// Literal native IR and measured ink are the oracle; no renderer/query formatter.
function nullFindings(f, sourceCells) {
  const g = {
    ...f.report,
    texts: f.report.texts.map((t) => ({
      ...t,
      cell: t.row ? { column: t.columnIndex } : undefined,
    })),
  };
  const key = f.report.texts.find((t) => t.row).row;
  return reports(
    g,
    f.packet.sheets[1],
    f.packet,
    sourceCells && {
      kind: f.ir.relations?.some((r) => r.uid === key && r.assembly)
        ? "assemblies"
        : undefined,
      rows: [{ key, cells: sourceCells }],
    },
  ).filter((x) => x.kind === "report-null-placeholder");
}
it.each([
  ["no-same-location-connections", "No connections"],
  ["no-same-location-connections", "No same-location connections"],
  ["no-other-location-connections", "No connections"],
  [
    "no-other-location-connections",
    "No other / unspecified location connections",
  ],
  ["unspecified-status", "Not specified"],
  ["unspecified-status", "Status not specified"],
  ["unspecified-medium", "Not specified"],
  ["unspecified-medium", "Protocol / medium not specified"],
  ["assembly-status", "Not specified"],
  ["assembly-status", "Status not specified"],
])("M3 and null policy accept explicit native %s: %s", (state, form) => {
  const terminal = state.startsWith("no-"),
    f = terminal
      ? terminalFixture()
      : state === "assembly-status"
        ? assemblyFixture()
        : fixture();
  const column =
    state === "no-same-location-connections"
      ? 4
      : state === "no-other-location-connections"
        ? 5
        : state === "unspecified-medium"
          ? 1
          : 4;
  if (state === "unspecified-medium") delete f.ir.deviceTypes[0].ports.P.medium;
  if (state === "assembly-status") {
    delete f.ir.relations[0].assembly.status;
    f.ir.relations[0].assembly.pinMapping.reason =
      "Vendor pinout unspecified; None is a source word (null)";
  }
  // Keep the source query's old placeholders to check the rules' shared policy
  // even when only the visible rendering has changed.
  const sourceCells =
    state === "assembly-status"
      ? [
          "CB",
          "cordset",
          "A.J",
          "B.J",
          `Unspecified\nPin mapping: unresolved\n${f.ir.relations[0].assembly.pinMapping.reason}`,
        ]
      : terminal
        ? ["A", "", "U", "", "None", "None", "Unconnected"]
        : [
            "--",
            state === "unspecified-medium" ? "Unspecified" : "ethernet",
            "A: P",
            "Unconnected",
            "Unspecified",
          ];
  for (const t of f.report.texts.filter((t) => t.row)) {
    if (terminal && [4, 5].includes(t.columnIndex)) t.text = "No connections";
    if (!terminal && t.columnIndex === 4) t.text = "Status not specified";
    if (t.columnIndex === column)
      t.text =
        state === "assembly-status"
          ? `${form} Pin mapping: unresolved ${f.ir.relations[0].assembly.pinMapping.reason}`
          : form;
  }
  expect(errors(f)).toEqual([]);
  expect(nullFindings(f, sourceCells)).toEqual([]);
  for (const wrong of ["", "INVENTED -> B.T", "verified", "ethernet"]) {
    const bad = clone(f);
    bad.report.texts.find((t) => t.row && t.columnIndex === column).text =
      wrong;
    expect(
      errors(bad).some(
        (x) => x.kind === "printed-document-target-insufficient",
      ),
    ).toBe(true);
  }
});
it.each(["None", "Unspecified", "null", "None\nUnspecified\nnull"])(
  "native assembly reason %s is authored text, never a null field",
  (reason) => {
    const f = assemblyFixture();
    const assembly = f.ir.relations[0].assembly;
    delete assembly.status;
    assembly.pinMapping.reason = reason;
    const suffix = `Pin mapping: unresolved\n${reason}`;
    const source = ["CB", "cordset", "A.J", "B.J", `Unspecified\n${suffix}`];
    const ink = f.report.texts.find((t) => t.row && t.columnIndex === 4);
    ink.text = `Status not specified\n${suffix}`;
    expect(errors(f)).toEqual([]);
    expect(nullFindings(f, source)).toEqual([]);
    ink.text = `Unspecified\n${suffix}`;
    expect(nullFindings(f, source)).toHaveLength(1);
    assembly.status = "planned";
    ink.text = source[4] = `planned\n${suffix}`;
    expect(errors(f)).toEqual([]);
    expect(nullFindings(f, source)).toEqual([]);
    ink.text = `planned\nPin mapping: unresolved\n${reason} altered`;
    expect(
      errors(f).some((x) => x.kind === "printed-document-target-insufficient"),
    ).toBe(true);
  },
);
it("legacy placeholders still deliver native states while retaining the null-policy defect", () => {
  for (const f of [terminalFixture(), fixture()]) {
    expect(errors(f)).toEqual([]);
    expect(nullFindings(f).length).toBeGreaterThan(0);
  }
});
it("an exported dependency with no native need is rejected independently", () => {
  const f = fixture();
  expect(errors(f)).toEqual([]);
  const extra = clone(f.packet.navigation.dependencies[0]);
  extra.owner.noteId = "not-a-native-note";
  extra.id = `dependency/1/${hashForTest([extra.owner.viewKey, extra.owner.noteId])}`;
  f.packet.navigation.dependencies.push(extra);
  expect(errors(f).map((x) => x.kind)).toEqual([
    "document-dependency-without-native-need",
  ]);
});
it("a second painted caption without a native need is rejected independently", () => {
  const f = fixture();
  expect(errors(f)).toEqual([]);
  f.source.texts.push(
    ink("network inventory 02.A3 (A: P).", {
      element: "orphan-caption",
      bbox: { x: 30, y: 120, w: 80, h: 3 },
      anchor: point(30, 123),
    }),
  );
  expect(errors(f).map((x) => x.kind)).toEqual([
    "document-visible-caption-without-native-need",
  ]);
});
it("an extra bare location beside a sufficient caption is rejected independently", () => {
  const f = fixture();
  expect(errors(f)).toEqual([]);
  f.packet.navigation.dependencies[0].caption.text = f.source.texts[0].text +=
    " Also 99.D6.";
  expect(errors(f).map((x) => x.kind)).toEqual([
    "document-caption-extra-location",
  ]);
});
it("an authored request note cannot satisfy a native caption obligation", () => {
  const f = fixture();
  expect(errors(f)).toEqual([]);
  f.request.views[0].notes = [f.source.texts[0].text];
  f.source.texts[0].authoredText = "request-note";
  expect(errors(f).map((x) => x.kind)).toEqual([
    "document-caption-native-scope-mismatch",
  ]);
});

it("empty-state wording cannot replace a known native connection or protocol", () => {
  const ir = {
    devices: [
      { uid: "a", designation: "A", location: "L" },
      { uid: "b", designation: "B", location: "L" },
    ],
    terminals: [{ id: { deviceUid: "a", terminalKey: "U" } }],
    wires: [
      {
        uid: "w",
        designation: "W",
        endpoints: [
          { terminal: { deviceUid: "a", terminalKey: "U" } },
          { terminal: { deviceUid: "b", terminalKey: "T" } },
        ],
      },
    ],
    relations: [
      {
        uid: "link",
        designation: "NET",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        connection: { fromPort: "P", toPort: "Q", protocol: "EtherNet/IP" },
      },
    ],
  };
  const catalog = nativeRows(ir),
    terminal = catalog.find((r) => r.kind === "terminals"),
    row = {
      kind: "terminals",
      key: '["a","U"]',
      cells: {
        0: "A",
        2: "U",
        4: "W -> B.T",
        5: "No connections",
        6: "Terminated",
      },
    };
  expect(sufficient(row, terminal)).toBe(true);
  for (const falseEmpty of ["", "None", "No connections", "W -> B.WRONG"]) {
    expect(
      sufficient({ ...row, cells: { ...row.cells, 4: falseEmpty } }, terminal),
    ).toBe(false);
  }
  const link = catalog.find((r) => r.key === "link"),
    network = {
      kind: "network",
      key: "link",
      cells: {
        0: "NET",
        1: "EtherNet/IP",
        2: "A: P L",
        3: "B: Q L",
        4: "Status not specified",
      },
    };
  expect(sufficient(network, link)).toBe(true);
  expect(
    sufficient(
      { ...network, cells: { ...network.cells, 1: "Not specified" } },
      link,
    ),
  ).toBe(false);
  expect(
    sufficient(
      { ...network, cells: { ...network.cells, 4: "verified" } },
      link,
    ),
  ).toBe(false);
});

it("L5 Z5 rejects a complete foreign native resolution row specifically", () => {
  const f = fixture(),
    doc = f.packet.navigation.documents[0];
  f.ir.devices.push({ uid: "foreign", designation: "Foreign", typeId: "t" });
  const key = '["foreign","P"]';
  for (const t of [...f.report.texts, ...f.report.reportCells])
    if (t.row) t.row = key;
  f.report.texts.find((t) => t.columnIndex === 2 && t.row).text = "Foreign: P";
  doc.rows[0].nativeKey = key;
  doc.rows[0].displayName = "Foreign: P";
  doc.rows[0].facts = [
    { kind: "port-link-status", deviceUid: "foreign", portKey: "P" },
  ];
  expect(check(f).findings.map((f) => f.kind)).toContain(
    "document-resolution-row-mismatch",
  );
});
it("L5 Z6 refuses an exported zone claim even when delivery and caption are correct", () => {
  const f = fixture();
  f.packet.navigation.documents[0].rows[0].zone = "D6";
  expect(check(f).findings.map((f) => f.kind)).toContain(
    "document-row-locator-mismatch",
  );
});
it("L5 Z10 resolution binding is enforced independently of registry binding", () => {
  const f = fixture();
  f.packet.navigation.documents[0].snapshotDigest = "stale";
  expect(check(f).findings.map((f) => f.kind)).toContain(
    "document-resolution-source-mismatch",
  );
});
it("R2-L2 an orphan authored inventory note is excluded by native request text, not its flag", () => {
  const f = fixture(),
    note = "See network inventory 09.A1 (Historical note).";
  f.request.views[0].notes = [note];
  f.source.texts.push(
    ink(note, { element: "authored", authoredText: "request-note" }),
  );
  expect(errors(f)).toEqual([]);
  delete f.source.texts.at(-1).authoredText;
  expect(errors(f)).toEqual([]);
  f.request.views[0].notes = [];
  f.source.texts.at(-1).authoredText = "request-note";
  expect(errors(f).map((f) => f.kind)).toContain(
    "document-visible-caption-without-native-need",
  );
});
