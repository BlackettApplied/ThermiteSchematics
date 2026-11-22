import type { PresentationGraph, PresentationLabel } from "../types.js";
import { required } from "../presentation/util.js";

export function cardContext(cards: readonly PresentationLabel[]): string {
  return cards
    .map((label) => {
      const c = required(label.offView, "Missing off-view card");
      return `${c.terminalName}: ${c.connections.map((r) => r.designation).join(", ")}`;
    })
    .join("; ");
}

export function graphCardContext(graph: PresentationGraph): string {
  return cardContext(
    graph.nodes.flatMap((n) =>
      n.kind === "junction" ? [] : n.labels.filter((l) => l.offView),
    ),
  );
}
