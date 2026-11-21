import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import { titleFrameContext } from "../internal/title-data/frame-context.js";
import {
  authorTitleCells,
  rightTitleCells,
  revisionHistoryText,
  headingTitle,
  titlePaint,
} from "../internal/title-data/paint.js";
import type { Draft, PaperPage } from "./types.js";
import {
  compactFramePlan,
  compactTitleRows,
  type FramePlan,
  type FrameText,
} from "./frame-plan.js";
import { admitFinalBanks } from "./frame-banks.js";
import { continuationLabelSvg } from "./continuation-label.js";
import { rootedLegendView } from "../device-legend.js";
import { rootedSheetNoticeSvg, rootedSheetView } from "../off-view/notice.js";
import { sheetLabel } from "./page.js";
import {
  escapeXmlAttribute as attr,
  escapeXmlText as xml,
} from "../svg/escape.js";
import { n, text, line, namespaceSheetContent } from "./svg.js";
import { printableTextMetrics } from "../text-metrics.js";

const FOOTER_HEIGHT_MM = 6;

export function compactFrame(
  draft: Draft,
  page: PaperPage,
  number: number,
  total: number,
): string {
  const plan = compactFramePlan(
    draft.title,
    page,
    rootedSheetView(draft.view),
    draft.drawingBounds,
  );
  admitFinalBanks(draft, plan);
  const m = page.marginMm,
    w = page.widthMm - 2 * m,
    bottom = page.heightMm - m;
  const top = plan.title.top,
    label = sheetLabel(draft.view);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.widthMm)}mm" height="${n(page.heightMm)}mm" viewBox="0 0 ${n(page.widthMm)} ${n(page.heightMm)}" role="img" aria-label="${attr(`${label}, sheet ${number} of ${total}`)}" data-sheet="${number}" data-total-sheets="${total}"${rootedLegendView(draft.view) ? ` data-view-format="${attr(draft.view.format)}" data-view-family="${attr("family" in draft.view ? draft.view.family : "")}"` : ""} data-paper="${page.size}">`,
    `<title>${xml(label)} - Sheet ${number} of ${total}</title>`,
    `<rect width="${n(page.widthMm)}" height="${n(page.heightMm)}" fill="white"/>`,
    `<rect x="${n(m)}" y="${n(m)}" width="${n(w)}" height="${n(bottom - m)}" fill="none" stroke="#344054" stroke-width="0.4"/>`,
    ...frameHeader(page, number, total),
    namespaceSheetContent(draft.content, number),
  ];
  const notice = rootedSheetNoticeSvg(draft.view, page);
  if (notice) out.push(notice);
  out.push(...gridMarks(plan, page));
  for (const link of draft.links) {
    const sign = link.side === "left" || link.side === "top" ? -1 : 1;
    out.push(
      `<a href="#sheet-${link.to}" data-continuation-id="${attr(link.id)}" data-continuation-end="${link.end}" data-conductor-id="${attr(link.conductor)}" aria-label="${attr(`Continue ${link.conductor} on sheet ${link.to}.${link.toZone}`)}">`,
      link.side === "left" || link.side === "right"
        ? line(link.x, link.y, link.x + sign * 2, link.y)
        : line(link.x, link.y, link.x, link.y + sign * 2),
      continuationLabelSvg(link),
      "</a>",
    );
  }
  out.push(line(m, top, page.widthMm - m, top));
  out.push(...titleCells(draft, plan, page, number, total));
  out.push(...footerRows(draft, page, number));
  out.push(
    `<metadata>${xml(`Generator: Thermite Schematics ${draft.title.toolVersion}`)}</metadata>`,
    "</svg>",
  );
  return out.join("\n") + "\n";
}

function footerRows(draft: Draft, page: PaperPage, number: number) {
  const m = page.marginMm,
    w = page.widthMm - 2 * m,
    frameBottom = page.heightMm - m;
  const history = revisionHistoryText(draft);
  const stampPlacement =
    titleFrameContext(page)?.presentation.frame?.generatorStamp ?? "border";
  const stamp =
    stampPlacement === "border" ? `Thermite ${THERMITE_RELEASE_VERSION}` : "";
  const [noteY, historyY] = footerBaselines(
    frameBottom,
    draft.note,
    history,
    stamp,
    number,
  );
  const out = [];
  if (draft.note)
    out.push(titlePaint(number, "footer", m + 3, noteY, draft.note, w - 6));
  out.push(
    titlePaint(number, "revisionRows", m + 3, historyY, history, w - 72),
  );
  if (stamp) out.push(text(page.widthMm - m - 3, historyY, stamp, 2.5, "end"));
  return out;
}

