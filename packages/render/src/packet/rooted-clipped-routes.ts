import type { RootedCandidate } from "./rooted-build.js";
import { conductorKey, required } from "../presentation/util.js";
import { fragmentDefects, routeFragments } from "./route-fragments.js";

export interface RouteDefects {
  jogs: number[];
  detours: number[];
}
export type RoutePopulation = ReadonlyMap<string, RouteDefects>;
const cache = new WeakMap<object, Map<string, RoutePopulation>>();
/** Identity is the authored wire/jumper UID or cable UID AND core ID. Each
 * logical view has its own native comparison population; packets never offset
 * findings between views, identities or physical path occurrences. */
export function candidateRoutes(
  c: RootedCandidate,
  clipped = true,
): RoutePopulation {
  if (!c.prepared) return new Map();
  const key = JSON.stringify([
    clipped,
    c.grid,
    c.scale,
    c.profile,
    c.bank,
    c.drafts.map((d) => [
      d.note,
      d.rootedSections,
      d.drawingBounds,
      d.links?.map((l) => [l.x, l.y]),
    ]),
  ]);
  let entries = cache.get(c.prepared.layout);
  if (!entries) {
    entries = new Map();
    cache.set(c.prepared.layout, entries);
  }
  const found = entries.get(key);
  if (found) return found;
  const result = new Map<string, RouteDefects>();
  const edges = new Map(
    c.prepared.graph.edges
      .filter((e) => e.kind === "conductor")
      .map((e) => [e.id, e]),
  );
  for (const edge of c.prepared.layout.edges) {
    const authored = edges.get(edge.id);
    if (!authored) continue;
    const paths = clipped
      ? c.drafts.flatMap((d) =>
          (d.rootedSections ?? []).flatMap((s) =>
            routeFragments(edge.points, s.viewport),
          ),
        )
      : [edge.points];
    for (const id of new Set(authored.elementIds.map(conductorKey))) {
      const population = result.get(id) ?? { jogs: [], detours: [] };
      for (const path of paths) {
        const defects = fragmentDefects(path, c.scale);
        population.jogs.push(...defects.jogs);
        population.detours.push(...defects.detours);
      }
      result.set(id, population);
    }
  }
  entries.set(key, result);
  return result;
}
/** Positive growth is calculated BEFORE summing: a repair on A cannot pay for
 * a new/worse occurrence on B. Descending severity pairs worst occurrences. */
export function defectGrowth(
  actual: RoutePopulation,
  reference: RoutePopulation,
) {
  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (const [id, defects] of actual) {
    for (const [kind, index] of [
      ["jogs", 0],
      ["detours", 2],
    ] as const) {
      const values = [...defects[kind]].sort((a, b) => b - a);
      const base = [...(reference.get(id)?.[kind] ?? [])].sort((a, b) => b - a);
      result[index] += Math.max(0, values.length - base.length);
      result[index + 1] =
        required(result[index + 1], "Missing severity slot") +
        values.reduce((sum, n, i) => sum + Math.max(0, n - (base[i] ?? 0)), 0);
    }
  }
  return result;
}
export function routeGrowth(
  c: RootedCandidate,
  reference: RootedCandidate,
  clipped = true,
) {
  return defectGrowth(
    candidateRoutes(c, clipped),
    candidateRoutes(reference, clipped),
  );
}
