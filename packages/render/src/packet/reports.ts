import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import {
  plannedTitleContext,
  headingCapacity,
} from "../internal/title-data/headings.js";
import { emitReportRow } from "./report-cells.js";
import { paginatedReportCells } from "./report-layout.js";
import { reportPaginator } from "./report-paginator.js";

import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import {
  buildDocumentation,
  type DocumentationRequest,
  type DocumentationTable,
} from "@thermite/query";

import { escapeXmlAttribute as attr } from "../svg/escape.js";
import type { SchematicTitleContext } from "../title-block.js";
import type { RenderOutcome } from "../types.js";

import type {
  Draft,
  PaperPage,
  SheetReference,
  NormalizedDocumentationView,
} from "./types.js";
import { failure } from "./errors.js";
import { bounds } from "./page.js";
import { n, text } from "./svg.js";
import { reportNoteLines } from "./report-note-wrapping.js";
import { reportDocumentContext } from "./document-report.js";
import type { DocumentRowDraft } from "./document-types.js";
import {
  terminalStrip,
  stripRowReference,
  stripDrawing,
} from "./terminal-strip.js";

export function documentationDrafts(
  ir: Readonly<ElectricalIr>,
  request: DocumentationRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): RenderOutcome<Draft[]> {
  try {
    return tableDrafts(
      ir,
      buildDocumentation(ir, request),
      presentation,
      page,
      true,
    );
  } catch (e) {
    return failure(
      "invalid-packet",
      e instanceof Error ? e.message : "Invalid report.",
    );
  }
}
function reportTitle(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation: CompiledProjectPresentation | undefined,
): SchematicTitleContext {
  return plannedTitleContext(
    {
      projectName: ir.project.name,
      revision: presentation?.revision ?? "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: THERMITE_RELEASE_VERSION,
      lines: [
        {
          ownerKind: "view",
          ownerId: "report",
          field: "title.view-line",
          value: table.title,
        },
        ...(presentation?.titleBlockLines ?? []).map((value) => ({
          ownerKind: "presentation" as const,
          ownerId: "presentation",
          field: "title.authored-line" as const,
          value,
        })),
      ],
    },
    presentation,
  );
}
function prepareReport(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  projectStrip: boolean,
) {
  if (unprintableReportText(ir, table, presentation))
    return failure(
      "unprintable-layout",
      "Report text contains characters that cannot be represented in XML.",
    );
  const view: NormalizedDocumentationView = {
    format: "documentation-view/0.1",
    kind: table.kind,
    title: table.title,
  };
  const title = reportTitle(ir, table, presentation);
  const capacity = headingCapacity(title, presentation);
  if (capacity) return capacity;
  const fullBounds = bounds(title, page),
    b = fullBounds;
  if (b.w < 60 || b.h < 50)
    return failure(
      "unprintable-layout",
      "Insufficient report area. Shorten title lines or select a larger sheet.",
    );
  let measured: ReturnType<typeof paginatedReportCells>, header: string[][];
  let strip: ReturnType<typeof terminalStrip>;
  try {
    strip = projectStrip ? terminalStrip(ir, table, fullBounds) : undefined;
    measured = paginatedReportCells(ir, table, b.w, b.h, page, b.y);
    header = measured.split(table.columns, "header");
  } catch (error) {
    return failure("unprintable-layout", (error as Error).message);
  }
  return {
    ok: true as const,
    value: { view, title, fullBounds, b, strip, measured, header },
  };
}
export function tableDrafts(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  projectStrip = false,
): RenderOutcome<Draft[]> {
  table = reserveWireLocations(table);
  const prepared = prepareReport(ir, table, presentation, page, projectStrip);
  if (!prepared.ok) return prepared;
  const { view, title, fullBounds, b, strip, measured, header } =
    prepared.value;
  const drafts: Draft[] = [];
  const {
    widths,
    cellSize,
    rowDesignation,
    rowName,
    unknownReason,
    context,
    split,
    geometry,
    inlineLocations,
  } = measured;
  const headerH = geometry(header, true).height;
  const documents = reportDocumentContext(
    ir,
    table,
    presentation,
    b,
    header,
    headerH,
  );
  const notes = reportNotes(table, fullBounds.w, measured.allocationFallback);
  const bottom = b.y + b.h - notes.length * 3.5 - 5;
  const paginator = reportPaginator(b.y, b.h, headerH, notes.length);
  if (!paginator.headerFits) {
    const column = header.reduce(
      (best, lines, i) => (lines.length > header[best]!.length ? i : best),
      0,
    );
    return failure(
      "unprintable-layout",
      `${context("header", column)}: header needs ${n(headerH)} mm but the report area has only ${n(bottom - b.y - 9)} mm available at ${cellSize} mm text (minimum 2.5 mm). ${page.orientation === "landscape" ? "Use larger paper or shorter authored text." : "Use larger paper, landscape, or shorter authored text."}`,
    );
  }
  let content: string[] = [],
    documentRows: DocumentRowDraft[] = [],
    refs: SheetReference[] = [],
    y = 0,
    first = 0;
  function row(cells: string[][], height: number, heading = false) {
    content.push(
      ...emitReportRow(
        cells,
        height,
        widths,
        table.columns,
        b.x,
        y,
        geometry,
        heading,
        inlineLocations,
      ),
    );
    y += height;
  }
  function start() {
    content = [documents.titleSvg()];
    documentRows = [];
    refs = [];
    y = b.y + 9;
    content.push('<g id="document-header">');
    row(header, headerH, true);
    content.push("</g>");
    if (strip)
      content.push(
        text(b.x - 9, b.y + 12, "Strip", 2.5),
        text(b.x - 9, b.y + 15.5, "row", 2.5),
      );
  }
  function finish(end: number) {
    content.push(...reportNoteSvg(notes, b));
    drafts.push({
      view,
      title,
      content: content.join("\n"),
      links: [],
      references: refs,
      note: table.rows.length
        ? `Rows ${first + 1}-${end} of ${table.rows.length}`
        : "No matching records",
      documentationTable: true,
      ...documents.metadata(documentRows),
      ...(table.selection ? { documentationSelection: table.selection } : {}),
    });
  }
  start();
  for (let i = 0; i < table.rows.length; i++) {
    const source = table.rows[i]!;
    let cells: string[][];
    try {
      cells = split(source.cells, rowName(i), source.key);
    } catch (error) {
      return failure("unprintable-layout", (error as Error).message);
    }
    const height = geometry(cells).height;
    const placement = paginator.place(height);
    if (placement.kind === "overflow") {
      const column = cells.reduce(
        (best, value, index) =>
          value.length > cells[best]!.length ? index : best,
        0,
      );
      return failure(
        "unprintable-layout",
        `${context(rowName(i), column)}: ${cells[column]!.length} lines need ${n(height)} mm; only ${n(bottom - b.y - headerH - 9)} mm is available on a fresh sheet at the fixed ${cellSize} mm text size (minimum 2.5 mm).${unknownReason(source.cells[column]!)} ${page.orientation === "landscape" ? "Use larger paper or shorter authored text." : "Use larger paper, landscape, or shorter authored text."}`,
      );
    }
    if (placement.kind === "new-page") {
      finish(i);
      first = i;
      start();
    }
    refs.push(...documents.references(i, y, height));
    content.push(
      `<g id="document-row-${i}" data-report-row="${attr(source.key)}" data-row-designation="${attr(rowDesignation(i))}"${strip ? ` data-strip-ref="${attr(strip.facts.terminals.get(source.key)?.ref ?? "")}"` : ""}>`,
    );
    documentRows.push(documents.row(i, cells, y, height, rowDesignation(i)));
    row(cells, height);
    content.push("</g>");
    content.push(
      stripRowReference(
        strip?.facts.terminals.get(source.key)?.ref,
        source.key,
        b.x,
        y - height / 2 + 1,
      ),
    );
    if (drafts.length > 100)
      return failure(
        "unprintable-layout",
        "Report exceeds the 100-sheet limit.",
      );
  }
  if (!table.rows.length)
    content.push(text(b.x + 2, y + 7, "No matching records", 3));
  finish(table.rows.length);
  const firstDraft = drafts[0];
  if (strip && firstDraft) firstDraft.terminalStripPlan = stripDrawing(strip);
  return { ok: true, value: drafts };
}

