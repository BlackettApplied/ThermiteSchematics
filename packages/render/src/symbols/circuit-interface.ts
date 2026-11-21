import {
  circuitMarkName,
  composedCircuitMark,
  type CircuitMark,
} from "./circuit-mark.js";
import { PRINTABLE_SYMBOL_POLICY } from "./printable-policy.js";

type InterfacePin = { x: number; y: number; side: string };
const n = (v: number) => String(Number(v.toFixed(3)));

/** Fit the conversion outline over the physical span of its own terminals.
 * The existing 6⅔ mm depth leaves 1 mm before the tip of each independent lead. */
export function conversionQualifierSpan(
  mark: CircuitMark,
  coordinate: number,
  positions: readonly number[],
): readonly [number, number] | undefined {
  if (mark !== "ac-input" && mark !== "dc-output") return undefined;
  return [
    Math.min(-10 / 3, Math.min(...positions) - coordinate - 1.5),
    Math.max(10 / 3, Math.max(...positions) - coordinate + 1.5),
  ];
}

export function interfaceLeadTip(
  mark: CircuitMark,
  pin: InterfacePin,
  pins: readonly InterfacePin[],
  cx: number,
  cy: number,
  vertical: boolean,
  source: boolean,
) {
  const gap = PRINTABLE_SYMBOL_POLICY.separateStubGapMm;
  const depth =
    mark === "ac-input" || mark === "dc-output"
      ? 10 / 3 + gap
      : mark === "sensor-3wire" && pins.length === 1 && !source
        ? 10 / 3
        : 5 +
          (source ||
          circuitMarkName(mark) === "receptacle" ||
          pins.some((p) => p !== pin && p.side === pin.side)
            ? gap
            : 0);
  return vertical
    ? { x: pin.x, y: cy + (pin.side === "NORTH" ? -depth : depth) }
    : { x: cx + (pin.side === "WEST" ? -depth : depth), y: pin.y };
}

/** Interface leads and the presentation outline are independent for conversion. */
export function circuitInterfaceMark(
  mark: CircuitMark,
  cx: number,
  cy: number,
  pins: readonly InterfacePin[],
  vertical: boolean,
  source = false,
): string {
  const coordinates = pins.map((p) => (vertical ? p.x : p.y));
  const low = Math.min(...coordinates) - 2,
    high = Math.max(...coordinates) + 2;
  const span = conversionQualifierSpan(mark, vertical ? cx : cy, coordinates);
  const outline = vertical
    ? `<rect x="${n(low)}" y="${n(cy - 5)}" width="${n(high - low)}" height="10"/>`
    : `<rect x="${n(cx - 5)}" y="${n(low)}" width="10" height="${n(high - low)}"/>`;
  const sensorOutput = mark === "sensor-3wire" && pins.length === 1;
  const leads = pins
    .map((p) => {
      const tip = interfaceLeadTip(mark, p, pins, cx, cy, vertical, source);
      const role = source ? ' data-source-stub="true"' : "";
      return vertical
        ? `<line${role} x1="${n(p.x)}" x2="${n(tip.x)}" y1="${n(p.y)}" y2="${n(tip.y)}"/>`
        : `<line${role} y1="${n(p.y)}" y2="${n(tip.y)}" x1="${n(p.x)}" x2="${n(tip.x)}"/>`;
    })
    .join("");
  return `<g data-function-interface="${circuitMarkName(mark)}" fill="none" stroke="#17212b" stroke-width=".35">${source || sensorOutput || span ? "" : outline}${leads}</g>${composedCircuitMark(mark, cx, cy, vertical, span)}`;
}
