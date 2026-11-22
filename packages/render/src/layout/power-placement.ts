import type { ElectricalIr } from "@thermite/compiler";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { RootedCandidate } from "../packet/rooted-build.js";
import {
  buildRootedCandidates,
  materializeRootedCandidate,
} from "../packet/rooted-build.js";
import type { RootedSearch } from "../packet/rooted-search.js";
import { MAX_PLACEMENT_LAYOUTS } from "../packet/rooted-search.js";
import {
  economyExhausted,
  STANDARD_ECONOMY_ATTEMPTS,
} from "../packet/rooted-economy.js";
import { relayoutDrawing } from "../off-view/prepared.js";
import { compositionFits } from "../packet/composition-fit.js";
import { composeRootedWinner } from "../packet/rooted-compose.js";
import { candidateUtilisation } from "../packet/rooted-score.js";
import { USEFUL_UTILISATION } from "../packet/rooted-order.js";
import type { PaperPage } from "../packet/types.js";
import type { CircuitLayoutRun } from "./circuit-inline.js";
import {
  circuitInlineContext,
  circuitLayoutCacheKey,
} from "./circuit-inline-context.js";
import { createElkEngine } from "./elk-runtime.js";
import {
  InlineLabelFitError,
  isInlineLabelFailure,
} from "./inline-label-error.js";
import {
  powerConductorGuard,
  powerNativeGuard,
  powerRouteGraph,
} from "./power-placement-guard.js";
import { ELK_OPTIONS } from "./options.js";
import { circuitRouteMetrics } from "./circuit-route-quality.js";
import { compareText } from "../ordering.js";
import { required } from "../presentation/util.js";
import { elkWorkScope, type ElkWorkLedger } from "./elk-work.js";
import {
  frameBudgetFailure,
  frameBudgetOrder,
} from "../packet/frame-budget.js";

export interface PowerPlacementState {
  original: RootedCandidate;
  native: RootedCandidate;
  search: RootedSearch;
  work: ElkWorkLedger;
  selected?: RootedCandidate | undefined;
  decided?: boolean;
}

export function rememberPowerPlacement(
  run: CircuitLayoutRun | undefined,
  original: RootedCandidate,
  native: RootedCandidate,
  search: RootedSearch,
) {
  if (!run || circuitInlineContext.getStore()?.qualityPhase) return;
  run.power = {
    original: copyCandidate(original),
    native,
    search,
    work: required(search.elkWork, "Missing logical power ELK ledger"),
  };
  run.attempts = run.power.work.calls;
  const key = "printed-power";
  run.baseline.set(key, powerRouteGraph(original));
  run.printed.add(key);
}
export function copyCandidate(c: RootedCandidate): RootedCandidate {
  return { ...c, drafts: structuredClone(c.drafts) };
}

export function powerPlacementAvailable(run: CircuitLayoutRun) {
  const state = run.power;
  return (
    !state ||
    (!state.work.exhausted &&
      state.work.calls < MAX_PLACEMENT_LAYOUTS &&
      !economyExhausted(state.search) &&
      run.qualityAttempts < STANDARD_ECONOMY_ATTEMPTS)
  );
}

/** Exactly one recursive NS input after ordinary recovery. Logical requests and
 * the unchanged economy must fit; neither budget is reset or reserved
 * ahead of the existing TTB retry. Recomposition never re-runs recovery. */
export async function selectPowerPlacement(
  ir: Readonly<ElectricalIr>,
  run: CircuitLayoutRun,
  page: PaperPage,
) {
  const state = run.power;
  if (!state) throw Error("Missing original power placement");
  if (run.quality && !state.decided) {
    state.decided = true;
    let reason = "placement/economy budget exhausted";
    if (powerPlacementAvailable(run)) {
      state.search.attempts++;
      try {
        state.selected = await powerCandidate(ir, run, state, page);
        reason = state.selected
          ? "network-simplex"
          : "native/phase/conductor/print guards or no repair";
      } catch (error) {
        if (!isInlineLabelFailure(error)) throw error;
        reason = "single quality input cannot complete original composition";
      }
    }
    run.decisions.set("printed-power", reason);
  }
  return copyCandidate(
    run.quality && state.selected ? state.selected : state.original,
  );
}

