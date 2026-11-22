import type {
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  SymbolPresentationNode,
  JunctionPresentationNode,
  LayoutPort,
  LayoutPoint,
} from "./types.js";
import { compareRenderTextSource, structuralTupleId } from "./ordering.js";
import { continuousLabelSlot } from "./text-metrics.js";

/** Same-terminal context associations are references, never physical conductors. */
export function terminalContextAttachment(
  graph: Readonly<PresentationGraph>,
  edge: Readonly<PresentationEdge>,
):
  | {
      context: SymbolPresentationNode;
      junction: JunctionPresentationNode;
      junctionIsSource: boolean;
    }
  | undefined {
  if (
    edge.kind !== "boundary-segment" ||
    edge.conductor ||
    edge.elementIds.length
  )
    return undefined;
  const source = graph.nodes.find((n) =>
    n.ports.some((p) => p.id === edge.sourcePortId),
  );
  const target = graph.nodes.find((n) =>
    n.ports.some((p) => p.id === edge.targetPortId),
  );
  const context =
    source?.kind === "symbol" && source.representation === "terminal"
      ? source
      : target?.kind === "symbol" && target.representation === "terminal"
        ? target
        : undefined;
  const junction =
    source?.kind === "junction"
      ? source
      : target?.kind === "junction"
        ? target
        : undefined;
  const same = (a: (typeof edge.endpoints)[number], b: typeof a) =>
    a.deviceUid === b.deviceUid && a.terminalKey === b.terminalKey;
  return context &&
    junction &&
    same(edge.endpoints[0], edge.endpoints[1]) &&
    same(junction.terminal, edge.endpoints[0]) &&
    context.ports.some(
      (p) =>
        p.id ===
          (source === junction ? edge.targetPortId : edge.sourcePortId) &&
        same(p.terminal, junction.terminal),
    )
    ? { context, junction, junctionIsSource: source === junction }
    : undefined;
}

function referenceLabel(
  graph: PresentationGraph,
  edge: PresentationEdge,
  context: SymbolPresentationNode,
  role: "reference",
): PresentationLabel {
  const port = context.ports[0];
  if (!port) throw Error("Terminal context has no real terminal");
  const terminal = port.terminal;
  const text = `${context.designation}.${terminal.terminalKey} (reference, no wire)`;
  const width = continuousLabelSlot(text);
  const group = graph.deviceGroups.find((g) => g.id === context.deviceGroupId);
  const caption = context.labels.find((l) => l.role === "terminal");
  if (!group || !caption) throw Error("Terminal context identity is missing");
  return {
    id: structuralTupleId("label", "edge", edge.id, role),
    ownerKind: "edge",
    ownerId: edge.id,
    role,
    text,
    textSources: [...group.label.textSources, ...caption.textSources].sort(
      compareRenderTextSource,
    ),
    width,
    height: 14,
    textLength: Number((width - 6).toFixed(3)),
  };
}

export function labelTerminalContextReferences(
  graph: PresentationGraph,
): PresentationGraph {
  return {
    ...graph,
    edges: graph.edges.map((edge) => {
      const association = terminalContextAttachment(graph, edge);
      return association
        ? {
            ...edge,
            label: referenceLabel(
              graph,
              edge,
              association.context,
              "reference",
            ),
          }
        : edge;
    }),
  };
}

/** At default print scale each solid hairline leader is at most 2 mm. */
export function contextReferenceLeader(
  port: Pick<LayoutPort, "x" | "y" | "side">,
): readonly [LayoutPoint, LayoutPoint] {
  const dx = port.side === "west" ? -8 : port.side === "east" ? 8 : 0;
  const dy = port.side === "north" ? -8 : port.side === "south" ? 8 : 0;
  return [
    { x: port.x, y: port.y },
    { x: port.x + dx, y: port.y + dy },
  ];
}
