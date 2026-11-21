import type { IrFunction, TerminalId } from "@thermite/compiler";
import type { CaptionPoint, CaptionSegment } from "./circuit-caption.js";
import type { CircuitMark } from "./circuit.js";
import {
  COUPLED_WINDING_AMPLITUDE_MM,
  sourceEnclosure,
  windingPolyline,
} from "./printable-policy.js";
import type { SymbolSide } from "./types.js";

export interface InkOwner {
  width: number;
  height: number;
  boundary: boolean;
  type: { symbol?: string };
  sourceTerminalKeys: readonly string[];
  rows: readonly { f: IrFunction; mark: CircuitMark }[];
  pins: readonly (CaptionPoint & { terminal: TerminalId; side: string })[];
}
const sides: Readonly<Record<string, SymbolSide>> = {
  WEST: "west",
  EAST: "east",
  NORTH: "north",
  SOUTH: "south",
};
const chain = (ps: readonly CaptionPoint[]): CaptionSegment[] =>
  ps.slice(1).map((p, i) => [ps[i] as CaptionPoint, p]);
const same = (a: TerminalId, b: TerminalId) =>
  a.deviceUid === b.deviceUid && a.terminalKey === b.terminalKey;

function frameSegments(node: InkOwner): CaptionSegment[] {
  const block =
    node.boundary ||
    node.rows.some(
      ({ f, mark }) =>
        ["source", "load", "channel", "other"].includes(f.kind) &&
        !["motor", "heater", "lamp", "thermocouple", "fuse"].includes(mark),
    );
  if (!block) return [];
  const pins = node.pins.filter((p) =>
    node.sourceTerminalKeys.includes(p.terminal.terminalKey),
  );
  if (!pins.length)
    return chain([
      { x: 0, y: 0 },
      { x: node.width, y: 0 },
      { x: node.width, y: node.height },
      { x: 0, y: node.height },
      { x: 0, y: 0 },
    ]);
  const openings = pins.map((p) => {
    const side = sides[p.side];
    if (!side) throw Error("Unknown enclosure side");
    return { side, at: p.side === "WEST" || p.side === "EAST" ? p.y : p.x };
  });
  return sourceEnclosure(
    { x: 0, y: 0, width: node.width, height: node.height },
    openings,
    1.5,
  ).map((p) => [p.from, p.to]);
}

function windingSegments(
  node: InkOwner,
  f: IrFunction,
  c: CaptionPoint,
  vertical: boolean,
): CaptionSegment[] {
  const first = f.terminals[0],
    last = f.terminals.at(-1);
  if (!first || !last) return [];
  const a = node.pins.find((p) => same(p.terminal, first)),
    b = node.pins.find((p) => same(p.terminal, last));
  if (!a || !b) throw Error("Missing winding caption pin");
  const source = f.kind === "source",
    coupled = node.type.symbol === "thermite:transformer",
    cross = (vertical ? c.y : c.x) + (coupled ? (source ? 3 : -3) : 0),
    edge = source ? (vertical ? node.height : node.width) : 0;
  const ps = windingPolyline(
    cross,
    vertical ? a.x : a.y,
    vertical ? b.x : b.y,
    edge,
    coupled ? (source ? -1 : 1) * COUPLED_WINDING_AMPLITUDE_MM : 2,
    vertical ? [a.y, b.y] : [a.x, b.x],
  ).map(([cross, along]) =>
    vertical ? { x: along, y: cross } : { x: cross, y: along },
  );
  const result = chain(ps);
  if (!coupled)
    result.push(
      vertical
        ? [
            { x: Math.min(a.x, b.x) - 1, y: cross + 4 },
            { x: Math.max(a.x, b.x) + 1, y: cross + 4 },
          ]
        : [
            { x: cross + 4, y: a.y - 1 },
            { x: cross + 4, y: b.y + 1 },
          ],
    );
  return result;
}

/** The same native polylines and enclosure openings that the emitter paints. */
export function ownerExtraSegments(
  node: InkOwner,
  centers: readonly CaptionPoint[],
  vertical: boolean,
): CaptionSegment[] {
  const result = frameSegments(node),
    windings = node.rows.flatMap((row, i) => {
      if (row.mark !== "winding") return [];
      const c = centers[i];
      if (!c) throw Error("Missing winding center");
      result.push(...windingSegments(node, row.f, c, vertical));
      return row.f.terminals;
    });
  if (node.type.symbol === "thermite:transformer" && windings.length) {
    const coords = windings.map((t) => {
        const p = node.pins.find((p) => same(p.terminal, t));
        if (!p) throw Error("Missing transformer core pin");
        return vertical ? p.x : p.y;
      }),
      c = centers[0];
    if (!c) throw Error("Missing transformer core center");
    for (const d of [-0.5, 0.5])
      result.push(
        vertical
          ? [
              { x: Math.min(...coords) - 1, y: c.y + d },
              { x: Math.max(...coords) + 1, y: c.y + d },
            ]
          : [
              { x: c.x + d, y: Math.min(...coords) - 1 },
              { x: c.x + d, y: Math.max(...coords) + 1 },
            ],
      );
  }
  return result;
}
