import type { ElectricalIr } from "@thermite/compiler";
import type { PresentationEdge, PresentationGraph } from "../../src/types.js";

export function hasSourceCaption(
  graph: PresentationGraph,
  edge: PresentationEdge,
  name: string,
  ir: ElectricalIr,
  printed: (id: string) => string | null | undefined,
  role?: "rail",
) {
  return graph.nodes.some((node) => {
    if (node.kind === "junction") return false;
    const landing = node.ports.find((port) => port.id === edge.sourcePortId);
    if (!landing) return false;
    const ownsTerminal = (terminal: typeof landing.terminal) =>
      terminal.deviceUid === landing.terminal.deviceUid &&
      terminal.terminalKey === landing.terminal.terminalKey;
    return node.labels.some((caption) => {
      if ((role && caption.role !== role) || printed(caption.id) !== name)
        return false;
      if (caption.role === "terminal") {
        return node.ports.some(
          (port) => port.id === caption.ownerId && ownsTerminal(port.terminal),
        );
      }
      return (
        caption.role === "rail" &&
        node.kind === "rail" &&
        node.boundary.kind === "potential" &&
        ir.potentials.some(
          (potential) =>
            potential.uid === node.boundary.potentialUid &&
            potential.name === name &&
            potential.netId === edge.netId &&
            ownsTerminal(potential.terminal),
        )
      );
    });
  });
}
