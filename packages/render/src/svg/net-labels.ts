import { terminalIdKey } from "../ordering.js";
import type {
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
} from "../types.js";

function carriesPotential(caption: PresentationLabel, edge: PresentationEdge) {
  return caption.textSources.some(
    (source) =>
      source.ownerKind === "potential" &&
      source.field === "potential.name" &&
      edge.netLabel?.textSources.some(
        (net) =>
          net.ownerKind === source.ownerKind &&
          net.ownerId === source.ownerId &&
          net.field === source.field &&
          net.value === source.value,
      ),
  );
}

function ownedRailCaption(
  graph: Readonly<PresentationGraph>,
  edge: PresentationEdge,
  text: string,
) {
  return graph.nodes.some(
    (node) =>
      node.kind === "rail" &&
      node.boundary.kind === "potential" &&
      node.boundary.potentialUid !== undefined &&
      node.boundary.netId === edge.netId &&
      node.ports.some((port) => port.id === edge.sourcePortId) &&
      node.labels.some(
        (caption) =>
          caption.role === "rail" &&
          (caption.printableText ?? caption.text) === text &&
          carriesPotential(caption, edge),
      ),
  );
}

/** A landing caption already identifies this conductor. Suppress only redundant
 * ink, retaining the net label's reservation, ownership and electrical name.
 * Net labels anchor at ELK TAIL (the route source). Only that landing's body
 * can supply replacement ink: a far-end caption or remote/split body
 * cannot substitute for the name here. Duplicate port captions may share one
 * printed caption on that same physical terminal and body.
 */
export function redundantNetLabelIds(
  graph: Readonly<PresentationGraph>,
  hiddenCaptions: ReadonlySet<string>,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const edge of graph.edges) {
    const label = edge.netLabel;
    if (!label) continue;
    const text = label.printableText ?? label.text;
    if (!text) continue;
    if (ownedRailCaption(graph, edge, text)) {
      hidden.add(label.id);
      continue;
    }
    const portId = edge.sourcePortId;
    const node = graph.nodes.find((n) => n.ports.some((p) => p.id === portId));
    if (!node || node.kind === "junction") continue;
    const landing = node.ports.find((p) => p.id === portId);
    if (!landing) continue;
    const terminal = terminalIdKey(landing.terminal);
    if (
      node.labels.some(
        (caption) =>
          caption.role === "terminal" &&
          !hiddenCaptions.has(caption.id) &&
          (caption.printableText ?? caption.text) === text &&
          node.ports.some(
            (p) =>
              p.id === caption.ownerId &&
              terminalIdKey(p.terminal) === terminal,
          ),
      )
    )
      hidden.add(label.id);
  }
  return hidden;
}
