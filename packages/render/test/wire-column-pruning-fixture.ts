import type { ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, type DocumentationTable } from "@thermite/query";
import { reportCells, wireColumnProbe } from "../src/packet/report-cells.js";
import { normalizePaperPage } from "../src/packet/page.js";
import {
  reportPageCount,
  reportPagination,
} from "../src/packet/report-layout.js";
import { searchWireColumns } from "../src/packet/wire-column-search.js";
import { reportNoteLines } from "../src/packet/report-note-wrapping.js";
import { reportHeightPagination } from "../src/packet/report-paginator.js";

export const MACHINE_VECTORS = [
  {
    index: 0,
    pages: 7,
    lines: 551,
    widths: [
      28.747300000000003, 42.69489882352941, 42.69489882352941,
      32.021174117647064, 33.800128235294125, 21.7208, 21.7208,
    ],
  },
  {
    index: 1390,
    pages: 6,
    lines: 505,
    widths: [
      52.32687333333331, 28.119573333333335, 34.014466666666664,
      36.51315333333333, 28.984333333333336, 21.7208, 21.7208,
    ],
  },
  {
    index: 1391,
    pages: 6,
    lines: 501,
    widths: [
      52.32687333333331, 28.119573333333335, 34.014466666666664,
      42.40804666666666, 23.089440000000003, 21.7208, 21.7208,
    ],
  },
];

export function largeWireSchedule(source: ElectricalIr) {
  const ir = structuredClone(source);
  ir.jumpers = [];
  ir.cables = [];
  ir.cableConductors = [];
  ir.wires = Array.from({ length: 1500 }, (_, i) => {
    const wire = source.wires[i % source.wires.length];
    if (!wire) throw Error("Missing synthetic wire seed");
    return {
      ...wire,
      uid: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
      designation: `W${i}`,
    };
  });
  return ir;
}

export function pruningFixture(ir: ElectricalIr, height = 132.9) {
  const normalized = normalizePaperPage({
    size: "a3",
    orientation: "portrait",
  });
  if (!normalized.ok) throw Error(normalized.error.message);
  const table = buildDocumentation(
    ir,
    { format: "documentation-view-request/0.1", kind: "wires" },
    {},
  );
  const native: DocumentationTable = {
    ...table,
    columns: table.columns.slice(0, 5),
    widths: [0.15, 0.24, 0.24, 0.18, 0.19],
    rows: table.rows.map((r) => ({ ...r, cells: r.cells.slice(0, 5) })),
    notes: table.notes.filter(
      (n) =>
        !n.startsWith("Sheet.zone locates the native endpoint in this packet;"),
    ),
  };
  const page = normalized.value,
    width = 223.39999999999998,
    top = 31;
  const first = reportCells(ir, table, width, page);
  const reference = reportCells(ir, native, width, page, "legacy");
  const nativePages = reportPageCount(native, reference, width, height, top);
  return { ir, table, page, width, height, top, first, nativePages };
}

export function countedSearch(f: ReturnType<typeof pruningFixture>) {
  const counts = {
    rowSteps: 0,
    bodySplits: 0,
    emissionRows: 0,
    cellMeasurements: 0,
  };
  const probe = wireColumnProbe(
    f.ir,
    f.table,
    f.width,
    f.page,
    f.first.cellSize,
  );
  const countedProbe = probeWithCounts(probe, counts);
  const notes = f.table.notes.flatMap((n) =>
    reportNoteLines(n, f.width),
  ).length;
  const result = searchWireColumns(
    f.table,
    f.width,
    f.height,
    f.first.cellSize,
    f.nativePages,
    {
      measured: (measured, limit) => {
        const count = reportPagination(
          f.table,
          countedGeometry(measured, counts),
          f.width,
          f.height,
          f.top,
          limit,
        );
        return count;
      },
      heights: (measured, limit) => {
        const result = reportHeightPagination(
          measured,
          f.top,
          f.height,
          notes,
          limit,
        );
        counts.rowSteps += result.rowSteps;
        return result;
      },
    },
    f.top,
    countedProbe,
  );
  return {
    ...result,
    rowSteps: counts.rowSteps,
    emissionRows: counts.emissionRows,
    actualCellMeasurements: counts.cellMeasurements,
    wrapRows: counts.bodySplits - counts.emissionRows,
  };
}

function probeWithCounts(
  probe: ReturnType<typeof wireColumnProbe>,
  counts: { cellMeasurements: number; bodySplits: number },
) {
  return {
    ...probe,
    cell(...args: Parameters<typeof probe.cell>) {
      counts.cellMeasurements++;
      return probe.cell(...args);
    },
    measure(widths: number[]) {
      const measured = probe.measure(widths);
      return {
        ...measured,
        split(cells: readonly string[], row: string, key?: string) {
          if (row !== "header") counts.bodySplits++;
          return measured.split(cells, row, key);
        },
      };
    },
  };
}

function countedGeometry(
  measured: ReturnType<typeof reportCells>,
  counts: { emissionRows: number },
) {
  return {
    ...measured,
    geometry(cells: string[][], heading = false) {
      if (!heading) counts.emissionRows++;
      return measured.geometry(cells, heading);
    },
  };
}

/** Fresh text measurement and a separate cursor calculation; no receipt or
 * production page counter supplies any expected pages or wrap totals. */
export function measureVector(
  f: ReturnType<typeof pruningFixture>,
  widths: number[],
) {
  const measured = wireColumnProbe(
    f.ir,
    f.table,
    f.width,
    f.page,
    f.first.cellSize,
  ).measure(widths);
  const headers = measured.split(f.table.columns, "header");
  const headerHeight = measured.geometry(headers, true).height;
  const noteLines = f.table.notes.flatMap((n) =>
    reportNoteLines(n, f.width),
  ).length;
  const bottom = f.top + f.height - noteLines * 3.5 - 5;
  const start = f.top + 9 + headerHeight;
  let cursor = start,
    pages = 1,
    bodyLines = 0;
  if (start > bottom) throw Error("Unprintable independent header");
  for (const row of f.table.rows) {
    const cells = measured.split(row.cells, "independent", row.key);
    const height = measured.geometry(cells).height;
    if (height + headerHeight + 9 > bottom - f.top)
      throw Error("Unprintable independent row");
    if (cursor + height > bottom) {
      pages++;
      cursor = start;
    }
    cursor += height;
    bodyLines += cells.flat().length;
  }
  return {
    measured,
    pages,
    wrapLines: bodyLines + headers.flat().length * pages,
  };
}
