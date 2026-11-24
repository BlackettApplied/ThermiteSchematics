import { hasCompactFrame } from "./frame-profile.js";
import {
  beginFramePlanning,
  frameCandidate,
  rememberFrameCandidate,
  frameBudgetFailure,
  finishFramePlanning,
  recordFrameAttempt,
} from "./frame-budget.js";
import { legacyFramePlacement } from "./frame-legacy-placement.js";
import { selectRootedComposition } from "./rooted-selection.js";
import { composeRootedWinner } from "./rooted-compose.js";
import { graphCardContext } from "../off-view/context.js";
import { materializeRootedCandidate } from "./rooted-build.js";
import { rootedDiagnosticError } from "./rooted-constraint.js";
import { attributeVerticalSourceNetLabels } from "./rooted-source-labels.js";
import {
  WRAPPED_UTILISATION_FLOOR,
  visibleDrawingAreaUtilisation,
} from "./rooted-utilisation.js";
import { retryRootedPagination } from "./rooted-pagination-retry.js";
import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import type {
  RenderFailure,
  RenderOutcome,
  SchematicViewRequest,
} from "../types.js";
import type { Draft, PaperPage } from "./types.js";
import {
  searchRootedCandidates,
  rootedWinner,
  nativeWinner,
  type RootedNetLabelOptions,
  type RootedSearch,
} from "./rooted-search.js";
import { nextCircuitLayoutRun } from "../layout/circuit-inline.js";
import { rememberPowerPlacement } from "../layout/power-placement.js";
import {
  frameReferences,
  rootedSearches,
  rememberPowerFrame,
  selectFramedPower,
} from "./rooted-power-frame.js";
import { required } from "../presentation/util.js";
import type { RootedCandidate } from "./rooted-build.js";
import { controlPrint, proposeControlPrint } from "./rooted-control-print.js";
export { cuts } from "./rooted-cuts.js";

/** The legacy path is unchanged; compact planning owns a separate reference page. */
export async function drawingDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact" = "standard",
  referenceOffset = 0,
  singleViewPacket = true,
): Promise<RenderOutcome<Draft[]>> {
  const control = controlPrint.getStore();
  if (control?.replacement)
    return { ok: true, value: structuredClone(control.replacement) };
  const qualityRun =
    request?.format === "schematic-view-request/0.1" &&
    request.family === "power" &&
    request.flow === "left-to-right"
      ? nextCircuitLayoutRun()
      : undefined;
  if (qualityRun?.power) {
    const selected = await selectFramedPower(ir, qualityRun, page);
    if (qualityRun.quality && qualityRun.power.selected)
      return drawingResult(selected, qualityRun.power.native);
    rememberFrameCandidate(selected);
    return { ok: true, value: selected.drafts };
  }
  const result = await framedDrawingDrafts(
    ir,
    request,
    presentation,
    page,
    mode,
    referenceOffset,
    singleViewPacket,
  );
  if (result.ok && qualityRun) {
    const selected = frameCandidate(result.value);
    const search = required(
      rootedSearches.get(selected),
      "Missing selected rooted search",
    );
    rememberPowerPlacement(
      qualityRun,
      selected,
      required(nativeWinner(search), "Missing native winner"),
      search,
    );
    if (qualityRun.power) rememberPowerFrame(qualityRun.power, selected, page);
  }
  return result;
}

