import type { DocumentationTable } from "@thermite/query";
import { measureText } from "../text-metrics.js";
import { distributeReportWidths } from "./report-column-widths.js";
import type { WireColumnAllocation } from "./wire-report-columns.js";
import { ReportMeasurementError } from "./report-measurement.js";

interface MeasuredCells {
  split(cells: readonly string[], row: string, key?: string): string[][];
  geometry(cells: string[][], heading?: boolean): { height: number };
}

/** Reserve state words before distributing surplus, at the existing em only.
 * Preserve every cell's line capacity and row/header height. */
export function preferWholeStateWords<T extends MeasuredCells>(
  table: DocumentationTable,
  width: number,
  size: number,
  allocation: WireColumnAllocation,
  standard: T,
  measure: (candidate: WireColumnAllocation) => T,
): T {
  if (allocation.error || allocation.inlineLocations) return standard;
  if (!table.columns.some((column) => /\b(?:state|status)\b/iu.test(column)))
    return standard;
  const minimums = allocation.minimums.map((minimum, column) => {
    if (!/\b(?:state|status)\b/iu.test(table.columns[column] ?? ""))
      return minimum;
    const words = table.rows.flatMap(
      (row) => (row.cells[column] ?? "").match(/\S+/gu) ?? [],
    );
    return Math.max(
      minimum,
      ...words.map((word) => measureText(word, size).width + 4.02),
    );
  });
  if (minimums.reduce((sum, value) => sum + value, 0) > width) return standard;
  const widths = distributeReportWidths(minimums, table.widths, width);
  if (widths.every((w, i) => w === allocation.widths[i])) return standard;
  try {
    const candidate = measure({ ...allocation, widths, minimums });
    const fits = (cells: readonly string[], key?: string) => {
      const heading = key === undefined;
      const before = standard.split(cells, heading ? "header" : "probe", key);
      const after = candidate.split(cells, heading ? "header" : "probe", key);
      if (
        after.length !== before.length ||
        after.some((lines, i) => lines.length > (before[i]?.length ?? 0))
      )
        return false;
      return (
        candidate.geometry(after, heading).height <=
        standard.geometry(before, heading).height
      );
    };
    return fits(table.columns) &&
      table.rows.every((row) => fits(row.cells, row.key))
      ? candidate
      : standard;
  } catch (error) {
    if (!(error instanceof ReportMeasurementError)) throw error;
    return standard;
  }
}
