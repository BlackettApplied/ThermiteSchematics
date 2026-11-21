import { required } from "../presentation/util.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { fragmentDefects } from "../packet/route-fragments.js";
import { defectGrowth } from "../packet/rooted-clipped-routes.js";

export function circuitRouteMetrics(edge: ElkExtendedEdge) {
  const paths = (edge.sections ?? []).map((s) => [
    s.startPoint,
    ...(s.bendPoints ?? []),
    s.endPoint,
  ]);
  const lengths = paths.map((p) =>
    p
      .slice(1)
      .reduce(
        (n, b, i) =>
          n +
          Math.hypot(
            b.x - required(p[i], "Missing native circuit geometry").x,
            b.y - required(p[i], "Missing native circuit geometry").y,
          ),
        0,
      ),
  );
  return {
    length: lengths.reduce((a, b) => a + b, 0),
    bends: paths.reduce((n, p) => n + Math.max(0, p.length - 2), 0),
    jogs: paths.flatMap((p) => fragmentDefects(p, 1).jogs),
    detours: paths.flatMap((p) => fragmentDefects(p, 1).detours),
  };
}
export function circuitHasJogs(graph: ElkNode) {
  return (graph.edges ?? []).some(
    (e) => circuitRouteMetrics(e).jogs.length > 0,
  );
}
/** Circuit parts retain whole unscaled routes, so continuous and visible clipped
 * populations are identical. Edge IDs are physical wire/jumper or individual core
 * occurrences in this group; no cable designation or undefined wire key is used. */
export function circuitConductorGuard(candidate: ElkNode, original: ElkNode) {
  const compared = conductorComparison(candidate, original);
  if (!compared) return false;
  const { before, after } = compared;
  return (
    [...after.values()].reduce((n, a) => n + Number(a.jogs.length > 0), 0) <
    [...before.values()].reduce((n, a) => n + Number(a.jogs.length > 0), 0)
  );
}

/** The same safety envelope, without imposing the caller's improvement goal. */
export function circuitConductorNonRegression(
  candidate: ElkNode,
  original: ElkNode,
) {
  return conductorComparison(candidate, original) !== undefined;
}

function conductorComparison(candidate: ElkNode, original: ElkNode) {
  const before = new Map(
    (original.edges ?? []).map((e) => [e.id, circuitRouteMetrics(e)]),
  );
  const after = new Map(
    (candidate.edges ?? []).map((e) => [e.id, circuitRouteMetrics(e)]),
  );
  if (
    before.size !== after.size ||
    [...before.keys()].some((id) => !after.has(id))
  )
    return undefined;
  if (defectGrowth(after, before).some((n) => n > 1e-7)) return undefined;
  for (const [id, a] of after) {
    const b = required(before.get(id), "Missing native circuit geometry");
    const repaired =
      a.jogs.length < b.jogs.length || a.detours.length < b.detours.length;
    if (
      a.bends > b.bends ||
      (!repaired && a.length - b.length > Math.max(10, b.length * 0.25) + 1e-7)
    )
      return undefined;
  }
  return { before, after };
}
