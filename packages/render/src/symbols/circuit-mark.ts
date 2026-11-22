import { captionInk } from "./caption-ink.js";
import { strokeMiters } from "./stroke-join.js";
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
  | "receptacle-with-earth"
  | "ac-input"
  | "dc-output"
  | "sensor-3wire";

type Point = readonly [number, number];
export type CircuitMarkRole =
  | "operator"
  | "operating-link"
  | "contact-moving"
  | "contact-fixed"
  | "contact-state"
  | "lead"
  | "earth-stem"
  | "earth-bar";
type Primitive = (
  | { kind: "line"; a: Point; b: Point; dash?: readonly [number, number] }
  | { kind: "polyline"; points: readonly Point[] }
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "text"; x: number; y: number; text: string }
) & { readonly role?: CircuitMarkRole };
const line = (
  x: number,
  y: number,
  a: number,
  b: number,
): Extract<Primitive, { kind: "line" }> => ({
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
const CONTACT: Primitive[] = [
  { ...line(0, 6, 4, 6), role: "lead" },
  { ...line(8, 6, 12, 6), role: "lead" },
  { ...line(4, 3, 4, 9), role: "contact-moving" },
  { ...line(8, 3, 8, 9), role: "contact-fixed" },
];
// Four physical mm: two free-standing 1.5 mm dashes separated by 1 mm.
// Leave >0.5 mm of painted clearance to both neighbouring solid strokes.
const operatingLink: Primitive = {
  ...line(4, -4, 4, 2),
  dash: [2.25, 1.5],
  role: "operating-link",
};
const closedState: Primitive = { ...line(2, 10, 10, 2), role: "contact-state" };
const pressure: Primitive[] = [
  { ...line(4, -7, 4, -5), role: "operator" },
  {
    kind: "polyline",
    role: "operator",
    points: [
      [0, -7],
      [1, -6],
      [2, -7],
      [3, -6],
      [4, -7],
      [5, -6],
      [6, -7],
      [7, -6],
      [8, -7],
    ],
  },
];
const level: Primitive[] = [
  { ...line(4, -6, 4, -5), role: "operator" },
  {
    kind: "polyline",
    role: "operator",
    points: [
      [4, -8],
      [2, -7],
      [4, -6],
      [6, -7],
      [4, -8],
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
const RECEPTACLE_FACE = [circle(6, 6, 5), line(4, 3, 4, 7), line(8, 3, 8, 7)];

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
      { ...line(0, 6, 4, 6), role: "lead" },
      { ...line(4, 2, 4, 10), role: "earth-bar" },
      { ...line(7, 3, 7, 9), role: "earth-bar" },
      { ...line(10, 4, 10, 8), role: "earth-bar" },
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
    interface: [rect(1, 1, 10, 10), label("I/F")],
    "pressure-no": [...CONTACT, ...pressure, operatingLink],
    "pressure-nc": [...CONTACT, ...pressure, operatingLink, closedState],
    "level-no": [...CONTACT, ...level, operatingLink],
    "level-nc": [...CONTACT, ...level, operatingLink, closedState],
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
    receptacle: RECEPTACLE_FACE,
    "receptacle-with-earth": [
      ...RECEPTACLE_FACE,
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

const EARTH_LTR: readonly Primitive[] = [
  { ...line(0, 6, 6, 6), role: "lead" },
  { ...line(6, 6, 6, 8), role: "earth-stem" },
  { ...line(2, 8, 10, 8), role: "earth-bar" },
  { ...line(3, 10, 9, 10), role: "earth-bar" },
  { ...line(4, 12, 8, 12), role: "earth-bar" },
];
// Qualifier strokes have page meaning independent of electrical flow. Undo only
// their local quarter-turn; the body and its native attachment frame still turn.
function uprightQualifier(p: Primitive): Primitive {
  const turn = ([x, y]: Point): Point => [y, 12 - x];
  if (p.kind === "line") return { ...p, a: turn(p.a), b: turn(p.b) };
  if (p.kind === "polyline") return { ...p, points: p.points.map(turn) };
  return p;
}

/** Both faces share the authored mark name and interface layout. */
export function circuitMarkName(mark: CircuitMark) {
  return mark === "receptacle-with-earth" ? "receptacle" : mark;
}

function markPrimitives(
  mark: CircuitMark,
  vertical: boolean,
  span?: readonly [number, number],
) {
  if (mark === "earth" && !vertical) return EARTH_LTR;
  const upright =
    vertical &&
    ["ac-input", "dc-output", "receptacle"].includes(circuitMarkName(mark));
  if (!span && !upright) return MARKS[mark];
  return MARKS[mark].map((p) => {
    if (span && p.kind === "rect") {
      const [low, high] = span;
      const start = vertical ? 6 - high / MARK_SCALE : 6 + low / MARK_SCALE;
      return rect(p.x, start, p.width, (high - low) / MARK_SCALE);
    }
    return upright ? uprightQualifier(p) : p;
  });
}
const hasExtendedInk = (mark: CircuitMark, vertical: boolean) =>
  mark.startsWith("pressure-") ||
  mark === "level-no" ||
  mark === "level-nc" ||
  (mark === "earth" && !vertical);

// Keep the established 8 mm electrical attachment frame. Operator ink can extend
// outside it; its exact envelope is reserved before ELK and used by captions.
const MARK_SCALE = 0.666667;
const legendEm = (value: string, mmPerUnit: number) =>
  Math.ceil(Math.max(value.length > 1 ? 2.5 : 3.5, 2.5 / mmPerUnit) * 1000) /
  1000;

/** Attachment frame is 12 units. mmPerUnit includes every enclosing scale. */
export function emitCircuitMark(
  mark: CircuitMark,
  vertical: boolean,
  mmPerUnit: number,
  span?: readonly [number, number],
): string {
  return `<g data-circuit-mark="${circuitMarkName(mark)}" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}" fill="none"${hasExtendedInk(mark, vertical) ? ' stroke-linecap="round" stroke-linejoin="round"' : ""}${vertical ? ' transform="translate(12 0) rotate(90)"' : ""}>${markPrimitives(
    mark,
    vertical,
    span,
  )
    .map((p) => {
      const role = p.role ? ` data-circuit-role="${p.role}"` : "";
      switch (p.kind) {
        case "line":
          return `<line${role} x1="${n(p.a[0])}" y1="${n(p.a[1])}" x2="${n(p.b[0])}" y2="${n(p.b[1])}"${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(" ")}" stroke-linecap="butt"` : ""}/>`;
        case "polyline":
          return `<polyline${role} points="${p.points.map((v) => `${n(v[0])},${n(v[1])}`).join(" ")}"/>`;
        case "circle":
          return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.radius)}"/>`;
        case "rect":
          return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.width)}" height="${n(p.height)}"/>`;
        case "text":
          return `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" stroke="none" fill="#17212b" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="${legendEm(p.text, mmPerUnit)}"${vertical ? ' transform="rotate(-90 6 6)"' : ""}>${xml(p.text)}</text>`;
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
  span?: readonly [number, number],
): string {
  return `<g transform="translate(${n(cx - 4)} ${n(cy - 4)}) scale(.666667)">${emitCircuitMark(mark, vertical, MARK_SCALE, span)}</g>`;
}

/** Mark-centred counter-rotation leaves the legend ink identical in both flows. Used
 * before ELK for row/block reservations and again for caption obstacles. */
export function circuitMarkLegendInk(
  mark: CircuitMark,
  cx: number,
  cy: number,
) {
  return MARKS[mark].flatMap((p) =>
    p.kind === "text"
      ? [
          captionInk(
            p.text,
            cx - 4 + p.x * MARK_SCALE,
            cy - 4 + p.y * MARK_SCALE,
            legendEm(p.text, MARK_SCALE) * MARK_SCALE,
            "middle",
          ),
        ]
      : [],
  );
}

/** Guard row/block spans with 1 mm either side of the centred ink envelope.
 * Grow the revised operator and LTR earth owners before placement. */
export function circuitLegendReservation(mark: CircuitMark, vertical: boolean) {
  const ink = [
    ...circuitMarkLegendInk(mark, 0, 0),
    ...(hasExtendedInk(mark, vertical)
      ? [circuitMarkInkBounds(mark, vertical)]
      : []),
  ];
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

/** Exact painted envelope in page axes about the electrical mark centre. */
export function circuitMarkInkBounds(
  mark: CircuitMark,
  vertical: boolean,
  includeMiters = false,
) {
  const points = circuitMarkSegments(mark, 0, 0, vertical).flatMap((s) => [
    ...s,
  ]);
  const halfStroke =
    (PRINTABLE_SYMBOL_POLICY.conductorStrokeMm * MARK_SCALE) / 2;
  const miters =
    includeMiters && !hasExtendedInk(mark, vertical)
      ? markPrimitives(mark, vertical)
          .flatMap((p) =>
            p.kind === "polyline"
              ? strokeMiters(
                  p.points,
                  PRINTABLE_SYMBOL_POLICY.conductorStrokeMm / 2,
                )
              : [],
          )
          .map(([x, y]) => ({
            x: (vertical ? 12 - y : x) * MARK_SCALE - 4,
            y: (vertical ? x : y) * MARK_SCALE - 4,
          }))
      : [];
  return {
    left: Math.min(
      Math.min(...points.map((p) => p.x)) - halfStroke,
      ...miters.map((p) => p.x),
    ),
    top: Math.min(
      Math.min(...points.map((p) => p.y)) - halfStroke,
      ...miters.map((p) => p.y),
    ),
    right: Math.max(
      Math.max(...points.map((p) => p.x)) + halfStroke,
      ...miters.map((p) => p.x),
    ),
    bottom: Math.max(
      Math.max(...points.map((p) => p.y)) + halfStroke,
      ...miters.map((p) => p.y),
    ),
  };
}

/** Segment obstacles from the emitted catalog primitives, including operator ink. */
export function circuitMarkSegments(
  mark: CircuitMark,
  cx: number,
  cy: number,
  vertical: boolean,
  span?: readonly [number, number],
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
  for (const p of markPrimitives(mark, vertical, span)) {
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
  for (const b of circuitMarkLegendInk(mark, cx, cy)) {
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
