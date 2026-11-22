import { compareTerminalId } from "../ordering.js";
import type { SymbolSide } from "../symbols/types.js";
import type { JunctionPresentationNode, PresentationGraph } from "../types.js";

/** ELK may loop a branch across its sibling when both loads share a compound.
 * Enumerate the four straight/turned assignments at each two-arm source fork.
 * Only routing sides change: identities, anchors and incidence stay exact. */
export function* directLoadRouteAlternatives(
  graph: PresentationGraph,
): Generator<PresentationGraph> {
  if (!graph.directLoadPair) return;
  const sourceUid =
    "deviceUid" in graph.view.root ? graph.view.root.deviceUid : undefined;
  const designations = new Map(
    graph.deviceGroups.map((g) => [g.deviceUid, g.designation]),
  );
  const forks = graph.nodes
    .filter(
      (node): node is JunctionPresentationNode =>
        node.kind === "junction" &&
        node.terminal.deviceUid === sourceUid &&
        node.ports.length === 3,
    )
    .sort((a, b) =>
      compareTerminalId(a.terminal, b.terminal, (uid) =>
        designations.get(uid)!,
      ),
    );
  // A DC source has two mapped arms. Keep the search bounded at 4² routes.
  if (forks.length === 0 || forks.length > 2) return;
  const forward: SymbolSide =
    graph.view.flow === "left-to-right" ? "east" : "south";
  const opposite = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
  } as const;
  const ports = forks.map((node) =>
    node.ports
      .filter((port) =>
        graph.edges.some(
          (edge) => edge.kind === "conductor" && edge.sourcePortId === port.id,
        ),
      )
      .sort((a, b) => a.order - b.order),
  );
  if (
    ports.some(
      (pair) =>
        pair.length !== 2 ||
        pair[0]!.side !== forward ||
        pair[1]!.side === forward ||
        pair[1]!.side === opposite[forward],
    )
  )
    return;
  for (let candidate = 1; candidate < 4 ** forks.length; candidate++) {
    const sides = new Map<string, SymbolSide>();
    ports.forEach((pair, index) => {
      const variant = Math.floor(candidate / 4 ** index) % 4;
      const turn = variant < 2 ? pair[1]!.side : opposite[pair[1]!.side];
      sides.set(pair[0]!.id, variant % 2 === 0 ? forward : turn);
      sides.set(pair[1]!.id, variant % 2 === 0 ? turn : forward);
    });
    yield {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind !== "junction"
          ? node
          : {
              ...node,
              ports: node.ports.map((port) => ({
                ...port,
                side: sides.get(port.id) ?? port.side,
              })),
            },
      ),
    };
  }
}

/** Loads keep incoming sides fixed (six choices on each of two nets).
 * Existing PNP signal forks use all four sides on their one signal net.
 * A second, capped stage varies four component slots, repeated on longer chains.
 * Identical port-side assignments are tried once. Bounds including the original
 * layout: loads 291 (36 with one fork per net); PNP traces 279. */
export function* rootedRouteAlternatives(
  graph: PresentationGraph,
): Generator<PresentationGraph> {
  if (graph.directLoadPair) {
    yield* directLoadRouteAlternatives(graph);
    return;
  }
  if (
    !("intent" in graph.view) ||
    !["loads", "trace"].includes(graph.view.intent)
  )
    return;
  const trace = graph.view.intent === "trace";
  const rootUid =
    "deviceUid" in graph.view.root ? graph.view.root.deviceUid : undefined;
  const signalNet = trace
    ? graph.nodes.flatMap((n) =>
        n.kind === "junction" || n.deviceUid !== rootUid
          ? []
          : n.ports
              .filter((p) => p.symbolPortId === "signal")
              .map((p) => p.netId),
      )[0]
    : undefined;
  if (trace && signalNet === undefined) return;
  const forks = graph.nodes.filter(
    (n): n is JunctionPresentationNode =>
      n.kind === "junction" && (!trace || n.netId === signalNet),
  );
  if (trace) {
    // Compatibility recovery for existing closed three-/four-arm signal forks.
    // Repeated sides cannot be repaired by a side permutation.
    const rootArms = forks
      .filter((n) => n.terminal.deviceUid === rootUid)
      .reduce(
        (count, n) =>
          count +
          n.ports.filter((p) => p.symbolPortId.startsWith("conductor-")).length,
        0,
      );
    if (
      rootArms < 3 ||
      forks.some(
        (n) => new Set(n.ports.map((p) => p.side)).size !== n.ports.length,
      )
    )
      return;
  }
  const nets = [...new Set(forks.map((n) => n.netId))];
  if (nets.length === 0 || nets.length > (trace ? 1 : 2)) return;
  const sides: SymbolSide[] =
    graph.view.flow === "left-to-right"
      ? ["east", "north", "south"]
      : ["south", "east", "west"];
  if (trace) sides.push(graph.view.flow === "left-to-right" ? "west" : "north");
  const permute = (values: number[]): number[][] =>
    values.length === 0
      ? [[]]
      : values.flatMap((v, i) =>
          permute(values.filter((_, j) => j !== i)).map((rest) => [v, ...rest]),
        );
  const permutations = permute(sides.map((_, i) => i));
  const radix = permutations.length;
  // Only junction sides vary. Their ordered vector completely identifies an
  // adapter candidate, without UUIDs or unused permutation positions in its key.
  const seen = new Set([
    JSON.stringify(forks.map((n) => n.ports.map((p) => p.side))),
  ]);
  const variant = (
    choices: readonly number[],
  ): PresentationGraph | undefined => {
    const assignments = new Map(
      forks.map((n, i) => [
        n.id,
        n.ports.map((p) => {
          const index = sides.indexOf(p.side);
          return index < 0
            ? p.side
            : sides[permutations[choices[i]!]![index]!]!;
        }),
      ]),
    );
    const key = JSON.stringify([...assignments.values()]);
    if (seen.has(key)) return undefined;
    seen.add(key);
    return {
      ...graph,
      nodes: graph.nodes.map((n) => {
        if (n.kind !== "junction") return n;
        const assigned = assignments.get(n.id);
        return !assigned
          ? n
          : {
              ...n,
              ports: n.ports.map((p, i) => ({ ...p, side: assigned[i]! })),
            };
      }),
    };
  };
  for (let candidate = 1; candidate < radix ** nets.length; candidate++) {
    const result = variant(
      forks.map(
        (n) => Math.floor(candidate / radix ** nets.indexOf(n.netId)) % radix,
      ),
    );
    if (result) yield result;
  }
  // With exactly one component on every net, both stages enumerate the same set.
  if (forks.length === nets.length) return;
  // A second stage permits independent comb components. Fixed cap: 256
  // assignments, even if a source has more than four junction components.
  const limit = Math.min(radix ** forks.length, 256);
  for (let candidate = 1; candidate < limit; candidate++) {
    const result = variant(
      forks.map(
        (_, index) => Math.floor(candidate / radix ** (index % 4)) % radix,
      ),
    );
    if (result) yield result;
  }
}
