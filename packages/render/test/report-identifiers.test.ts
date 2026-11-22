import { beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  buildDocumentation,
  relationPrintIdentity,
  type DocumentationTable,
} from "@thermite/query";
import {
  reportIdentifiers,
  REPORT_IDENTIFIER_COLUMNS,
} from "../src/packet/report-identifiers.js";
import { reportColumns } from "../src/packet/report-column-widths.js";
import { reportCells, emitReportRow } from "../src/packet/report-cells.js";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { wrapReportCell } from "../src/packet/report-wrapping.js";
import { expectedIdentifierCells } from "../../../evals/draw/identifier-policy.mjs";
import { renderSchematicPacket } from "../src/sheets.js";

it("issues port references for undesignated network links and assemblies", async () => {
  const compiled = await compileProject("examples/report-filtering");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const { ir } = compiled;
  const network = ir.relations.find((r) => r.designation === "NET1")!;
  const assembly = ir.relations.find((r) => r.designation === "ASM1")!;
  delete network.designation;
  delete assembly.designation;
  network.description = "Authored link description";
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    views: (["network", "assemblies", "bom", "io-ports"] as const).map(
      (kind) => ({
        format: "documentation-view-request/0.1",
        kind,
      }),
    ),
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  for (const [kind, relation, column, units] of [
    ["network", network, 1, ["PLC1: ETH", "DOC1: IN"]],
    ["assemblies", assembly, 1, ["PLC1.X1", "S1.P"]],
    ["bom", assembly, 2, ["PLC1.X1", "S1.P"]],
  ] as const) {
    const sheet = result.value.sheets.find(
      (s) => "kind" in s.view && s.view.kind === kind,
    )!;
    const doc = parseHTML(sheet.svg).document;
    const ink = [
      ...doc.querySelectorAll(
        `[data-report-row="${relation.uid}"] [data-report-column="${column}"] text`,
      ),
    ]
      .map((t) => t.textContent)
      .join(" ");
    expect(ink).toBe(units.join(" ↔ "));
  }
  const ports = result.value.sheets.find(
    (s) => "kind" in s.view && s.view.kind === "io-ports",
  )!;
  expect(ports.svg).toContain("PLC1.X1");
  expect(ports.svg).toContain("S1.P");
  expect(ports.svg).not.toContain(`>${assembly.uid}`);

  const missing = new Map();
  expect(relationPrintIdentity(network, missing)).toEqual({
    text: network.description,
    identifiers: [],
  });
  expect(
    relationPrintIdentity({ ...network, description: " " }, missing),
  ).toEqual({
    text: "",
    identifiers: [],
  });
});

const orders = [
  "6ES7131-6BF01-0BA0",
  "6ES7132-6BF01-0BA0",
  "6ES7212-1AE40-0XB0",
];
let ir: ElectricalIr, bom: DocumentationTable;
beforeAll(async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  ir = compiled.ir;
  bom = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "bom",
  });
});

it("widens before reducing the font and emits all three real Siemens values whole", () => {
  const cells = reportCells(ir, bom, 375.8);
  expect(cells.cellSize).toBe(2.6);
  expect(cells.widths[4]).toBeCloseTo(34.97032, 5);
  for (const value of orders) {
    const row = bom.rows.find((r) => r.cells[4] === value)!;
    const split = cells.split(row.cells, "test", row.key);
    expect(split[4]).toEqual([value]);
    const svg = emitReportRow(
      split,
      cells.geometry(split).height,
      cells.widths,
      bom.columns,
      0,
      0,
      cells.geometry,
    ).join("");
    const doc = parseHTML(`<svg>${svg}</svg>`).document;
    expect(
      [...doc.querySelectorAll('[data-report-column="5"] text')].map(
        (t) => t.textContent,
      ),
    ).toEqual([value]);
  }
});

