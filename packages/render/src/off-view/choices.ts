import type { PreparedSchematicDrawing } from "../renderer.js";

export function placementChoices(p: PreparedSchematicDrawing, rank: number) {
  return Object.fromEntries(
    p.graph.nodes.flatMap((n) =>
      n.kind === "junction"
        ? []
        : n.labels.flatMap((l) =>
            l.offView
              ? [[l.id, Math.min(rank, (l.offView.placementCount ?? 1) - 1)]]
              : [],
          ),
    ),
  );
}
export function actualChoices(p: PreparedSchematicDrawing) {
  return Object.fromEntries(
    p.graph.nodes.flatMap((n) =>
      n.kind === "junction"
        ? []
        : n.labels.flatMap((l) =>
            l.offView ? [[l.id, l.offView.placementRank ?? 0]] : [],
          ),
    ),
  );
}
export function cardGroups(p: PreparedSchematicDrawing) {
  const groups = new Map<string, string[]>();
  for (const n of p.graph.nodes)
    if (n.kind !== "junction") {
      const ids = n.labels.filter((l) => l.offView).map((l) => l.id);
      if (ids.length)
        groups.set(n.deviceUid, [...(groups.get(n.deviceUid) ?? []), ...ids]);
    }
  return [...groups.values()];
}
