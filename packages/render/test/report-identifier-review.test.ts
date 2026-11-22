import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, REPORT_KINDS } from "@thermite/query";
import {
  REPORT_IDENTIFIER_COLUMNS,
  reportIdentifiers,
} from "../src/packet/report-identifiers.js";
import { referenceTables } from "../src/packet/references.js";
import { reportCells } from "../src/packet/report-cells.js";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { wrapReportCell } from "../src/packet/report-wrapping.js";
import {
  identifierColumns,
  expectedIdentifierCells,
} from "../../../evals/draw/identifier-policy.mjs";
import { createTerminalIr } from "../../query/test/fixtures.js";

let machine: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw Error("compile");
  machine = compiled.ir;
});

it("pins every registered renderer and checker header to the real query position", () => {
  const tables = [
    ...REPORT_KINDS.map((kind) =>
      buildDocumentation(machine, {
        format: "documentation-view-request/0.1",
        kind,
      }),
    ),
    ...referenceTables(machine, [], {}, undefined).tables,
  ];
  expect(tables.map((t) => t.kind).sort()).toEqual(
    Object.keys(REPORT_IDENTIFIER_COLUMNS).sort(),
  );
  expect(tables.map((t) => t.kind).sort()).toEqual(
    Object.keys(identifierColumns).sort(),
  );
  for (const table of tables) {
    const headers = [
      ...REPORT_IDENTIFIER_COLUMNS[table.kind].map(([column, header]) => ({
        column,
        header,
      })),
      ...identifierColumns[table.kind],
    ];
    for (const { column, header } of headers) {
      if (table.kind === "wires" && (column === 5 || column === 6)) {
        expect(header).toBe(column === 5 ? "From sheet.zone" : "To sheet.zone");
        expect(table.columns[column]).toBeUndefined(); // packet-only reference columns
      } else
        expect(table.columns[column], `${table.kind}/${column}`).toBe(header);
    }
  }
  const packetWires = buildDocumentation(
    machine,
    { format: "documentation-view-request/0.1", kind: "wires" },
    {
      conductors: new Map([[machine.wires[0]!.uid, ["2.B3", null] as const]]),
    },
  );
  for (const [column, header] of REPORT_IDENTIFIER_COLUMNS.wires)
    expect(packetWires.columns[column]).toBe(header);
  for (const { column, header } of identifierColumns.wires)
    expect(packetWires.columns[column]).toBe(header);
});

function connectionFixture() {
  const keys = ["1", "13", "+", "a"];
  const ir = createTerminalIr(
    [
      { uid: "owner", designation: "XT1", terminalKeys: ["1"] },
      { uid: "local", designation: "X1", terminalKeys: ["13"] },
      { uid: "remote", designation: "PS1", terminalKeys: ["+"] },
      { uid: "unspecified", designation: "N1", terminalKeys: ["a"] },
    ].map((device) => ({ ...device, terminalKeys: keys })),
  );
  ir.devices[0]!.location = ir.devices[1]!.location = "Panel A";
  ir.devices[2]!.location = "Panel B";
  const source = ir.devices[0]!.source;
  ir.deviceTypes[0]!.terminals = keys.map((key) => ({ key, source }));
  ir.deviceTypes[0]!.terminalOrder = keys;
  const end = (deviceUid: string, terminalKey: string) => ({
    terminal: { deviceUid, terminalKey },
    source,
  });
  ir.wires = [
    {
      uid: "w1",
      designation: "W1",
      aliases: [],
      source,
      endpoints: [end("owner", "1"), end("local", "13")],
    },
    {
      uid: "w2",
      designation: "W2",
      aliases: [],
      source,
      endpoints: [end("remote", "+"), end("owner", "1")],
    },
  ];
  ir.jumpers = [
    {
      uid: "j1",
      designation: "J1",
      source,
      endpoints: [end("owner", "1"), end("unspecified", "a")],
    },
  ];
  return ir;
}
function terminalTable(ir: ElectricalIr) {
  return buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    device: "XT1",
  });
}

it("protects complete source endpoints in both terminal connection columns", () => {
  const ir = connectionFixture(),
    table = terminalTable(ir),
    row = table.rows[0]!;
  const ids = reportIdentifiers(ir, table).get(row.key)!;
  expect(ids[4]).toEqual(["X1.13"]);
  expect(ids[5]).toEqual(["PS1.+", "N1.a"]);
  for (const column of [4, 5]) {
    const expected = expectedIdentifierCells(ir, table).find(
      (cell: { column: number }) => cell.column === column,
    );
    expect(expected.identifiers).toEqual(ids[column]);
    const lines = wrapReportCell(row.cells[column]!, 14, 2.6, [], ids[column]);
    for (const unit of ids[column]!)
      expect(lines.some((line) => line.includes(unit))).toBe(true);
  }
  expect(
    wrapReportCell(row.cells[5]!, 14, 2.6, [], ids[5]).length,
  ).toBeGreaterThan(1);
});

