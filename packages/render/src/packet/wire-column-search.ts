import type { DocumentationTable } from "@thermite/query";
import type { ReportPagination, ReportHeights } from "./report-paginator.js";
import { wireColumnArithmetic } from "./wire-column-arithmetic.js";
import { required } from "../presentation/util.js";
import { reportCells, wireColumnProbe } from "./report-cells.js";

export const WIRE_GRID_DIVISIONS = 12;
const NATIVE_COLUMNS = 5;
export const WIRE_SEARCH_CANDIDATES = candidateBound(WIRE_GRID_DIVISIONS);
function candidateBound(divisions: number) {
  let count = 1;
  for (let i = 1; i < NATIVE_COLUMNS; i++)
    count = (count * (divisions + i)) / i;
  return count + 1; // One weighted vector, then all C(divisions + 4, 4) shares.
}

export interface WireAllocationAttempt {
  widths: number[];
  pages: number | null;
  wrapLines: number | null;
  rowSteps: number | null;
  prunedAtPage?: number;
  pageLimit?: number;
  failure?: string;
}
export interface WireAllocationReceipt {
  format: "wire-column-search/1";
  title: string;
  rows: number;
  field: { width: number; height: number; top: number };
  cellSize: number;
  nativePages: number | null;
  bounds: { divisions: number; nativeColumns: number; maxCandidates: number };
  minimums: number[];
  locators: number[];
  candidates: WireAllocationAttempt[];
  selected: number | null;
  tier: "b" | "c";
}

function* shares(
  total: number,
  columns: number,
  prefix: number[] = [],
): Generator<number[]> {
  if (columns === 1) yield [...prefix, total];
  else
    for (let n = 0; n <= total; n++)
      yield* shares(total - n, columns - 1, [...prefix, n]);
}

function vectors(minimums: number[], locators: number[], width: number) {
  const slack =
    width - [...minimums, ...locators].reduce((sum, w) => sum + w, 0);
  if (slack < 0) return [];
  return [...shares(WIRE_GRID_DIVISIONS, NATIVE_COLUMNS)].map((share) => {
    const native = minimums.map(
      (w, i) =>
        w +
        (slack * required(share[i], "Missing width share")) /
          WIRE_GRID_DIVISIONS,
    );
    // Put floating-point residue in a field with positive slack, preserving minima.
    const receiver = share.findIndex((n) => n > 0);
    native[receiver] =
      required(native[receiver], "Missing width receiver") +
      width -
      [...native, ...locators].reduce((sum, w) => sum + w, 0);
    return [...native, ...locators];
  });
}

const vectorOrder = (a: number[], b: number[]) => {
  for (const [i, value] of a.entries()) {
    const other = required(b[i], "Missing comparison width");
    if (value !== other) return value - other;
  }
  return 0;
};
const scoreOrder = (a: WireAllocationAttempt, b: WireAllocationAttempt) =>
  (a.pages ?? Infinity) - (b.pages ?? Infinity) ||
  (a.wrapLines ?? Infinity) - (b.wrapLines ?? Infinity) ||
  vectorOrder(a.widths, b.widths);

export interface WirePagination {
  measured: (
    measured: ReturnType<typeof reportCells>,
    limit: number,
  ) => ReportPagination;
  heights: (measured: ReportHeights, limit: number) => ReportPagination;
}

function scoreCandidate(
  widths: number[],
  arithmetic: ReturnType<typeof wireColumnArithmetic>,
  paginate: WirePagination["heights"],
  limit: number,
) {
  const attempt: WireAllocationAttempt = {
    widths,
    pages: null,
    wrapLines: null,
    rowSteps: null,
  };
  try {
    const measured = arithmetic.candidate(widths),
      result = paginate(measured, limit),
      pages = result.pages;
    attempt.rowSteps = result.rowSteps;
    if (result.prunedAtPage !== undefined) {
      attempt.prunedAtPage = result.prunedAtPage;
      attempt.pageLimit = limit;
      return { attempt };
    }
    if (!Number.isFinite(pages)) {
      attempt.failure = "A header or body row exceeds fresh-sheet capacity";
      return { attempt };
    }
    attempt.pages = pages;
    return {
      attempt,
      wrapLines: measured.headerLines * pages + measured.bodyLines,
    };
  } catch (error) {
    attempt.failure =
      error instanceof Error ? error.message : "Candidate measurement failed";
    return { attempt };
  }
}

