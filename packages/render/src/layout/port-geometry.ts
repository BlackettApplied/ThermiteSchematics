import type {
  SymbolPresentationNode,
  RailPresentationNode,
  PresentationPort,
} from "../types.js";
import type { SymbolSide } from "../symbols/types.js";

export function portBorderOffset(
  side: SymbolSide,
  position: Readonly<{ x: number; y: number }>,
  width: number,
  height: number,
): number {
  // ELK 0.12 places a side-constrained zero-size port on the node border. A
  // negative border offset keeps the FIXED_POS anchor at the D6 primitive.
  switch (side) {
    case "west":
      return -position.x;
    case "east":
      return -(width - position.x);
    case "north":
      return -position.y;
    case "south":
      return -(height - position.y);
  }
}

export function portPosition(
  node: SymbolPresentationNode | RailPresentationNode,
  port: PresentationPort,
): Readonly<{ x: number; y: number }> {
  const origin = node.primitiveOrigin;
  switch (port.side) {
    case "west":
      return {
        x: quantizedInput(origin.x),
        y: quantizedInput(origin.y + port.offset * node.symbolSize.height),
      };
    case "east":
      return {
        x: quantizedInput(origin.x + node.symbolSize.width),
        y: quantizedInput(origin.y + port.offset * node.symbolSize.height),
      };
    case "north":
      return {
        x: quantizedInput(origin.x + port.offset * node.symbolSize.width),
        y: quantizedInput(origin.y),
      };
    case "south":
      return {
        x: quantizedInput(origin.x + port.offset * node.symbolSize.width),
        y: quantizedInput(origin.y + node.symbolSize.height),
      };
  }
}

export function quantizedInput(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("ELK adapter invariant: adapter geometry must be finite");
  const quantized = Number(value.toFixed(3));
  return Object.is(quantized, -0) ? 0 : quantized;
}
