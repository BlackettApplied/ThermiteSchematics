import { required } from "../presentation/util.js";
import type { RootedCandidate } from "./rooted-build.js";
import type { Draft, PaperPage } from "./types.js";
import { compactFramePlan } from "./frame-plan.js";
import { rootedSheetView } from "../off-view/notice.js";
import { admitFinalBanks } from "./frame-banks.js";
import { continuationInkFailure } from "./continuation-fit.js";
import { resolveRootedContinuations } from "./continuation-resolve.js";
import { offViewPacketFailure } from "../off-view/presentation.js";
import {
  FRAME_LOSS_LIMIT_PERCENT,
  frameContext,
  type FrameReceipt,
  fieldLoss,
  frameField,
  finishFramePlanning,
} from "./frame-budget.js";

function partition(d: Draft) {
  return JSON.stringify(d.rootedSections?.map((s) => s.viewport));
}
function furnitureFailure(d: Draft, page: PaperPage): string | undefined {
  const plan = compactFramePlan(
      d.title,
      page,
      rootedSheetView(d.view),
      d.drawingBounds,
    ),
    b = plan.service;
  if (
    [...(d.rootedShapes ?? []), ...(d.rootedCaptionInk ?? [])].some(
      (s) =>
        s.x < b.x - 0.001 ||
        s.y < b.y - 0.001 ||
        s.x + s.w > b.x + b.w + 0.001 ||
        s.y + s.h > b.y + b.h + 0.001,
    )
  )
    return "Native content or its caption enters compact frame furniture.";
  d.drawingBounds = {
    ...required(d.drawingBounds, "Missing legacy field"),
    frameService: b,
  };
  admitFinalBanks(d, plan);
  return continuationInkFailure(d, page, false, true);
}

/** Per-sheet geometry receipts; the frame stays compact on every sheet. */
export function legacyFramePlacement(
  reference: RootedCandidate,
  modern: RootedCandidate | undefined,
  page: PaperPage,
) {
  const drafts = structuredClone(reference.drafts),
    ctx = required(
      frameContext(page, reference.prepared.view),
      "Missing fallback context",
    );
  const strategies: ("folded-group" | "legacy-continuation-placement")[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const other = modern?.drafts[i];
    const keep =
      modern?.prepared === reference.prepared &&
      modern.scale === reference.scale &&
      modern.drafts.length === drafts.length &&
      other &&
      partition(other) ===
        partition(required(drafts[i], "Missing legacy sheet")) &&
      fieldLoss(
        required(ctx.receipt.referenceFields[i], "Missing reference field"),
        frameField(required(other.drawingBounds, "Missing modern field")),
      ) <=
        FRAME_LOSS_LIMIT_PERCENT + 1e-8;
    if (keep) drafts[i] = structuredClone(other);
    strategies.push(keep ? "folded-group" : "legacy-continuation-placement");
  }
  try {
    resolveRootedContinuations(drafts, page);
    ctx.receipt.fallback = checkFallbackFurniture(
      drafts,
      strategies,
      page,
      ctx.receipt.referenceFields,
    );
    const rejected = ctx.receipt.fallback.find((s) => s.failure);
    if (rejected) throw Error(`Sheet ${rejected.sheet}: ${rejected.failure}`);
  } catch (e) {
    ctx.receipt.termination = "no-compatible-fallback";
    ctx.reference = null;
    return offViewPacketFailure(
      reference.prepared.graph,
      "unprintable-layout",
      `Compact frame has no compatible within-budget placement after bounded enumeration: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const chosen = { ...reference, drafts };
  finishFramePlanning(page, chosen, "legacy-continuation-placement");
  ctx.receipt.termination = "bounded-enumeration";
  ctx.receipt.sheets.forEach((s, i) => {
    s.strategy = required(strategies[i], "Missing sheet strategy");
    s.candidate =
      s.strategy === "legacy-continuation-placement"
        ? "legacy-sheet-placement"
        : s.candidate;
  });
  return { ok: true as const, value: drafts };
}

function checkFallbackFurniture(
  drafts: Draft[],
  strategies: NonNullable<FrameReceipt["fallback"]>[number]["strategy"][],
  page: PaperPage,
  references: FrameReceipt["referenceFields"],
) {
  const rows: NonNullable<FrameReceipt["fallback"]> = [];
  for (const [i, d] of drafts.entries()) {
    let failure: string | undefined;
    try {
      failure = furnitureFailure(d, page);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    rows.push({
      sheet: i + 1,
      strategy: required(strategies[i], "Missing sheet strategy"),
      lossPercent: fieldLoss(
        required(references[i], "Missing reference field"),
        frameField(required(d.drawingBounds, "Missing fallback field")),
      ),
      ...(failure ? { failure } : {}),
    });
  }
  return rows;
}
