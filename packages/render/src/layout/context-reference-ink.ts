import type { JunctionPresentationNode, PresentationGraph } from "../types.js";
import { terminalContextAttachment } from "../terminal-context-reference.js";

/** Reserve the label and its 2 mm leader as local ink, not a hidden ELK edge.
 * The 6-unit dot keeps every semantic port; only its unpainted envelope grows. */
export function contextJunctionInk(
  graph: Readonly<PresentationGraph>,
  node: JunctionPresentationNode,
) {
  const associations = graph.edges.flatMap((edge) => {
    const association = terminalContextAttachment(graph, edge);
    return association?.junction.id === node.id
      ? [{ edge, ...association }]
      : [];
  });
  const association = associations[0];
  if (!association)
    return { width: 6, height: 6, anchor: { x: 3, y: 3 }, labels: [] };
  if (associations.length !== 1)
    throw Error("Terminal context must have one association per junction");
  const { edge, junctionIsSource } = association;
  if (!edge.label || edge.label.role !== "reference")
    throw Error("Terminal context has no reference label");
  const port = node.ports.find(
    (p) => p.id === (junctionIsSource ? edge.sourcePortId : edge.targetPortId),
  );
  if (!port) throw Error("Terminal context has no junction port");
  const label = edge.label,
    gap = 4.25,
    reach = 8;
  if (port.side === "north" || port.side === "south") {
    const height = label.height + gap + reach + 3;
    const north = port.side === "north";
    return {
      width: Math.max(6, label.width),
      height,
      anchor: { x: 3, y: north ? height - 3 : 3 },
      labels: [{ label, x: 0, y: north ? 0 : reach + 3 + gap }],
    };
  }
  const width = label.width + gap + reach + 3,
    height = Math.max(6, label.height),
    west = port.side === "west";
  return {
    width,
    height,
    anchor: { x: west ? width - 3 : 3, y: height / 2 },
    labels: [{ label, x: west ? 0 : reach + 3 + gap, y: 0 }],
  };
}