function cpuTable(): DocumentationTable {
  const row = bom.rows.find((r) => r.cells[4] === orders[2])!;
  return {
    ...bom,
    rows: [
      { ...row, cells: row.cells.map((value, i) => (i === 2 ? "" : value)) },
    ],
  };
}
function minimum(table: DocumentationTable, size: number) {
  return reportColumns(table, 0, size, [], reportIdentifiers(ir, table))
    .minimumWidth;
}
it("uses the allowed 2.5 mm only after redistribution at 2.6 mm cannot fit", () => {
  const table = cpuTable();
  const width = (minimum(table, 2.6) + minimum(table, 2.5)) / 2;
  const cells = reportCells(ir, table, width);
  expect(cells.cellSize).toBe(2.5);
  const row = table.rows[0]!,
    split = cells.split(row.cells, "1", row.key);
  expect(split[4]).toEqual([orders[2]]);
  const svg = emitReportRow(
    split,
    cells.geometry(split).height,
    cells.widths,
    table.columns,
    0,
    0,
    cells.geometry,
  ).join("");
  const doc = parseHTML(`<svg>${svg}</svg>`).document;
  expect(
    [...doc.querySelectorAll("text")].every(
      (t) => t.getAttribute("font-size") === "2.5",
    ),
  ).toBe(true);
});
it("refuses with row, identifier, shortfall and paper advice at the 2.5 mm limit", () => {
  const table = cpuTable(),
    width = minimum(table, 2.5) - 0.1;
  const cells = reportCells(ir, table, width);
  expect(cells.cellSize).toBe(2.5);
  expect(() => cells.split(table.columns, "header")).toThrow(
    /row .*column 5 "Order number": identifier "6ES7212-1AE40-0XB0".*minimum table width.*only .*2\.5 mm em.*larger paper or landscape/u,
  );
  const paper = normalizePaperPage({ size: "letter", orientation: "portrait" });
  if (!paper.ok) throw Error("paper");
  const result = tableDrafts(ir, table, undefined, {
    ...paper.value,
    widthMm: width + 56,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "R006", reason: "unprintable-layout" },
  });
});

it.each(["\n", "\r", "\u2028", "\u2029"])(
  "refuses a scalar identifier containing %j without repairing it",
  (separator) => {
    const table = cpuTable(),
      row = table.rows[0]!;
    const cells = [...row.cells];
    cells[4] = orders[2]!.replace("-", separator);
    const changed = { ...table, rows: [{ ...row, cells }] };
    expect(() => reportCells(ir, changed, 375.8)).toThrow(
      /column 5.*identifier.*line separator/su,
    );
    expect(cells[4]).toContain(separator);
  },
);

