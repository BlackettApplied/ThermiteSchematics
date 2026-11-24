import { frameContext, rollbackFrameSearch } from "./frame-budget.js";
import { withFontMetricCache } from "../symbols/font-metric-cache.js";
import { validateEconomyCandidate } from "./rooted-economy.js";
import { placements } from "./rooted-placements.js";
import { repairSearchJogs, printedJogTrigger } from "./rooted-jog-repair.js";
import { searchSettled } from "./rooted-settled.js";
import {
  MAX_PLACEMENT_LAYOUTS,
  ROOTED_COMPACT_PROFILES,
} from "./rooted-limits.js";
export { MAX_PLACEMENT_LAYOUTS } from "./rooted-limits.js";
import { invariantCardConstraint } from "./rooted-constraint.js";
import { offViewPacketFailure } from "../off-view/presentation.js";
import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import {
  prepareSchematicDrawing,
  type PreparedSchematicDrawing,
} from "../renderer.js";
import { nativeDrawing } from "../off-view/prepared.js";
import type { SchematicViewRequest, RenderFailure } from "../types.js";
import type { PaperPage } from "./types.js";
import {
  buildRootedCandidates,
  type RootedBuildResult,
  type RootedCandidate,
} from "./rooted-build.js";
import {
  recordRootedDiagnostic,
  type RootedDiagnostic,
} from "./rooted-constraint.js";
import { compareCandidates } from "./rooted-score.js";
import {
  elkWorkLedger,
  elkWorkScope,
  type ElkWorkLedger,
  ElkWorkBudgetError,
} from "../layout/elk-work.js";
import { withCircuitLayoutCache } from "../layout/circuit-inline-context.js";
import type { RootedPaginationRetry } from "./rooted-pagination-retry.js";

type Profile = "compact" | "dense" | undefined;
export interface RootedNetLabelOptions {
  readonly wrapNetLabelIds?: ReadonlySet<string>;
  readonly omitNetLabelIds?: ReadonlySet<string>;
}
export interface RootedSearch {
  elkWork?: ElkWorkLedger;
  diagnostics?: RootedDiagnostic[];
  referenceOffset?: number;
  candidates: RootedCandidate[];
  native: RootedCandidate[];
  errors: RenderFailure[];
  nativeErrors: Map<Profile, RenderFailure>;
  prepared: { p: PreparedSchematicDrawing; profile: Profile }[];
  /** Existing proposal/economy schedule; elkWork counts logical LTR requests. */
  attempts: number;
  tried: Set<string>;
  settled?: boolean;
  earlyExit?: boolean;
  standardEconomy?: boolean;
  jogRetryReserved?: boolean;
  economyStartedAt?: number;
  validatedCandidate?: RootedCandidate;
  localityReference?: RootedCandidate;
  paginationRetry?: RootedPaginationRetry;
}
async function initial(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  profile: Profile,
  run: RootedSearch,
  netLabelOptions?: RootedNetLabelOptions,
) {
  const result = await prepareSchematicDrawing(ir, request, presentation, {
    packetContinuations: true,
    ...(profile ? { spacingProfile: profile } : {}),
    ...(netLabelOptions?.wrapNetLabelIds?.size
      ? { wrapNetLabelIds: netLabelOptions.wrapNetLabelIds }
      : {}),
    ...(netLabelOptions?.omitNetLabelIds?.size
      ? { omitNetLabelIds: netLabelOptions.omitNetLabelIds }
      : {}),
  });
  if (!result.ok) {
    run.errors.push(result.error);
    return;
  }
  const p = result.value;
  run.tried.add(`${profile ?? "standard"}:[]`);
  const invariant = invariantCardConstraint(p, page);
  if (invariant) {
    const failed = offViewPacketFailure(
      p.graph,
      "unprintable-layout",
      invariant,
    );
    run.errors.push(failed.error);
    return;
  }
  run.prepared.push({ p, profile });
  const build = profileBuilder(ir, page, profile, run.referenceOffset ?? 0);
  const actual = build(p);
  recordRootedDiagnostic(run.diagnostics, actual);
  if (actual.ok) run.candidates.push(...actual.value);
  else run.errors.push(actual.error);
  const native = await nativeDrawing(p);
  if (!native.ok) {
    const error = offViewPacketFailure(
      p.graph,
      "unprintable-layout",
      `No printable no-card baseline: ${native.error.message}`,
    ).error;
    run.nativeErrors.set(profile, error);
    run.errors.push(error);
    return;
  }
  recordInitialGrids(run, p, native.value, profile, actual, build);
}

