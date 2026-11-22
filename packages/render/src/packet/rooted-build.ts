import {
  frameContext,
  frameZeroLoss,
  recordFrameAttempt,
  recordFrameBanks,
} from "./frame-budget.js";
import { hasCompactFrame } from "./frame-profile.js";
import { cardDistances, CARD_LOCALITY_AIM_MM } from "./rooted-locality.js";
import {
  continuationBanks,
  bankBounds,
  type ContinuationBank,
} from "./continuation-bank.js";
import { fitContinuations } from "./continuation-fit.js";
import { contentPages } from "./rooted-content.js";
import { rootedLocationContent } from "./location-headings.js";
import { required } from "../presentation/util.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { RenderOutcome } from "../types.js";
import type { Draft, DrawingBounds, PaperPage } from "./types.js";
import { continuationGridConstraint } from "./continuation-constraint.js";
import type {
  RootedConstraint,
  RootedDiagnostic,
} from "./rooted-constraint.js";
import { bounds, zone } from "./page.js";
import { gridLinks, type RootedGrid } from "./rooted-plans.js";
import { rootedBankGrids } from "./rooted-bank-grids.js";
import {
  frameFoldGroups,
  foldedBankProbes,
  rootedGridDrafts,
  previewFrameFields,
  type FoldGroups,
} from "./frame-fold-groups.js";
import { postTrimCaptionConstraint } from "./rooted-caption.js";
import { foldDrawingDrafts } from "./folding.js";
import { emitSchematicSvg } from "../svg/emitter.js";
import { offViewPacketFailure } from "../off-view/presentation.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";
import { interiorJogs, routeDetours } from "./rooted-ink.js";
import { paginationSpacing } from "./rooted-pagination-retry.js";
import type { PaginationSpacing } from "../layout/spacing.js";

export interface RootedCandidate {
  printableDrafts?: Draft[];
  foldGroups?: FoldGroups;
  drafts: Draft[];
  bank: ContinuationBank;
  grid: RootedGrid;
  profile?: "compact" | "dense";
  prepared: PreparedSchematicDrawing;
  scale: number;
  jogs: Map<string, number>;
  detours?: ReadonlyMap<string, number>;
  greedy?: boolean;
  proximity: number;
  localityExcess?: number;
}
export type RootedBuildResult = RenderOutcome<RootedCandidate[]> &
  RootedDiagnostic & { paginationSpacing?: PaginationSpacing };
export function rootedSpace(
  p: PreparedSchematicDrawing,
  page: PaperPage,
  compact: boolean,
  native = false,
) {
  let b = bounds(p.titleContext, page, native ? undefined : p.view);
  b = { ...b, y: b.y + 4, h: b.h - 4 };
  const full = page.widthMm - 2 * page.marginMm - 10;
  if (
    compact &&
    (p.layout.width + 2 * pad) * 0.25 <= full &&
    (p.layout.height + 2 * pad) * 0.25 <= b.h
  )
    b = { ...b, x: page.marginMm + 5, w: full };
  const scale = Math.max(
    0.25,
    Math.min(
      0.32,
      b.w / (p.layout.width + 2 * pad),
      b.h / (p.layout.height + 2 * pad),
    ),
  );
  return { b, scale };
}

function makeDrafts(
  p: PreparedSchematicDrawing,
  grid: RootedGrid,
  page: PaperPage,
  scale: number,
  inner: string,
  compact: boolean,
  profile: "compact" | "dense" | undefined,
  native: boolean,
  bank: ContinuationBank,
  groups?: FoldGroups,
): Draft[] | string {
  const original = rootedSpace(p, page, compact, native).b;
  const b = bankBounds(original, bank);
  const probes = bank.extra ? gridProbeDrafts(grid) : undefined;
  if (probes && !gridLinks(p, grid, b, scale, probes))
    return "Continuation spacing does not fit this grid.";
  const planned = foldedBankProbes(probes, groups);
  const drafts = rootedGridDrafts(
    p,
    grid,
    (i) => perSideBankBounds(b, bank, planned?.[i]),
    scale,
    inner,
    profile,
    original.y - 9,
  );
  for (const d of drafts) d.rootedScoreBounds = original;
  if (!gridLinks(p, grid, b, scale, drafts))
    return "Continuation spacing does not fit this grid.";
  const caption = postTrimCaptionConstraint(drafts, page, native);
  if (caption) return caption;
  const originalDrafts = structuredClone(drafts);
  const pages =
    grid.ys.length === 2 && grid.xs.length > 2
      ? foldDrawingDrafts(
          drafts,
          p.layout,
          grid.xs,
          b,
          scale,
          p.layout.height + 2 * pad,
          {
            prepared: p,
            inner,
            ...(profile ? { profile } : {}),
            ...(groups ? { groups } : {}),
          },
        )
      : drafts;
  applyFinalBankBounds(pages, b, bank);
  const visible = contentPages(pages);
  if (typeof visible === "string") return visible;
  const failure =
    fitContinuations(visible, page, bank, native) ??
    postTrimCaptionConstraint(visible, page, native);
  if (!failure) return visible;
  if (pages === drafts) return failure;
  // Conservative fallback retains the complete original viewports and captions.
  return unfoldedFallback(originalDrafts, page, bank, b, native);
}

