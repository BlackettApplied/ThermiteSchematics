import { expect, it } from "vitest";
import { identifierTable } from "./identifier-tables.mjs";
import { identifierFindings } from "./identifier-checks.mjs";

const ir = {
  devices: [
    { uid: "plc1", designation: "PLC1" },
    { uid: "plc2", designation: "PLC2" },
  ],
};
const key = JSON.stringify(["plc1", []]);
const ref = (zone, functions = [], representation) => ({
  deviceUid: "plc1",
  designation: "PLC1",
  functions,
  zone,
  ...(representation ? { representation } : {}),
});
const sheet = (number, kind, references = []) => ({
  number,
  view: { format: "documentation-view/0.1", kind },
  references,
});
function packet(appearances = "drawings") {
  return {
    referenceSelection: {
      enabled: true,
      appearances,
      deviceUids: ["plc1"],
    },
    sheets: [
      sheet(1, "communication", [ref("A1")]),
      sheet(3, "terminals", [ref("A4")]),
      sheet(4, "network", [ref("A4")]),
      sheet(5, "bom", [ref("A4"), ref("A4"), ref("B4")]),
      sheet(6, "index", [ref("D6")]),
      sheet(7, "references", [ref("D6")]),
    ],
  };
}
function table(p, kind = "references", keys = [key]) {
  return identifierTable(sheet(7, kind), p, { reportRows: keys }, ir, []);
}

it("projects only drawing appearances without dropping report sheets from the index", () => {
  const p = packet(),
    before = JSON.stringify(p);
  expect(table(p).rows[0].cells[2]).toBe("1 / A1");
  expect(table(p, "index").rows.map((r) => r.cells[0])).toEqual([
    "1",
    "3",
    "4",
    "5",
  ]);
  expect(JSON.stringify(p)).toBe(before);
});

it.each(["all", undefined])(
  "retains schedule appearances for %s scope",
  (scope) => {
    const p = packet("all");
    if (scope === undefined) delete p.referenceSelection;
    expect(table(p).rows[0].cells[2]).toBe(
      "1 / A1; 3 / A4; 4 / A4; 5 / A4; 5 / B4",
    );
  },
);

it("keeps functions and representations separate and preserves original sheet numbers", () => {
  const p = packet();
  p.sheets.unshift(
    sheet(9, "circuit", [
      ref("B2", ["coil"]),
      ref("B2", ["coil"]),
      ref("D3", [], "terminal"),
    ]),
  );
  const coil = JSON.stringify(["plc1", ["coil"]]),
    terminal = JSON.stringify(["plc1", [], "terminal"]);
  expect(
    table(p, "references", [key, coil, terminal]).rows.map((r) => r.cells[2]),
  ).toEqual(["1 / A1", "9 / B2", "9 / D3"]);
});

it("rejects a printed row outside the selected devices without filtering the index", () => {
  const p = packet();
  p.referenceSelection.deviceUids = ["plc2"];
  expect(() => table(p)).toThrow(/reference source missing/);
  expect(table(p, "index").rows[0].cells[2]).toBe("PLC1");
  p.referenceSelection.deviceUids = [];
  expect(table(p, "references", []).rows).toEqual([]);
});

it("allows a complete index when references are disabled and rejects a reference page", () => {
  const p = packet();
  p.referenceSelection.enabled = false;
  expect(table(p, "index").rows).toHaveLength(4);
  expect(() => table(p)).toThrow(/invalid reference selection/);
});

it.each([
  { enabled: true, appearances: "schedule", deviceUids: ["plc1"] },
  { enabled: true, appearances: "drawings" },
])("fails closed on invalid scope metadata %j", (selection) => {
  expect(() => table({ ...packet(), referenceSelection: selection })).toThrow(
    /invalid reference selection/,
  );
});

function run(text, y = 20, x = 65) {
  return {
    text,
    anchor: { x, y },
    bbox: { x, y: y - 2, w: text.length, h: 2 },
  };
}
function geometry(runs) {
  return {
    reportRows: [key],
    reportCells: [0, 2].map((columnIndex) => ({
      row: key,
      columnIndex,
      element: `cell-${columnIndex}`,
      bbox: { x: columnIndex ? 60 : 1, y: 1, w: columnIndex ? 100 : 30, h: 40 },
    })),
    texts: [
      {
        row: key,
        columnIndex: 0,
        painted: true,
        reportRuns: [run("PLC1", 20, 5)],
      },
      { row: key, columnIndex: 2, painted: true, reportRuns: runs },
    ],
  };
}
const clean = () => [run("1 / A1")];
const split = () => [run("1 /", 20), run("A1", 24)];
const pdf = (runs) => [run("PLC1", 20, 5), ...runs];

it.each(["svg", "html", "pdf"])(
  "checks the scoped model in %s without forgiving required splits or missing text",
  (medium) => {
    const expected = table(packet());
    expect(
      identifierFindings(geometry(clean()), expected, ir, medium, pdf(clean())),
    ).toEqual([]);
    expect(
      identifierFindings(geometry(split()), expected, ir, medium, pdf(split())),
    ).toMatchObject([{ kind: "identifier-line-break", identifier: "1 / A1" }]);
    for (const text of ["1 / A", "2 / A1", "1 / A…", ""]) {
      const runs = text ? [run(text)] : [];
      expect(
        identifierFindings(geometry(runs), expected, ir, medium, pdf(runs)),
      ).toMatchObject([{ kind: "identifier-text-mismatch" }]);
    }
  },
);

it("detects a PDF-only reference split when SVG and HTML are clean", () => {
  const expected = table(packet()),
    g = geometry(clean());
  expect(identifierFindings(g, expected, ir)).toEqual([]);
  expect(identifierFindings(g, expected, ir, "html")).toEqual([]);
  expect(
    identifierFindings(g, expected, ir, "pdf", pdf(split())),
  ).toMatchObject([{ kind: "identifier-line-break", medium: "pdf" }]);
});

it("allows complete all-scope references on separate lines", () => {
  const expected = table(packet("all"));
  const runs = expected.rows[0].cells[2]
    .split("; ")
    .map((text, i, entries) =>
      run(text + (i < entries.length - 1 ? ";" : ""), 20 + i * 4),
    );
  for (const medium of ["svg", "html", "pdf"])
    expect(
      identifierFindings(geometry(runs), expected, ir, medium, pdf(runs)),
    ).toEqual([]);
});

it("allows an intact conductor and alias on separate PDF lines with extraction padding", () => {
  const source = {
    ...ir,
    wires: [
      { uid: key, designation: "W104", properties: { label: "PUMP-RUN" } },
    ],
    jumpers: [],
  };
  const g = geometry([run("W104 /"), run("PUMP-RUN", 24)]);
  g.reportCells.shift();
  g.texts.shift();
  g.reportCells[0].columnIndex = g.texts[0].columnIndex = 0;
  const expected = identifierTable(sheet(7, "wires"), packet(), g, source, [
    {
      kind: "wires",
      columns: ["Conductor / label"],
      rows: [{ key, cells: ["W104 / PUMP-RUN"] }],
    },
  ]);
  const padding = run(" ", 18.85);
  const find = (runs) => identifierFindings(g, expected, source, "pdf", runs);
  expect(find([run(" W104 / "), run(" PUMP-RUN ", 24), padding])).toEqual([]);
  expect(
    find([run("W10 "), run(" 4 / ", 24), run("PUMP-RUN", 28)]),
  ).toMatchObject([
    { kind: "identifier-line-break", identifier: "W104", lineCount: 2 },
  ]);
});
