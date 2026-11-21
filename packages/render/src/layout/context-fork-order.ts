import type { PresentationGraph, JunctionPresentationNode } from "../types.js";
import type { SymbolSide } from "../symbols/types.js";
import { terminalContextAttachment } from "../terminal-context-reference.js";

const opposite = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
} as const;

function controlForks(graph: Readonly<PresentationGraph>, forward: SymbolSide) {
  return graph.nodes
    .filter(
      (n): n is JunctionPresentationNode =>
        n.kind === "junction" && n.ports.length === 3,
    )
    .flatMap((node) => {
      const ports = node.ports
        .filter((p) =>
          graph.edges.some(
            (e) => e.kind === "conductor" && e.sourcePortId === p.id,
          ),
        )
        .sort((a, b) => a.order - b.order);
      const attachment = node.ports.filter((p) => !ports.includes(p));
      const [first, second] = ports,
        [attachmentPort] = attachment;
      return ports.length === 2 &&
        first &&
        second &&
        attachment.length === 1 &&
        attachmentPort &&
        graph.edges.some(
          (e) =>
            e.kind === "boundary-segment" &&
            (e.sourcePortId === attachmentPort.id ||
              e.targetPortId === attachmentPort.id) &&
            !terminalContextAttachment(graph, e),
        ) &&
        first.side === forward &&
        second.side !== forward &&
        second.side !== opposite[forward]
        ? [{ node, ports: [first, second] as const }]
        : [];
    });
}

/** A detached reference must not determine real branch order. Try the four
 * straight/turned assignments in authored incidence order, retaining the
 * incoming attachment. At most two two-arm forks: 15 alternatives + original.
 * Every candidate is routed by ELK and checked by the unchanged route guards. */
export function* contextForkOrderAlternatives(
  graph: Readonly<PresentationGraph>,
): Generator<PresentationGraph> {
  if (
    graph.view.family !== "control" ||
    !graph.edges.some((edge) => terminalContextAttachment(graph, edge))
  )
    return;
  const forward: SymbolSide =
    graph.view.flow === "left-to-right" ? "east" : "south";
  const forks = controlForks(graph, forward);
  if (!forks.length || forks.length > 2) return;
  for (let candidate = 1; candidate < 4 ** forks.length; candidate++) {
    const assignments = new Map<string, SymbolSide>();
    forks.forEach(({ ports }, index) => {
      const variant = Math.floor(candidate / 4 ** index) % 4;
      const turn = variant < 2 ? ports[1].side : opposite[ports[1].side];
      assignments.set(ports[0].id, variant % 2 === 0 ? forward : turn);
      assignments.set(ports[1].id, variant % 2 === 0 ? turn : forward);
    });
    yield {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.kind !== "junction"
          ? n
          : {
              ...n,
              ports: n.ports.map((p) => ({
                ...p,
                side: assignments.get(p.id) ?? p.side,
              })),
            },
      ),
    };
  }
}
