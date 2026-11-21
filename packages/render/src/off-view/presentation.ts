import { alignPowerCardReservations } from "./power-alignment.js";
import { cardContext } from "./context.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { PresentationGraph, RenderFailure } from "../types.js";
import type { InvalidSheetError, InvalidRenderTextError } from "../errors.js";
import { preflightOffViewSources } from "../svg/escape.js";
import { terminalIdKey } from "../ordering.js";
import { conductorKey } from "../presentation/util.js";
import { authoredTerminalIncidence, omittedConnections } from "./incidence.js";
import { createOffViewCard } from "./card.js";
import { reserveOffViewCards } from "./placement.js";
import { reserveGangAnnotations } from "../presentation/gang-annotations.js";

type AnnotatedGraph =
  | { readonly ok: true; readonly value: PresentationGraph }
  | {
      readonly ok: false;
      readonly error: InvalidSheetError | InvalidRenderTextError;
    };

export function addOffViewCards(
  ir: Readonly<ElectricalIr>,
  graph: PresentationGraph,
  choices: Readonly<Record<string, number>> = {},
): AnnotatedGraph {
  graph = reserveGangAnnotations(ir, graph);
  const incidence = authoredTerminalIncidence(ir);
  // View union, not a path, page fragment, reference leader or packet union.
  const drawn = new Set(
    graph.edges
      .filter((e) => e.kind === "conductor")
      .flatMap((e) => e.elementIds.map(conductorKey)),
  );
  const nodes = [];
  for (const node of graph.nodes) {
    if (node.kind === "junction") {
      nodes.push(node);
      continue;
    }
    const seen = new Set<string>();
    const cards = node.ports.flatMap((port) => {
      const key = terminalIdKey(port.terminal);
      if (seen.has(key)) return [];
      seen.add(key);
      const omitted = omittedConnections(incidence, port.terminal, drawn);
      return omitted.length
        ? [
            createOffViewCard(
              port.terminal,
              `${node.designation}.${port.terminal.terminalKey}`,
              omitted,
              "port",
              port.id,
            ),
          ]
        : [];
    });
    const preflight = preflightOffViewSources(
      graph.view,
      cards.flatMap((c) => c.textSources),
    );
    if (!preflight.ok) return preflight;
    const reserved = reserveOffViewCards(node, cards, choices);
    if (!reserved) return offViewRefusal(graph, cardContext(cards));
    nodes.push(reserved);
  }
  return { ok: true, value: alignPowerCardReservations({ ...graph, nodes }) };
}

export function offViewRefusal(
  graph: Pick<PresentationGraph, "view">,
  context: string,
): { readonly ok: false; readonly error: InvalidSheetError } {
  return {
    ok: false,
    error: {
      code: "R006",
      reason: "unprintable-layout",
      root: graph.view.root.designation,
      message: `Off-view cards cannot be printed without overlap: ${context}. Use a larger page or change flow.`,
      details: { reason: "off-view-card", terminals: context },
    },
  };
}

export function offViewLayoutFailure(
  graph: PresentationGraph,
  error: RenderFailure,
): RenderFailure {
  const cards = graph.nodes.flatMap((n) =>
    n.kind === "junction" ? [] : n.labels.filter((l) => l.offView),
  );
  const message =
    error.code === "R004"
      ? String(error.details?.originalMessage ?? error.message)
      : error.message;
  if (
    !cards.length ||
    !(
      error.code === "R006" ||
      (error.code === "R004" && cards.some((c) => message.includes(c.id)))
    )
  )
    return error;
  const context = cardContext(cards);
  return {
    code: "R006",
    root: error.root,
    reason: "unprintable-layout",
    message: `${error.message} Off-view cards: ${context}. Retain every connection; use a larger page or change flow.`,
    details: {
      ...error.details,
      offViewConnections: context,
      originalCode: error.code,
    },
  };
}

export function offViewPacketFailure(
  graph: PresentationGraph,
  reason: InvalidSheetError["reason"],
  message: string,
) {
  return {
    ok: false as const,
    error: offViewLayoutFailure(graph, {
      code: "R006",
      root: "packet",
      reason,
      message,
    }),
  };
}
