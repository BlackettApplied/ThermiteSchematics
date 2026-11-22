import { continuationBankSources } from "./continuation-bank-sources.js";
import { maximumContinuationSerial } from "./continuation-reservation.js";
import { rootedGrids } from "./rooted-plans.js";
import { rootedCrossings } from "./rooted-crossings.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { DrawingBounds } from "./types.js";
import { reserveContinuationSources } from "./continuation-source.js";
import { continuationHeaderWidth } from "./continuation-label.js";
import { labelMetrics, labelRows } from "./label-text.js";

export interface ContinuationBank {
  width: number;
  headerWidth: number;
  single: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  extra?: { readonly left: number; readonly right: number };
}
export const CONTINUATION_BANK_FORMS = [false, true] as const;
export const FALLBACK_BANK_RESERVATIONS = [1.7, 3.5] as const;
// Physical caption envelopes and the existing gutters, all in sheet mm.
const SIDE_CAPTION_INSET = { left: 9.35, right: 4.35 };
const VERTICAL_CAPTION_INSET = 4.15;
const NATIVE_GUTTER = { left: 18, right: 18, top: 8.96, bottom: 14 };
/** Finite measured paper reservations; cuts consume these before acceptance. */
export function continuationBanks(
  p: PreparedSchematicDrawing,
  b: DrawingBounds,
  scale: number,
  offset = 0,
  extraReservations = false,
): ContinuationBank[] {
  const seeds = rootedGrids(p, b, scale);
  const sides = new Set(
    seeds.flatMap((g) =>
      p.layout.edges
        .flatMap((e) => rootedCrossings(e, g.xs, g.ys, b, scale))
        .flatMap((c) => [c.a.side, c.z.side]),
    ),
  );
  const xCuts = sides.has("left") || sides.has("right"),
    yCuts = sides.has("top") || sides.has("bottom");
  const maximumSerial = maximumContinuationSerial(p, offset);
  const headerWidth = continuationHeaderWidth(maximumSerial);
  const sources = reserveContinuationSources(p.graph);
  const cutSources = continuationBankSources(p, seeds, b, scale);
  const maxBody = Math.max(headerWidth, ...sources.map((s) => s.width));
  const plans: ContinuationBank[] = [];
  for (const single of CONTINUATION_BANK_FORMS) {
    const width = maxBody;
    const side = (name: string) =>
      bankExtent(cutSources(name), width, headerWidth, single);
    const plan = {
      width,
      headerWidth,
      single,
      left: xCuts
        ? Math.max(
            0,
            side("left").maxW + SIDE_CAPTION_INSET.left - NATIVE_GUTTER.left,
          )
        : 0,
      right: xCuts
        ? Math.max(
            0,
            side("right").maxW + SIDE_CAPTION_INSET.right - NATIVE_GUTTER.right,
          )
        : 0,
      top: yCuts
        ? Math.max(
            0,
            side("top").maxH + VERTICAL_CAPTION_INSET - NATIVE_GUTTER.top,
          )
        : 0,
      bottom: yCuts
        ? Math.max(
            0,
            side("bottom").maxH + VERTICAL_CAPTION_INSET - NATIVE_GUTTER.bottom,
          )
        : 0,
    };
    if (!plans.some((p) => JSON.stringify(p) === JSON.stringify(plan)))
      plans.push(plan);
  }
  if (extraReservations) appendFallbackBanks(plans, sides);
  return plans;
}
export function bankBounds(b: DrawingBounds, bank: ContinuationBank) {
  return {
    ...b,
    x: b.x + bank.left,
    y: b.y + bank.top,
    w: b.w - bank.left - bank.right,
    h: b.h - bank.top - bank.bottom,
  };
}

function bankExtent(
  sources: ReturnType<typeof reserveContinuationSources>,
  width: number,
  headerWidth: number,
  single: boolean,
) {
  const header = labelMetrics("C0123456789 / .ABCD");
  let maxW = headerWidth,
    maxH = 0;
  for (const s of sources) {
    const values =
      single && !s.descriptor
        ? [` / ${s.conductor}`]
        : [
            ...(s.descriptor ? labelRows(s.descriptor, width) : []),
            s.conductor,
          ];
    const ms = values.map((v) => labelMetrics(v));
    const h =
      single && !s.descriptor
        ? Math.max(header.top, ...ms.map((m) => m.top)) -
          Math.min(header.bottom, ...ms.map((m) => m.bottom))
        : Math.max(header.top, ...ms.map((m) => m.top)) +
          values.length * 3.5 -
          Math.min(header.bottom, ...ms.map((m) => m.bottom));
    maxH = Math.max(maxH, h);
    maxW = Math.max(
      maxW,
      single && !s.descriptor
        ? headerWidth + Math.max(...ms.map((m) => m.width))
        : Math.max(headerWidth, ...ms.map((m) => m.width)),
    );
  }
  return { maxW, maxH };
}

function appendFallbackBanks(
  plans: ContinuationBank[],
  sides: ReadonlySet<string>,
) {
  for (const extra of FALLBACK_BANK_RESERVATIONS)
    for (const plan of [...plans].slice(0, CONTINUATION_BANK_FORMS.length)) {
      if (sides.has("left") || sides.has("right"))
        plans.push({
          ...plan,
          left: plan.left + (sides.has("left") ? extra : 0),
          right: plan.right + (sides.has("right") ? extra : 0),
          extra: {
            left: sides.has("left") ? extra : 0,
            right: sides.has("right") ? extra : 0,
          },
        });
    }
}
