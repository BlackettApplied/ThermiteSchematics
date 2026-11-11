import { captionInk } from "./caption-ink.js";
import {
  PRINTABLE_SYMBOL_POLICY,
  sharedMarkHeight,
  sharedMarkPrimitives,
  type SharedMark,
} from "./printable-policy.js";
import { escapeXmlText as xml } from "../svg/escape.js";

/** Closed, original circuit marks. Profiles never grant electrical continuity. */
export type CircuitMark =
  | "disconnector"
  | "estop-no"
  | "estop-nc"
  | "selector-no"
  | "selector-nc"
  | "contact-no"
  | "contact-nc"
  | "breaker"
  | "overload"
  | "fuse"
  | "coil"
  | "motor"
  | "heater"
  | "winding"
  | "source"
  | "load"
  | "terminal"
  | "earth"
  | "solenoid"
  | "lamp"
  | "switch-no"
  | "switch-nc"
  | "pushbutton-no"
  | "pushbutton-nc"
  | "thermocouple"
  | "interface"
  | "pressure-no"
  | "pressure-nc"
  | "level-no"
  | "level-nc"
  | "level-sensor"
  | "conductivity-probe"
  | "receptacle"
  | "ac-input"
  | "dc-output"
  | "sensor-3wire";

type Point = readonly [number, number];
type Primitive =
  | { kind: "line"; a: Point; b: Point; dashed?: boolean }
  | { kind: "polyline"; points: readonly Point[] }
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "text"; x: number; y: number; text: string };
const line = (x: number, y: number, a: number, b: number): Primitive => ({
  kind: "line",
  a: [x, y],
  b: [a, b],
});
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
): Primitive => ({ kind: "rect", x, y, width, height });
const circle = (x: number, y: number, radius: number): Primitive => ({
  kind: "circle",
  x,
  y,
  radius,
});
const label = (text: string): Primitive => ({ kind: "text", x: 6, y: 7, text });
const zigzag: Primitive = {
  kind: "polyline",
  points: [
    [0, 6],
    [2, 6],
    [3, 3],
    [5, 9],
    [7, 3],
    [9, 9],
    [10, 6],
    [12, 6],
  ],
};
const CONTACT = [
  line(0, 6, 4, 6),
  line(8, 6, 12, 6),
  line(4, 3, 4, 9),
  line(8, 3, 8, 9),
];
const pressure: Primitive[] = [
  line(6, 0, 6, 2),
  {
    kind: "polyline",
    points: [
      [2, 0],
      [3, 1],
      [4, 0],
      [5, 1],
      [6, 0],
      [7, 1],
      [8, 0],
      [9, 1],
      [10, 0],
    ],
  },
];
const level: Primitive[] = [
  line(6, 0, 6, 2),
  {
    kind: "polyline",
    points: [
      [6, 0],
      [4, 1],
      [6, 2],
      [8, 1],
      [6, 0],
    ],
  },
];
function sharedCircuitPrimitives(mark: SharedMark): Primitive[] {
  const y = (v: number) => 6 + (v - sharedMarkHeight(mark) / 2) * 0.3;
  return sharedMarkPrimitives(mark).map((original) => {
    const pivot = sharedMarkHeight(mark) / 2 - 6;
    const transform = (v: { x: number; y: number }) => ({
      x: 20 + (v.x - 20) * 1.5,
      y: pivot + (v.y - pivot) * 1.5,
    });
    const p =
      original.style !== "actuator"
        ? original
        : original.kind === "line"
          ? {
              ...original,
              from: transform(original.from),
              to: transform(original.to),
            }
          : original.kind === "polyline"
            ? { ...original, points: original.points.map(transform) }
            : original;
    switch (p.kind) {
      case "line":
        return line(p.from.x * 0.3, y(p.from.y), p.to.x * 0.3, y(p.to.y));
      case "polyline":
        return {
          kind: "polyline",
          points: p.points.map((v) => [v.x * 0.3, y(v.y)] as Point),
        };
      case "rect":
        return rect(p.x * 0.3, y(p.y), p.width * 0.3, p.height * 0.3);
      default:
        throw Error(`Unsupported shared mark primitive ${p.kind}`);
    }
  });
}
const MARKS: Readonly<Record<CircuitMark, readonly Primitive[]>> =
  Object.freeze({
    disconnector: sharedCircuitPrimitives("disconnector"),
    "estop-no": sharedCircuitPrimitives("estop-no"),
    "estop-nc": sharedCircuitPrimitives("estop-nc"),
    "selector-no": sharedCircuitPrimitives("selector-no"),
    "selector-nc": sharedCircuitPrimitives("selector-nc"),
    "contact-no": sharedCircuitPrimitives("contact-no"),
    "contact-nc": sharedCircuitPrimitives("contact-nc"),
    breaker: sharedCircuitPrimitives("breaker"),
    overload: sharedCircuitPrimitives("overload"),
    fuse: [line(0, 6, 12, 6), rect(3, 4, 6, 4)],
    coil: sharedCircuitPrimitives("coil"),
    motor: [circle(6, 6, 5), label("M")],
    heater: [zigzag],
    winding: [
      {
        kind: "polyline",
        points: [
          [0, 6],
          [2, 6],
          [3, 3],
          [4, 6],
          [5, 3],
          [6, 6],
          [7, 3],
          [8, 6],
          [9, 3],
          [10, 6],
          [12, 6],
        ],
      },
      line(2, 10, 10, 10),
    ],
    source: [rect(1, 1, 10, 10), label("SUP")],
    load: [rect(1, 1, 10, 10), label("PWR")],
    terminal: [circle(6, 6, 1.2), line(0, 6, 4.8, 6), line(7.2, 6, 12, 6)],
    earth: [
      line(0, 6, 4, 6),
      line(4, 2, 4, 10),
      line(7, 3, 7, 9),
      line(10, 4, 10, 8),
    ],
    solenoid: [
      line(0, 6, 2, 6),
      line(10, 6, 12, 6),
      rect(2, 2, 8, 8),
      line(2, 10, 10, 2),
    ],
    lamp: [
      circle(6, 6, 4),
      line(3.2, 3.2, 8.8, 8.8),
      line(3.2, 8.8, 8.8, 3.2),
      line(6, 0, 6, 1),
      line(6, 11, 6, 12),
    ],
    "switch-no": sharedCircuitPrimitives("switch-no"),
    "switch-nc": sharedCircuitPrimitives("switch-nc"),
    "pushbutton-no": sharedCircuitPrimitives("pushbutton-no"),
    "pushbutton-nc": sharedCircuitPrimitives("pushbutton-nc"),
    thermocouple: [
      {
        kind: "polyline",
        points: [
          [0, 3],
          [8, 3],
          [10, 6],
          [8, 9],
          [0, 9],
        ],
      },
      circle(10, 6, 0.7),
    ],
    interface: [rect(1, 1, 10, 10)],
    "pressure-no": [...CONTACT, ...pressure],
    "pressure-nc": [...CONTACT, ...pressure, line(2, 10, 10, 2)],
    "level-no": [...CONTACT, ...level],
    "level-nc": [...CONTACT, ...level, line(2, 10, 10, 2)],
    "level-sensor": [
      rect(1, 1, 10, 10),
      {
        kind: "polyline",
        points: [
          [6, 3],
          [3, 6],
          [6, 9],
          [9, 6],
          [6, 3],
        ],
      },
    ],
    "conductivity-probe": [circle(6, 6, 5), line(4, 3, 4, 9), line(8, 3, 8, 9)],
    receptacle: [
      circle(6, 6, 5),
      line(4, 3, 4, 7),
      line(8, 3, 8, 7),
      {
        kind: "polyline",
        points: [
          [5, 9],
          [5, 8],
          [7, 8],
          [7, 9],
        ],
      },
    ],
    "ac-input": [
      rect(1, 1, 10, 10),
      {
        kind: "polyline",
        points: [
          [2, 6],
          [3, 4],
          [4, 3],
          [5, 4],
          [7, 8],
          [8, 9],
          [9, 8],
          [10, 6],
        ],
      },
    ],
    "sensor-3wire": [rect(1, 1, 10, 10), circle(6, 6, 2), line(8, 6, 12, 6)],
    "dc-output": [
      rect(1, 1, 10, 10),
      line(3, 4, 9, 4),
      line(3, 7, 4, 7),
      line(5, 7, 7, 7),
      line(8, 7, 9, 7),
    ],
  });