it("takes terminal endpoint boundaries from source fields even when a name contains printed separators", () => {
  const ir = connectionFixture();
  ir.devices[1]!.designation = "PUMP; EAST -> LOCAL";
  const table = terminalTable(ir),
    row = table.rows[0]!;
  const unit = "PUMP; EAST -> LOCAL.13";
  expect(row.cells[4]).toBe(`W1 -> ${unit}`);
  expect(reportIdentifiers(ir, table).get(row.key)![4]).toEqual([unit]);
  expect(
    expectedIdentifierCells(ir, table).find(
      (cell: { row: string; column: number }) =>
        cell.row === row.key && cell.column === 4,
    ).identifiers,
  ).toEqual([unit]);
});

it.each([undefined, ""])(
  "uses authored location semantics for terminal endpoints at %j",
  (location) => {
    const ir = connectionFixture();
    if (location === undefined) {
      delete ir.devices[0]!.location;
      delete ir.devices[1]!.location;
    } else ir.devices[0]!.location = ir.devices[1]!.location = location;
    const table = terminalTable(ir),
      ids = reportIdentifiers(ir, table).get(table.rows[0]!.key)!;
    expect(ids[4]).toEqual(location === undefined ? [] : ["X1.13"]);
    expect(ids[5]).toEqual(
      location === undefined ? ["X1.13", "PS1.+", "N1.a"] : ["PS1.+", "N1.a"],
    );
    for (const cell of expectedIdentifierCells(ir, table).filter(
      (cell: { row: string }) => cell.row === table.rows[0]!.key,
    ))
      expect(cell.identifiers).toEqual(ids[cell.column]);
  },
);

it("includes authored cable-core peers and leaves unterminated spare text out of the identifier list", () => {
  const ir = connectionFixture(),
    source = ir.devices[0]!.source;
  ir.wires = [];
  ir.jumpers = [];
  ir.cableTypes = [
    {
      kind: "cable_type",
      id: "test:cable",
      libraryName: "test",
      libraryVersion: "0.1.0",
      aliases: [],
      source,
      conductors: ["1", "2"].map((id) => ({ id, color: "", source })),
    },
  ];
  ir.cables = [
    {
      uid: "c1",
      designation: "CB1",
      typeId: "test:cable",
      aliases: [],
      source,
      assignments: [
        {
          id: "1",
          source,
          endpoints: [
            { terminal: { deviceUid: "owner", terminalKey: "1" }, source },
            { terminal: { deviceUid: "local", terminalKey: "13" }, source },
          ],
        },
        {
          id: "2",
          usage: "spare",
          source,
          endpoints: [
            { terminal: { deviceUid: "owner", terminalKey: "1" }, source },
            null,
          ],
        },
      ],
    },
  ];
  const table = terminalTable(ir),
    ids = reportIdentifiers(ir, table).get(table.rows[0]!.key)!;
  expect(table.rows[0]!.cells[5]).toContain("Unterminated");
  expect(ids[4]).toEqual(["X1.13"]);
  expect(ids[5]).toEqual([]);
  expect(
    expectedIdentifierCells(ir, table).find(
      (cell: { column: number }) => cell.column === 4,
    ).identifiers,
  ).toEqual(["X1.13"]);
  expect(
    expectedIdentifierCells(ir, table).some(
      (cell: { column: number }) => cell.column === 5,
    ),
  ).toBe(false);
});

it("keeps identifiers protected when row cells are copied and requires an explicit source key", () => {
  const table = buildDocumentation(machine, {
    format: "documentation-view-request/0.1",
    kind: "bom",
  });
  const row = table.rows.find((r) => r.cells[4] === "6ES7212-1AE40-0XB0")!;
  const measured = reportCells(machine, table, 375.8),
    copied = [...row.cells];
  expect(measured.split(copied, "copied", row.key)[4]).toEqual([row.cells[4]]);
  expect(() => measured.split(row.cells, "missing key")).toThrow(
    /explicit source row key/,
  );
  const paper = normalizePaperPage({});
  if (!paper.ok) throw Error("paper");
  expect(tableDrafts(machine, table, undefined, paper.value).ok).toBe(true);
});
