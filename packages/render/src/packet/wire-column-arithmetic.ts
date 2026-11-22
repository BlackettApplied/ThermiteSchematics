import type { DocumentationTable } from "@thermite/query";
import type { wireColumnProbe } from "./report-cells.js";
import type { ReportCellMetrics } from "./report-measurement.js";
import { reportRowHeight } from "./report-measurement.js";
import type { ReportHeights } from "./report-paginator.js";
import { required } from "../presentation/util.js";

type Probe = ReturnType<typeof wireColumnProbe>;
type Cell = { metrics: ReportCellMetrics } | { error: unknown };
interface Column {
  header: Cell;
  counts: Uint32Array;
  ascents: Float64Array;
  descents: Float64Array;
  errors: Map<number, unknown>;
}
export interface WireArithmeticWork {
  logicalCells: number;
  cellMeasurements: number;
  heightRows: number;
  widthLevels: number[];
}

function rowGroups(probe: Probe, rows: number, column: number) {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows; i++) {
    const key = probe.cellKey(column, i),
      existing = groups.get(key);
    if (existing) existing.push(i);
    else groups.set(key, [i]);
  }
  return [...groups.values()];
}

function cell(probe: Probe, column: number, width: number, row?: number): Cell {
  try {
    return { metrics: probe.cell(column, width, row) };
  } catch (error) {
    return { error };
  }
}

function measureColumn(
  probe: Probe,
  column: number,
  width: number,
  groups: number[][],
  rows: number,
  work: WireArithmeticWork,
): Column {
  const result: Column = {
    header: cell(probe, column, width),
    counts: new Uint32Array(rows),
    ascents: new Float64Array(rows),
    descents: new Float64Array(rows),
    errors: new Map(),
  };
  work.logicalCells += rows + 1;
  work.cellMeasurements += groups.length + 1;
  for (const indices of groups) {
    const measured = cell(probe, column, width, indices[0]);
    for (const row of indices) {
      if ("error" in measured) result.errors.set(row, measured.error);
      else {
        result.counts[row] = measured.metrics.count;
        result.ascents[row] = measured.metrics.ascent;
        result.descents[row] = measured.metrics.descent;
      }
    }
  }
  return result;
}

function headerMetrics(columns: Column[], note?: string) {
  let count = 0,
    ascent = 0,
    descent = 0,
    lines = 0;
  for (const column of columns) {
    if ("error" in column.header) throw column.header.error;
    const m = column.header.metrics;
    count = Math.max(count, m.count);
    ascent = Math.max(ascent, m.ascent);
    descent = Math.max(descent, m.descent);
    lines += m.count;
  }
  return { height: reportRowHeight(count, ascent, descent, true, note), lines };
}

function rowHeights(columns: Column[], rows: number) {
  const heights = new Float64Array(rows),
    errors = new Map<number, unknown>();
  let lines = 0;
  for (let row = 0; row < rows; row++) {
    let count = 0,
      ascent = 0,
      descent = 0;
    for (const column of columns) {
      if (column.errors.has(row)) {
        errors.set(row, column.errors.get(row));
        break;
      }
      const cells = required(column.counts[row], "Missing cell line count");
      count = Math.max(count, cells);
      ascent = Math.max(
        ascent,
        required(column.ascents[row], "Missing cell ascent"),
      );
      descent = Math.max(
        descent,
        required(column.descents[row], "Missing cell descent"),
      );
      lines += cells;
    }
    heights[row] = errors.has(row)
      ? NaN
      : reportRowHeight(count, ascent, descent);
  }
  return { heights, errors, lines };
}

/** Cache exact physical widths, including residue variants of a grid level.
 * Equal text/identifier cells share work; source row order remains unchanged. */
export function wireColumnArithmetic(probe: Probe, table: DocumentationTable) {
  const rows = table.rows.length;
  const groups = table.columns.map((_, column) =>
    rowGroups(probe, rows, column),
  );
  const cache = table.columns.map(() => new Map<number, Column>());
  const work: WireArithmeticWork = {
    logicalCells: 0,
    cellMeasurements: 0,
    heightRows: 0,
    widthLevels: table.columns.map(() => 0),
  };
  return {
    work,
    candidate(
      widths: number[],
    ): ReportHeights & { headerLines: number; bodyLines: number } {
      probe.validate(widths);
      const columns = widths.map((width, column) => {
        const values = required(cache[column], "Missing column cache");
        const found = values.get(width);
        if (found) return found;
        const measured = measureColumn(
          probe,
          column,
          width,
          required(groups[column], "Missing column groups"),
          rows,
          work,
        );
        values.set(width, measured);
        work.widthLevels[column] = (work.widthLevels[column] ?? 0) + 1;
        return measured;
      });
      const header = headerMetrics(columns, probe.headerNote);
      const body = rowHeights(columns, rows);
      work.heightRows += rows;
      return {
        headerHeight: header.height,
        rowHeights: body.heights,
        errors: body.errors,
        headerLines: header.lines,
        bodyLines: body.lines,
      };
    },
  };
}
