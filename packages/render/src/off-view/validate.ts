import { cardInkFits } from "./ink.js";
import { terminalIdKey } from "../ordering.js";
import { required } from "../presentation/util.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { PresentationGraph, PresentationLabel } from "../types.js";
import { conductorKey, invariant } from "../presentation/util.js";
import { createOffViewCard } from "./card.js";
import { authoredTerminalIncidence, omittedConnections } from "./incidence.js";

export function validateOffViewLabel(label: PresentationLabel) {
  invariant(cardInkFits(label), `${label.id} natural off-view ink bounds`);
  const card = label.offView;
  invariant(
    card !== undefined && label.role === "off-view",
    `${label.id} off-view data`,
  );
  const expected = createOffViewCard(
    card.terminal,
    card.terminalName,
    card.connections,
    label.ownerKind,
    label.ownerId,
  );
  invariant(
    label.id === expected.id &&
      JSON.stringify(label.textSources) ===
        JSON.stringify(expected.textSources) &&
      label.text === expected.text &&
      label.width === expected.width &&
      label.height === expected.height &&
      label.textLength === expected.textLength,
    `${label.id} complete off-view text geometry`,
  );
  invariant(
    JSON.stringify(card.lines) ===
      JSON.stringify(required(expected.offView, "Missing expected card").lines),
    `${label.id} complete off-view rows`,
  );
}

/** Recompute from physical source, independently of selected path partitioning. */
export function validateOffViewIncidence(
  ir: Readonly<ElectricalIr>,
  graph: PresentationGraph,
) {
  const incidence = authoredTerminalIncidence(ir);
  const drawn = new Set(
    graph.edges
      .filter((e) => e.kind === "conductor")
      .flatMap((e) => e.elementIds.map(conductorKey)),
  );
  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const seen = new Set<string>();
    for (const port of node.ports) {
      const key = terminalIdKey(port.terminal);
      if (seen.has(key)) continue;
      seen.add(key);
      const expected = omittedConnections(incidence, port.terminal, drawn);
      const cards = node.labels.filter(
        (l) => l.offView && terminalIdKey(l.offView.terminal) === key,
      );
      invariant(
        cards.length === (expected.length ? 1 : 0),
        `${node.id} one off-view disclosure per terminal`,
      );
      if (cards.length) {
        invariant(
          required(required(cards[0], "Missing label").offView, "Missing card")
            .terminalName ===
            `${node.designation}.${port.terminal.terminalKey}`,
          "exact terminal card heading",
        );
        invariant(
          JSON.stringify(
            required(
              required(cards[0], "Missing off-view label").offView,
              "Missing off-view card",
            ).connections,
          ) === JSON.stringify(expected),
          `${node.id} exact authored off-view incidence`,
        );
      }
    }
  }
}