function recordInitialGrids(
  run: RootedSearch,
  p: PreparedSchematicDrawing,
  native: PreparedSchematicDrawing,
  profile: Profile,
  actual: RootedBuildResult,
  build: ReturnType<typeof profileBuilder>,
) {
  const baseline = build(native, true);
  const spacing = baseline.paginationSpacing ?? actual.paginationSpacing;
  if (spacing && !run.paginationRetry)
    run.paginationRetry = {
      annotated: p,
      native,
      profile,
      spacing,
    };
  if (baseline.ok) {
    run.native.push(...baseline.value);
    if (
      actual.ok &&
      Math.min(...actual.value.map((c) => c.drafts.length)) >
        Math.min(...baseline.value.map((c) => c.drafts.length))
    ) {
      const repacked = build(p, false, true);
      if (repacked.ok) run.candidates.push(...repacked.value);
    }
  } else {
    run.nativeErrors.set(profile, baseline.error);
    run.errors.push(baseline.error);
  }
}
export function nativeWinner(run: Pick<RootedSearch, "native">) {
  let best: RootedCandidate | undefined;
  for (const candidate of run.native) {
    if (
      !best ||
      candidate.drafts.length < best.drafts.length ||
      (candidate.drafts.length === best.drafts.length &&
        candidate.drafts.reduce((n, d) => n + d.links.length, 0) <
          best.drafts.reduce((n, d) => n + d.links.length, 0))
    )
      best = candidate;
    if (best.drafts.length === 1) break;
  }
  return best;
}
export function rootedWinner(
  run: Pick<RootedSearch, "candidates" | "native" | "localityReference">,
  page: PaperPage,
) {
  const baseline = nativeWinner(run)?.jogs ?? new Map<string, number>();
  return [...run.candidates].sort((a, b) =>
    compareCandidates(
      a,
      b,
      baseline,
      page,
      nativeWinner(run)?.detours,
      nativeWinner(run),
      run.localityReference,
    ),
  )[0];
}

export async function searchRootedCandidates(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  compact: boolean,
  referenceOffset = 0,
  netLabelOptions?: RootedNetLabelOptions,
) {
  const legacy = () =>
    elkWorkScope.exit(() =>
      runRootedSearch(
        ir,
        request,
        presentation,
        page,
        compact,
        referenceOffset,
        netLabelOptions,
      ),
    );
  return withFontMetricCache(async () => {
    // TTB retains the complete dev search, including adapter recovery and retry.
    if (
      request?.format !== "schematic-view-request/0.1" ||
      request.family !== "power" ||
      request.flow !== "left-to-right"
    )
      return legacy();
    const work = elkWorkLedger(
      JSON.stringify([request, compact, referenceOffset]),
      MAX_PLACEMENT_LAYOUTS,
    );
    return withCircuitLayoutCache(async () => {
      let run: RootedSearch;
      try {
        run = await elkWorkScope.run(work, () =>
          rollbackFrameSearch(page, () =>
            runRootedSearch(
              ir,
              request,
              presentation,
              page,
              compact,
              referenceOffset,
            ),
          ),
        );
      } catch (error) {
        if (!(error instanceof ElkWorkBudgetError)) throw error;
        // Discard the truncated search; the unchanged legacy path owns fallback.
        work.exhausted = true;
        run = await legacy();
      }
      run.elkWork = work;
      work.baselineCalls = work.calls;
      return run;
    });
  });
}

async function runRootedSearch(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  compact: boolean,
  referenceOffset: number,
  netLabelOptions?: RootedNetLabelOptions,
) {
  const run: RootedSearch = {
    standardEconomy: !compact,
    diagnostics: [],
    referenceOffset,
    candidates: [],
    native: [],
    errors: [],
    nativeErrors: new Map(),
    prepared: [],
    attempts: 0,
    tried: new Set(),
  };
  for (const profile of compact ? ROOTED_COMPACT_PROFILES : [undefined]) {
    await initial(
      ir,
      request,
      presentation,
      page,
      profile,
      run,
      netLabelOptions,
    );
  }
  const reference =
    run.prepared[0] && frameContext(page, run.prepared[0].p.view)?.reference;
  if (reference) {
    const seeded = buildRootedCandidates(
      ir,
      reference.prepared,
      page,
      reference.profile,
      false,
      true,
      referenceOffset,
      true,
    );
    if (seeded.ok) run.candidates.push(...seeded.value);
  }
  validateEconomyCandidate(ir, run, page);
  if (searchSettled(run, page)) {
    run.earlyExit = true;
  } else {
    // Hold one existing attempt for a physical jog left by ordinary recovery.
    // Testing only the initial layout can pre-empt a jog-free recovered base.
    run.jogRetryReserved = !!printedJogTrigger(
      ir,
      rootedWinner(run, page),
      nativeWinner(run),
      page,
    );
    await placements(ir, request, presentation, page, run);
    if (run.validatedCandidate) run.candidates = [run.validatedCandidate];
  }
  delete run.jogRetryReserved;
  await repairSearchJogs(ir, run, page);
  validateEconomyCandidate(ir, run, page);
  return run;
}

function profileBuilder(
  ir: Readonly<ElectricalIr>,
  page: PaperPage,
  profile: Profile,
  offset: number,
) {
  return (p: PreparedSchematicDrawing, native = false, explore = false) =>
    buildRootedCandidates(ir, p, page, profile, native, explore, offset);
}