async function framedDrawingDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact",
  referenceOffset: number,
  singleViewPacket: boolean,
): Promise<RenderOutcome<Draft[]>> {
  if (!hasCompactFrame(page))
    return selectedDrawingDrafts(
      ir,
      request,
      presentation,
      page,
      mode,
      referenceOffset,
      undefined,
      singleViewPacket,
    );
  const legacy = await selectedDrawingDrafts(
    ir,
    request,
    presentation,
    { ...page },
    mode,
    referenceOffset,
    undefined,
    singleViewPacket,
  );
  if (!legacy.ok) return legacy;
  const reference = frameCandidate(legacy.value);
  const ordinary = await selectedDrawingDrafts(
    ir,
    request,
    presentation,
    page,
    mode,
    referenceOffset,
    undefined,
    singleViewPacket,
  );
  beginFramePlanning(page, reference);
  const result = retainCompactPlacement(ordinary, page)
    ? ordinary
    : await replanCompactDrawing(
        ir,
        request,
        presentation,
        page,
        mode,
        referenceOffset,
        reference,
        singleViewPacket,
      );
  const failure = legacy.value[0]?.rootedPaginationFailure;
  if (!result.ok) return failure ? { ok: false, error: failure } : result;
  frameReferences.set(frameCandidate(result.value), reference);
  if (failure)
    required(result.value[0], "Missing framed sheet").rootedPaginationFailure =
      failure;
  return result;
}

function retainCompactPlacement(
  result: RenderOutcome<Draft[]>,
  page: PaperPage,
) {
  if (!result.ok) return false;
  const c = frameCandidate(result.value);
  recordFrameAttempt(
    page,
    c.prepared,
    c.profile,
    c.bank,
    c.grid,
    c.foldGroups,
    c.scale,
    c.drafts.map((d) => {
      if (!d.drawingBounds) throw Error("Missing compact field");
      return d.drawingBounds;
    }),
  );
  if (frameBudgetFailure(c, page)) return false;
  finishFramePlanning(page, c, "existing-compact");
  return true;
}
async function replanCompactDrawing(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact",
  referenceOffset: number,
  reference: import("./rooted-build.js").RootedCandidate,
  singleViewPacket: boolean,
): Promise<RenderOutcome<Draft[]>> {
  const planned = await selectedDrawingDrafts(
    ir,
    request,
    presentation,
    page,
    mode,
    referenceOffset,
    undefined,
    singleViewPacket,
  );
  if (planned.ok && !frameBudgetFailure(frameCandidate(planned.value), page)) {
    finishFramePlanning(page, frameCandidate(planned.value), "folded-group");
    return planned;
  }
  const result = legacyFramePlacement(
    reference,
    planned.ok ? frameCandidate(planned.value) : undefined,
    page,
  );
  if (result.ok) {
    const selected = { ...reference, drafts: result.value };
    rememberFrameCandidate(selected);
    rootedSearches.set(
      selected,
      required(rootedSearches.get(reference), "Missing legacy search"),
    );
  }
  return result;
}

/** Search owns ELK; the selected winner may then compose its existing strips. */
async function selectedDrawingDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact" = "standard",
  referenceOffset = 0,
  netLabelOptions?: RootedNetLabelOptions,
  singleViewPacket = true,
): Promise<RenderOutcome<Draft[]>> {
  const run = await searchRootedCandidates(
    ir,
    request,
    presentation,
    page,
    mode === "compact",
    referenceOffset,
    netLabelOptions,
  );
  const winner = rootedWinner(run, page),
    native = nativeWinner(run);
  if (!winner || !native) {
    const profile = winner ? winner.profile : run.prepared[0]?.profile;
    const error = (!native && run.nativeErrors.get(profile)) || run.errors[0];
    if (!error) throw Error("Rooted search returned neither drawing nor error");
    const recovered =
      run.paginationRetry && !hasCompactFrame(page)
        ? await retryRootedPagination(
            ir,
            run.paginationRetry,
            page,
            referenceOffset,
          )
        : undefined;
    const retry =
      !recovered && !netLabelOptions && singleViewPacket
        ? await retryOversizedSourceNetLabels({
            ir,
            request,
            presentation,
            run,
            page,
            mode,
            referenceOffset,
          })
        : undefined;
    if (retry?.drafts) return retry.drafts;
    const diagnostic = rootedDiagnosticError(
      error,
      run.diagnostics,
      retry?.sourcePotentials,
    );
    if (recovered) {
      rootedSearches.set(recovered.winner, run);
      return drawingResult(recovered.winner, recovered.native, diagnostic);
    }
    return { ok: false, error: diagnostic };
  }
  return finalizeRootedWinner(ir, winner, native, run, page, referenceOffset);
}

