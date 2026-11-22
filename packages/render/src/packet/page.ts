import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import { hasCompactFrame } from "./frame-profile.js";

const RELEASE_STAMP = `Thermite ${THERMITE_RELEASE_VERSION}`;
import { compactFramePlan } from "./frame-plan.js";
import { compactFrame } from "./frame-compact.js";
import { legacyFooterNote } from "./legacy-footer.js";
import { rootedLegendView } from "../device-legend.js";
import { continuationLabelSvg } from "./continuation-label.js";
import { wrapPrintableText, wrapText } from "../text-metrics.js";
import {
  rootedNoticeLines,
  rootedSheetNoticeSvg,
  rootedSheetView,
} from "../off-view/notice.js";
import type { NormalizedSchematicView } from "../types.js";

import {
  escapeXmlAttribute as attr,
  escapeXmlText as xml,
} from "../svg/escape.js";
import type { SchematicTitleContext } from "../title-block.js";
import type { RenderOutcome } from "../types.js";

import type {
  PaperPage,
  RenderedSheet,
  Draft,
  DrawingBounds,
} from "./types.js";
import { failure, record } from "./errors.js";
import { n, text, line, namespaceSheetContent } from "./svg.js";

const PAPERS = {
  letter: [215.9, 279.4],
  tabloid: [279.4, 431.8],
  a4: [210, 297],
  a3: [297, 420],
} as const;
export function normalizePaperPage(
  input: unknown = {},
): RenderOutcome<PaperPage> {
  if (
    !record(input) ||
    Object.keys(input).some(
      (key) => !["size", "orientation", "marginMm"].includes(key),
    )
  )
    return failure(
      "invalid-page",
      "Page must contain only size, orientation and marginMm.",
    );
  const size = input.size ?? "tabloid";
  const orientation = input.orientation ?? "landscape";
  const marginMm = input.marginMm ?? 10;
  if (
    typeof size !== "string" ||
    !Object.hasOwn(PAPERS, size) ||
    !["landscape", "portrait"].includes(String(orientation)) ||
    typeof orientation !== "string" ||
    typeof marginMm !== "number" ||
    !Number.isFinite(marginMm) ||
    marginMm < 5 ||
    marginMm > 25 ||
    Object.values(input).some((value) => value === null || value === undefined)
  )
    return failure(
      "invalid-page",
      "Use letter, tabloid, a4 or a3; landscape or portrait; and a margin from 5 to 25 mm.",
    );
  const [short, long] = PAPERS[size as PaperPage["size"]];
  return {
    ok: true,
    value: {
      size: size as PaperPage["size"],
      orientation: orientation as PaperPage["orientation"],
      marginMm,
      widthMm: orientation === "landscape" ? long : short,
      heightMm: orientation === "landscape" ? short : long,
    },
  };
}
function titleHeight(title: SchematicTitleContext, page: PaperPage): number {
  const custom = title.lines.filter(
    (entry) => entry.field === "title.authored-line",
  );
  const width = page.widthMm - 2 * page.marginMm - 76;
  const view =
    title.lines.find((entry) => entry.field === "title.view-line")?.value ?? "";
  // Authored rows of the standard frame reserve the pinned fallback envelope.
  const rows =
    wrapPrintableText(title.projectName, width, 3.2, true).length +
    wrapPrintableText(view, width, 2.8).length +
    custom.flatMap((entry) => wrapText(entry.value, width, 2.5)).length;
  return Math.max(28, 14 + rows * 4);
}
export function bounds(
  title: SchematicTitleContext,
  page: PaperPage,
  rooted?: NormalizedSchematicView,
): DrawingBounds {
  if (hasCompactFrame(page)) {
    const plan = compactFramePlan(title, page, rooted);
    return { ...plan.drawing, frameService: plan.service };
  }
  const m = page.marginMm;
  const noticeHeight = rooted
    ? rootedNoticeLines(rooted, page.widthMm - 2 * m - 36, 2.7).length * 4 + 4
    : 0;
  return {
    x: m + 18,
    y: m + 21 + noticeHeight,
    w: page.widthMm - 2 * m - 36,
    h: page.heightMm - 2 * m - titleHeight(title, page) - 35 - noticeHeight,
  };
}
export function sheetLabel(view: RenderedSheet["view"]): string {
  if (view.format === "documentation-view/0.1") return view.title;
  return `${view.root.designation} / ${view.format === "schematic-view/0.1" ? view.family : view.intent === "trace" ? `trace to ${view.target.designation}` : view.intent}`;
}
export function zone(x: number, y: number, b: DrawingBounds): string {
  return `${"ABCD"[Math.max(0, Math.min(3, Math.floor(((y - b.y) / b.h) * 4)))]}${1 + Math.max(0, Math.min(5, Math.floor(((x - b.x) / b.w) * 6)))}`;
}
export function frame(
  draft: Draft,
  page: PaperPage,
  number: number,
  total: number,
): string {
  if (hasCompactFrame(page)) return compactFrame(draft, page, number, total);
  const m = page.marginMm,
    w = page.widthMm - 2 * m,
    bottom = page.heightMm - m;
  const titleTop = bottom - titleHeight(draft.title, page);
  const label = sheetLabel(draft.view);
  const content = namespaceSheetContent(draft.content, number);
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.widthMm)}mm" height="${n(page.heightMm)}mm" viewBox="0 0 ${n(page.widthMm)} ${n(page.heightMm)}" role="img" aria-label="${attr(`${label}, sheet ${number} of ${total}`)}" data-sheet="${number}" data-total-sheets="${total}"${rootedLegendView(draft.view) ? ` data-view-format="${attr(draft.view.format)}" data-view-family="${attr("family" in draft.view ? draft.view.family : "")}"` : ""} data-paper="${page.size}">`,
    `<title>${xml(label)} - Sheet ${number} of ${total}</title>`,
    `<rect width="${n(page.widthMm)}" height="${n(page.heightMm)}" fill="white"/>`,
    `<rect x="${n(m)}" y="${n(m)}" width="${n(w)}" height="${n(bottom - m)}" fill="none" stroke="#344054" stroke-width="0.4"/>`,
    text(m + 4, m + 5, "THERMITE  /  ELECTRICAL", 2.6, "start", 700),
    text(
      page.widthMm - m - 4,
      m + 5,
      `SHEET ${String(number).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      2.6,
      "end",
    ),
    line(m, m + 8, page.widthMm - m, m + 8),
    content,
  ];
  const rooted = rootedSheetView(draft.view);
  const area = draft.drawingBounds ?? bounds(draft.title, page, rooted);
  const notice = rootedSheetNoticeSvg(draft.view, page);
  if (notice) out.push(notice);
  for (let col = 0; col < 6; col++)
    out.push(
      text(
        area.x + (area.w * (col + 0.5)) / 6,
        m + 12,
        String(col + 1),
        2.5,
        "middle",
      ),
    );
  for (let row = 0; row < 4; row++)
    out.push(
      text(m + 3, area.y + (area.h * (row + 0.5)) / 4, "ABCD"[row]!, 2.5),
    );
  for (const link of draft.links) {
    out.push(
      `<a href="#sheet-${link.to}" data-continuation-id="${attr(link.id)}" data-continuation-end="${link.end}" data-conductor-id="${attr(link.conductor)}" aria-label="${attr(`Continue ${link.conductor} on sheet ${link.to}.${link.toZone}`)}">`,
    );
    const sign = link.side === "left" || link.side === "top" ? -1 : 1;
    out.push(
      link.side === "left" || link.side === "right"
        ? line(link.x, link.y, link.x + sign * 2, link.y)
        : line(link.x, link.y, link.x, link.y + sign * 2),
    );
    out.push(continuationLabelSvg(link));
    out.push("</a>");
  }
  out.push(
    line(m, titleTop, page.widthMm - m, titleTop),
    line(page.widthMm - m - 66, titleTop, page.widthMm - m - 66, bottom),
  );
  const titleWidth = w - 76;
  let y = titleTop + 5;
  for (const row of wrapPrintableText(
    draft.title.projectName,
    titleWidth,
    3.2,
    true,
  )) {
    out.push(text(m + 4, y, row, 3.2, "start", 700));
    y += 4;
  }
  for (const row of wrapPrintableText(label, titleWidth, 2.8)) {
    out.push(text(m + 4, y, row));
    y += 4;
  }
  for (const entry of draft.title.lines.filter(
    (entry) => entry.field === "title.authored-line",
  )) {
    for (const row of wrapText(entry.value, titleWidth, 2.5)) {
      out.push(text(m + 4, y, row, 2.5));
      y += 4;
    }
  }
  out.push(...legacyFooterNote(draft.note, m + 4, w - 76, bottom, y));
  const revisionRows = wrapPrintableText(
    `REV ${draft.title.revision}`,
    58,
    2.6,
    true,
  );
  if (revisionRows.length > 3)
    throw new Error(
      "Revision is too long for the sheet title block; use at most 96 characters.",
    );
  revisionRows.forEach((row, index) =>
    out.push(
      text(
        page.widthMm - m - 62,
        titleTop + 5 + index * 3,
        row,
        2.6,
        "start",
        700,
      ),
    ),
  );
  out.push(
    text(
      page.widthMm - m - 62,
      bottom - 10,
      `${page.size.toUpperCase()} / ${page.orientation.toUpperCase()}`,
      2.5,
    ),
    text(page.widthMm - m - 62, bottom - 6, RELEASE_STAMP, 2.5),
    text(
      page.widthMm - m - 62,
      bottom - 2.5,
      `SHEET ${number} OF ${total}`,
      2.5,
    ),
    "</svg>",
  );
  return out.join("\n") + "\n";
}