function unfoldedFallback(
  drafts: Draft[],
  page: PaperPage,
  bank: ContinuationBank,
  b: DrawingBounds,
  native: boolean,
) {
  const fallback = contentPages(drafts);
  if (typeof fallback === "string") return fallback;
  applyFinalBankBounds(fallback, b, bank);
  return (
    fitContinuations(fallback, page, bank, native) ??
    postTrimCaptionConstraint(fallback, page, native) ??
    fallback
  );
}

/** Folding combines virtual cells; final sheet cuts decide reservations. */
function applyFinalBankBounds(
  drafts: Draft[],
  b: DrawingBounds,
  bank: ContinuationBank,
) {
  if (!bank.extra) return;
  for (const d of drafts) {
    const area = perSideBankBounds(b, bank, d);
    d.drawingBounds = area;
    if (d.references)
      d.references = d.references.map((r) =>
        r.xMm === undefined || r.yMm === undefined
          ? r
          : { ...r, zone: zone(r.xMm, r.yMm, area) },
      );
  }
}

/** Release a fallback reservation on each cut-free side before constructing
 * the viewport and its endpoints. No emitted route or packed label is moved. */
export function perSideBankBounds(
  b: import("./types.js").DrawingBounds,
  bank: ContinuationBank,
  probe: Draft | undefined,
) {
  if (!bank.extra || !probe) return b;
  const sides = new Set(probe.links.map((l) => l.side));
  const left = sides.has("left") ? 0 : bank.extra.left;
  const right = sides.has("right") ? 0 : bank.extra.right;
  return { ...b, x: b.x - left, w: b.w + left + right };
}

export function buildRootedCandidates(
  ir: Readonly<ElectricalIr>,
  p: PreparedSchematicDrawing,
  page: PaperPage,
  profile?: "compact" | "dense",
  native = false,
  explore = false,
  offset = 0,
  extraReservations = false,
): RootedBuildResult {
  const space = rootedSpace(p, page, !!profile, native);
  const context = !native && frameContext(page, p.view);
  const b = space.b,
    scale = context ? context.receipt.referenceScale : space.scale;
  if (b.w < 60 || b.h < 50)
    return offViewPacketFailure(
      p.graph,
      "unprintable-layout",
      "Title information leaves insufficient drawing space. Use a larger sheet or landscape.",
    );
  const banks = continuationBanks(
    p,
    b,
    scale,
    offset,
    extraReservations || !!context,
  );
  if (context) recordFrameBanks(page, p, banks);
  const constraint = continuationGridConstraint(
    p,
    banks.map((bank) => bankBounds(b, bank)),
    scale,
  );
  const search = rootedBankGrids(p, b, scale, banks, explore || !!context);
  const { candidates, captionFailure } = buildGridCandidates(
    p,
    page,
    profile,
    native,
    scale,
    b,
    search.grids,
    constraint,
  );
  if (!candidates.length && !explore && !context)
    return buildRootedCandidates(
      ir,
      p,
      page,
      profile,
      native,
      true,
      offset,
      extraReservations,
    );
  if (candidates.length) return { ok: true, value: candidates, constraint };
  if (hasCompactFrame(page) && !extraReservations && !context)
    return buildRootedCandidates(
      ir,
      p,
      page,
      profile,
      native,
      true,
      offset,
      true,
    );
  return failedBuild(p, constraint, captionFailure, search);
}