/** Enumerate the complete bounded grid, not just the first capacity-preserving
 * probe. Pages, printed wrap lines, then numeric vector order break ties. */
export function searchWireColumns(
  table: DocumentationTable,
  width: number,
  height: number,
  size: number,
  nativePages: number,
  paginate: WirePagination,
  top: number,
  probe: ReturnType<typeof wireColumnProbe>,
) {
  const locators = probe.widths.slice(5),
    minimums = probe.minimums.slice(0, NATIVE_COLUMNS);
  const receipt: WireAllocationReceipt = {
    format: "wire-column-search/1",
    title: table.title,
    rows: table.rows.length,
    field: { width, height, top },
    cellSize: size,
    nativePages: Number.isFinite(nativePages) ? nativePages : null,
    bounds: {
      divisions: WIRE_GRID_DIVISIONS,
      nativeColumns: NATIVE_COLUMNS,
      maxCandidates: WIRE_SEARCH_CANDIDATES,
    },
    minimums,
    locators,
    candidates: [],
    selected: null,
    tier: "c",
  };
  let bestPages = nativePages;
  const arithmetic = wireColumnArithmetic(probe, table),
    wrapTotals: (number | undefined)[] = [];
  const contenders: number[] = [];
  for (const widths of [probe.widths, ...vectors(minimums, locators, width)]) {
    if (receipt.candidates.length >= WIRE_SEARCH_CANDIDATES)
      throw Error("Wire allocation grid exceeded its bound");
    const scored = scoreCandidate(
      widths,
      arithmetic,
      paginate.heights,
      Math.min(nativePages, bestPages),
    );
    const attempt = scored.attempt;
    const index = receipt.candidates.push(attempt) - 1;
    wrapTotals[index] = scored.wrapLines;
    if (attempt.pages === null || attempt.pages > bestPages) continue;
    if (attempt.pages < bestPages) contenders.length = 0;
    bestPages = attempt.pages;
    contenders.push(index);
  }
  const selected = scoreTies(receipt, contenders, wrapTotals);
  const measured =
    selected === null
      ? undefined
      : verifyChoice(table, probe, receipt, selected, paginate);
  return { measured, receipt, work: { ...arithmetic.work, ...probe.work } };
}

/** Only final page ties need the secondary score; dominated receipts stay null. */
function scoreTies(
  receipt: WireAllocationReceipt,
  contenders: number[],
  totals: (number | undefined)[],
) {
  for (const index of contenders) {
    const attempt = required(receipt.candidates[index], "Missing contender");
    attempt.wrapLines = required(totals[index], "Missing contender wrap total");
    const previous =
      receipt.selected === null
        ? undefined
        : receipt.candidates[receipt.selected];
    if (!previous || scoreOrder(attempt, previous) < 0) {
      receipt.selected = index;
    }
  }
  if (receipt.selected !== null) receipt.tier = "b";
  return receipt.selected;
}

/** The selected vector always receives the ordinary full emission measurement.
 * Keep this assertion active in tests and production rather than trusting caches. */
function verifyChoice(
  table: DocumentationTable,
  probe: ReturnType<typeof wireColumnProbe>,
  receipt: WireAllocationReceipt,
  selected: number,
  paginate: WirePagination,
) {
  const chosen = required(
    receipt.candidates[selected],
    "Missing chosen vector",
  );
  const measured = probe.measure(chosen.widths),
    actual = paginate.measured(measured, Infinity);
  const wraps =
    measured.split(table.columns, "header").flat().length * actual.pages +
    table.rows.reduce(
      (n, row) => n + measured.split(row.cells, "probe", row.key).flat().length,
      0,
    );
  if (actual.pages !== chosen.pages || wraps !== chosen.wrapLines)
    throw Error(
      "Wire arithmetic score disagrees with full emission measurement",
    );
  return measured;
}
