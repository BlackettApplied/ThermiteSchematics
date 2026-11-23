import type { ElectricalIr } from "@thermite/compiler";
import type { DocumentationTable } from "@thermite/query";
import type { PaperPage } from "./types.js";
import { reportCells, wireColumnProbe } from "./report-cells.js";
import { reportNoteLines } from "./report-note-wrapping.js";
import { fieldTextWidth } from "./svg.js";
import { denserAssemblyCells } from "./report-assembly-columns.js";
import {
  reportPaginator,
  reportHeightPagination,
  type ReportPagination,
} from "./report-paginator.js";
import {
  ReportMeasurementError,
  withReportContext,
} from "./report-measurement.js";
import {
  searchWireColumns,
  type WireAllocationReceipt,
  type WirePagination,
} from "./wire-column-search.js";

/** Prefer real columns. Extra wrapping is allowed only at native page capacity. */
export function paginatedReportCells(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  width: number,
  height: number,
  page: PaperPage,
  top = 0,
): ReturnType<typeof reportCells> & {
  allocationReceipt?: WireAllocationReceipt;
  allocationFallback?: {
    stage: "native-reference" | "search-setup";
    reason: string;
    column?: string;
    detail?: string;
  };
} {
  const first = reportCells(ir, table, width, page);
  if (table.kind === "assemblies")
    return denserAssemblyCells(ir, table, width, page, first, (cells) =>
      reportPageCount(table, cells, width, height, top),
    );
  if (!first.inlineLocations) return first;
  let count: number, probe: ReturnType<typeof wireColumnProbe>;
  let stage: "native-reference" | "search-setup" = "native-reference";
  try {
    const native = nativeWireTable(table);
    const baseline = reportCells(ir, native, width, page, "legacy");
    count = reportPageCount(native, baseline, width, height, top);
    stage = "search-setup";
    probe = wireColumnProbe(ir, table, width, page, first.cellSize);
  } catch (error) {
    if (!(error instanceof ReportMeasurementError))
      throw withReportContext(error, table, "not identified");
    return {
      ...first,
      allocationFallback: reportFallback(table, error, stage),
    };
  }
  const searched = searchWireColumns(
    table,
    width,
    height,
    first.cellSize,
    count,
    reportPaginations(table, width, height, top),
    top,
    probe,
  );
  return {
    ...(searched.measured ?? first),
    allocationReceipt: searched.receipt,
  };
}

function nativeWireTable(table: DocumentationTable) {
  return {
    ...table,
    columns: table.columns.slice(0, 5),
    widths: [0.15, 0.24, 0.24, 0.18, 0.19],
    rows: table.rows.map((r) => ({ ...r, cells: r.cells.slice(0, 5) })),
    notes: table.notes.filter(
      (note) =>
        !note.startsWith(
          "Sheet.zone locates the native endpoint in this packet;",
        ),
    ),
  };
}

function reportFallback(
  table: DocumentationTable,
  error: ReportMeasurementError,
  stage: "native-reference" | "search-setup",
) {
  const cell = error.cell;
  const column =
    cell?.column === undefined ? undefined : table.columns[cell.column];
  const matched = column !== undefined && column === cell?.columnName;
  return {
    stage,
    reason: error.message,
    ...(matched ? { column, detail: error.detail } : {}),
  };
}

/** Paired arithmetic/emission paths share the same frame and note reservation. */
export function reportPaginations(
  table: DocumentationTable,
  width: number,
  height: number,
  top = 0,
): WirePagination {
  const noteLines = table.notes.flatMap((note) =>
    reportNoteLines(note, fieldTextWidth(width)),
  ).length;
  return {
    measured: (measured, limit) =>
      reportPagination(table, measured, width, height, top, limit),
    heights: (measured, limit) =>
      reportHeightPagination(measured, top, height, noteLines, limit),
  };
}

/** Same row, header, title and note capacity used by the report paginator. */
export function reportPageCount(
  table: DocumentationTable,
  measured: ReturnType<typeof reportCells>,
  width: number,
  height: number,
  top = 0,
) {
  return reportPagination(table, measured, width, height, top).pages;
}

/** Page counts only increase. Crossing the limit proves this vector cannot win;
 * the returned pruned page is a lower bound, not a completed measurement. */
export function reportPagination(
  table: DocumentationTable,
  measured: ReturnType<typeof reportCells>,
  width: number,
  height: number,
  top = 0,
  pageLimit = Infinity,
): ReportPagination {
  const notes = table.notes.flatMap((note) =>
    reportNoteLines(note, fieldTextWidth(width)),
  );
  const header = measured.geometry(
    measured.split(table.columns, "header"),
    true,
  ).height;
  const paginator = reportPaginator(top, height, header, notes.length);
  let rowSteps = 0;
  if (!paginator.headerFits) return { pages: Infinity, rowSteps };
  for (const row of table.rows) {
    const rowHeight = measured.geometry(
      measured.split(row.cells, "probe", row.key),
    ).height;
    rowSteps++;
    if (paginator.place(rowHeight).kind === "overflow")
      return { pages: Infinity, rowSteps };
    if (paginator.pages > pageLimit)
      return {
        pages: paginator.pages,
        rowSteps,
        prunedAtPage: paginator.pages,
      };
  }
  return { pages: paginator.pages, rowSteps };
}
