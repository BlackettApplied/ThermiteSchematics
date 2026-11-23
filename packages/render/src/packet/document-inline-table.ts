import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { DocumentationTable } from "@thermite/query";
import type { PaperPage, DrawingBounds } from "./types.js";
import { reportCells, emitReportRow } from "./report-cells.js";
import { reportNoteLines } from "./report-note-wrapping.js";
import { reportDocumentContext } from "./document-report.js";
import { fieldTextLeft, fieldTextWidth, text } from "./svg.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { required } from "../presentation/util.js";

export function inlineTablePlan(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  width: number,
  page: PaperPage,
) {
  const measured = reportCells(ir, table, width, page);
  const header = measured.split(table.columns, "header");
  const headerHeight = measured.geometry(header, true).height;
  const rows = table.rows.map((r) => measured.split(r.cells, r.key, r.key));
  const heights = rows.map((cells) => measured.geometry(cells).height);
  const notes = table.notes.flatMap((note) =>
    reportNoteLines(note, fieldTextWidth(width)),
  );
  return {
    table,
    measured,
    header,
    headerHeight,
    rows,
    heights,
    notes,
    width,
    height:
      9.5 +
      headerHeight +
      heights.reduce((a, b) => a + b, 0) +
      5 +
      notes.length * 3.5,
  };
}
export function inlineTableContent(
  ir: Readonly<ElectricalIr>,
  plan: ReturnType<typeof inlineTablePlan>,
  box: DrawingBounds,
  presentation?: CompiledProjectPresentation,
) {
  const { measured, table, header, headerHeight } = plan;
  const label = { ...table, title: "assembly inventory" };
  const shiftedBox = { ...box, y: box.y + 0.5, h: box.h - 0.5 };
  const context = reportDocumentContext(
    ir,
    label,
    presentation,
    shiftedBox,
    header,
    headerHeight,
  );
  const content = [
    context.titleSvg(),
    '<g id="document-header">',
    ...emitReportRow(
      header,
      headerHeight,
      measured.widths,
      table.columns,
      box.x,
      box.y + 9.5,
      measured.geometry,
      true,
      measured.inlineLocations,
    ),
    "</g>",
  ];
  const documentRows = [];
  let y = box.y + 9.5 + headerHeight;
  for (const [i, cells] of plan.rows.entries()) {
    const height = required(plan.heights[i], "Missing inline row height");
    const native = required(table.rows[i], "Missing inline native row");
    content.push(
      `<g id="document-row-${i}" data-report-row="${attr(native.key)}" data-row-designation="${attr(measured.rowDesignation(i))}">`,
      ...emitReportRow(
        cells,
        height,
        measured.widths,
        table.columns,
        box.x,
        y,
        measured.geometry,
        false,
        measured.inlineLocations,
      ),
      "</g>",
    );
    documentRows.push(
      context.row(i, cells, y, height, measured.rowDesignation(i)),
    );
    y += height;
  }
  for (const [i, line] of plan.notes.entries())
    content.push(text(fieldTextLeft(box.x), y + 4 + i * 3.5, line, 2.5));
  return { content: content.join(""), ...context.metadata(documentRows) };
}
