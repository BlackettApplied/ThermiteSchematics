import type { ElectricalIr } from "@thermite/compiler";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { PaginationSpacing } from "../layout/spacing.js";
import { repaginateDrawing } from "../off-view/prepared.js";
import {
  buildRootedCandidates,
  materializeRootedCandidate,
  rootedSpace,
} from "./rooted-build.js";
import { compositionFits } from "./composition-fit.js";
import type { RootedConstraint } from "./rooted-constraint.js";
import type { RootedSpacingCut } from "./rooted-plans.js";
import { nativeWinner, rootedWinner } from "./rooted-search.js";
import type { PaperPage } from "./types.js";

export function paginationSpacing(
  p: PreparedSchematicDrawing,
  constraint: RootedConstraint,
  cut: RootedSpacingCut | undefined,
): PaginationSpacing | undefined {
  if (p.view?.flow !== "top-to-bottom") return;
  if (constraint.kind === "protected-span")
    return { axes: constraint.spans.map((span) => span.axis) };
  if (!cut) return;
  const nodes = new Map(p.layout.nodes.map((node) => [node.id, node]));
  const nodesByPort = new Map(
    p.layout.ports.map((port) => [port.id, port.nodeId]),
  );
  const routes = cut.edgeIds.map((id) =>
    p.layout.edges.find((edge) => edge.id === id),
  );
  const parents = routes.flatMap((route) =>
    route
      ? [route.sourcePortId, route.targetPortId].map((port) => {
          const ancestors: string[] = [];
          for (
            let node = nodes.get(nodesByPort.get(port) ?? "");
            node;
            node = nodes.get(node.parentId)
          ) {
            const parent = nodes.get(node.parentId);
            if (
              parent &&
              cut.y >= parent.y &&
              cut.y <= parent.y + parent.height
            )
              ancestors.push(parent.id);
          }
          return ancestors;
        })
      : [],
  );
  if (parents.length !== 4) return;
  // Put the hint on the deepest compound containing both runs at the cut.
  // Compressing its layers can clear a band elsewhere without moving any port.
  return {
    parentId:
      parents[0]?.find((parent) =>
        parents.every((path) => path.includes(parent)),
      ) ?? "root",
    axes: ["height"],
  };
}

export interface RootedPaginationRetry {
  annotated: PreparedSchematicDrawing;
  native: PreparedSchematicDrawing;
  profile: "compact" | "dense" | undefined;
  spacing: PaginationSpacing;
}

export async function retryRootedPagination(
  ir: Readonly<ElectricalIr>,
  retry: RootedPaginationRetry,
  page: PaperPage,
  offset: number,
) {
  const { annotated, native, profile, spacing } = retry;
  const actual = await repaginateDrawing(annotated, annotated, spacing);
  if (!actual.ok || !sameScale(annotated, actual.value, page, !!profile))
    return;
  const built = buildRootedCandidates(
    ir,
    actual.value,
    page,
    profile,
    false,
    false,
    offset,
  );
  if (!built.ok) return;
  const baseline = await repaginateDrawing(native, annotated, spacing);
  if (!baseline.ok || !sameScale(native, baseline.value, page, !!profile, true))
    return;
  const builtNative = buildRootedCandidates(
    ir,
    baseline.value,
    page,
    profile,
    true,
    false,
    offset,
  );
  if (!builtNative.ok) return;
  const pair = { candidates: built.value, native: builtNative.value };
  const winner = rootedWinner(pair, page);
  const base = nativeWinner(pair);
  if (!winner || !base) return;
  const materialized = materializeRootedCandidate(ir, winner, page);
  if (!materialized.ok) return;
  winner.drafts = materialized.value;
  if (compositionFits(winner, base, page)) return { winner, native: base };
}

function sameScale(
  original: PreparedSchematicDrawing,
  proposal: PreparedSchematicDrawing,
  page: PaperPage,
  profile: boolean,
  native = false,
) {
  return (
    rootedSpace(original, page, profile, native).scale ===
    rootedSpace(proposal, page, profile, native).scale
  );
}
