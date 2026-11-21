import { MAX_GRID_PLANS } from "./safe-cuts.js";
import { MAX_FRAME_FOLD_PLANS } from "./frame-fold-groups.js";
import {
  MAX_PLACEMENT_LAYOUTS,
  ROOTED_COMPACT_PROFILES,
} from "./rooted-limits.js";
import { hasCompactFrame } from "./frame-profile.js";
import type { RootedCandidate } from "./rooted-build.js";
import type { ContinuationBank } from "./continuation-bank.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { FoldGroups } from "./frame-fold-groups.js";
import type { RootedGrid } from "./rooted-plans.js";
import type { Draft, DrawingBounds, PaperPage } from "./types.js";
import { required } from "../presentation/util.js";
import { n } from "./svg.js";

export const FRAME_LOSS_LIMIT_PERCENT = 2;
export interface FrameField extends DrawingBounds {
  area: number;
  anchorArea: number;
}
export interface FrameAttempt {
  id: string;
  bank: ContinuationBank;
  grid: RootedGrid;
  groups?: FoldGroups;
  fields: FrameField[];
  losses: number[];
  pages: number;
  scale: number;
  failure?: string;
}
export interface FrameReceipt {
  view: PreparedSchematicDrawing["view"];
  rootedViewOrdinal: number;
  referenceScale: number;
  referenceFields: FrameField[];
  /** Observed bank maximum and enforcing caps, plus one existing-placement probe. */
  candidateLimit: {
    gridsPerBank: number;
    banksPerLayout: number;
    foldsPerGrid: number;
    layouts: number;
  };
  candidates: FrameAttempt[];
  sheets: {
    sheet: number;
    strategy:
      "existing-compact" | "folded-group" | "legacy-continuation-placement";
    candidate: string;
    lossPercent: number;
  }[];
  fallback?: {
    sheet: number;
    strategy:
      "existing-compact" | "folded-group" | "legacy-continuation-placement";
    lossPercent: number;
    failure?: string;
  }[];
  termination?:
    | "existing-within-budget"
    | "zero-loss-lower-bound"
    | "bounded-enumeration"
    | "no-compatible-fallback";
}
interface Context {
  reference: RootedCandidate | null;
  receipt: FrameReceipt;
  layouts: WeakMap<PreparedSchematicDrawing, number>;
  newLayouts?: Set<PreparedSchematicDrawing> | undefined;
  layoutCount: number;
  attempts: Set<string>;
}
const pages = new WeakMap<PaperPage, Map<string, Context>>();
const receipts = new WeakMap<PaperPage, FrameReceipt[]>();
const selected = new WeakMap<Draft[], RootedCandidate>();
const key = (view: PreparedSchematicDrawing["view"]) => JSON.stringify(view);
export const rememberFrameCandidate = (candidate: RootedCandidate) =>
  selected.set(candidate.drafts, candidate);
export const frameCandidate = (drafts: Draft[]) =>
  required(selected.get(drafts), "Missing selected frame reference");
export function frameContext(
  page: PaperPage,
  view: PreparedSchematicDrawing["view"],
) {
  const ctx = pages.get(page)?.get(key(view));
  return ctx?.reference ? ctx : undefined;
}
export function beginFramePlanning(
  page: PaperPage,
  reference: RootedCandidate,
) {
  const all = receipts.get(page) ?? [];
  const receipt: FrameReceipt = {
    view: reference.prepared.view,
    rootedViewOrdinal: all.length,
    referenceScale: reference.scale,
    referenceFields: reference.drafts.map((d) =>
      frameField(required(d.drawingBounds, "Missing legacy drawing field")),
    ),
    candidateLimit: {
      gridsPerBank: MAX_GRID_PLANS,
      banksPerLayout: 0,
      foldsPerGrid: MAX_FRAME_FOLD_PLANS,
      // Initial profiles, the existing placement budget, and one reference seed.
      layouts: ROOTED_COMPACT_PROFILES.length + MAX_PLACEMENT_LAYOUTS + 1,
    },
    candidates: [],
    sheets: [],
  };
  all.push(receipt);
  receipts.set(page, all);
  const map = pages.get(page) ?? new Map<string, Context>();
  map.set(key(reference.prepared.view), {
    reference,
    receipt,
    layouts: new WeakMap(),
    layoutCount: 0,
    attempts: new Set(),
  });
  pages.set(page, map);
}
/** Maximum of the bank lists actually passed to grid enumeration. */
export function recordFrameBanks(
  page: PaperPage,
  p: PreparedSchematicDrawing,
  banks: readonly ContinuationBank[],
) {
  const ctx = frameContext(page, p.view);
  if (ctx)
    ctx.receipt.candidateLimit.banksPerLayout = Math.max(
      ctx.receipt.candidateLimit.banksPerLayout,
      banks.length,
    );
}
export function compactPlanningReceipts(
  page: PaperPage,
): readonly FrameReceipt[] {
  return structuredClone(receipts.get(page) ?? []);
}

