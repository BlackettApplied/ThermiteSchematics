import { hasCompactFrame } from "./frame-profile.js";
import { compactFramePlan, compactLegendBounds } from "./frame-plan.js";
import type { ElectricalIr } from "@thermite/compiler";
import { addDeviceLegend } from "../device-legend.js";
import { invariant, required } from "../presentation/util.js";
import { emitSchematicSvg } from "../svg/emitter.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";
import { safeAxisPlans } from "./safe-cuts.js";
import { protectedDrawingIntervals } from "./rooted-geometry.js";
import { rootedDraft } from "./rooted-draft.js";
import { gridLinks, type RootedGrid } from "./rooted-plans.js";
import { contentPages } from "./rooted-content.js";
import { fitContinuations } from "./continuation-fit.js";
import { bounds, frame } from "./page.js";
import { rootedLocationContent } from "./location-headings.js";
import { draftCompositionFits } from "./composition-fit.js";
import { trimLegendStrip } from "./legend-strip.js";
import type { Draft, PaperPage, RootedLegendSource } from "./types.js";
import type { RenderFailure } from "../types.js";
import { rootedPageCostFailure } from "./rooted-bound.js";
import type { LegendSearchCap } from "./legend-search-limits.js";
export interface LegendSearchFailure {
  tail?: { start: number; failure: RenderFailure };
  bound?: RenderFailure;
  stops?: Set<LegendSearchCap>;
}

export function recordLegendCap(
  failures: LegendSearchFailure | undefined,
  cap: LegendSearchCap,
) {
  if (failures) (failures.stops ??= new Set()).add(cap);
}

interface BandContext {
  ir: Readonly<ElectricalIr>;
  source: RootedLegendSource;
  original: readonly Draft[];
  page: PaperPage;
  inner: string;
  axis: "xs" | "ys";
  failures?: LegendSearchFailure;
}
function bandDrafts(c: BandContext, points: number[], inner: string) {
  const p = c.source.prepared,
    grid: RootedGrid = { ...c.source.grid, [c.axis]: points },
    first = required(c.original[0], "Missing original legend draft"),
    b = required(first.drawingBounds, "Missing legend drawing bounds"),
    drafts: Draft[] = [];
  for (let row = 0; row < grid.ys.length - 1; row++)
    for (let col = 0; col < grid.xs.length - 1; col++)
      drafts.push(
        rootedDraft(
          p,
          grid,
          col,
          row,
          b,
          c.source.scale,
          inner,
          c.source.profile,
          first.continuedCaptionY,
        ),
      );
  if (!gridLinks(p, grid, b, c.source.scale, drafts)) return undefined;
  return drafts.map((d) => trimLegendStrip(c.source, d, inner));
}
function legendSpan(c: BandContext, start: number, end: number) {
  const p = c.source.prepared,
    length = (c.axis === "ys" ? p.layout.height : p.layout.width) + 2 * pad,
    points = [...new Set([0, start, end, length])],
    drafts = bandDrafts(c, points, c.inner);
  if (!drafts) return false;
  const position = points.indexOf(start),
    area = bounds(p.titleContext, c.page, p.view),
    bank = required(c.original[0]?.rootedBank, "Missing legend caption bank"),
    columns = c.source.grid.xs.length - 1;
  return drafts.every((d, i) => {
    if (
      !(c.axis === "ys"
        ? Math.floor(i / columns) === position
        : i % (points.length - 1) === position)
    )
      return true;
    if (!d.rootedContent?.figures)
      return !d.rootedContent?.conductors && !d.links.length;
    // A probe reserves the existing caption bank at the alpha's largest sheet
    // address. Final assembly still resolves and validates the real reciprocal ends.
    for (const link of d.links) {
      link.to = 99;
      link.toZone = "D6";
    }
    if (fitContinuations([d], c.page, bank)) return false;
    const result = addDeviceLegend(
      c.ir,
      frame(d, c.page, 99, 100),
      hasCompactFrame(c.page)
        ? compactLegendBounds(
            area,
            compactFramePlan(p.titleContext, c.page, p.view),
            c.page,
          )
        : {
            ...area,
            w: c.page.widthMm - c.page.marginMm - 3.34 - area.x,
            h: area.h + 10.66,
          },
      1,
      false,
      p.view,
    );
    if (
      !result.ok &&
      end === length &&
      c.failures &&
      start >= (c.failures.tail?.start ?? -1)
    )
      c.failures.tail = { start, failure: result.error };
    return result.ok;
  });
}
function bandContext(
  ir: Readonly<ElectricalIr>,
  original: readonly Draft[],
  page: PaperPage,
): BandContext | undefined {
  const first = original[0],
    source = first?.rootedLegendSource;
  if (!source || !first.rootedBank) return;
  const p = source.prepared,
    emitted = emitSchematicSvg(
      p.graph,
      p.layout,
      p.titleContext,
      undefined,
      true,
      source.scale,
      ir,
    );
  invariant(emitted.ok, "Validated rooted drawing failed legend re-emission");
  const c: BandContext = {
    ir,
    source,
    original,
    page,
    axis: p.view.flow === "top-to-bottom" ? "ys" : "xs",
    inner: emitted.value
      .replace(/^<\?xml[^>]*>\s*/, "")
      .replace(/^<svg[^>]*>\s*/, "")
      .replace(/<\/svg>\s*$/, ""),
  };
  return c;
}
/** Reserve legend space by recutting the selected drawing, never by another
 * ELK/routing attempt. The same protected gaps, MAX_GAP_POINTS, MAX_AXIS_PLANS
 * and MAX_CUTS bound this search; whole packets retain the original 2× cost cap. */
