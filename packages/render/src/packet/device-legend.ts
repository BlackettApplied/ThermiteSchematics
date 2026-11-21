import { hasCompactFrame } from "./frame-profile.js";
import { compactFramePlan, compactLegendBounds } from "./frame-plan.js";
import {
  legendPagination,
  recordLegendCap,
  type LegendSearchFailure,
} from "./legend-pagination.js";
import type { ElectricalIr } from "@thermite/compiler";
import { addDeviceLegend, rootedLegendView } from "../device-legend.js";
import type { RenderOutcome } from "../types.js";
import type { Draft, PaperPage, RenderedSheet } from "./types.js";
import type { PacketViewContext } from "./errors.js";
import { assembleSheets, appendViewDrafts } from "./assembly.js";
import { bounds } from "./page.js";
import { rootedPageCostFailure } from "./rooted-bound.js";
import { draftCompositionFits } from "./composition-fit.js";
import { SECTION_GAP } from "./fold-stack.js";
import { stackSections } from "./fold-stack.js";
import { required } from "../presentation/util.js";
import { legendBoundFailure } from "./legend-bound-failure.js";
import { LEGEND_PACKET_SHEET_LIMIT } from "./legend-search-limits.js";
import { centroidReferences } from "./navigation-occurrences.js";
import { finalizeNavigation } from "./navigation-finalize.js";
import { finalizeWireSchedules } from "./wire-schedule-locations.js";
import { locateStripSheets } from "./terminal-strip-landings.js";
export interface LegendViewDrafts {
  navigationView?: import("./navigation-types.js").NavigationView;
  drafts: Draft[];
  viewIndex: number;
  context: PacketViewContext;
}
export function legendSheets(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  page: PaperPage,
  includeNotice = false,
  documents?: {
    presentation:
      import("@thermite/compiler").CompiledProjectPresentation | undefined;
    standalone: boolean;
  },
): RenderOutcome<RenderedSheet[]> & {
  failedSheet?: number;
  navigation?: import("./navigation-types.js").IssuedNavigation;
} {
  const sheets = assembleSheets(ir, structuredClone(drafts), page);
  for (const [i, sheet] of sheets.entries()) {
    if (!rootedLegendView(sheet.view)) continue;
    const draft = required(drafts[i], "Missing legend geometry"),
      area = bounds(
        draft.title,
        page,
        draft.view as import("../types.js").NormalizedSchematicView,
      );
    // The routed area leaves 14 mm above the title rule for bank labels. Free
    // final-sheet space there is available when actual ink still clears by 3 mm.
    const legend = addDeviceLegend(
      ir,
      sheet.svg,
      hasCompactFrame(page)
        ? compactLegendBounds(
            area,
            compactFramePlan(
              draft.title,
              page,
              draft.view as import("../types.js").NormalizedSchematicView,
            ),
            page,
          )
        : {
            ...area,
            w: page.widthMm - page.marginMm - 3.34 - area.x,
            h: area.h + 10.66,
          },
      1,
      false,
      draft.view as import("../types.js").NormalizedSchematicView,
    );
    if (!legend.ok) return { ...legend, failedSheet: i };
    sheets[i] = { ...sheet, svg: legend.value };
  }
  const finalizedDrafts = structuredClone(drafts);
  const stripLocations = locateStripSheets(ir, finalizedDrafts, sheets, page);
  finalizeWireSchedules(ir, finalizedDrafts, sheets, page, stripLocations);
  const finalized = finalizeNavigation(ir, finalizedDrafts, sheets, {
    notice: includeNotice,
    page,
    ...(documents ? { documents } : {}),
  });
  if (!finalized.ok) return finalized;
  return {
    ok: true,
    value: locatedSheets(drafts, finalized.value),
    navigation: finalized.value.navigation,
  };
}
/** centroidReferences only replaces references; detach that output without
 * cloning unrelated layout graphs and document bodies. */
function locatedSheets(
  drafts: readonly Draft[],
  finalized: {
    sheets: RenderedSheet[];
    navigation: { occurrences: Parameters<typeof centroidReferences>[1] };
  },
) {
  const located = drafts.map((draft) => ({
    ...draft,
    references: structuredClone(draft.references ?? []),
  }));
  centroidReferences(located, finalized.navigation.occurrences);
  return finalized.sheets.map((sheet, i) => ({
    ...sheet,
    references: drafts[i]?.terminalStrip
      ? sheet.references
      : (located[i]?.references ?? sheet.references),
  }));
}