/** Replay completed work only. Active search contexts are never shared. */
export function replayCompactPlanningReceipts(
  page: PaperPage,
  completed: readonly FrameReceipt[],
) {
  const all = receipts.get(page) ?? [];
  for (const receipt of structuredClone(completed)) {
    receipt.rootedViewOrdinal = all.length;
    all.push(receipt);
  }
  receipts.set(page, all);
}

/** Compare both printed tick endpoints and the independently reconstructed mark sequence. */
export function frameField(b: DrawingBounds): FrameField {
  const q = (v: number) => Number(n(v));
  const x = q(b.x),
    y = q(b.y),
    w = q(b.x + b.w) - x,
    h = q(b.y + b.h) - y;
  const aw = q(((q(b.x + (b.w * 11) / 12) - q(b.x + b.w / 12)) / 5) * 6);
  const ah = q(((q(b.y + (b.h * 7) / 8) - q(b.y + b.h / 8)) / 3) * 4);
  return { x, y, w, h, area: w * h, anchorArea: aw * ah };
}
export function fieldLoss(before: FrameField, after: FrameField): number {
  return Math.max(
    0,
    ((before.area - after.area) / before.area) * 100,
    ((before.anchorArea - after.anchorArea) / before.anchorArea) * 100,
  );
}
export function candidateLosses(candidate: RootedCandidate, page: PaperPage) {
  const ctx = hasCompactFrame(page)
    ? frameContext(page, candidate.prepared.view)
    : undefined;
  if (!ctx) return [];
  const refs = ctx.receipt.referenceFields;
  return candidate.drafts.map((d, i) =>
    fieldLoss(
      required(refs[Math.min(i, refs.length - 1)], "Missing reference field"),
      frameField(required(d.drawingBounds, "Missing candidate drawing field")),
    ),
  );
}
export function frameBudgetFailure(
  candidate: RootedCandidate,
  page: PaperPage,
): string | undefined {
  const ctx = hasCompactFrame(page)
    ? frameContext(page, candidate.prepared.view)
    : undefined;
  if (!ctx) return;
  if (candidate.drafts.length !== ctx.receipt.referenceFields.length)
    return "page-count";
  if (Math.abs(candidate.scale - ctx.receipt.referenceScale) > 1e-12)
    return "scale-change";
  if (
    candidateLosses(candidate, page).some(
      (v) => v > FRAME_LOSS_LIMIT_PERCENT + 1e-8,
    )
  )
    return "drawing-field-loss";
}
export function frameBudgetOrder(
  a: RootedCandidate,
  b: RootedCandidate,
  page: PaperPage,
): number {
  if (!hasCompactFrame(page) || !frameContext(page, a.prepared.view)) return 0;
  const aa = candidateLosses(a, page),
    bb = candidateLosses(b, page);
  return (
    Number(!!frameBudgetFailure(a, page)) -
      Number(!!frameBudgetFailure(b, page)) ||
    Math.max(0, ...aa) - Math.max(0, ...bb) ||
    aa.reduce((n, v) => n + v, 0) - bb.reduce((n, v) => n + v, 0)
  );
}
export function frameZeroLoss(candidate: RootedCandidate, page: PaperPage) {
  return (
    hasCompactFrame(page) &&
    !!frameContext(page, candidate.prepared.view) &&
    !frameBudgetFailure(candidate, page) &&
    candidateLosses(candidate, page).every((v) => v === 0)
  );
}

