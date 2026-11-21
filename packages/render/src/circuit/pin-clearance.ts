import { captionInk } from "../symbols/caption-ink.js";
import type { CaptionBox } from "../symbols/circuit-caption.js";
import {
  circuitMarkInkBounds,
  circuitMarkName,
  circuitWindingPoints,
} from "../symbols/circuit.js";
import { TERMINAL_TEXT_SIZE } from "../symbols/circuit-text.js";
import { PRINTABLE_SYMBOL_POLICY } from "../symbols/printable-policy.js";
import { strokeMiters } from "../symbols/stroke-join.js";
import type { FunctionRow, Pin } from "./types.js";

export const LATERAL_PIN_INSET_MM = 1.5;
// Half a millimetre plus room for the emitted stroke and glyph coordinates to
// round independently. This also preserves the established winding clearance.
const CLEARANCE_MM = 0.56;
const HALF_STROKE = PRINTABLE_SYMBOL_POLICY.conductorStrokeMm / 2;
type Point = readonly [number, number];

/** Bounds of the winding body and its miters. Horizontal rays from the first
 * and last corners to the pins sit below their respective captions. */
function windingBody(points: readonly Point[], coupled: boolean): CaptionBox {
  const body = points.slice(1, -1);
  const vertices: Point[] = [
    ...body.flatMap(([x, y]): Point[] => [
      [x - HALF_STROKE, y - HALF_STROKE],
      [x + HALF_STROKE, y + HALF_STROKE],
    ]),
    ...strokeMiters(points, HALF_STROKE),
  ];
  const first = body[0],
    last = body.at(-1);
  if (!coupled && first && last) {
    const [x, y] = first;
    vertices.push(
      [x + 4 + HALF_STROKE, y - 1],
      [x + 4 + HALF_STROKE, last[1] + 1],
    );
  }
  return {
    left: Math.min(...vertices.map((p) => p[0])),
    right: Math.max(...vertices.map((p) => p[0])),
    top: Math.min(...vertices.map((p) => p[1])),
    bottom: Math.max(...vertices.map((p) => p[1])),
  };
}

function lateralBody(
  row: FunctionRow,
  pins: readonly Pin[],
  pitch: number,
  coupled: boolean,
): CaptionBox[] {
  const { mark, f, center, slots, channelLines } = row;
  const rowPins = f.terminals.flatMap((t) => {
    const pin = pins.find((p) => p.terminal.terminalKey === t.terminalKey);
    return pin ? [pin] : [];
  });
  const ports = rowPins.map((pin) => pin.y);
  const [first, last] = rowPins;
  if (mark === "winding" && first && last) {
    // Only the direction of the horizontal leads affects the corner miters.
    const edge = (pin: Pin) => (pin.side === "WEST" ? -10 : 10);
    const b = windingBody(
      circuitWindingPoints(0, first.y, last.y, f.kind === "source", coupled, [
        edge(first),
        edge(last),
      ]),
      coupled,
    );
    return [b];
  }
  if (mark === "motor") {
    const radius = Math.max(5, (slots * pitch) / 2 - 2) + HALF_STROKE;
    return [
      {
        left: -radius,
        right: radius,
        top: center - radius,
        bottom: center + radius,
      },
    ];
  }
  const specialized = mark === "level-sensor" || mark === "sensor-3wire";
  if (channelLines && !specialized) return [];
  const markY = channelLines
    ? center - (9 + channelLines.length * 3.1) / 2 + 4
    : center;
  const ink = circuitMarkInkBounds(mark, false, true);
  const boxes = [{ ...ink, top: ink.top + markY, bottom: ink.bottom + markY }];
  if (
    ports.length &&
    [
      "level-sensor",
      "conductivity-probe",
      "receptacle",
      "sensor-3wire",
    ].includes(circuitMarkName(mark)) &&
    f.kind !== "source" &&
    (mark !== "sensor-3wire" || ports.length > 1) &&
    (!channelLines || mark === "sensor-3wire")
  ) {
    // Interface face has a 10 mm depth and a 0.35 mm outline.
    boxes.push({
      left: -5.175,
      right: 5.175,
      top: Math.min(...ports) - 2.175,
      bottom: Math.max(...ports) + 2.175,
    });
  }
  return boxes;
}

/** Reserve each label lane independently about the centred symbol ink. */
export function lateralPinClearanceWidth(
  pins: readonly Pin[],
  rows: readonly FunctionRow[],
  pitch: number,
  coupled: boolean,
  label: (p: Pin) => string,
) {
  const bodies = rows.flatMap((row) => lateralBody(row, pins, pitch, coupled));
  let width = 0;
  for (const pin of pins) {
    const west = pin.side === "WEST";
    const ink = captionInk(
      label(pin),
      west ? LATERAL_PIN_INSET_MM : -LATERAL_PIN_INSET_MM,
      pin.y - LATERAL_PIN_INSET_MM,
      TERMINAL_TEXT_SIZE,
      west ? "start" : "end",
    );
    for (const body of bodies) {
      if (
        ink.bottom + CLEARANCE_MM <= body.top ||
        body.bottom + CLEARANCE_MM <= ink.top
      )
        continue;
      const reach = west ? ink.right - body.left : body.right - ink.left;
      width = Math.max(width, 2 * (reach + CLEARANCE_MM + 0.002));
    }
  }
  return Math.ceil(width * 1000) / 1000;
}
