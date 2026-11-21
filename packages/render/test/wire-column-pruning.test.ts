import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import * as cellModule from "../src/packet/report-cells.js";
import {
  ReportMeasurementError,
  reportCellContext,
} from "../src/packet/report-measurement.js";
import { tableDrafts } from "../src/packet/reports.js";
import { parseSvg } from "./off-view-fixtures.js";
import {
  paginatedReportCells,
  reportPagination,
} from "../src/packet/report-layout.js";
import {
  MACHINE_VECTORS,
  countedSearch,
  largeWireSchedule,
  measureVector,
  pruningFixture,
} from "./wire-column-pruning-fixture.js";

let machine: ElectricalIr, conveyor: ElectricalIr;
beforeAll(async () => {
  for (const name of ["machine-demo", "conveyor-line"]) {
    const c = await compileProject(`examples/${name}`);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    if (name === "machine-demo") machine = c.ir;
    else conveyor = c.ir;
  }
});
afterEach(() => vi.restoreAllMocks());

it("remeasures fixed vectors from scratch with an independent cursor and catches self-consistent receipt errors", () => {
  const f = pruningFixture(machine),
    result = countedSearch(f);
  expect(result.receipt.selected).toBe(1391);
  for (const vector of MACHINE_VECTORS) {
    const actual = measureVector(f, vector.widths);
    expect(actual.pages).toBe(vector.pages);
    expect(actual.wrapLines).toBe(vector.lines);
    const candidate = result.receipt.candidates[vector.index];
    if (!candidate) throw Error("Missing fixed vector");
    expect(candidate.widths).toEqual(vector.widths);
    if (candidate.prunedAtPage !== undefined) {
      expect(candidate.pages).toBeNull();
      expect(candidate.prunedAtPage).toBeGreaterThan(
        candidate.pageLimit ?? Infinity,
      );
      expect(candidate.prunedAtPage).toBeLessThanOrEqual(actual.pages);
      expect(candidate.wrapLines).toBeNull();
    } else {
      expect(candidate.pages).toBe(actual.pages);
      expect(candidate.wrapLines).toBe(actual.wrapLines);
    }
  }
  expect(result.measured?.widths).toEqual(MACHINE_VECTORS[2]?.widths);
});

it("completes an equal-page candidate and stops only after crossing the bound", () => {
  const f = pruningFixture(machine),
    vector = MACHINE_VECTORS[2];
  if (!vector) throw Error("Missing independent vector");
  const { measured } = measureVector(f, vector.widths);
  const count = (limit: number) =>
    reportPagination(f.table, measured, f.width, f.height, f.top, limit);
  expect(count(6)).toEqual({ pages: 6, rowSteps: 61 });
  const stopped = count(5);
  expect(stopped.pages).toBe(6);
  expect(stopped.prunedAtPage).toBe(6);
  expect(stopped.rowSteps).toBeLessThan(61);
});

it("tightens the native bound with the incumbent and scores only final page ties", () => {
  const f = pruningFixture(conveyor),
    result = countedSearch(f),
    receipt = result.receipt;
  const winner =
    receipt.selected === null
      ? undefined
      : receipt.candidates[receipt.selected];
  expect(f.nativePages).toBe(6);
  expect(winner?.pages).toBe(5);
  expect(receipt.candidates.some((c) => c.pageLimit === 5)).toBe(true);
  expect(receipt.candidates.some((c) => c.pages === 6)).toBe(true);
  for (const candidate of receipt.candidates) {
    if (candidate.pages !== 5) expect(candidate.wrapLines).toBeNull();
    else expect(candidate.wrapLines).not.toBeNull();
  }
  expect(result.wrapRows).toBe(f.table.rows.length);
  expect(result.emissionRows).toBe(f.table.rows.length);
});

