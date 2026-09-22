import type { IrDeviceType, IrFunction } from "@thermite/compiler";
import { escapeXmlText as xml } from "../svg/escape.js";

/** Closed, original circuit marks. Profiles never grant electrical continuity. */
export type CircuitMark =
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
  | "interface";

const CORE_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  "core:supply-480v-3ph": "thermite:power-source",
  "core:breaker-3p": "thermite:breaker",
  "core:contactor-3p-1no": "thermite:contactor",
  "core:overload-3p-1nc": "thermite:overload",
  "core:motor-3ph": "thermite:motor-3ph",
  "core:pushbutton-nc": "thermite:pushbutton",
  "core:limit-switch-2wire": "thermite:switch",
  "core:plc-compact": "thermite:io-module",
  "core:psu-24vdc": "thermite:dc-supply",
  "core:terminal-block-8": "thermite:terminal-strip",
  "core:junction-box-8": "thermite:terminal-strip",
});
export const CIRCUIT_PROFILES = Object.freeze([
  "thermite:contactor",
  "thermite:relay",
  "thermite:breaker",
  "thermite:overload",
  "thermite:fuse",
  "thermite:motor-3ph",
  "thermite:motor",
  "thermite:heater",
  "thermite:transformer",
  "thermite:power-source",
  "thermite:dc-supply",
  "thermite:io-module",
  "thermite:terminal-strip",
  "thermite:solenoid",
  "thermite:lamp",
  "thermite:switch",
  "thermite:pushbutton",
  "thermite:thermocouple",
] as const);

export function circuitProfile(type: IrDeviceType): string {
  const profile = Object.hasOwn(CORE_PROFILES, type.id)
    ? CORE_PROFILES[type.id]
    : type.symbol;
  if (
    !profile ||
    !CIRCUIT_PROFILES.includes(profile as (typeof CIRCUIT_PROFILES)[number])
  )
    throw new Error(
      `Unsupported circuit symbol profile for ${type.id}: ${profile ?? "missing"}. Declare a supported type.symbol profile in its library.`,
    );
  return profile;
}

export function isCircuitTerminalStrip(type: IrDeviceType): boolean {
  return (
    (Object.hasOwn(CORE_PROFILES, type.id)
      ? CORE_PROFILES[type.id]
      : type.symbol) === "thermite:terminal-strip"
  );
}

