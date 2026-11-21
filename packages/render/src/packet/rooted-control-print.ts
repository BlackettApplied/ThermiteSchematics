import { AsyncLocalStorage } from "node:async_hooks";
import type { ElectricalIr } from "@thermite/compiler";
import {
  backtracks,
  controlReconvergence,
} from "../layout/control-reconvergence.js";
import { circuitPacketGuard } from "../layout/circuit-packet-guard.js";
import { repaginateDrawing } from "../off-view/prepared.js";
import type { NormalizedSchematicLayout, RenderOutcome } from "../types.js";
import {
  buildRootedCandidates,
  materializeRootedCandidate,
  type RootedCandidate,
} from "./rooted-build.js";
import { composeRootedWinner } from "./rooted-compose.js";
import { compositionFits } from "./composition-fit.js";
import { routeGrowth } from "./rooted-clipped-routes.js";
import { localityRegression } from "./rooted-locality.js";
import { nativeWinner, rootedWinner } from "./rooted-search.js";
import { candidateUtilisation } from "./rooted-score.js";
import { USEFUL_UTILISATION } from "./rooted-order.js";
import { hasCompactFrame } from "./frame-profile.js";
import type { Draft, PaperPage, RenderedPacket } from "./types.js";

interface Placement {
  propose?: () => Promise<Draft[] | undefined>;
  replacement?: Draft[];
}
export const controlPrint = new AsyncLocalStorage<Placement>();

export async function selectControlPrint(
  render: () => Promise<RenderOutcome<RenderedPacket>>,
  eligible: () => boolean,
) {
  const placement: Placement = {};
  const original = await controlPrint.run(placement, render);
  if (
    !original.ok ||
    !placement.propose ||
    hasCompactFrame(original.value.page) ||
    !eligible()
  )
    return original;
  const replacement = await placement.propose();
  if (!replacement) return original;
  const candidate = await controlPrint.run({ replacement }, render);
  // A refold can round the same annotation distance at a different origin.
  return candidate.ok &&
    circuitPacketGuard(
      candidate.value,
      original.value,
      original.value.navigation?.quantumMm,
    )
    ? candidate
    : original;
}

/** Rebuild the annotated and no-card plans with one shared layout proposal.
 * Compare physical routes and keep the original if the alternate won't print. */
export async function proposeControlPrint(
  ir: Readonly<ElectricalIr>,
  original: RootedCandidate,
  native: RootedCandidate,
  page: PaperPage,
  offset: number,
) {
  const p = original.prepared;
  const [location] = p.graph.locationGroups;
  if (hasCompactFrame(page) || !location || p.graph.locationGroups.length !== 1)
    return;
  const join = controlReconvergence(p.graph, p.layout);
  if (
    !join &&
    (original.profile ||
      p.graph.view.flow !== "left-to-right" ||
      original.drafts.length < 2 ||
      original.grid.xs.length <= 2 ||
      original.grid.ys.length !== 2)
  )
    return;

  // Use the compact profile's layer spacing at the common location, leaving
  // fixed symbol and text reservations and all other spacing intact.
  const flow = p.graph.view.flow;
  const spacing =
    flow === "top-to-bottom" && original.profile !== "dense"
      ? { axes: [] }
      : {
          parentId: location.id,
          axes: [flow === "left-to-right" ? "width" : "height"] as const,
          layerSpacing: 40,
        };
  const actual = await repaginateDrawing(p, p, spacing, join);
  if (!actual.ok) return;
  if (!improvesRoutes(p.layout, actual.value.layout, join?.returningEdgeId))
    return;
  const baseline = await repaginateDrawing(native.prepared, p, spacing, join);
  if (!baseline.ok) return;
  const pair = printablePair(
    ir,
    page,
    actual.value,
    baseline.value,
    original.profile,
    !!join,
    offset,
  );
  if (!pair || pair.winner.scale < original.scale) return;
  const printed = materializeRootedCandidate(ir, pair.winner, page);
  if (!printed.ok) return;
  pair.winner.drafts = printed.value;
  const selected = composeRootedWinner(ir, pair.winner, pair.native, page);
  if (
    selected.drafts.length > original.drafts.length ||
    (!join && selected.drafts.length === original.drafts.length) ||
    candidateUtilisation(selected, page) < USEFUL_UTILISATION ||
    routeGrowth(selected, original).some(Boolean) ||
    routeGrowth(selected, original, false).some(Boolean) ||
    localityRegression(selected, original) ||
    !compositionFits(selected, native, page)
  )
    return;
  return selected;
}

function printablePair(
  ir: Readonly<ElectricalIr>,
  page: PaperPage,
  actual: RootedCandidate["prepared"],
  baseline: RootedCandidate["prepared"],
  profile: RootedCandidate["profile"],
  explore: boolean,
  offset: number,
) {
  const a = buildRootedCandidates(
    ir,
    actual,
    page,
    profile,
    false,
    explore,
    offset,
  );
  const b = buildRootedCandidates(
    ir,
    baseline,
    page,
    profile,
    true,
    false,
    offset,
  );
  if (!a.ok || !b.ok) return;
  const pair = { candidates: a.value, native: b.value };
  const winner = rootedWinner(pair, page);
  const native = nativeWinner(pair);
  if (winner && native) return { winner, native };
}

function improvesRoutes(
  original: NormalizedSchematicLayout,
  candidate: NormalizedSchematicLayout,
  returnId: string | undefined,
) {
  if (returnId) {
    const route = candidate.edges.find(({ id }) => id === returnId);
    if (
      !route ||
      backtracks(route.points, original.view.flow) ||
      candidate.crossings.some(({ edgeIds }) => edgeIds.includes(returnId))
    )
      return false;
  }
  const crossings = new Set(original.crossings.map(crossingKey));
  return candidate.crossings.every((c) => crossings.has(crossingKey(c)));
}

function crossingKey({ edgeIds }: { edgeIds: readonly string[] }) {
  return JSON.stringify([...edgeIds].sort());
}