function repartitions(drafts: readonly Draft[], page: PaperPage): Draft[][] {
  const axis = drafts.find((d) => d.rootedPartAxis)?.rootedPartAxis;
  if (!axis || drafts.some((d) => !d.rootedParts || d.rootedPartAxis !== axis))
    return [];
  const parts = drafts.flatMap((d) =>
      required(d.rootedParts, "Missing source strips"),
    ),
    sizes = drafts.flatMap((d) =>
      required(d.rootedPartSizes, "Missing strip sizes"),
    );
  const b = required(drafts[0]?.drawingBounds, "Missing drawing bounds"),
    fit = drafts[0]?.rootedFit;
  const options: Draft[][] = [];
  const band = legendBand(drafts, parts, sizes, b, axis, fit);
  const bank = drafts[0]?.rootedBank;
  if (
    bank &&
    draftCompositionFits(band, bank, fit?.basePages ?? drafts.length, page)
  )
    options.push(band);
  for (let split = 1; split < parts.length; split++) {
    const groups = [
      parts.slice(0, split).map((_, i) => i),
      parts.slice(split).map((_, i) => i + split),
    ];
    const candidate = repackedPartition(drafts, parts, sizes, groups, page);
    if (!candidate) continue;
    options.push(candidate);
  }
  // One bounded band alternative for larger packets; no ELK, new cuts or
  // routing attempts. It remains subject to the original 2× page-cost bound.
  const pages = drafts.length + 1;
  if (pages <= Math.min(parts.length, 2 * (fit?.basePages ?? drafts.length))) {
    const indices = parts.map((_, i) => i),
      groups = Array.from({ length: pages }, (_, i) =>
        indices.slice(
          Math.floor((i * parts.length) / pages),
          Math.floor(((i + 1) * parts.length) / pages),
        ),
      );
    const candidate = repackedPartition(drafts, parts, sizes, groups, page);
    if (candidate) options.push(candidate);
  }
  return options;
}
function repackedPartition(
  drafts: readonly Draft[],
  parts: readonly Draft[],
  sizes: readonly number[],
  groups: readonly number[][],
  page: PaperPage,
): Draft[] | undefined {
  const first = required(drafts[0], "Missing original legend draft"),
    b = required(first.drawingBounds, "Missing drawing bounds"),
    axis = required(first.rootedPartAxis, "Missing strip axis"),
    fit = first.rootedFit,
    bank = first.rootedBank;
  if (
    !bank ||
    groups.some(
      (g) =>
        g.reduce(
          (sum, i) => sum + required(sizes[i], "Missing strip size"),
          0,
        ) +
          (g.length - 1) * SECTION_GAP >
        (axis === "x" ? b.w : b.h),
    )
  )
    return;
  const candidate = stackSections(parts, sizes, groups, b, axis);
  if (candidate.some((d) => !d.rootedContent?.figures)) return;
  if (fit)
    required(candidate[0], "Missing legend geometry").rootedFit = {
      ...fit,
      actualPages: candidate.length,
    };
  return draftCompositionFits(
    candidate,
    bank,
    fit?.basePages ?? drafts.length,
    page,
  )
    ? candidate
    : undefined;
}
function legendBand(
  drafts: readonly Draft[],
  parts: readonly Draft[],
  sizes: readonly number[],
  b: import("./types.js").DrawingBounds,
  axis: import("./fold-axis.js").FoldAxis,
  fit: Draft["rootedFit"],
) {
  let offset = 0;
  const originalGroups = drafts.map((d) => {
    const n = required(d.rootedParts, "Missing source strips").length,
      group = Array.from({ length: n }, (_, i) => offset + i);
    offset += n;
    return group;
  });
  const band = stackSections(
    parts,
    sizes,
    originalGroups,
    b,
    axis,
    (index, position) => legendSectionGap(parts, sizes, axis, index, position),
  );
  if (fit)
    required(band[0], "Missing band draft").rootedFit = {
      ...fit,
      actualPages: band.length,
    };
  return band;
}
function legendSectionGap(
  parts: readonly Draft[],
  sizes: readonly number[],
  axis: "x" | "y",
  index: number,
  position: number,
) {
  const current = required(parts[index], "Missing legend strip"),
    next = parts[index + 1];
  const normal = position === 0 ? SECTION_GAP : 3.13;
  if (!next) return normal;
  if (axis === "y") return next.rootedCaptionInk?.length ? SECTION_GAP : normal;
  const x = required(current.drawingBounds, "Missing strip bounds").x,
    nextX = required(next.drawingBounds, "Missing strip bounds").x,
    right = Math.max(
      0,
      ...(current.rootedCaptionInk ?? []).map((r) => r.x + r.w - x),
    ),
    left = Math.min(
      0,
      ...(next.rootedCaptionInk ?? []).map((r) => r.x - nextX),
    );
  // Match continuation-fit's 1 mm clear-ink rule. Captions can overhang a
  // trimmed viewport, so the gap includes that measured overhang, not just 3.13 mm.
  return Math.max(
    normal,
    right - required(sizes[index], "Missing strip size") - left + 1.001,
  );
}
function failureCapacity(result: RenderOutcome<unknown>) {
  if (result.ok || !("details" in result.error)) return 0;
  return (
    Number(result.error.details?.availableWidthMm ?? 0) *
    Number(result.error.details?.availableHeightMm ?? 0)
  );
}
function* legendCandidates(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  page: PaperPage,
  otherViews: readonly Draft[],
  failures: LegendSearchFailure,
) {
  yield* repartitions(drafts, page);
  yield* legendPagination(ir, drafts, page, otherViews, failures);
}
function rebuild(
  views: readonly LegendViewDrafts[],
  overrides: ReadonlyMap<number, Draft[]>,
  layout: "standard" | "compact" | undefined,
) {
  const drafts: Draft[] = [];
  let reference = 0;
  for (const v of views)
    reference = appendViewDrafts(
      drafts,
      structuredClone(overrides.get(v.viewIndex) ?? v.drafts),
      v.viewIndex,
      layout,
      reference,
      v.context,
      v.navigationView,
    );
  return drafts;
}
export function legendCandidateLimited(
  drafts: Draft[],
  failures: LegendSearchFailure,
) {
  const bound = rootedPageCostFailure(drafts);
  if (bound) failures.bound = bound;
  if (drafts.length > LEGEND_PACKET_SHEET_LIMIT)
    recordLegendCap(failures, "sheet-limit");
  return !!bound || drafts.length > LEGEND_PACKET_SHEET_LIMIT;
}
/** Release a legend band by repacking strips, then recutting protected gaps if
 * needed. Route geometry and print scale stay intact; no ELK work or cap changes.
 * Without a measured tail, only an observed sheet limit justifies replacing
 * the original device-rooted failure with a search report. */