it("protects source identifiers with their spaces, punctuation and combining clusters", () => {
  for (const id of [
    orders[2]!,
    "CR MOTOR START 101",
    "=PLANT+CAB-PUMP",
    "A\u0301.B/1_2-3",
  ]) {
    const prefix = "Notes ";
    const lines = wrapReportCell(
      prefix + id,
      35,
      2.6,
      [],
      [id.normalize("NFC")],
    );
    if (id === "CR MOTOR START 101") expect(lines).toContain(id);
    else
      expect(lines.some((line) => line.includes(id.normalize("NFC")))).toBe(
        true,
      );
  }
});
it("rejects an identifier that fits no line rather than using punctuation breaks", () => {
  expect(() => wrapReportCell(orders[2]!, 10, 2.6, [], [orders[2]!])).toThrow(
    /cannot fit without splitting/u,
  );
});
it("wraps a designation list between source units, including names containing commas", () => {
  const input = structuredClone(ir);
  input.devices[0]!.designation = "PUMP, EAST";
  input.devices[1]!.designation = "PUMP-WEST";
  const table: DocumentationTable = {
    kind: "bom",
    title: "Names",
    columns: ["Qty", "Designations"],
    widths: [1, 2],
    notes: [],
    rows: [
      {
        key: "group",
        cells: ["2", "PUMP, EAST, PUMP-WEST"],
        deviceUids: input.devices.slice(0, 2).map((d) => d.uid),
      },
    ],
  };
  const cells = reportCells(input, table, 50);
  const lines = cells.split(table.rows[0]!.cells, "1", table.rows[0]!.key)[1]!;
  expect(lines.some((line) => line.includes("PUMP, EAST"))).toBe(true);
  expect(lines.some((line) => line.includes("PUMP-WEST"))).toBe(true);
  expect(lines.length).toBeGreaterThan(1);
});
it("leaves prose and the separate 120-character wire display label wrappable", () => {
  const input = structuredClone(ir);
  input.wires[0]!.properties = { label: "W".repeat(120) };
  const table = buildDocumentation(input, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  const row = table.rows.find((r) => r.key === input.wires[0]!.uid)!;
  const ids = reportIdentifiers(input, table).get(row.key)![0]!;
  expect(ids).toEqual([input.wires[0]!.designation]);
  expect(ids).not.toContain("W".repeat(120));
  expect(
    reportCells(input, table, 375.8).split(row.cells, "1", row.key)[0]!.length,
  ).toBeGreaterThan(1);
  expect(wrapReportCell(orders[2]!, 10, 2.6, []).length).toBeGreaterThan(1);
});
it("does not infer an identifier column from its contents", () => {
  const table = {
    ...cpuTable(),
    columns: bom.columns.map((c, i) => (i === 4 ? "Description" : c)),
  };
  expect(reportIdentifiers(ir, table).get(table.rows[0]!.key)![4]).toEqual([]);
  expect(() =>
    reportIdentifiers(ir, { ...table, kind: "unknown" as "bom" }),
  ).toThrow(/no identifier policy/u);
  expect(Object.keys(REPORT_IDENTIFIER_COLUMNS)).toHaveLength(10);
});

it("keeps the whole Order number header only without extra body lines or header height", async () => {
  const compiled = await compileProject("examples/report-filtering");
  if (!compiled.ok) throw Error("compile");
  const table = buildDocumentation(compiled.ir, {
    format: "documentation-view-request/0.1",
    kind: "bom",
    filter: {
      locations: ["Main"],
      excludeTypes: ["filter-fixture:documentary"],
    },
  });
  expect(
    reportCells(compiled.ir, table, 223.4).split(table.columns, "header")[4],
  ).toEqual(["Order number"]);
  expect(
    reportCells(compiled.ir, table, 159.9).split(table.columns, "header")[4],
  ).toEqual(["Order", "number"]);
});

it.each([
  ["examples/machine-demo", "wires"],
  ["examples/machine-demo", "cables"],
  ["examples/machine-demo", "terminals"],
  ["examples/machine-demo", "io"],
  ["examples/connector-io", "io-ports"],
  ["examples/connector-io", "assemblies"],
  ["examples/network-pagination", "network"],
] as const)(
  "keeps source-field boundaries consistent in independent policies for %s/%s",
  async (project, kind) => {
    const compiled =
      project === "examples/machine-demo"
        ? { ok: true as const, ir }
        : await compileProject(project);
    if (!compiled.ok) throw Error("compile");
    const table = buildDocumentation(compiled.ir, {
      format: "documentation-view-request/0.1",
      kind,
    });
    const rendered = reportIdentifiers(compiled.ir, table);
    const checked = expectedIdentifierCells(compiled.ir, table);
    for (const row of table.rows) {
      for (const [column, identifiers] of rendered.get(row.key)!.entries()) {
        const expected = checked.find(
          (cell: { row: string; column: number }) =>
            cell.row === row.key && cell.column === column,
        );
        expect(expected?.identifiers ?? [], `${row.key}/${column}`).toEqual(
          identifiers,
        );
        for (const identifier of identifiers)
          expect(row.cells[column]!.normalize("NFC")).toContain(identifier);
      }
    }
    if (kind === "io-ports") {
      const device = compiled.ir.devices.find((d) => d.connectorIo)!;
      const [port, assignment] = Object.entries(device.connectorIo!.ports)[0]!;
      const cells = rendered.get(JSON.stringify([device.uid, port]))!;
      expect(cells[0]).toEqual([device.designation]);
      expect(cells[1]).toEqual([port]);
      expect(cells[3]).toEqual(
        [device.connectorIo!.addressSpace, assignment.address].filter(Boolean),
      );
      expect(cells[4]).toEqual([]); // signal/usage prose never becomes an ID
    }
  },
);

it("declines the cosmetic header if it makes an otherwise printable Unicode cluster refuse", async () => {
  const compiled = await compileProject("examples/report-filtering");
  if (!compiled.ok) throw Error("compile");
  const source = buildDocumentation(compiled.ir, {
    format: "documentation-view-request/0.1",
    kind: "bom",
  });
  const row = source.rows[0]!,
    cells = row.cells.map((value, i) => (i < 2 ? value : ""));
  const cluster = Array(12).fill("W").join("\u200d");
  cells[5] = cluster;
  const table = { ...source, rows: [{ ...row, cells }] };
  const measured = reportCells(compiled.ir, table, 159.9);
  expect(measured.cellSize).toBe(2.6);
  expect(measured.split(table.columns, "header")[4]).toEqual([
    "Order",
    "number",
  ]);
  expect(measured.split(cells, "1", row.key)[5]).toEqual([cluster]);
});