function footerBaselines(
  frameBottom: number,
  note: string,
  history: string,
  stamp: string,
  number: number,
) {
  // Work between the inner edges of the 0.25 mm title rule and 0.4 mm frame stroke.
  const top = frameBottom - FOOTER_HEIGHT_MM + 0.125;
  const bottom = frameBottom - 0.2;
  const upper = printableTextMetrics(note, 2.5);
  const historyInk = printableTextMetrics(history, 2.5);
  const stampInk = printableTextMetrics(stamp, 2.5);
  const lowerTop = Math.max(historyInk.top, stampInk.top);
  const lowerBottom = Math.min(historyInk.bottom, stampInk.bottom);
  const height = upper.top - upper.bottom + lowerTop - lowerBottom;
  const available = bottom - top;
  if (height > available)
    throw Error(
      `Sheet ${number} footer needs ${height.toFixed(3)} mm of glyph height; ${available.toFixed(3)} mm are available. Use shorter supplied revision history.`,
    );
  const gap = (available - height) / (note ? 3 : 2);
  return [top + gap + upper.top, bottom - gap + lowerBottom] as const;
}

function frameHeader(page: PaperPage, number: number, total: number) {
  const m = page.marginMm,
    w = page.widthMm - 2 * m;
  return [
    titlePaint(
      number,
      "header",
      m + 4,
      m + 5,
      titleFrameContext(page)?.presentation.frame?.header?.text ??
        "THERMITE  /  ELECTRICAL",
      w - 8 - printableTextMetrics("SHEET 100 OF 100", 2.6).right - 3,
      2.6,
      true,
    ),
    text(
      page.widthMm - m - 4,
      m + 5,
      `SHEET ${number} OF ${total}`,
      2.6,
      "end",
    ),
    line(m, m + 8, page.widthMm - m, m + 8),
  ];
}

function gridMarks(plan: FramePlan, page: PaperPage): string[] {
  const out: string[] = [],
    m = page.marginMm,
    top = plan.title.top,
    area = plan.drawing;
  for (let col = 0; col < plan.grid.columns; col++)
    for (const y of [m + 12, top - 1])
      out.push(
        text(
          area.x + (area.w * (col + 0.5)) / 6,
          y,
          String(col + 1),
          2.5,
          "middle",
        ),
      );
  for (let row = 0; row < plan.grid.rows; row++)
    for (const [x, anchor] of [
      [m + 0.6, "start"],
      [page.widthMm - m - 0.6, "end"],
    ] as const)
      out.push(
        text(
          x,
          area.y + (area.h * (row + 0.5)) / 4,
          String.fromCharCode(65 + row),
          2.5,
          anchor,
        ),
      );
  for (let col = 0; col <= 6; col++) {
    const x = area.x + (area.w * col) / 6;
    out.push(line(x, m + 8, x, m + 10), line(x, top - 2, x, top));
  }
  for (let row = 0; row <= 4; row++) {
    const y = area.y + (area.h * row) / 4;
    out.push(
      line(m, y, m + 1.5, y),
      line(page.widthMm - m - 1.5, y, page.widthMm - m, y),
    );
  }
  return out;
}
function titleCells(
  draft: Draft,
  plan: FramePlan,
  page: PaperPage,
  number: number,
  total: number,
): string[] {
  const out: string[] = [],
    top = plan.title.top,
    label = titleFrameContext(page)
      ? (draft.title.lines.find((entry) => entry.field === "title.view-line")
          ?.value ?? sheetLabel(draft.view))
      : sheetLabel(draft.view);
  const rows = compactTitleRows(
    {
      ...draft.title,
      projectName: headingTitle(draft, "project", draft.title.projectName),
      lines: draft.title.lines.map((entry) =>
        entry.field === "title.view-line"
          ? { ...entry, value: headingTitle(draft, "sheetTitle", label) }
          : entry,
      ),
    },
    page,
    false,
  );
  out.push(...rows.map((row, i) => titleRowSvg(row, i, plan, page, number)));
  out.push(
    ...authorTitleCells(draft, page, number),
    // The author cells already stop above the footer. End the right cells at
    // the same rule so the two footer rows can use the full framed width.
    ...rightTitleCells(
      draft,
      page,
      number,
      total,
      top,
      plan.title.height - FOOTER_HEIGHT_MM,
    ),
  );
  return out;
}

function titleRowSvg(
  row: FrameText,
  index: number,
  plan: FramePlan,
  page: PaperPage,
  number: number,
): string {
  const baseline = plan.title.top + 5 + 4 * index;
  const metrics = printableTextMetrics(row.value, row.size, row.bold);
  const width = page.widthMm - 2 * page.marginMm - 76;
  if (metrics.right > width + 0.001 || metrics.left < -4)
    throw Error(
      `Sheet ${number} field ${row.field} requires ${metrics.right.toFixed(3)} mm; ${width.toFixed(3)} mm are available. Use larger paper or a shorter supplied title.`,
    );
  if (baseline - metrics.bottom > page.heightMm - page.marginMm - 14.125)
    throw Error(
      `Sheet ${number} field ${row.field} needs more glyph clearance; use a larger paper/profile or a shorter supplied title.`,
    );
  return text(
    page.marginMm + 4,
    baseline,
    row.value,
    row.size,
    "start",
    row.bold ? 700 : 400,
  );
}