export function buildGridCandidates(
  p: PreparedSchematicDrawing,
  page: PaperPage,
  profile: "compact" | "dense" | undefined,
  native: boolean,
  scale: number,
  b: DrawingBounds,
  grids: { bank: ContinuationBank; grid: RootedGrid }[],
  constraint: RootedConstraint,
) {
  const candidates: RootedCandidate[] = [],
    distances = cardDistances(p, scale);
  let captionFailure: string | RootedConstraint = constraint;
  for (const { bank, grid } of grids) {
    const options =
      frameContext(page, p.view) && !native
        ? frameFoldGroups(p, grid, bankBounds(b, bank), scale)
        : [undefined];
    for (const groups of options) {
      const drafts = makeDrafts(
        p,
        grid,
        page,
        scale,
        "",
        !!profile,
        profile,
        native,
        bank,
        groups,
      );
      if (!native)
        recordGridAttempt(
          p,
          page,
          profile,
          bank,
          grid,
          groups,
          scale,
          b,
          drafts,
        );
      if (typeof drafts === "string") {
        captionFailure = drafts;
        continue;
      }
      const candidate = rootedCandidate(
        drafts,
        bank,
        grid,
        p,
        scale,
        profile,
        distances,
        groups,
      );
      candidates.push(candidate);
      if (!native && frameZeroLoss(candidate, page))
        return { candidates, captionFailure };
    }
  }
  return { candidates, captionFailure };
}
function recordGridAttempt(
  p: PreparedSchematicDrawing,
  page: PaperPage,
  profile: "compact" | "dense" | undefined,
  bank: ContinuationBank,
  grid: RootedGrid,
  groups: FoldGroups | undefined,
  scale: number,
  b: DrawingBounds,
  drafts: Draft[] | string,
) {
  recordFrameAttempt(
    page,
    p,
    profile,
    bank,
    grid,
    groups,
    scale,
    typeof drafts === "string"
      ? previewFrameFields(
          p,
          grid,
          bankBounds(b, bank),
          scale,
          groups,
          (probe) => perSideBankBounds(bankBounds(b, bank), bank, probe),
        )
      : drafts.map((d) => required(d.drawingBounds, "Missing candidate field")),
    typeof drafts === "string" ? drafts : undefined,
  );
}

function failedBuild(
  p: PreparedSchematicDrawing,
  constraint: RootedConstraint,
  caption: string | RootedConstraint,
  search: ReturnType<typeof rootedBankGrids>,
): RootedBuildResult {
  const { cutFailure } = search;
  const message = typeof caption === "string" ? caption : caption.message;
  const error =
    cutFailure ??
    offViewPacketFailure(p.graph, "unprintable-layout", message).error;
  const spacing =
    !search.grids.length && paginationSpacing(p, constraint, search.spacing);
  return {
    ok: false,
    error,
    constraint,
    ...(spacing ? { paginationSpacing: spacing } : {}),
    ...(!cutFailure && typeof caption !== "string"
      ? { gridFailure: { error, suffix: error.message.slice(message.length) } }
      : {}),
  };
}

/** Only the selected layout is emitted; it still passes the original emitter. */
export function materializeRootedCandidate(
  ir: Readonly<ElectricalIr>,
  candidate: RootedCandidate,
  page: PaperPage,
): RenderOutcome<Draft[]> {
  const p = candidate.prepared,
    scale = candidate.scale;
  const emitted = emitSchematicSvg(
    p.graph,
    p.layout,
    p.titleContext,
    undefined,
    true,
    scale,
    ir,
  );
  if (!emitted.ok) return emitted;
  const inner = emitted.value
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(/^<svg[^>]*>\s*/, "")
    .replace(/<\/svg>\s*$/, "");
  const drafts = makeDrafts(
    p,
    candidate.grid,
    page,
    scale,
    rootedLocationContent(inner, p, candidate.drafts),
    !!candidate.profile,
    candidate.profile,
    false,
    candidate.bank,
    candidate.foldGroups,
  );
  return typeof drafts === "string"
    ? offViewPacketFailure(p.graph, "unprintable-layout", drafts)
    : { ok: true, value: drafts };
}

function gridProbeDrafts(grid: RootedGrid): Draft[] {
  return Array.from(
    { length: (grid.xs.length - 1) * (grid.ys.length - 1) },
    () => ({ links: [] }) as unknown as Draft,
  );
}
function rootedCandidate(
  drafts: Draft[],
  bank: ContinuationBank,
  g: RootedGrid,
  p: PreparedSchematicDrawing,
  scale: number,
  profile: "compact" | "dense" | undefined,
  distances: number[],
  groups?: FoldGroups,
): RootedCandidate {
  return {
    drafts,
    ...(groups ? { foldGroups: groups } : {}),
    bank,
    grid: g,
    ...(profile ? { profile } : {}),
    prepared: p,
    scale,
    jogs: interiorJogs(p, scale),
    detours: routeDetours(p, scale),
    greedy: g.greedy === true,
    proximity: distances.reduce((sum, n) => sum + n, 0),
    localityExcess: distances.reduce(
      (sum, n) => sum + Math.max(0, n - CARD_LOCALITY_AIM_MM),
      0,
    ),
  };
}
