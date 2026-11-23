import { titleFrameContext } from "../internal/title-data/frame-context.js";
import type { SchematicTitleContext } from "../title-block.js";
import type { NormalizedSchematicView } from "../types.js";
import { printableTextMetrics, wrapPrintableText } from "../text-metrics.js";
import {
  rootedNoticeLines,
  rootedSheetNoticeWidth,
} from "../off-view/notice.js";
import type { DrawingBounds, PaperPage } from "./types.js";

export interface FrameText {
  readonly field: string;
  readonly value: string;
  readonly size: number;
  readonly bold: boolean;
}
export interface FramePlan {
  readonly profile: "compact";
  readonly grid: { readonly columns: 6; readonly rows: 4 };
  readonly drawing: Readonly<DrawingBounds>;
  readonly service: Readonly<DrawingBounds>;
  readonly lanes: readonly Readonly<DrawingBounds>[];
  readonly title: {
    readonly top: number;
    readonly height: number;
    readonly legacyHeight: number;
    readonly headerRecovery: number;
    readonly rows: readonly FrameText[];
  };
}

/** Preserve the existing title's row budget and typography. Measure ink as well
 * as row count: a descender must remain 1 mm from the author-cell rule. */
export function compactTitleRows(
  title: SchematicTitleContext,
  page: PaperPage,
  planning = true,
): FrameText[] {
  const width = page.widthMm - 2 * page.marginMm - 76;
  const rows = (value: string, size: number, bold = false, field = "notes") =>
    wrapPrintableText(value, width, size, bold).map((value) =>
      Object.freeze({ value, size, bold, field }),
    );
  const selected =
    title.lines.find((e) => e.field === "title.view-line")?.value ?? "";
  const candidates = planning
    ? [selected, ...(title.titleCandidates ?? [])]
    : [selected];
  const headingRows = candidates.map((value) =>
    rows(value, 2.8, false, "sheetTitle"),
  );
  const measured = headingRows.map((lines) => ({
    lines,
    extent: Math.max(
      ...lines.map(
        (row, i) =>
          4 * i - printableTextMetrics(row.value, row.size, row.bold).bottom,
      ),
    ),
  }));
  const largest = measured.reduce((a, b) => (a.extent >= b.extent ? a : b));
  return [
    ...rows(title.projectName, 3.2, true, "project"),
    ...largest.lines,
    ...title.lines
      .filter((e) => e.field === "title.authored-line")
      .flatMap((e) => rows(e.value, 2.5)),
    ...(titleFrameContext(page)?.presentation.frame?.generatorStamp === "title"
      ? rows(
          `Tool: Thermite Schematics ${title.toolVersion}`,
          2.5,
          false,
          "generatorStamp",
        )
      : []),
  ];
}

/** Recovery is bounded by painted header/notice ink, not a fixed assumption. */
export function headerRecovery(
  baseTop: number,
  paintedBottom: number,
  wanted: number,
): number {
  return Math.max(0, Math.min(wanted, baseTop - paintedBottom - 1));
}

function buildCompactFramePlan(
  title: SchematicTitleContext,
  page: PaperPage,
  rooted?: NormalizedSchematicView,
  drawing?: DrawingBounds,
): FramePlan {
  const m = page.marginMm,
    bottom = page.heightMm - m;
  const rows = compactTitleRows(title, page);
  const legacyHeight = Math.max(28, 14 + rows.length * 4);
  const inkHeight = Math.max(
    ...rows.map(
      (r, i) =>
        5 +
        i * 4 -
        printableTextMetrics(r.value, r.size, r.bold).bottom +
        14.125,
    ),
  );
  const height =
    Math.ceil(
      Math.max(legacyHeight + (rows.length > 3 ? 2 : 0), inkHeight) * 1000,
    ) / 1000;
  const top = bottom - height;
  const notice = rooted
    ? rootedNoticeLines(rooted, rootedSheetNoticeWidth(page), 2.7)
    : [];
  const noticeHeight = rooted ? notice.length * 4 + 4 : 0;
  const baseTop = m + 21 + noticeHeight;
  const paintedBottom = Math.max(
    m + 12 - printableTextMetrics("123456", 2.5).bottom,
    ...notice.map(
      (r, i) =>
        m + 19 + 4 * i - printableTextMetrics(r.text, 2.7, r.bold).bottom,
    ),
  );
  const recovery =
    rows.length > 3 ? headerRecovery(baseTop, paintedBottom, 2) : 0;
  const area = drawing ?? {
    x: m + 18,
    y: baseTop - recovery,
    w: page.widthMm - 2 * m - 36,
    h: page.heightMm - 2 * m - height - 35 - noticeHeight + recovery,
  };
  const service = {
    x: m + 2.9,
    y: m + 13.3,
    w: page.widthMm - 2 * m - 5.8,
    h: top - 3.3 - (m + 13.3),
  };
  return Object.freeze({
    profile: "compact",
    grid: Object.freeze({ columns: 6, rows: 4 }),
    drawing: Object.freeze({ ...area }),
    service: Object.freeze(service),
    lanes: frameLanes(page, top),
    title: Object.freeze({
      top,
      height,
      legacyHeight,
      headerRecovery: recovery,
      rows: Object.freeze(rows),
    }),
  });
}

// A normalized page owns its immutable plans. Repeated consumers, including
// cloned drafts, share the same plan for the same final title/grid geometry.
const plans = new WeakMap<PaperPage, Map<string, FramePlan>>();
export function compactFramePlan(
  title: SchematicTitleContext,
  page: PaperPage,
  rooted?: NormalizedSchematicView,
  drawing?: DrawingBounds,
): FramePlan {
  let cache = plans.get(page);
  if (!cache) {
    cache = new Map();
    plans.set(page, cache);
  }
  const key = JSON.stringify([title, rooted, drawing]);
  let plan = cache.get(key);
  if (!plan) {
    plan = buildCompactFramePlan(title, page, rooted, drawing);
    cache.set(key, plan);
  }
  return plan;
}

/** Both legend consumers must constrain their extension as well as the field. */
export function compactLegendBounds(
  area: DrawingBounds,
  plan: FramePlan,
  page: PaperPage,
): DrawingBounds {
  const right = Math.min(
    page.widthMm - page.marginMm - 3.34,
    plan.service.x + plan.service.w,
  );
  const bottom = Math.min(
    area.y + area.h + 10.66,
    plan.service.y + plan.service.h,
  );
  return {
    x: Math.max(area.x, plan.service.x),
    y: Math.max(area.y, plan.service.y),
    w: right - Math.max(area.x, plan.service.x),
    h: bottom - Math.max(area.y, plan.service.y),
  };
}

function frameLanes(page: PaperPage, top: number) {
  const m = page.marginMm;
  const lanes = [
    { x: m, y: m + 13, w: 2.6, h: top - 3 - (m + 13) },
    { x: page.widthMm - m - 2.6, y: m + 13, w: 2.6, h: top - 3 - (m + 13) },
    { x: m, y: m + 7.8, w: page.widthMm - 2 * m, h: 5.2 },
    { x: m, y: top - 3, w: page.widthMm - 2 * m, h: 3 },
  ];
  return Object.freeze(lanes.map((l) => Object.freeze(l)));
}
