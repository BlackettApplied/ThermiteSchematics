import { measureText } from "../text-metrics.js";
import type { DocumentationTable } from "@thermite/query";

export interface ReportCellContext {
  title: string;
  kind: DocumentationTable["kind"];
  row: string;
  column?: number;
  columnName?: string;
}

/** A measured layout constraint, rather than an unexpected programming error. */
export class ReportMeasurementError extends Error {
  constructor(
    message: string,
    readonly cell?: ReportCellContext,
    readonly detail = message,
  ) {
    super(message);
  }
}

const contextualErrors = new WeakSet<Error>();
export function reportCellContext(
  table: Pick<DocumentationTable, "title" | "kind" | "columns">,
  row: string,
  column?: number,
): ReportCellContext {
  const columnName = column === undefined ? undefined : table.columns[column];
  return {
    title: table.title,
    kind: table.kind,
    row,
    ...(column === undefined ? {} : { column }),
    ...(columnName === undefined ? {} : { columnName }),
  };
}

/** Preserve unexpected error identity/type while adding the known cell context.
 * Setup without a resolved cell says so rather than inventing a row or column. */
export function withReportContext(
  error: unknown,
  table: Pick<DocumentationTable, "title" | "kind" | "columns">,
  row: string,
  column?: number,
) {
  const cell = reportCellContext(table, row, column);
  const prefix = `Report ${JSON.stringify(cell.title)} (${cell.kind}), row ${row}, column ${column === undefined ? "not identified" : `${column + 1} ${cell.columnName === undefined ? "(name not identified)" : JSON.stringify(cell.columnName)}`}`;
  if (error instanceof ReportMeasurementError)
    return error.cell
      ? error
      : new ReportMeasurementError(
          `${prefix}: ${error.message}`,
          cell,
          error.detail,
        );
  if (error instanceof Error && !contextualErrors.has(error)) {
    error.message = `${prefix}: ${error.message}`;
    contextualErrors.add(error);
  }
  return error;
}

export interface ReportCellMetrics {
  count: number;
  ascent: number;
  descent: number;
}

export function reportLineMetrics(
  lines: string[],
  size: number,
  cache?: Map<string, ReturnType<typeof measureText>>,
  measured?: () => void,
): ReportCellMetrics {
  const metrics = lines.map((value) => {
    const hit = cache?.get(value);
    if (hit) return hit;
    measured?.();
    const result = measureText(value, size);
    cache?.set(value, result);
    return result;
  });
  return {
    count: lines.length,
    ascent: Math.max(0, ...metrics.map((m) => m.ascent)),
    descent: Math.max(0, ...metrics.map((m) => m.descent)),
  };
}

/** Preserve the emission formula and its floating-point operation order. */
export function reportRowHeight(
  count: number,
  ascent: number,
  descent: number,
  heading = false,
  headerNote?: string,
) {
  const lineHeight = Math.max(3.6, ascent + descent + 0.6);
  const baseline = Math.max(4, ascent + 1);
  return (
    (heading && headerNote ? 4 : 0) +
    Math.max(
      count * 3.6 + (heading ? 5 : 4),
      baseline + (count - 1) * lineHeight + descent + 1,
    )
  );
}