function finalizeRootedWinner(
  ir: Readonly<ElectricalIr>,
  winner: RootedCandidate,
  native: RootedCandidate,
  run: RootedSearch,
  page: PaperPage,
  referenceOffset: number,
): RenderOutcome<Draft[]> {
  const materialized = winner.printableDrafts
    ? { ok: true as const, value: winner.printableDrafts }
    : materializeRootedCandidate(ir, winner, page);
  if (!materialized.ok) return materialized;
  winner.drafts = materialized.value;
  const selected = selectRootedComposition(
    winner,
    composeRootedWinner(ir, winner, native, page),
    page,
  );
  rootedSearches.set(selected, run);
  offerControlPrint(ir, selected, native, page, referenceOffset);
  return drawingResult(selected, native);
}

async function retryOversizedSourceNetLabels(context: {
  readonly ir: Readonly<ElectricalIr>;
  readonly request: SchematicViewRequest;
  readonly presentation: CompiledProjectPresentation | undefined;
  readonly run: RootedSearch;
  readonly page: PaperPage;
  readonly mode: "standard" | "compact";
  readonly referenceOffset: number;
}): Promise<
  | {
      readonly drafts?: RenderOutcome<Draft[]>;
      readonly sourcePotentials?: readonly string[];
    }
  | undefined
> {
  const { ir, request, presentation, run, page, mode, referenceOffset } =
    context;
  const attribution = await attributeVerticalSourceNetLabels(
    ir,
    request,
    presentation,
    run,
    page,
    mode,
    referenceOffset,
  );
  if (attribution === undefined) return undefined;
  if (attribution.wrappableLabelIds.size > 0) {
    const retried = await selectedDrawingDrafts(
      ir,
      request,
      presentation,
      page,
      mode,
      referenceOffset,
      { wrapNetLabelIds: attribution.wrappableLabelIds },
    );
    if (retried.ok) {
      const selected = frameCandidate(retried.value);
      if (
        visibleDrawingAreaUtilisation(selected, page) >=
        WRAPPED_UTILISATION_FLOOR
      ) {
        return { drafts: retried };
      }
      return undefined;
    }
    if (
      retried.error.code === "R004" &&
      retried.error.details?.reason === "ambiguous-conductor-caption"
    ) {
      return undefined;
    }
  }
  return { sourcePotentials: attribution.potentialNames };
}

function offerControlPrint(
  ir: Readonly<ElectricalIr>,
  selected: RootedCandidate,
  native: RootedCandidate,
  page: PaperPage,
  referenceOffset: number,
) {
  const control = controlPrint.getStore();
  const { view } = selected.prepared.graph;
  if (
    control &&
    !control.replacement &&
    view.format === "schematic-view/0.1" &&
    view.family === "control"
  )
    control.propose = async () => {
      const proposal = await proposeControlPrint(
        ir,
        selected,
        native,
        page,
        referenceOffset,
      );
      if (proposal) {
        drawingResult(proposal.selected, native);
        return proposal;
      }
    };
}

function drawingResult(
  selected: RootedCandidate,
  native: RootedCandidate,
  paginationFailure?: RenderFailure,
): RenderOutcome<Draft[]> {
  const context = graphCardContext(selected.prepared.graph);
  const first = required(selected.drafts[0], "Missing rooted sheet");
  if (paginationFailure) first.rootedPaginationFailure = paginationFailure;
  first.rootedFit = {
    basePages: native.drafts.length,
    actualPages: selected.drafts.length,
    context,
  };
  first.rootedLegendSource = {
    prepared: selected.prepared,
    grid: selected.grid,
    scale: selected.scale,
    ...(selected.profile ? { profile: selected.profile } : {}),
  };
  for (const draft of selected.drafts) draft.rootedBank = selected.bank;
  rememberFrameCandidate(selected);
  return { ok: true, value: selected.drafts };
}