const n = (v: number) => String(Number(v.toFixed(3)));

// Keep the established 8 mm composition geometry; compensate only legend em.
const MARK_SCALE = 0.666667;
const legendEm = (value: string, mmPerUnit: number) =>
  Math.ceil(Math.max(value.length > 1 ? 2.5 : 3.5, 2.5 / mmPerUnit) * 1000) /
  1000;

/** Catalog geometry is 12 units. mmPerUnit includes every enclosing scale. */
export function emitCircuitMark(
  mark: CircuitMark,
  vertical = false,
  mmPerUnit = 1,
): string {
  return `<g data-circuit-mark="${mark}" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}" fill="none"${vertical ? ' transform="translate(12 0) rotate(90)"' : ""}>${MARKS[
    mark
  ]
    .map((p) => {
      switch (p.kind) {
        case "line":
          return `<line x1="${n(p.a[0])}" y1="${n(p.a[1])}" x2="${n(p.b[0])}" y2="${n(p.b[1])}"/>`;
        case "polyline":
          return `<polyline points="${p.points.map((v) => `${n(v[0])},${n(v[1])}`).join(" ")}"/>`;
        case "circle":
          return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.radius)}"/>`;
        case "rect":
          return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.width)}" height="${n(p.height)}"/>`;
        case "text":
          return `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" stroke="none" fill="#17212b" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="${legendEm(p.text, mmPerUnit)}"${vertical ? ` transform="rotate(-90 ${p.x} ${p.y})"` : ""}>${xml(p.text)}</text>`;
      }
    })
    .join("")}</g>`;
}

/** The single scaled composition path keeps geometry and physical em together. */
export function composedCircuitMark(
  mark: CircuitMark,
  cx: number,
  cy: number,
  vertical: boolean,
): string {
  return `<g transform="translate(${n(cx - 4)} ${n(cy - 4)}) scale(.666667)">${emitCircuitMark(mark, vertical, MARK_SCALE)}</g>`;
}

/** Horizontal legend ink after mark rotation and its counter-rotation. Used
 * before ELK for row/block reservations and again for caption obstacles. */
export function circuitMarkLegendInk(
  mark: CircuitMark,
  cx: number,
  cy: number,
  vertical: boolean,
) {
  return MARKS[mark].flatMap((p) =>
    p.kind === "text"
      ? [
          captionInk(
            p.text,
            cx - 4 + (vertical ? 12 - p.y : p.x) * MARK_SCALE,
            cy - 4 + (vertical ? p.x : p.y) * MARK_SCALE,
            legendEm(p.text, MARK_SCALE) * MARK_SCALE,
            "middle",
          ),
        ]
      : [],
  );
}

/** Minimum row and block spans, including a 1 mm margin on either side. */
export function circuitLegendReservation(mark: CircuitMark, vertical: boolean) {
  const ink = circuitMarkLegendInk(mark, 0, 0, vertical);
  const x = Math.max(
    0,
    ...ink.flatMap((b) => [Math.abs(b.left), Math.abs(b.right)]),
  );
  const y = Math.max(
    0,
    ...ink.flatMap((b) => [Math.abs(b.top), Math.abs(b.bottom)]),
  );
  return { row: 2 * (vertical ? x : y) + 2, block: 2 * (vertical ? y : x) + 2 };
}

/** Segment obstacles from the exact catalog primitives, in the composed 8 mm box. */
export function circuitMarkSegments(
  mark: CircuitMark,
  cx: number,
  cy: number,
  vertical: boolean,
) {
  const segments: (readonly [
    { x: number; y: number },
    { x: number; y: number },
  ])[] = [];
  const point = ([x, y]: Point) => {
    const a = vertical ? 12 - y : x,
      b = vertical ? x : y;
    return { x: cx - 4 + a * MARK_SCALE, y: cy - 4 + b * MARK_SCALE };
  };
  const append = (points: readonly { x: number; y: number }[]) => {
    let previous: { x: number; y: number } | undefined;
    for (const current of points) {
      if (previous) segments.push([previous, current]);
      previous = current;
    }
  };
  const chain = (ps: readonly Point[]) => append(ps.map(point));
  for (const p of MARKS[mark]) {
    if (p.kind === "line") chain([p.a, p.b]);
    else if (p.kind === "polyline") chain(p.points);
    else if (p.kind === "rect")
      chain([
        [p.x, p.y],
        [p.x + p.width, p.y],
        [p.x + p.width, p.y + p.height],
        [p.x, p.y + p.height],
        [p.x, p.y],
      ]);
    else if (p.kind === "circle")
      chain([
        [p.x - p.radius, p.y - p.radius],
        [p.x + p.radius, p.y - p.radius],
        [p.x + p.radius, p.y + p.radius],
        [p.x - p.radius, p.y + p.radius],
        [p.x - p.radius, p.y - p.radius],
      ]);
  }
  for (const b of circuitMarkLegendInk(mark, cx, cy, vertical)) {
    append([
      { x: b.left, y: b.top },
      { x: b.right, y: b.top },
      { x: b.right, y: b.bottom },
      { x: b.left, y: b.bottom },
      { x: b.left, y: b.top },
    ]);
  }
  return segments;
}
