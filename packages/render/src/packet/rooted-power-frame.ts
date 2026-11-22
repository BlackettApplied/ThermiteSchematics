import type { ElectricalIr } from "@thermite/compiler";
import type { CircuitLayoutRun } from "../layout/circuit-inline.js";
import {
  copyCandidate,
  selectPowerPlacement,
  type PowerPlacementState,
} from "../layout/power-placement.js";
import type { RootedCandidate } from "./rooted-build.js";
import type { RootedSearch } from "./rooted-search.js";
import type { PaperPage } from "./types.js";
import { useCompactFrame } from "./frame-profile.js";
import {
  configureTitleFrame,
  titleFrameContext,
} from "../internal/title-data/frame-context.js";
import {
  beginFramePlanning,
  compactPlanningReceipts,
  finishFramePlanning,
  replayCompactPlanningReceipts,
  type FrameReceipt,
} from "./frame-budget.js";

export const rootedSearches = new WeakMap<RootedCandidate, RootedSearch>();
export const frameReferences = new WeakMap<RootedCandidate, RootedCandidate>();
interface SavedFrame {
  reference: RootedCandidate;
  original: readonly FrameReceipt[];
  selected?: readonly FrameReceipt[];
}
const frames = new WeakMap<PowerPlacementState, SavedFrame>();
export function rememberPowerFrame(
  state: PowerPlacementState,
  selected: RootedCandidate,
  page: PaperPage,
) {
  const reference = frameReferences.get(selected);
  if (reference)
    frames.set(state, {
      reference: copyCandidate(reference),
      original: compactPlanningReceipts(page).slice(-1),
    });
}

/** One logical view, with the same legacy field reference for every alternative.
 * Reuse completed receipts; never revive or share a mutable planning context. */
export async function selectFramedPower(
  ir: Readonly<ElectricalIr>,
  run: CircuitLayoutRun,
  page: PaperPage,
) {
  const frame = run.power && frames.get(run.power);
  if (!frame) return selectPowerPlacement(ir, run, page);
  const working = { ...page };
  const title = titleFrameContext(page);
  if (title) configureTitleFrame(working, title);
  else useCompactFrame(working);
  beginFramePlanning(working, frame.reference);
  const selected = await selectPowerPlacement(ir, run, working);
  if (run.quality && run.power?.selected) {
    if (!frame.selected) {
      finishFramePlanning(working, selected, "folded-group");
      frame.selected = compactPlanningReceipts(working);
    }
    replayCompactPlanningReceipts(page, frame.selected);
  } else replayCompactPlanningReceipts(page, frame.original);
  return selected;
}
