import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { wireColumnProbe } from "../src/packet/report-cells.js";
import { wireColumnArithmetic } from "../src/packet/wire-column-arithmetic.js";
import { searchWireColumns } from "../src/packet/wire-column-search.js";
import { reportPaginations } from "../src/packet/report-layout.js";
import { reportHeightPagination } from "../src/packet/report-paginator.js";
import { ReportMeasurementError } from "../src/packet/report-measurement.js";
import {
  arithmeticFixture,
  independentHeight,
} from "./wire-column-arithmetic-fixture.js";
import {
  countedSearch,
  pruningFixture,
} from "./wire-column-pruning-fixture.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  ir = compiled.ir;
});

it.each(["glyphs", "hyphens", "boundary"] as const)(
  "matches raw glyph metrics and every row-height float for %s",
  (kind) => {
    const f = arithmeticFixture(ir, kind),
      result = countedSearch(f);
    const reference = wireColumnProbe(
      f.ir,
      f.table,
      f.width,
      f.page,
      f.first.cellSize,
    );
    const optimized = wireColumnArithmetic(
      wireColumnProbe(f.ir, f.table, f.width, f.page, f.first.cellSize),
      f.table,
    );
    let compared = 0,
      hyphens = 0;
    for (const candidate of result.receipt.candidates) {
      const measured = reference.measure(candidate.widths);
      let headers: string[][];
      try {
        headers = measured.split(f.table.columns, "header");
      } catch (error) {
        expect(() => optimized.candidate(candidate.widths)).toThrow(
          error instanceof Error ? error.message : undefined,
        );
        continue;
      }
      const actual = optimized.candidate(candidate.widths),
        header = measured.geometry(headers, true);
      expect(header.height).toBe(
        independentHeight(headers, f.first.cellSize, true, header.headerNote),
      );
      expect(actual.headerHeight).toBe(header.height);
      hyphens += headers.flat().filter((s) => s.endsWith("-")).length;
      for (const [row, source] of f.table.rows.entries()) {
        const cells = measured.split(source.cells, "probe", source.key);
        const expected = independentHeight(cells, f.first.cellSize);
        expect(measured.geometry(cells).height).toBe(expected);
        expect(actual.rowHeights[row]).toBe(expected);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
    if (kind === "hyphens") expect(hyphens).toBeGreaterThan(0);
    if (kind === "boundary")
      expect(result.receipt.candidates[0]?.pages).toBe(1);
  },
);

it("preserves absolute floating-point additions at an exact page boundary", () => {
  const heights = {
    headerHeight: 8.6,
    rowHeights: new Float64Array(6).fill(7.6),
    errors: new Map(),
  };
  const actual = reportHeightPagination(heights, 31, 68.19999999999999, 0);
  expect(actual).toEqual({ pages: 1, rowSteps: 6 });
  let sequential = 31 + 9 + 8.6,
    relative = 0;
  for (const height of heights.rowHeights) {
    sequential += height;
    relative += height;
  }
  expect(sequential).toBe(94.19999999999999);
  expect(31 + 9 + 8.6 + relative).toBe(94.2);
});

it("defers a later measurement error until its row is actually visited", () => {
  const error = new ReportMeasurementError("Later row fails");
  const measured = {
    headerHeight: 8.6,
    rowHeights: new Float64Array([7.6, 7.6, NaN]),
    errors: new Map([[2, error]]),
  };
  expect(reportHeightPagination(measured, 31, 31, 0, 1)).toEqual({
    pages: 2,
    rowSteps: 2,
    prunedAtPage: 2,
  });
  expect(() => reportHeightPagination(measured, 31, 31, 0)).toThrow(
    "Later row fails",
  );
});

it("records one candidate measurement failure and continues the search", () => {
  const f = pruningFixture(ir);
  const run = () => {
    const probe = wireColumnProbe(
      f.ir,
      f.table,
      f.width,
      f.page,
      f.first.cellSize,
    );
    let first = true;
    return searchWireColumns(
      f.table,
      f.width,
      f.height,
      f.first.cellSize,
      f.nativePages,
      reportPaginations(f.table, f.width, f.height, f.top),
      f.top,
      {
        ...probe,
        validate(widths) {
          if (first) {
            first = false;
            throw new ReportMeasurementError("Synthetic candidate failure");
          }
          probe.validate(widths);
        },
      },
    );
  };
  expect(run).not.toThrow();
  const actual = run();
  expect(actual.receipt.candidates[0]?.failure).toBe(
    "Synthetic candidate failure",
  );
  expect(actual.receipt.candidates[0]?.pages).toBeNull();
  expect(actual.receipt.selected).toBe(1391);
});

it("checks the chosen arithmetic page and wrap scores against full emission", () => {
  const f = pruningFixture(ir);
  const probe = wireColumnProbe(
    f.ir,
    f.table,
    f.width,
    f.page,
    f.first.cellSize,
  );
  expect(() =>
    searchWireColumns(
      f.table,
      f.width,
      f.height,
      f.first.cellSize,
      f.nativePages,
      reportPaginations(f.table, f.width, f.height, f.top),
      f.top,
      {
        ...probe,
        cell(column, width, row) {
          const measured = probe.cell(column, width, row);
          return row === undefined && column === 5
            ? { ...measured, count: measured.count + 1 }
            : measured;
        },
      },
    ),
  ).toThrow("Wire arithmetic score disagrees with full emission measurement");
});