export function recordFrameAttempt(
  page: PaperPage,
  p: PreparedSchematicDrawing,
  profile: RootedCandidate["profile"],
  bank: ContinuationBank,
  grid: RootedGrid,
  groups: FoldGroups | undefined,
  scale: number,
  fields: DrawingBounds[],
  failure?: string,
) {
  const ctx = frameContext(page, p.view);
  if (!ctx) return;
  let ordinal = ctx.layouts.get(p);
  if (ordinal === undefined) {
    ordinal = ctx.layoutCount++;
    ctx.layouts.set(p, ordinal);
    ctx.newLayouts?.add(p);
  }
  const id = JSON.stringify([ordinal, profile, bank, grid, groups]);
  if (ctx.attempts.has(id)) return;
  ctx.attempts.add(id);
  const measured = fields.map(frameField),
    refs = ctx.receipt.referenceFields;
  const losses = measured.map((f, i) =>
    fieldLoss(
      required(refs[Math.min(i, refs.length - 1)], "Missing reference field"),
      f,
    ),
  );
  ctx.receipt.candidates.push({
    id,
    bank: structuredClone(bank),
    grid: structuredClone(grid),
    ...(groups ? { groups: structuredClone(groups) } : {}),
    fields: measured,
    losses,
    pages: fields.length,
    scale,
    ...(failure ? { failure } : {}),
  });
}
export function finishFramePlanning(
  page: PaperPage,
  candidate: RootedCandidate,
  strategy:
    "existing-compact" | "folded-group" | "legacy-continuation-placement",
) {
  const ctx = required(
    frameContext(page, candidate.prepared.view),
    "Missing frame planning context",
  );
  const losses = candidateLosses(candidate, page);
  const id = JSON.stringify([
    ctx.layouts.get(candidate.prepared),
    candidate.profile,
    candidate.bank,
    candidate.grid,
    candidate.foldGroups,
  ]);
  ctx.receipt.sheets = losses.map((lossPercent, sheet) => ({
    sheet: sheet + 1,
    strategy,
    candidate: id,
    lossPercent,
  }));
  ctx.receipt.termination =
    strategy === "existing-compact"
      ? "existing-within-budget"
      : frameZeroLoss(candidate, page)
        ? "zero-loss-lower-bound"
        : "bounded-enumeration";
  ctx.reference = null;
}

/** An abandoned capped search must leave the active legacy receipt untouched.
 * Search only appends attempts and assigns layout ordinals; it does not finish
 * planning. Retain original prepared identities, and remove only new entries. */
export async function rollbackFrameSearch<T>(
  page: PaperPage,
  search: () => Promise<T>,
): Promise<T> {
  const saved = [...(pages.get(page)?.values() ?? [])]
    .filter((ctx) => ctx.reference)
    .map((ctx) => {
      const snapshot = {
        ctx,
        count: ctx.layoutCount,
        banks: ctx.receipt.candidateLimit.banksPerLayout,
        attempts: new Set(ctx.attempts),
        length: ctx.receipt.candidates.length,
        previous: ctx.newLayouts,
        added: new Set<PreparedSchematicDrawing>(),
      };
      ctx.newLayouts = snapshot.added;
      return snapshot;
    });
  try {
    return await search();
  } catch (error) {
    for (const s of saved) {
      s.ctx.layoutCount = s.count;
      s.ctx.receipt.candidateLimit.banksPerLayout = s.banks;
      s.ctx.attempts = s.attempts;
      s.ctx.receipt.candidates.length = s.length;
      for (const p of s.added) s.ctx.layouts.delete(p);
    }
    throw error;
  } finally {
    for (const s of saved) {
      for (const p of s.added) s.previous?.add(p);
      s.ctx.newLayouts = s.previous;
    }
  }
}
