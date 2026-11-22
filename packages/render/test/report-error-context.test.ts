import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import * as cells from "../src/packet/report-cells.js";
import * as wrapping from "../src/packet/report-wrapping.js";
import {
  ReportMeasurementError,
  reportCellContext,
} from "../src/packet/report-measurement.js";
import { paginatedReportCells } from "../src/packet/report-layout.js";
import { tableDrafts } from "../src/packet/reports.js";
import { pruningFixture } from "./wire-column-pruning-fixture.js";
import { parseSvg } from "./off-view-fixtures.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});
afterEach(() => vi.restoreAllMocks());

function forceFallback(
  stage: "native-reference" | "search-setup",
  mapped = true,
) {
  const f = pruningFixture(ir);
  const context = reportCellContext(
    { ...f.table, title: "Hidden sizing table" },
    "147",
    4,
  );
  if (!mapped) context.columnName = "Hidden-only column";
  const error = new ReportMeasurementError(
    'Report "Hidden sizing table", row 147, column 5: Header text cannot fit.',
    context,
    "Header text cannot fit.",
  );
  if (stage === "native-reference") {
    const original = cells.reportCells;
    vi.spyOn(cells, "reportCells").mockImplementation((...args) => {
      if (args[4] === "legacy") throw error;
      return original(...args);
    });
  } else
    vi.spyOn(cells, "wireColumnProbe").mockImplementation(() => {
      throw error;
    });
  const result = tableDrafts(f.ir, f.table, undefined, f.page);
  if (!result.ok) throw Error(result.error.message);
  const svg = parseSvg(
    `<svg>${result.value.map((d) => d.content).join("")}</svg>`,
  );
  return (
    [...svg.querySelectorAll("[data-report-note]")]
      .map((n) => n.textContent)
      // Word wrapping preserves boundary whitespace; reconstruct exact note text.
      .join("")
  );
}

it.each(["native-reference", "search-setup"] as const)(
  "prints a drafting fallback note without hidden %s coordinates or stage names",
  (stage) => {
    const notes = forceFallback(stage);
    expect(notes).toContain(
      "Sheet and zone references are shown below the endpoints.",
    );
    expect(notes).toContain(
      'An alternative layout for "Wire and core schedule" could not fit column "Assignment": Header text cannot fit.',
    );
    expect(notes).not.toMatch(
      /native-reference|search-setup|Hidden sizing table|row 147|column 5/u,
    );
  },
);

it("identifies an unmapped fallback column as unknown instead of naming a hidden column", () => {
  const notes = forceFallback("native-reference", false);
  expect(notes).toContain(
    'An alternative layout for "Wire and core schedule" could not be measured; the affected column was not identified.',
  );
  expect(notes).not.toMatch(
    /Hidden-only column|Hidden sizing table|row 147|column 5/u,
  );
});

it.each([Error, TypeError, RangeError])(
  "keeps unexpected %s type, identity and known row/column context",
  (ErrorType) => {
    const f = pruningFixture(ir),
      row = f.table.rows[0];
    if (!row) throw Error("Missing row");
    const error = new ErrorType("Unexpected wrapping error");
    vi.spyOn(wrapping, "wrapReportCell").mockImplementation(() => {
      throw error;
    });
    let caught: unknown;
    try {
      f.first.split(row.cells, "2", row.key);
    } catch (actual) {
      caught = actual;
    }
    expect(caught).toBe(error);
    expect(caught).toBeInstanceOf(ErrorType);
    expect(error.message).toContain(
      'Report "Wire and core schedule" (wires), row 2, column 1 "Conductor / label"',
    );
  },
);

it.each([Error, TypeError, RangeError])(
  "keeps unexpected setup %s type and marks unresolved cell context honestly",
  (ErrorType) => {
    const f = pruningFixture(ir),
      error = new ErrorType("Unexpected setup error");
    vi.spyOn(cells, "wireColumnProbe").mockImplementation(() => {
      throw error;
    });
    let caught: unknown;
    try {
      paginatedReportCells(f.ir, f.table, f.width, f.height, f.page, f.top);
    } catch (actual) {
      caught = actual;
    }
    expect(caught).toBe(error);
    expect(caught).toBeInstanceOf(ErrorType);
    expect(error.message).toContain(
      'Report "Wire and core schedule" (wires), row not identified, column not identified',
    );
  },
);