export function circuitMark(type: IrDeviceType, f: IrFunction): CircuitMark {
  const count = f.terminals.length;
  const explicit =
    type.circuitSymbols && Object.hasOwn(type.circuitSymbols, f.id.functionKey)
      ? type.circuitSymbols[f.id.functionKey]
      : undefined;
  if (explicit !== undefined) {
    const valid =
      (f.kind === "contact" &&
        count === 2 &&
        [
          "contact-no",
          "contact-nc",
          "breaker",
          "overload",
          "fuse",
          "switch-no",
          "switch-nc",
          "pushbutton-no",
          "pushbutton-nc",
        ].includes(explicit)) ||
      (f.kind === "coil" &&
        count === 2 &&
        ["coil", "solenoid"].includes(explicit)) ||
      (f.kind === "load" &&
        (([2, 3].includes(count) &&
          ["motor", "heater", "load"].includes(explicit)) ||
          (count === 2 && ["lamp", "winding"].includes(explicit)))) ||
      (f.kind === "source" &&
        ((count >= 1 && count <= 4 && explicit === "source") ||
          (count === 2 && explicit === "winding"))) ||
      (f.kind === "bus" &&
        count === 1 &&
        ["terminal", "earth"].includes(explicit)) ||
      (f.kind === "channel" &&
        [1, 2].includes(count) &&
        explicit === "interface") ||
      (f.kind === "other" &&
        ((count >= 1 && count <= 8 && explicit === "interface") ||
          (count === 2 && ["thermocouple", "fuse"].includes(explicit))));
    if (
      !valid ||
      (f.kind === "contact" &&
        ((explicit.endsWith("-no") && f.normal_state !== "open") ||
          (explicit.endsWith("-nc") && f.normal_state !== "closed")))
    )
      throw new Error(
        `Invalid circuit symbol binding ${type.id}/${f.id.functionKey}: ${explicit} is incompatible with its declared function.`,
      );
    return explicit as CircuitMark;
  }
  const profile = circuitProfile(type);
  if (f.kind === "bus" && count === 1)
    return type.terminals.find((t) => t.key === f.terminals[0]!.terminalKey)
      ?.role === "protective_earth"
      ? "earth"
      : "terminal";
  if (f.kind === "contact" && count === 2) {
    if (
      ["thermite:contactor", "thermite:relay", "thermite:io-module"].includes(
        profile,
      )
    )
      return f.normal_state === "open" ? "contact-no" : "contact-nc";
    if (profile === "thermite:breaker") return "breaker";
    if (profile === "thermite:overload")
      return f.normal_state === "closed" ? "contact-nc" : "overload";
    if (profile === "thermite:fuse") return "fuse";
    if (profile === "thermite:switch")
      return f.normal_state === "open" ? "switch-no" : "switch-nc";
    if (profile === "thermite:pushbutton")
      return f.normal_state === "open" ? "pushbutton-no" : "pushbutton-nc";
  }
  if (f.kind === "coil" && count === 2) {
    if (["thermite:contactor", "thermite:relay"].includes(profile))
      return "coil";
    if (profile === "thermite:solenoid") return "solenoid";
  }
  if (f.kind === "load") {
    if (profile === "thermite:motor-3ph" && count === 3) return "motor";
    if (profile === "thermite:motor" && count === 2) return "motor";
    if (profile === "thermite:heater" && [2, 3].includes(count))
      return "heater";
    if (profile === "thermite:lamp" && count === 2) return "lamp";
    if (profile === "thermite:transformer" && count === 2) return "winding";
    if (
      ["thermite:dc-supply", "thermite:relay", "thermite:io-module"].includes(
        profile,
      ) &&
      [2, 3].includes(count)
    )
      return "load";
  }
  if (f.kind === "source") {
    if (profile === "thermite:transformer" && count === 2) return "winding";
    if (
      [
        "thermite:dc-supply",
        "thermite:power-source",
        "thermite:io-module",
      ].includes(profile) &&
      count >= 1 &&
      count <= 4
    )
      return "source";
  }
  if (
    profile === "thermite:io-module" &&
    f.kind === "channel" &&
    [1, 2].includes(count)
  )
    return "interface";
  if (
    profile === "thermite:io-module" &&
    f.kind === "other" &&
    count >= 1 &&
    count <= 8
  )
    return "interface";
  if (profile === "thermite:fuse" && f.kind === "other" && count === 2)
    return "fuse";
  if (profile === "thermite:thermocouple" && f.kind === "other" && count === 2)
    return "thermocouple";
  throw new Error(
    `Unsupported circuit function ${type.id}/${f.id.functionKey}: ${profile} does not map ${f.kind} with ${count} terminals.`,
  );
}

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
const MARKS: Readonly<Record<CircuitMark, readonly Primitive[]>> =
  Object.freeze({
    "contact-no": CONTACT,
    "contact-nc": [...CONTACT, line(2, 10, 10, 2)],
    breaker: [
      line(0, 6, 3, 6),
      line(3, 6, 8, 2),
      line(9, 6, 12, 6),
      {
        kind: "polyline",
        points: [
          [5, 2],
          [6, 0],
          [8, 1],
        ],
      },
    ],
    overload: [rect(3, 2, 6, 8), line(0, 6, 3, 6), line(9, 6, 12, 6), zigzag],
    fuse: [line(0, 6, 12, 6), rect(3, 4, 6, 4)],
    coil: [line(0, 6, 2, 6), line(10, 6, 12, 6), circle(6, 6, 4)],
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
    "switch-no": [...CONTACT, line(6, 0, 6, 3), line(6, 0, 9, 0)],
    "switch-nc": [
      ...CONTACT,
      line(2, 10, 10, 2),
      line(6, 0, 6, 3),
      line(6, 0, 9, 0),
    ],
    "pushbutton-no": [...CONTACT, line(6, 0, 6, 3), line(3, 0, 9, 0)],
    "pushbutton-nc": [
      ...CONTACT,
      line(2, 10, 10, 2),
      line(6, 0, 6, 3),
      line(3, 0, 9, 0),
    ],
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
  });
const n = (v: number) => String(Number(v.toFixed(3)));

/** Fixed 12 mm catalog mark; labels and terminals are composed separately. */
export function emitCircuitMark(mark: CircuitMark, vertical = false): string {
  return `<g data-circuit-mark="${mark}" stroke="#17212b" stroke-width=".4" fill="none"${vertical ? ' transform="translate(12 0) rotate(90)"' : ""}>${MARKS[
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
          return `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" stroke="none" fill="#17212b" font-family="Arial, Helvetica, sans-serif" font-size="${p.text.length > 1 ? 2.5 : 3.5}"${vertical ? ` transform="rotate(-90 ${p.x} ${p.y})"` : ""}>${xml(p.text)}</text>`;
      }
    })
    .join("")}</g>`;
}

export function circuitBlock(width: number, height: number): string {
  return `<rect width="${n(width)}" height="${n(height)}" fill="white" stroke="#17212b" stroke-width=".4"/>`;
}

export function circuitTerminal(
  x: number,
  y: number,
  connected: boolean,
): string {
  return `<circle cx="${n(x)}" cy="${n(y)}" r=".65" fill="${connected ? "#17212b" : "white"}" stroke="#17212b" stroke-width=".3"/>`;
}

