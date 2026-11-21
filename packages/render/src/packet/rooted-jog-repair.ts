import type { ElectricalIr } from "@thermite/compiler";
import type { RootedCandidate } from "./rooted-build.js";
import {
  MAX_PLACEMENT_LAYOUTS,
  nativeWinner,
  rootedWinner,
  type RootedSearch,
} from "./rooted-search.js";
import type { PaperPage } from "./types.js";
import { VERTICAL_POWER_EDGE_NODE_SPACING } from "../layout/adapter-ordering.js";
import { conductorKey } from "../presentation/util.js";
import { actualChoices } from "../off-view/choices.js";
import { repositionDrawing } from "../off-view/prepared.js";
import {
  buildRootedCandidates,
  materializeRootedCandidate,
} from "./rooted-build.js";
import { candidateRoutes, routeGrowth } from "./rooted-clipped-routes.js";
import { candidateUtilisation } from "./rooted-score.js";
import { USEFUL_UTILISATION } from "./rooted-order.js";
import { localityRegression } from "./rooted-locality.js";
import { composeRootedWinner } from "./rooted-compose.js";
import { compositionFits } from "./composition-fit.js";
import { economyExhausted } from "./rooted-economy.js";

const jogCount = (c: RootedCandidate) =>
  [...c.jogs.values()].reduce((a, b) => a + b, 0);
const SOURCE_TURN_MARGIN_UNITS = 0.5;

/** Reservation and retry share the final printed/clipped trigger. A raw jog
 * hidden by a cut (or inside CHECK's numerical band) spends no economy slot. */
export function printedJogTrigger(
  ir: Readonly<ElectricalIr>,
  original: RootedCandidate | undefined,
  native: RootedCandidate | undefined,
  page: PaperPage,
) {
  if (
    !original ||
    !native ||
    !jogCount(original) ||
    original.prepared.view.family !== "power" ||
    original.prepared.view.flow !== "top-to-bottom"
  )
    return undefined;
  const printed = printedComposition(ir, original, native, page);
  return printed && printedJogCount(printed) ? printed : undefined;
}

/** One page-aware ELK retry, charged to the existing placement budget.
 * Keep the original unless the complete printed candidate repairs a jog with
 * no new/worse per-conductor defect, extra page or lost card locality. */
export async function repairRootedJogs(
  ir: Readonly<ElectricalIr>,
  original: RootedCandidate,
  native: RootedCandidate,
  page: PaperPage,
  run: RootedSearch,
  offset = 0,
) {
  if (run.attempts >= MAX_PLACEMENT_LAYOUTS || economyExhausted(run))
    return original;
  const before = printedJogTrigger(ir, original, native, page);
  if (!before) return original;
  run.attempts++;
  const minimum = 3 / original.scale;
  const spacing = sourceTurnSpacing(before);
  const prepared = await repositionDrawing(
    original.prepared,
    actualChoices(original.prepared),
    spacing ? 0 : minimum,
    spacing,
  );
  if (!prepared.ok) return original;
  const built = buildRootedCandidates(
    ir,
    prepared.value,
    page,
    original.profile,
    false,
    false,
    offset,
  );
  if (!built.ok) return original;
  const candidates = built.value
    .filter(
      (c) =>
        c.drafts.length <= original.drafts.length &&
        jogCount(c) < jogCount(original) &&
        !localityRegression(c, original) &&
        routeGrowth(c, original, false).every((n) => n === 0) &&
        routeGrowth(c, original).every((n) => n === 0),
    )
    .sort(
      (a, b) =>
        jogCount(a) - jogCount(b) ||
        a.drafts.length - b.drafts.length ||
        candidateUtilisation(b, page) - candidateUtilisation(a, page),
    );
  const candidate = candidates[0];
  if (!candidate) return original;
  const materialized = materializeRootedCandidate(ir, candidate, page);
  if (!materialized.ok) return original;
  candidate.drafts = materialized.value;
  if (
    !compositionFits(candidate, native, page) ||
    !preservesPrintedQuality(ir, before, candidate, native, page)
  )
    return original;
  candidate.printableDrafts = materialized.value;
  return candidate;
}

function printedComposition(
  ir: Readonly<ElectricalIr>,
  candidate: RootedCandidate,
  native: RootedCandidate,
  page: PaperPage,
) {
  const printed = candidate.printableDrafts
    ? { ok: true as const, value: candidate.printableDrafts }
    : materializeRootedCandidate(ir, candidate, page);
  return printed.ok
    ? composeRootedWinner(
        ir,
        { ...candidate, drafts: printed.value },
        native,
        page,
      )
    : undefined;
}

export async function repairSearchJogs(
  ir: Readonly<ElectricalIr>,
  run: RootedSearch,
  page: PaperPage,
) {
  const original = rootedWinner(run, page),
    native = nativeWinner(run);
  if (!original || !native) return;
  const repaired = await repairRootedJogs(
    ir,
    original,
    native,
    page,
    run,
    run.referenceOffset ?? 0,
  );
  if (repaired !== original) run.candidates = [repaired];
}

/** Compare the final strip compositions too: equal virtual grids can fold to
 * different physical page counts after a reservation changes the strip widths. */
function preservesPrintedQuality(
  ir: Readonly<ElectricalIr>,
  before: RootedCandidate,
  candidate: RootedCandidate,
  native: RootedCandidate,
  page: PaperPage,
) {
  const after = composeRootedWinner(ir, candidate, native, page);
  return (
    after.drafts.length <= before.drafts.length &&
    printedJogCount(after) < printedJogCount(before) &&
    routeGrowth(after, before, false).every((n) => n === 0) &&
    routeGrowth(after, before).every((n) => n === 0) &&
    candidateUtilisation(after, page) >=
      Math.min(USEFUL_UTILISATION, candidateUtilisation(before, page))
  );
}

function printedJogCount(candidate: RootedCandidate) {
  return [...candidateRoutes(candidate).values()].reduce(
    (n, defects) => n + defects.jogs.length,
    0,
  );
}

/** Measure the source-side shortfall in layout units. The retry adds half a
 * layout unit: 0.125 mm at the existing minimum 0.25 mm/unit print scale. */
function sourceTurnSpacing(c: RootedCandidate) {
  const ports = new Set(
    c.prepared.graph.nodes.flatMap((node) =>
      node.kind === "symbol" && node.classification === "source"
        ? node.ports.map((p) => p.id)
        : [],
    ),
  );
  const routes = candidateRoutes(c);
  const deficit = Math.max(
    0,
    ...c.prepared.graph.edges
      .filter((e) => ports.has(e.sourcePortId) || ports.has(e.targetPortId))
      .flatMap((e) =>
        e.elementIds.flatMap((id) => routes.get(conductorKey(id))?.jogs ?? []),
      ),
  );
  return deficit
    ? Number(VERTICAL_POWER_EDGE_NODE_SPACING) +
        deficit / c.scale +
        SOURCE_TURN_MARGIN_UNITS
    : 0;
}
