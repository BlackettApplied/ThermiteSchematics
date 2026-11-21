import type { PreparedSchematicDrawing } from "../renderer.js";
import { conductorKey } from "../presentation/util.js";
import type { DrawingBounds } from "./types.js";
import type { RootedGrid } from "./rooted-plans.js";
import { reserveContinuationSources } from "./continuation-source.js";
import { rootedCrossings } from "./rooted-crossings.js";

type Source = ReturnType<typeof reserveContinuationSources>[number];
/** Full source widths are known before cutting. Each side consumes only its
 * crossed blocks; an uncut identity cannot enlarge an unrelated bank. Final
 * candidate ink is still checked if a reservation changes the selected cuts. */
export function continuationBankSources(
  p: PreparedSchematicDrawing,
  grids: readonly RootedGrid[],
  b: DrawingBounds,
  scale: number,
) {
  const sources = new Map(
    reserveContinuationSources(p.graph).map((s) => [
      conductorKey(s.provenance),
      s,
    ]),
  );
  const byEdge = new Map(
    p.graph.edges.map((e) => {
      const element = e.elementIds?.[0];
      return [
        e.id,
        e.elementIds?.length === 1 && element
          ? sources.get(conductorKey(element))
          : undefined,
      ];
    }),
  );
  const sides = new Map<string, Set<Source>>();
  for (const grid of grids)
    for (const edge of p.layout.edges) {
      const source = byEdge.get(edge.id);
      if (!source) continue;
      for (const cut of rootedCrossings(edge, grid.xs, grid.ys, b, scale))
        for (const side of [cut.a.side, cut.z.side]) {
          const values = sides.get(side) ?? new Set<Source>();
          values.add(source);
          sides.set(side, values);
        }
    }
  return (side: string): readonly Source[] => [...(sides.get(side) ?? [])];
}