/** Motor load ports end on the circle at distinct points; the mark never joins its phases. */
export function circuitMotor(
  width: number,
  top: number,
  span: number,
  portYs: readonly number[],
): string {
  const cx = width / 2,
    cy = top + span / 2,
    r = Math.min(width / 2 - 2, Math.max(5, span / 2 - 2));
  return `<g data-circuit-mark="motor" stroke="#17212b" stroke-width=".4" fill="none"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>${portYs
    .map((y) => {
      const dy = Math.max(-r, Math.min(r, y - cy)),
        x = cx - Math.sqrt(r * r - dy * dy);
      return `<line x1="0" y1="${n(y)}" x2="${n(x)}" y2="${n(y)}"/>`;
    })
    .join(
      "",
    )}<text x="${n(cx)}" y="${n(cy + 1.2)}" font-family="Arial, Helvetica, sans-serif" font-size="3.5" text-anchor="middle" stroke="none" fill="#17212b">M</text></g>`;
}

export function circuitMotorVertical(
  cx: number,
  cy: number,
  span: number,
  portXs: readonly number[],
): string {
  const r = Math.max(5, span / 2 - 2);
  return `<g data-circuit-mark="motor" stroke="#17212b" stroke-width=".4" fill="none"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>${portXs
    .map((x) => {
      const dx = Math.max(-r, Math.min(r, x - cx)),
        y = cy - Math.sqrt(r * r - dx * dx);
      return `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(y)}"/>`;
    })
    .join(
      "",
    )}<text x="${n(cx)}" y="${n(cy + 1.2)}" font-family="Arial, Helvetica, sans-serif" font-size="3.5" text-anchor="middle" stroke="none" fill="#17212b">M</text></g>`;
}

/** Both winding terminals remain distinct; this local mark has no IR net effect. */
export function circuitWinding(
  width: number,
  y1: number,
  y2: number,
  source: boolean,
): string {
  const x = width / 2,
    edge = source ? width : 0,
    span = y2 - y1;
  const points: Point[] = [
    [edge, y1],
    [x, y1],
    ...[1, 2, 3, 4, 5, 6, 7].map((i): Point => [
      x + (i % 2 ? 2 : 0),
      y1 + (span * i) / 8,
    ]),
    [x, y2],
    [edge, y2],
  ];
  return `<g data-circuit-mark="winding" stroke="#17212b" stroke-width=".4" fill="none"><polyline points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}"/><line x1="${n(x + 4)}" x2="${n(x + 4)}" y1="${n(y1 - 1)}" y2="${n(y2 + 1)}"/></g>`;
}

export function circuitWindingVertical(
  height: number,
  x1: number,
  x2: number,
  source: boolean,
): string {
  const y = height / 2,
    edge = source ? height : 0,
    span = x2 - x1;
  const points: Point[] = [
    [x1, edge],
    [x1, y],
    ...[1, 2, 3, 4, 5, 6, 7].map((i): Point => [
      x1 + (span * i) / 8,
      y + (i % 2 ? 2 : 0),
    ]),
    [x2, y],
    [x2, edge],
  ];
  return `<g data-circuit-mark="winding" stroke="#17212b" stroke-width=".4" fill="none"><polyline points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}"/><line x1="${n(Math.min(x1, x2) - 1)}" x2="${n(Math.max(x1, x2) + 1)}" y1="${n(y + 4)}" y2="${n(y + 4)}"/></g>`;
}

/** Local catalog attachment for a function terminal, including a reused physical common. */
export function circuitAttachment(
  from: { x: number; y: number; side: string },
  to: { x: number; y: number },
  targetSide: string,
  width: number,
  height: number,
): string {
  let points: Point[];
  if (targetSide === "WEST" || targetSide === "EAST") {
    const fromEdge = from.side === "WEST" ? 1 : width - 1,
      targetEdge = targetSide === "WEST" ? 1 : width - 1;
    points =
      from.side === targetSide
        ? [
            [from.x, from.y],
            [fromEdge, from.y],
            [fromEdge, to.y],
            [to.x, to.y],
          ]
        : [
            [from.x, from.y],
            [fromEdge, from.y],
            [fromEdge, 4.5],
            [targetEdge, 4.5],
            [targetEdge, to.y],
            [to.x, to.y],
          ];
  } else {
    const fromEdge = from.side === "NORTH" ? 1 : height - 1,
      targetEdge = targetSide === "NORTH" ? 1 : height - 1;
    points =
      from.side === targetSide
        ? [
            [from.x, from.y],
            [from.x, fromEdge],
            [to.x, fromEdge],
            [to.x, to.y],
          ]
        : [
            [from.x, from.y],
            [from.x, fromEdge],
            [width - 1, fromEdge],
            [width - 1, targetEdge],
            [to.x, targetEdge],
            [to.x, to.y],
          ];
  }
  const path = points
    .map((p, i) => `${i ? "L" : "M"} ${n(p[0])} ${n(p[1])}`)
    .join(" ");
  return `<path d="${path}" fill="none" stroke="white" stroke-width=".8"/><path d="${path}" fill="none" stroke="#17212b" stroke-width=".35"/>`;
}