it("bounds actual paginator work for 1,500 rows that reach tier (b)", () => {
  const f = pruningFixture(largeWireSchedule(machine), 300);
  expect(f.table.rows).toHaveLength(1500);
  expect(f.first.inlineLocations).toBe(true);
  const result = countedSearch(f),
    receipt = result.receipt;
  expect(receipt.tier).toBe("b");
  expect(receipt.candidates).toHaveLength(1821);
  expect(result.rowSteps).toBe(1_964_661);
  expect(result.emissionRows).toBe(1500);
  expect(result.wrapRows).toBe(1500);
  expect(result.work.heightRows).toBe(2_731_500);
  expect(result.work.logicalCells).toBe(207_138);
  expect(result.work.cellMeasurements).toBe(50_107);
  expect(result.actualCellMeasurements).toBe(result.work.cellMeasurements);
  expect(result.work.wrapCalls).toBe(59_000);
  expect(result.work.lineMeasurements).toBe(3307);
  expect(result.work.widthLevels).toEqual([31, 37, 32, 22, 14, 1, 1]);
  expect(result.rowSteps).toBe(
    receipt.candidates.reduce((n, c) => n + (c.rowSteps ?? 0), 0),
  );
  expect(
    receipt.candidates.filter((c) => c.prunedAtPage !== undefined).length,
  ).toBeGreaterThan(1500);
  expect(result.measured?.inlineLocations).toBe(false);
});

it.each(["native-reference", "search-setup"] as const)(
  "retains the measured stacked layout when %s throws",
  (stage) => {
    const f = pruningFixture(machine);
    if (stage === "native-reference") {
      const original = cellModule.reportCells;
      vi.spyOn(cellModule, "reportCells").mockImplementation((...args) => {
        if (args[4] === "legacy")
          throw new ReportMeasurementError("Synthetic reference failure");
        return original(...args);
      });
    } else {
      vi.spyOn(cellModule, "wireColumnProbe").mockImplementation(() => {
        throw new ReportMeasurementError("Synthetic probe failure");
      });
    }
    const measure = () =>
      paginatedReportCells(f.ir, f.table, f.width, f.height, f.page, f.top);
    expect(measure).not.toThrow();
    const result = measure();
    expect(result.inlineLocations).toBe(true);
    expect(result.widths).toEqual(f.first.widths);
    expect(result.cellSize).toBe(f.first.cellSize);
    expect(result.allocationReceipt).toBeUndefined();
    expect(result.allocationFallback).toEqual({
      stage,
      reason:
        stage === "native-reference"
          ? "Synthetic reference failure"
          : "Synthetic probe failure",
    });
    expect(
      result.split(f.table.rows[0]?.cells ?? [], "test", f.table.rows[0]?.key),
    ).toEqual(
      f.first.split(f.table.rows[0]?.cells ?? [], "test", f.table.rows[0]?.key),
    );
  },
);

it("refuses an initial measurement error rather than claiming a stacked fallback", () => {
  const f = pruningFixture(machine);
  vi.spyOn(cellModule, "reportCells").mockImplementation(() => {
    throw Error("Synthetic initial failure");
  });
  expect(() =>
    paginatedReportCells(f.ir, f.table, f.width, f.height, f.page, f.top),
  ).toThrow("Synthetic initial failure");
});

it.each([Error, TypeError, RangeError])(
  "rethrows unexpected setup %s errors",
  (ErrorType) => {
    const f = pruningFixture(machine);
    vi.spyOn(cellModule, "wireColumnProbe").mockImplementation(() => {
      throw new ErrorType("Unexpected setup bug");
    });
    expect(() =>
      paginatedReportCells(f.ir, f.table, f.width, f.height, f.page, f.top),
    ).toThrow("Unexpected setup bug");
  },
);

it("paints an expected setup fallback as a visible report diagnostic", () => {
  const f = pruningFixture(machine);
  vi.spyOn(cellModule, "wireColumnProbe").mockImplementation(() => {
    throw new ReportMeasurementError(
      "Synthetic measured constraint",
      reportCellContext(f.table, "header", 4),
    );
  });
  const result = tableDrafts(f.ir, f.table, undefined, f.page);
  if (!result.ok) throw Error(result.error.message);
  const svg = parseSvg(
    `<svg>${result.value.map((d) => d.content).join("")}</svg>`,
  );
  const notes = [...svg.querySelectorAll("[data-report-note]")]
    .map((n) => n.textContent)
    // Notes use fixed character chunks; do not insert spaces into their text.
    .join("");
  expect(notes).toContain(
    'An alternative layout for "Wire and core schedule" could not fit column "Assignment": Synthetic measured constraint',
  );
  expect(notes).not.toMatch(
    /native-reference|search-setup|Wire allocation fallback/u,
  );
});