export function* legendPagination(
  ir: Readonly<ElectricalIr>,
  original: readonly Draft[],
  page: PaperPage,
  otherViews: readonly Draft[],
  failures?: LegendSearchFailure,
): Generator<Draft[]> {
  const c = bandContext(ir, original, page);
  if (!c) return;
  if (failures) c.failures = failures;
  const { source } = c,
    first = required(original[0], "Missing legend source"),
    p = source.prepared;
  const protecteds = protectedDrawingIntervals(p.layout, pad),
    b = required(first.drawingBounds, "Missing legend drawing bounds"),
    cache = new Map<string, boolean>(),
    plans = safeAxisPlans(
      (c.axis === "ys" ? p.layout.height : p.layout.width) + 2 * pad,
      (c.axis === "ys" ? b.h : b.w) / source.scale,
      c.axis === "ys" ? protecteds.protectedY : protecteds.protectedX,
      () => true,
      (start, end) => {
        const key = `${start}:${end}`;
        if (!cache.has(key)) cache.set(key, legendSpan(c, start, end));
        return required(cache.get(key), "Missing legend span result");
      },
      (cap) => recordLegendCap(failures, cap),
    );
  for (const plan of plans) {
    const geometry = bandDrafts(c, plan, "");
    if (!geometry) continue;
    const drafts = bandDrafts(
      c,
      plan,
      rootedLocationContent(c.inner, p, geometry),
    );
    if (!drafts) continue;
    const visible = contentPages(drafts);
    if (typeof visible === "string") continue;
    const fit = first.rootedFit,
      bank = required(first.rootedBank, "Missing legend caption bank");
    required(visible[0], "Missing legend page").rootedFit = {
      basePages: fit?.basePages ?? original.length,
      actualPages: visible.length,
      context: fit?.context ?? "legend band",
    };
    for (const d of visible) d.rootedBank = bank;
    const bound = rootedPageCostFailure([...otherViews, ...visible]);
    if (bound && failures) failures.bound = bound;
    if (
      draftCompositionFits(
        visible,
        bank,
        fit?.basePages ?? original.length,
        page,
        otherViews,
      )
    )
      yield visible;
  }
}