export function fitLegendDrafts(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  views: readonly LegendViewDrafts[],
  page: PaperPage,
  layout: "standard" | "compact" | undefined,
  render: typeof legendSheets = legendSheets,
): RenderOutcome<Draft[]> {
  const overrides = new Map<number, Draft[]>();
  let current = drafts;
  for (let attempt = 0; attempt <= views.length; attempt++) {
    const rendered = render(ir, current, page);
    if (rendered.ok) return { ok: true, value: current };
    if (
      "details" in rendered.error &&
      rendered.error.details?.navigationInvariant
    )
      return rendered;
    const index = required(
        current[required(rendered.failedSheet, "Missing legend geometry")],
        "Missing legend geometry",
      ).views?.[0]?.viewIndex,
      view = views.find((v) => v.viewIndex === index);
    if (!view || overrides.has(view.viewIndex)) return rendered;
    let accepted = false;
    let bestFailure = rendered;
    const failures: LegendSearchFailure = {};
    const otherViews = current.filter(
      (d) => d.views?.[0]?.viewIndex !== view.viewIndex,
    );
    for (const candidate of legendCandidates(
      ir,
      view.drafts,
      page,
      otherViews,
      failures,
    )) {
      overrides.set(view.viewIndex, candidate);
      const next = rebuild(views, overrides, layout);
      if (legendCandidateLimited(next, failures)) continue;
      const trial = render(ir, next, page);
      if (trial.ok) return { ok: true, value: next };
      if ("details" in trial.error && trial.error.details?.navigationInvariant)
        return trial;
      if (failureCapacity(trial) > failureCapacity(bestFailure))
        bestFailure = trial;
      if (
        required(
          next[required(trial.failedSheet, "Missing legend geometry")],
          "Missing legend geometry",
        ).views?.[0]?.viewIndex !== view.viewIndex
      ) {
        current = next;
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      const failure = legendBoundFailure(
        failures,
        current,
        view.context.title,
        failures.stops?.has("sheet-limit") ? bestFailure.error : undefined,
      );
      if (failure) return { ok: false, error: failure };
      return bestFailure;
    }
  }
  throw Error("Legend pagination did not settle");
}