async function powerCandidate(
  ir: Readonly<ElectricalIr>,
  run: CircuitLayoutRun,
  state: PowerPlacementState,
  page: PaperPage,
) {
  const engine = powerEngine(run, state);
  const original = state.original;
  const prepared = await relayoutDrawing(original.prepared, engine);
  if (!prepared.ok || !powerNativeGuard(prepared.value, original.prepared))
    return;
  const built = buildRootedCandidates(
    ir,
    prepared.value,
    page,
    original.profile,
    false,
    false,
    state.search.referenceOffset ?? 0,
  );
  if (!built.ok) return;
  const candidates: RootedCandidate[] = [];
  for (const candidate of built.value) {
    const printed = materializeRootedCandidate(ir, candidate, page);
    if (!printed.ok) continue;
    const printedCandidate = { ...candidate, drafts: printed.value };
    const composition = composeRootedWinner(
      ir,
      printedCandidate,
      state.native,
      page,
    );
    const composed =
      frameBudgetOrder(composition, printedCandidate, page) <= 0
        ? composition
        : printedCandidate;
    if (
      !frameBudgetFailure(composed, page) &&
      composed.drafts.length <= original.drafts.length &&
      compositionFits(composed, state.native, page) &&
      powerConductorGuard(composed, original) &&
      candidateUtilisation(composed, page) >=
        Math.min(USEFUL_UTILISATION, candidateUtilisation(original, page))
    )
      candidates.push(composed);
  }
  return candidates.sort((a, b) => {
    const before = score(a),
      after = score(b);
    return (
      before.map((n, i) => n - (after[i] ?? 0)).find((n) => n !== 0) ??
      compareText(
        JSON.stringify([a.grid, a.bank]),
        JSON.stringify([b.grid, b.bank]),
      )
    );
  })[0];
}

function powerEngine(run: CircuitLayoutRun, state: PowerPlacementState) {
  let configurationKey: string | undefined;
  const engine = createElkEngine(),
    layout = engine.layout.bind(engine);
  engine.layout = async (input, options) => {
    const candidate = structuredClone(input);
    networkSimplex(candidate);
    const context = circuitInlineContext.getStore(),
      key = circuitLayoutCacheKey(candidate, options);
    if (configurationKey !== undefined && configurationKey !== key)
      throw new InlineLabelFitError(
        "Power alternative permits one routing configuration per view.",
      );
    configurationKey = key;
    if (!run.qualityAttempts) {
      if (state.work.calls >= MAX_PLACEMENT_LAYOUTS)
        throw new InlineLabelFitError(
          "Power alternative exhausted its shared layout budget.",
        );
      run.qualityAttempts++;
      context?.permittedInputs.add(key);
    }
    try {
      return await elkWorkScope.run(state.work, () =>
        layout(candidate, options),
      );
    } finally {
      run.attempts = state.work.calls;
    }
  };
  return engine;
}

function networkSimplex(node: ElkNode) {
  if (!node.children?.length) return;
  node.layoutOptions = {
    ...node.layoutOptions,
    [ELK_OPTIONS.nodePlacementStrategy]: "NETWORK_SIMPLEX",
  };
  node.children.forEach(networkSimplex);
}
function score(c: RootedCandidate) {
  const routes = (powerRouteGraph(c).edges ?? []).map(circuitRouteMetrics);
  return [
    routes.filter((r) => r.jogs.length).length,
    routes.filter((r) => r.detours.length).length,
    routes.reduce((n, r) => n + r.bends, 0),
    routes.reduce((n, r) => n + r.length, 0),
  ];
}
