import { required } from "../presentation/util.js";

export interface ReportPagination {
  pages: number;
  rowSteps: number;
  prunedAtPage?: number;
}

export interface ReportHeights {
  headerHeight: number;
  rowHeights: Float64Array;
  errors: ReadonlyMap<number, unknown>;
}

/** Arithmetic scores still visit rows in order through the emission paginator. */
export function reportHeightPagination(
  measured: ReportHeights,
  top: number,
  height: number,
  noteLines: number,
  pageLimit = Infinity,
): ReportPagination {
  const paginator = reportPaginator(
    top,
    height,
    measured.headerHeight,
    noteLines,
  );
  let rowSteps = 0;
  if (!paginator.headerFits) return { pages: Infinity, rowSteps };
  for (let i = 0; i < measured.rowHeights.length; i++) {
    const rowHeight = required(
      measured.rowHeights[i],
      "Missing precomputed row height",
    );
    if (Number.isNaN(rowHeight) && measured.errors.has(i))
      throw measured.errors.get(i);
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

/** Shared by allocation scoring and painted report emission. Keep absolute
 * coordinates: rounding at a page boundary must make the same decision. */
export function reportPaginator(
  top: number,
  height: number,
  headerHeight: number,
  noteLines: number,
) {
  const bottom = top + height - noteLines * 3.5 - 5;
  const start = top + 9 + headerHeight;
  let y = start,
    pages = 1;
  return {
    headerFits: headerHeight + 9 <= bottom - top,
    get pages() {
      return pages;
    },
    place(rowHeight: number) {
      if (rowHeight + headerHeight + 9 > bottom - top)
        return { kind: "overflow" as const, y };
      const newPage = y + rowHeight > bottom;
      if (newPage) {
        pages++;
        y = start;
      }
      const position = y;
      y += rowHeight;
      return {
        kind: newPage ? ("new-page" as const) : ("row" as const),
        y: position,
      };
    },
  };
}
