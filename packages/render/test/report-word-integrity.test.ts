import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { buildDocumentation } from "@thermite/query";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { reportCells } from "../src/packet/report-cells.js";
import { tableDrafts } from "../src/packet/reports.js";
import { documentPaper } from "./document-fixture.js";
import { preferWholeStateWords } from "../src/packet/report-state-words.js";
import { reportColumns } from "../src/packet/report-column-widths.js";
import { reportNoteLines } from "../src/packet/report-note-wrapping.js";
import { measureText } from "../src/text-metrics.js";

const fixture = () => {
  const ir = createTerminalIr([
    { uid: "word-owner", designation: "X-PROTECTED-123", terminalKeys: ["1"] },
  ]);
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    device: "X-PROTECTED-123",
  });
  return { ir, table };
};

it("reserves a whole state word before surplus goes to empty columns", () => {
  const { ir, table } = fixture();
  const state = table.columns.indexOf("State");
  const measured = reportCells(ir, table, 190.5);
  const source = table.rows[0];
  if (!source) throw Error("Missing native terminal row");
  const cells = measured.split(source.cells, "1", source.key);
  expect(cells[state]).toEqual(["Unconnected"]);
  expect(cells.flat().join(" ")).toContain("X-PROTECTED-123");
  expect(measured.cellSize).toBe(2.6);
});

it("wraps report notes at measured word boundaries without dropping an identifier", () => {
  const { ir, table } = fixture();
  const note =
    "The protected identifier X-PROTECTED-123 remains available for lookup. "
      .repeat(7)
      .trim();
  table.notes = [note];
  const result = tableDrafts(ir, table, undefined, documentPaper());
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const dom = parseHTML(`<svg>${result.value[0]?.content}</svg>`).document;
  const lines = [...dom.querySelectorAll("[data-report-note]")].map(
    (node) => node.textContent ?? "",
  );
  expect(lines.join(" ").replace(/\s+/gu, " ").trim()).toBe(note);
  for (const line of lines)
    for (const word of line.trim().split(/\s+/u))
      expect(note.split(/\s+/u)).toContain(word);
  expect(lines.join(" ").match(/X-PROTECTED-123/gu)).toHaveLength(7);
  expect(result.value).toHaveLength(1);
});

it.each(["row", "header"])(
  "rejects a state candidate that increases %s height",
  (part) => {
    const { table } = fixture();
    const standard = {
      split: (cells: readonly string[]) => cells.map((cell) => [cell]),
      geometry: (_cells: string[][], _heading = false) => ({ height: 10 }),
    };
    const candidate = {
      ...standard,
      geometry: (_cells: string[][], heading = false) => ({
        height: heading === (part === "header") ? 20 : 10,
      }),
    };
    const measure = vi.fn(() => candidate);
    expect(
      preferWholeStateWords(
        table,
        160,
        2.6,
        reportColumns(table, 160, 2.6, []),
        standard,
        measure,
      ),
    ).toBe(standard);
    expect(measure).toHaveBeenCalledTimes(1);
  },
);

it.each(["WWWW WWWW WWWW WWWW", "ENDPOINT123", "e\u0301WWWWW"])(
  "fits wide source text without dropping characters: %j",
  (value) => {
    const width = 11;
    const lines = reportNoteLines(value, width);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(value);
    expect(lines.every((line) => measureText(line, 2.5).width <= width)).toBe(
      true,
    );
    expect(lines.every((line) => !/^\p{Mark}/u.test(line))).toBe(true);
  },
);

it.each([
  "Cafe\u0301 remains available.",
  "Cafe\u0301 remains available for exact lookup. ".repeat(3) +
    "\r\nKeep authored spacing  here.",
])("preserves authored note code points and line separators: %j", (value) => {
  expect(reportNoteLines(value, 70).join("")).toBe(value);
});
