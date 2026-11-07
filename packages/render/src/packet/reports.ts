import { reportCells, emitReportRow } from "./report-cells.js";

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
import { bounds, zone } from "./page.js";
import { n, text, wrap } from "./svg.js";

export function documentationDrafts(
  ir: Readonly<ElectricalIr>,
  request: DocumentationRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): RenderOutcome<Draft[]> {
  try {
    return tableDrafts(ir, buildDocumentation(ir, request), presentation, page);
  } catch (e) {
    return failure(
      "invalid-packet",
      e instanceof Error ? e.message : "Invalid report.",
    );
  }
}
export function tableDrafts(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): RenderOutcome<Draft[]> {
  const allText = [
    ir.project.name,
    presentation?.revision ?? "UNSPECIFIED",
    ...(presentation?.titleBlockLines ?? []),
    table.title,
    ...table.columns,
    ...table.notes,
    ...table.rows.flatMap((r) => r.cells),
  ];
  if (
    allText.some((t) =>
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(t),
    )
  )
    return failure(
      "unprintable-layout",
      "Report text contains characters that cannot be represented in XML.",
    );
  const view: NormalizedDocumentationView = {
    format: "documentation-view/0.1",
    kind: table.kind,
    title: table.title,
  };
  const title: SchematicTitleContext = {
    projectName: ir.project.name,
    revision: presentation?.revision ?? "UNSPECIFIED",
    backgroundColor: "#ffffff",
    toolVersion: "0.3.0-alpha.2",
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
  };
  const b = bounds(title, page),
    drafts: Draft[] = [];
  if (b.w < 60 || b.h < 50)
    return failure(
      "unprintable-layout",
      "Insufficient report area. Shorten title lines or select a larger sheet.",
    );
  const {
    widths,
    cellSize,
    rowDesignation,
    rowName,
    unknownReason,
    context,
    split,
    geometry,
  } = reportCells(ir, table, b.w, page);
  let header: string[][];
  try {
    header = split(table.columns, "header");
  } catch (error) {
    return failure("unprintable-layout", (error as Error).message);
  }
  const headerH = geometry(header, true).height;
  const notes = table.notes.flatMap((t) => wrap(t, Math.floor(b.w / 1.6)));
  const bottom = b.y + b.h - notes.length * 3.5 - 5;
  if (headerH + 9 > bottom - b.y) {
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
      ),
    );
    y += height;
  }
  function start() {
    content = [text(b.x, b.y + 3, table.title, 4, "start", 700)];
    refs = [];
    y = b.y + 9;
    row(header, headerH, true);
  }
  function finish(end: number) {
    notes.forEach((v, i) =>
      content.push(text(b.x, b.y + b.h - (notes.length - 1 - i) * 3.5, v, 2.5)),
    );
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
      ...(table.selection ? { documentationSelection: table.selection } : {}),
    });
  }
  start();
  for (let i = 0; i < table.rows.length; i++) {
    const source = table.rows[i]!;
    let cells: string[][];
    try {
      cells = split(source.cells, rowName(i));
    } catch (error) {
      return failure("unprintable-layout", (error as Error).message);
    }
    const height = geometry(cells).height;
    if (height + headerH + 9 > bottom - b.y) {
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
    if (y + height > bottom) {
      finish(i);
      first = i;
      start();
    }
    for (const uid of new Set(source.deviceUids)) {
      const d = ir.devices.find((d) => d.uid === uid);
      if (d)
        refs.push({
          deviceUid: uid,
          designation: d.designation,
          functions: [],
          zone: zone(b.x + b.w / 2, y + height / 2, b),
        });
    }
    content.push(
      `<g data-report-row="${attr(source.key)}" data-row-designation="${attr(rowDesignation(i))}">`,
    );
    row(cells, height);
    content.push("</g>");
    if (drafts.length > 100)
      return failure(
        "unprintable-layout",
        "Report exceeds the 100-sheet limit.",
      );
  }
  if (!table.rows.length)
    content.push(text(b.x + 2, y + 7, "No matching records", 3));
  finish(table.rows.length);
  return { ok: true, value: drafts };
}
