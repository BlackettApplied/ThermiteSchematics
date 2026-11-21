import type { DocumentationTable } from "@thermite/query";
import { required } from "../presentation/util.js";
import { measureText } from "../text-metrics.js";
import {
  reportColumns,
  reportHeaderParts,
  type ReportName,
} from "./report-column-widths.js";
import type { ReportIdentifiers } from "./report-identifiers.js";
import { wrapReportCell } from "./report-wrapping.js";
import {
  ReportMeasurementError,
  withReportContext,
} from "./report-measurement.js";

const nativeWeights = [0.15, 0.24, 0.24, 0.18, 0.19];
export type WireColumnAllocation = ReturnType<typeof reportColumns> & {
  inlineLocations?: boolean;
  nativeFits?: boolean;
};

/** Location columns get their measured content, rather than a table percentage.
 * Every existing field and header retains its baseline line-count capacity. */
export function wireReportColumns(
  table: DocumentationTable,
  width: number,
  size: number,
  names: readonly ReportName[],
  identifiers: ReportIdentifiers,
  mode?: "columns" | "legacy",
): WireColumnAllocation {
  if (mode === "legacy")
    return reportColumns(table, width, size, names, identifiers, [], 1);
  const standard = reportColumns(table, width, size, names, identifiers);
  if (table.kind !== "wires" || table.columns.length !== 7) return standard;
  const native = {
    ...table,
    columns: table.columns.slice(0, 5),
    widths: nativeWeights,
    rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice(0, 5) })),
  };
  // The old allocator used adaptive 1–2 mm insets. Its actual line counts
  // equal the compact 1 mm counts; reserve those counts at the restored 2 mm.
  const baseline = reportColumns(
    native,
    width,
    size,
    names,
    identifiers,
    [],
    1,
  );
  if (baseline.error) return { ...standard, nativeFits: false };
  const locations = locatorWidths(table, size);
  if (mode === "columns")
    return wrappingColumns(native, width, size, names, identifiers, locations);
  const minimum = baseline.widths.map((w, column) =>
    fieldMinimum(
      native,
      column,
      w,
      size,
      names,
      identifiers,
      baseline.hyphenatedColumns[column] ?? false,
    ),
  );
  const inline = inlineColumns(baseline, minimum, locations, width);
  if (standard.error) return inline;
  const requiredWidths = [...minimum, ...locations];
  const free = width - requiredWidths.reduce((sum, w) => sum + w, 0);
  if (free < 0) return inline;
  return {
    ...standard,
    nativeFits: true,
    hyphenatedColumns: [...baseline.hyphenatedColumns, false, false],
    hyphenate: baseline.hyphenate,
    padding: 2,
    widths: [
      ...minimum.map(
        (w, i) =>
          w + free * required(nativeWeights[i], "Missing wire column weight"),
      ),
      ...locations,
    ],
  };
}

function wrappingColumns(
  native: DocumentationTable,
  width: number,
  size: number,
  names: readonly ReportName[],
  identifiers: ReportIdentifiers,
  locations: number[],
): WireColumnAllocation {
  const allocation = reportColumns(
    native,
    width - locations.reduce((sum, w) => sum + w, 0),
    size,
    names,
    identifiers,
    [],
    2,
  );
  return {
    ...allocation,
    nativeFits: true,
    widths: [...allocation.widths, ...locations],
    hyphenatedColumns: [...allocation.hyphenatedColumns, false, false],
  };
}

function inlineColumns(
  baseline: ReturnType<typeof reportColumns>,
  native: number[],
  locations: number[],
  width: number,
): WireColumnAllocation {
  const minimum = native.map((w, i) =>
    i === 1 || i === 2
      ? Math.max(w, required(locations[i - 1], "Missing locator minimum"))
      : w,
  );
  const free = width - minimum.reduce((sum, w) => sum + w, 0);
  const widths = minimum.map(
    (w, i) =>
      w +
      Math.max(0, free) * required(nativeWeights[i], "Missing native weight"),
  );
  return {
    ...baseline,
    nativeFits: true,
    inlineLocations: true,
    padding: 2,
    error: free < 0,
    minimumWidth: width - free,
    minimums: minimum,
    widths: [
      ...widths,
      required(widths[1], "Missing first endpoint width"),
      required(widths[2], "Missing second endpoint width"),
    ],
    hyphenatedColumns: [...baseline.hyphenatedColumns, false, false],
  };
}

function locatorWidths(table: DocumentationTable, size: number) {
  return [5, 6].map(
    (column) =>
      Math.max(
        measureText("not drawn", size).width,
        ...table.rows.map(
          (row) =>
            measureText(
              required(row.cells[column], "Missing native wire cell"),
              size,
            ).width,
        ),
        ...required(table.columns[column], "Missing native wire header")
          .split(/\s+/u)
          .map((word) => measureText(word, size).width),
      ) + 4.02,
  );
}

function fieldMinimum(
  table: DocumentationTable,
  column: number,
  originalWidth: number,
  size: number,
  names: readonly ReportName[],
  identifiers: ReportIdentifiers,
  hyphenated: boolean,
) {
  const header = required(table.columns[column], "Missing native wire header");
  const wrapHeader = (width: number) => {
    try {
      return wireHeaderLines(header, width, size, hyphenated);
    } catch (error) {
      throw withReportContext(error, table, "header", column);
    }
  };
  const rows = table.rows.map((row, index) => ({
    row: String(index + 1),
    text: required(row.cells[column], "Missing native wire cell"),
    ids: identifiers.get(row.key)?.[column] ?? [],
  }));
  const wrap = (row: (typeof rows)[number], width: number, inset = 4.01) => {
    try {
      return wrapReportCell(row.text, width - inset, size, names, row.ids)
        .length;
    } catch (error) {
      throw withReportContext(error, table, row.row, column);
    }
  };
  const counts = rows.map((row) => wrap(row, originalWidth, 2.01));
  const headerLines = wrapHeader(originalWidth - 2.01);
  let low = 4.02,
    high = originalWidth + 2;
  for (let step = 0; step < 18; step++) {
    const mid = (low + high) / 2;
    let fits = false;
    try {
      fits =
        wrapHeader(mid - 4.01) <= headerLines &&
        rows.every(
          (row, i) =>
            wrap(row, mid) <= required(counts[i], "Missing native line count"),
        );
    } catch (error) {
      if (!(error instanceof ReportMeasurementError)) throw error;
      /* An indivisible native token establishes a real minimum. */
    }
    if (fits) high = mid;
    else low = mid;
  }
  return high + 0.02;
}

function wireHeaderLines(
  header: string,
  width: number,
  size: number,
  hyphenated: boolean,
) {
  let lines = 1,
    line = "";
  for (const word of header.split(/\s+/u)) {
    if (measureText(word, size).width > width) {
      const parts = hyphenated && reportHeaderParts(word, width, size);
      if (!parts) throw new ReportMeasurementError("Header word cannot fit");
      if (line) lines++;
      lines += parts.length - 1;
      line = required(parts.at(-1), "Missing header part");
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (measureText(next, size).width <= width) line = next;
    else {
      lines++;
      line = word;
    }
  }
  return lines;
}
