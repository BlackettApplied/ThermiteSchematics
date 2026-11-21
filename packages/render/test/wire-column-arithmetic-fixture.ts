import type { ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, type DocumentationTable } from "@thermite/query";
import { measureText } from "../src/text-metrics.js";
import { reportCells, wireColumnProbe } from "../src/packet/report-cells.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { reportPageCount } from "../src/packet/report-layout.js";
import { reportNoteLines } from "../src/packet/report-note-wrapping.js";

export function arithmeticFixture(
  source: ElectricalIr,
  kind: "glyphs" | "hyphens" | "boundary",
) {
  const ir = structuredClone(source);
  ir.jumpers = [];
  ir.cables = [];
  ir.cableConductors = [];
  ir.wires = ir.wires.slice(0, 6).map((wire, i) => ({
    ...wire,
    designation: `T${i}`,
    properties: {
      ...wire.properties,
      label:
        kind === "boundary" ? "" : "e\u0301\u0302\u0323 g\u0323 ∫ ".repeat(10),
    },
  }));
  const normalized = normalizePaperPage(
    kind === "hyphens"
      ? { size: "letter", orientation: "portrait", marginMm: 25 }
      : { size: "a3", orientation: "portrait" },
  );
  if (!normalized.ok) throw Error(normalized.error.message);
  const table = buildDocumentation(
    ir,
    { format: "documentation-view-request/0.1", kind: "wires" },
    {},
  );
  const width = kind === "hyphens" ? 129.9 : 223.39999999999998;
  const page = normalized.value,
    top = 31;
  const first = reportCells(ir, table, width, page);
  let height = kind === "hyphens" ? 150 : 300;
  if (kind === "boundary")
    height = boundaryHeight(ir, table, width, page, top, first.cellSize);
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
  const nativePages = reportPageCount(
    native,
    reportCells(ir, native, width, page, "legacy"),
    width,
    height,
    top,
  );
  return { ir, table, page, width, height, top, first, nativePages };
}

function boundaryHeight(
  ir: ElectricalIr,
  table: DocumentationTable,
  width: number,
  page: ReturnType<typeof arithmeticFixture>["page"],
  top: number,
  size: number,
): number {
  const probe = wireColumnProbe(ir, table, width, page, size),
    measured = probe.measure(probe.widths);
  const headers = measured.split(table.columns, "header");
  let end = top + 9 + measured.geometry(headers, true).height;
  for (const row of table.rows)
    end += measured.geometry(
      measured.split(row.cells, "boundary", row.key),
    ).height;
  const notes = table.notes.flatMap((n) => reportNoteLines(n, width)).length;
  const height = end - top + notes * 3.5 + 5;
  if (top + height - notes * 3.5 - 5 !== end)
    throw Error("Boundary fixture is not exact");
  return height;
}

/** Independent copy of the pre-D1e formula, measured from raw wrapped text. */
export function independentHeight(
  cells: string[][],
  size: number,
  heading = false,
  note?: string,
) {
  const metrics = cells.flat().map((value) => measureText(value, size));
  const ascent = Math.max(0, ...metrics.map((m) => m.ascent));
  const descent = Math.max(0, ...metrics.map((m) => m.descent));
  const lineHeight = Math.max(3.6, ascent + descent + 0.6);
  const baseline = Math.max(4, ascent + 1),
    count = Math.max(...cells.map((c) => c.length));
  return (
    (heading && note ? 4 : 0) +
    Math.max(
      count * 3.6 + (heading ? 5 : 4),
      baseline + (count - 1) * lineHeight + descent + 1,
    )
  );
}
