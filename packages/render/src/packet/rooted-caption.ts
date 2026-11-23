import { pinnedMetrics } from "../off-view/metrics.js";
import {
  rootedNoticeLines,
  rootedSheetNoticeWidth,
  rootedSheetNoticeX,
} from "../off-view/notice.js";
import { fieldTextLeft } from "./svg.js";
import type { NormalizedSchematicView } from "../types.js";
import type { Draft, DrawingBounds, Link, PaperPage } from "./types.js";

export function textInk(
  value: string,
  x: number,
  y: number,
  size: number,
  bold = false,
  anchor = "start",
) {
  const m = pinnedMetrics(value, size, bold);
  const start =
    x -
    (anchor === "middle" ? m.advance / 2 : anchor === "end" ? m.advance : 0);
  return {
    x: start + m.left,
    y: y - m.top,
    w: m.right - m.left,
    h: m.top - m.bottom,
  };
}
type Ink = ReturnType<typeof textInk>;
export const HEADING_CLEARANCE_MM = 1.5;
export function inkOverlaps(a: Ink, b: Ink) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
function inkWithinGap(a: Ink, b: Ink, gap: number) {
  return inkOverlaps(
    {
      x: a.x - gap + 0.001,
      y: a.y - gap + 0.001,
      w: a.w + 2 * (gap - 0.001),
      h: a.h + 2 * (gap - 0.001),
    },
    b,
  );
}
/** Compute the continued-location header baseline centered in the header lane
 * so both the rooted notice above and top continuations below keep >= 1.5 mm. */
export function continuedCaptionY(
  originalY: number,
  page: PaperPage,
  view: NormalizedSchematicView,
  native = false,
) {
  const preferred = originalY - 10.035;
  if (native) return preferred;
  const noticeX = rootedSheetNoticeX(page);
  const notices = rootedNoticeLines(
    view,
    rootedSheetNoticeWidth(page, noticeX),
    2.7,
  ).map((l, i) =>
    textInk(
      l.text,
      fieldTextLeft(noticeX, l.text, 2.7, l.bold),
      page.marginMm + 19 + 4 * i,
      2.7,
      l.bold,
    ),
  );
  if (!notices.length) return preferred;
  const noticeBottom = Math.max(...notices.map((n) => n.y + n.h));
  const sample = textInk("CONTINUED LOCATION: A", 0, 0, 2.5);
  const minBaseline = noticeBottom + HEADING_CLEARANCE_MM - sample.y;
  return Math.max(preferred, minBaseline);
}

/** The caption has its own lane between the complete notice and top links. */
export function captionConstraint(
  caption: string,
  b: DrawingBounds,
  page: PaperPage,
  view: NormalizedSchematicView,
  links: readonly Link[],
  captionY = b.y - 10.035,
) {
  if (!caption) return undefined;
  return captionInkConstraint(
    textInk(caption, b.x, captionY, 2.5),
    b,
    page,
    view,
    links,
  );
}
function captionInkConstraint(
  ink: Ink,
  b: DrawingBounds,
  page: PaperPage,
  view: NormalizedSchematicView,
  links: readonly Link[],
) {
  const shortfall = Math.max(b.x - ink.x, ink.x + ink.w - b.x - b.w);
  if (shortfall > 0.001)
    return `Continued-location caption exceeds its header width by ${shortfall.toFixed(2)} mm. Use a larger sheet or landscape.`;
  const noticeX = rootedSheetNoticeX(page, b.x);
  const notices = rootedNoticeLines(
    view,
    rootedSheetNoticeWidth(page, noticeX),
    2.7,
  ).map((l, i) =>
    textInk(
      l.text,
      fieldTextLeft(noticeX, l.text, 2.7, l.bold),
      page.marginMm + 19 + 4 * i,
      2.7,
      l.bold,
    ),
  );
  const captions = links.flatMap((l) => l.label?.rows.map((r) => r.ink) ?? []);
  if (
    [...notices, ...captions].some((other) =>
      inkWithinGap(ink, other, HEADING_CLEARANCE_MM),
    )
  )
    return "Continued-location caption ink overlaps or lacks 1.5 mm clearance from the notice or a continuation. Use a larger sheet or landscape.";
  return undefined;
}

/** Recheck the actual final caption ink, including captions rebuilt by trimming
 * and translated by stacking. Notice wrapping participates in the same test. */
export function postTrimCaptionConstraint(
  drafts: readonly Draft[],
  page: PaperPage,
  native = false,
) {
  if (native) return undefined;
  for (const d of drafts) {
    if (!d.drawingBounds || !d.view.format.startsWith("schematic-view/"))
      continue;
    for (const ink of d.rootedCaptionInk ?? []) {
      const constraint = captionInkConstraint(
        ink,
        d.drawingBounds,
        page,
        d.view as NormalizedSchematicView,
        d.links,
      );
      if (constraint) return constraint;
    }
  }
  return undefined;
}