/** Native query tables have no packet geometry; reserve endpoint cells here. */
function reserveWireLocations(table: DocumentationTable): DocumentationTable {
  if (table.kind !== "wires" || table.columns.includes("From sheet.zone"))
    return table;
  return {
    ...table,
    columns: [...table.columns, "From sheet.zone", "To sheet.zone"],
    widths: [0.12, 0.18, 0.18, 0.14, 0.16, 0.11, 0.11],
    rows: table.rows.map((row) => ({
      ...row,
      cells: [...row.cells, "not drawn", "not drawn"],
    })),
  };
}

function unprintableReportText(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation?: CompiledProjectPresentation,
) {
  const allText = [
    ir.project.name,
    presentation?.revision ?? "UNSPECIFIED",
    ...(presentation?.titleBlockLines ?? []),
    table.title,
    ...table.columns,
    ...table.notes,
    ...table.rows.flatMap((r) => r.cells),
  ];
  return allText.some((t) =>
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(t),
  );
}

function reportNotes(
  table: DocumentationTable,
  width: number,
  fallback?: {
    stage: string;
    reason: string;
    column?: string;
    detail?: string;
  },
) {
  const notes = fallback
    ? [
        ...table.notes,
        `Sheet and zone references are shown below the endpoints. An alternative layout for ${JSON.stringify(table.title)} ${fallback.column && fallback.detail ? `could not fit column ${JSON.stringify(fallback.column)}: ${fallback.detail}` : "could not be measured; the affected column was not identified."}`,
      ]
    : table.notes;
  return notes.flatMap((note, index) =>
    reportNoteLines(note, width).map((value) => ({ index, value })),
  );
}
function reportNoteSvg(
  notes: ReturnType<typeof reportNotes>,
  b: ReturnType<typeof bounds>,
): string[] {
  return notes.map((note, i) =>
    text(
      b.x,
      b.y + b.h - (notes.length - 1 - i) * 3.5,
      note.value,
      2.5,
    ).replace("<text ", `<text data-report-note="${note.index}" `),
  );
}
