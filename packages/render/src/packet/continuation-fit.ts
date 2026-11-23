import { hasCompactFrame } from "./frame-profile.js";
import { compactFramePlan } from "./frame-plan.js";
import { continuationInk } from "./frame-banks.js";
import { required } from "../presentation/util.js";
import { packContinuationLabels } from "./continuation-pack.js";
import {
  continuationPackingConstraint,
  continuationShortfall,
} from "./continuation-constraint.js";
import type { Draft, PaperPage } from "./types.js";
import type { ContinuationBank } from "./continuation-bank.js";
import {
  CONTINUATION_BLOCK_GAP,
  continuationLabel,
} from "./continuation-label.js";
import { inkOverlaps, textInk } from "./rooted-caption.js";
import { bounds } from "./page.js";
import {
  rootedNoticeLines,
  rootedSheetNoticeWidth,
  rootedSheetNoticeX,
  rootedSheetView,
} from "../off-view/notice.js";
import { printableTextMetrics } from "../text-metrics.js";
import type { InkBox } from "./rooted-ink.js";

export const LEFT_CONTINUATION_RULE_CLEARANCE_MM = 1.5;

function zoneLetterColumnRight(page: PaperPage): number {
  const letterStart = hasCompactFrame(page)
    ? page.marginMm + 0.6
    : page.marginMm + 3;
  // "D" is the widest uppercase zone letter in the pinned face.
  const letterRight = letterStart + printableTextMetrics("D", 2.5).right;
  const tickRight = hasCompactFrame(page) ? page.marginMm + 1.5 : letterRight;
  return Math.max(letterRight, tickRight);
}

const near = (a: InkBox, b: InkBox, gap = 1) =>
  inkOverlaps(
    {
      x: a.x - gap + 0.001,
      y: a.y - gap + 0.001,
      w: a.w + 2 * (gap - 0.001),
      h: a.h + 2 * (gap - 0.001),
    },
    b,
  );
function fixedInk(d: Draft, page: PaperPage, native: boolean): InkBox[] {
  const b = d.drawingBounds ?? bounds(d.title, page),
    m = page.marginMm,
    v = rootedSheetView(d.view);
  const result = [...(d.rootedCaptionInk ?? [])];
  if (v && !native) {
    const noticeX = rootedSheetNoticeX(page, b.x);
    rootedNoticeLines(v, rootedSheetNoticeWidth(page, noticeX), 2.7).forEach(
      (l, i) =>
        result.push(textInk(l.text, noticeX, m + 19 + 4 * i, 2.7, l.bold)),
    );
  }
  if (hasCompactFrame(page)) return result;
  for (let col = 0; col < 6; col++)
    result.push(
      textInk(
        String(col + 1),
        b.x + (b.w * (col + 0.5)) / 6,
        m + 12,
        2.5,
        false,
        "middle",
      ),
    );
  for (let row = 0; row < 4; row++)
    result.push(
      textInk(
        required("ABCD"[row], "Missing zone row"),
        m + 3,
        b.y + (b.h * (row + 0.5)) / 4,
        2.5,
      ),
    );
  return result;
}
/** Validate reserved physical ink after cropping/folding, before picking a grid. */
export function fitContinuations(
  drafts: Draft[],
  page: PaperPage,
  bank: ContinuationBank,
  native = false,
): string | undefined {
  for (const d of drafts) {
    const fieldLeft =
      (d.drawingBounds ?? bounds(d.title, page, rootedSheetView(d.view))).x +
      0.1;
    for (const l of d.links)
      l.label = continuationLabel(
        l,
        bank.width,
        bank.headerWidth,
        bank.single,
        fieldLeft,
      );
    const mixed = d.links.find((l) => l.label?.single !== bank.single);
    if (mixed)
      return `Continuation ${mixed.id} (${mixed.conductor}) needs the same form as its bank. Use a two-level bank for a descriptor, or another legal cut.`;
    if (!packContinuationLabels(d, fieldLeft))
      return continuationPackingConstraint(d.links);
    const failure = continuationInkFailure(d, page, native);
    if (failure) return failure;
  }
  return undefined;
}

function continuationMinX(
  side: string,
  serviceX: number,
  zoneFieldX: number,
  page: PaperPage,
) {
  return side === "left"
    ? Math.max(
        serviceX,
        zoneLetterColumnRight(page) + LEFT_CONTINUATION_RULE_CLEARANCE_MM,
      )
    : Math.max(serviceX, zoneFieldX);
}

/** Validate existing placement without resetting or repacking a legacy bank. */
export function continuationInkFailure(
  d: Draft,
  page: PaperPage,
  native = false,
  finalGlyphs = false,
): string | undefined {
  const frame = page.marginMm + 1.2,
    footer = bounds(d.title, page),
    bottom = footer.y + footer.h + 14 - 1.2;
  const plan = hasCompactFrame(page)
    ? compactFramePlan(d.title, page, rootedSheetView(d.view))
    : undefined;
  const zoneField =
    d.drawingBounds ?? bounds(d.title, page, rootedSheetView(d.view));
  const service = plan?.service ?? {
    x: frame,
    y: frame,
    w: page.widthMm - 2 * frame,
    h: bottom - frame,
  };
  const occupied = [...fixedInk(d, page, native), ...(d.rootedShapes ?? [])];
  const labels: InkBox[] = [];
  for (const l of d.links) {
    const glyphs = plan ? continuationInk(l, finalGlyphs) : [];
    const X = Math.min(...glyphs.map((b) => b.x)),
      Y = Math.min(...glyphs.map((b) => b.y));
    const box = plan
      ? {
          x: X,
          y: Y,
          w: Math.max(...glyphs.map((b) => b.x + b.w)) - X,
          h: Math.max(...glyphs.map((b) => b.y + b.h)) - Y,
        }
      : required(l.label, "Missing continuation label").bounds;
    const rowInk =
      finalGlyphs && plan
        ? glyphs
        : required(l.label, "Missing continuation label").rows.map(
            (r) => r.ink,
          );
    if (
      rowInk.some(
        (ink) =>
          occupied.some((o) => near(ink, o)) ||
          labels.some((o) => near(ink, o, CONTINUATION_BLOCK_GAP)),
      )
    )
      return `Continuation ${l.id} (${l.conductor}) cannot keep clear ink at the ${l.side} cut (${box.w.toFixed(2)} × ${box.h.toFixed(2)} mm): 1 mm to drawing content; ${CONTINUATION_BLOCK_GAP} mm between continuation blocks. The 1 mm clearance is short by ${continuationShortfall(
        rowInk,
        [...occupied, ...labels],
      ).toFixed(2)} mm. Use a larger sheet, landscape or another flow.`;
    const minX = continuationMinX(l.side, service.x, zoneField.x, page);
    const short = Math.max(
      minX - box.x,
      box.x + box.w - service.x - service.w,
      service.y - box.y,
      box.y + box.h - service.y - service.h,
    );
    if (short > 0.001)
      return `Continuation ${l.id} (${l.conductor}) needs ${box.w.toFixed(2)} × ${box.h.toFixed(2)} mm at the ${l.side} cut; sheet clearance is short by ${short.toFixed(2)} mm. Use a larger sheet, landscape or another flow.`;
    labels.push(...rowInk);
  }
  return undefined;
}
