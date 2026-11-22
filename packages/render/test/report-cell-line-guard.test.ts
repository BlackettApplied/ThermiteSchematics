import { expect, it, vi } from "vitest";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { buildDocumentation } from "@thermite/query";
import { reportCells } from "../src/packet/report-cells.js";
import * as stateWords from "../src/packet/report-state-words.js";

function neighbouringIdentifierFixture() {
  const ir = createTerminalIr([
    { uid: "owner", designation: "X1", terminalKeys: ["1"] },
    { uid: "neighbour", designation: "=BOX+UNIT-A1", terminalKeys: ["1"] },
  ]);
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    device: "X1",
  });
  const row = table.rows[0];
  if (!row) throw Error("Missing native row");
  row.cells[3] = "=BOX+UNIT-A1";
  row.cells[4] = "a\nb\nc\nd";
  row.cells[5] = "";
  table.widths = [0.1, 0.13, 0.09, 0.18, 0.23, 0.19, 0.08];
  return { ir, table, row };
}

it("does not split a neighbouring identifier inside an already-tall row", () => {
  const { ir, table, row } = neighbouringIdentifierFixture();
  const original = stateWords.preferWholeStateWords;
  const snapshot: { cells?: string[][]; height?: number } = {};
  const spy = vi
    .spyOn(stateWords, "preferWholeStateWords")
    .mockImplementation((table, width, size, allocation, standard, measure) => {
      snapshot.cells = standard.split(row.cells, "probe", row.key);
      snapshot.height = standard.geometry(snapshot.cells).height;
      return original(table, width, size, allocation, standard, measure);
    });
  try {
    const measured = reportCells(ir, table, 149.5);
    const before = snapshot.cells;
    if (!before) throw Error("Missing native measurement");
    expect(before[3]).toEqual(["=BOX+UNIT-A1"]);
    expect(before[4]).toHaveLength(4);
    expect(snapshot.height).toBe(18.4);
    const after = measured.split(row.cells, "probe", row.key);
    expect(measured.geometry(after).height).toBe(snapshot.height);
    expect(after[3]).toEqual(["=BOX+UNIT-A1"]);
    expect(after).toEqual(before);
    expect(measured.cellSize).toBe(2.6);
  } finally {
    spy.mockRestore();
  }
});
