import { circuitTextLines } from "../circuit.js";

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
import { n, text, line, wrap } from "./svg.js";

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
  const max = Math.floor((page.widthMm - 2 * page.marginMm - 76) / 1.6);
  const view =
    title.lines.find((entry) => entry.field === "title.view-line")?.value ?? "";
  if (
    title.lines.some(
      (entry) =>
        ["circuit", "connector-assembly"].includes(entry.ownerId) &&
        entry.field === "title.view-line",
    )
  ) {
    const width = page.widthMm - 2 * page.marginMm - 76;
    return Math.max(
      28,
      14 +
        (circuitTextLines(title.projectName, width, 3.2).length +
          circuitTextLines(view, width, 2.7).length +
          custom.flatMap((entry) => circuitTextLines(entry.value, width, 2.5))
            .length) *
          4,
    );
  }
  return Math.max(
    28,
    14 +
      (wrap(title.projectName, max).length +
        wrap(view, max).length +
        custom.flatMap((entry) => wrap(entry.value, max)).length) *
        4,
  );
}
export function bounds(
  title: SchematicTitleContext,
  page: PaperPage,
): DrawingBounds {
  const m = page.marginMm;
  return {
    x: m + 18,
    y: m + 21,
    w: page.widthMm - 2 * m - 36,
    h: page.heightMm - 2 * m - titleHeight(title, page) - 35,
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
  const m = page.marginMm,
    w = page.widthMm - 2 * m,
    bottom = page.heightMm - m;
  const titleTop = bottom - titleHeight(draft.title, page);
  const label = sheetLabel(draft.view);
  const prefix = `sheet-${number}-`;
  // Text is XML-escaped by the emitter. Scope rewriting to real tag attributes
  // so a designation containing id="..." or url(#...) remains verbatim.
  const content = draft.content.replace(/<[^>]+>/g, (tag) =>
    tag
      .replace(/(?<=\s)id="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
      .replace(
        /(?<=\s)clip-path="url\(#([^)]+)\)"/g,
        (_, id: string) => `clip-path="url(#${prefix}${id})"`,
      ),
  );
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.widthMm)}mm" height="${n(page.heightMm)}mm" viewBox="0 0 ${n(page.widthMm)} ${n(page.heightMm)}" role="img" aria-label="${attr(`${label}, sheet ${number} of ${total}`)}" data-sheet="${number}" data-total-sheets="${total}" data-paper="${page.size}">`,
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
  const area = draft.drawingBounds ?? bounds(draft.title, page);
  for (let col = 0; col < 6; col++)
    out.push(
      text(
        area.x + (area.w * (col + 0.5)) / 6,
        m + 12,
        String(col + 1),
        2.2,
        "middle",
      ),
    );
  for (let row = 0; row < 4; row++)
    out.push(
      text(m + 3, area.y + (area.h * (row + 0.5)) / 4, "ABCD"[row]!, 2.2),
    );
  for (const link of draft.links) {
    out.push(
      `<a href="#sheet-${link.to}" aria-label="Continue on sheet ${link.to}">`,
    );
    const label = `${link.id} / ${String(link.to).padStart(2, "0")}`;
    if (link.side === "left" || link.side === "right") {
      const sign = link.side === "left" ? -1 : 1;
      out.push(
        line(link.x, link.y, link.x + sign * 2, link.y),
        text(
          link.x + sign * 3,
          link.y + 0.8,
          label,
          2.2,
          sign < 0 ? "end" : "start",
        ),
      );
    } else {
      const sign = link.side === "top" ? -1 : 1;
      out.push(
        line(link.x, link.y, link.x, link.y + sign * 2),
        text(link.x, link.y + sign * 4, label, 2.2, "middle"),
      );
    }
    out.push("</a>");
  }
  out.push(
    line(m, titleTop, page.widthMm - m, titleTop),
    line(page.widthMm - m - 66, titleTop, page.widthMm - m - 66, bottom),
  );
  const max = Math.floor((w - 76) / 1.6);
  const circuit =
    draft.view.format === "documentation-view/0.1" &&
    ["circuit", "connector-assembly"].includes(draft.view.kind);
  let y = titleTop + 5;
  for (const row of circuit
    ? circuitTextLines(draft.title.projectName, w - 76, 3.2)
    : wrap(draft.title.projectName, max)) {
    out.push(text(m + 4, y, row, 3.2, "start", 700));
    y += 4;
  }
  for (const row of circuit
    ? circuitTextLines(label, w - 76, 2.7)
    : wrap(label, max)) {
    out.push(text(m + 4, y, row));
    y += 4;
  }
  for (const entry of draft.title.lines.filter(
    (entry) => entry.field === "title.authored-line",
  )) {
    for (const row of circuit
      ? circuitTextLines(entry.value, w - 76, 2.5)
      : wrap(entry.value, max)) {
      out.push(text(m + 4, y, row, 2.5));
      y += 4;
    }
  }
  out.push(text(m + 4, bottom - 3, draft.note, 2.2));
  const revisionRows = circuit
    ? circuitTextLines(`REV ${draft.title.revision}`, 58, 2.6)
    : wrap(`REV ${draft.title.revision}`, 34);
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
      2.4,
    ),
    text(page.widthMm - m - 62, bottom - 6, "Thermite 0.3.0-alpha.2", 2.4),
    text(
      page.widthMm - m - 62,
      bottom - 2.5,
      `SHEET ${number} OF ${total}`,
      2.4,
    ),
    "</svg>",
  );
  return out.join("\n") + "\n";
}
