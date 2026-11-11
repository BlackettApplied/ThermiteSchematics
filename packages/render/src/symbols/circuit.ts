import { symbolProfile } from "./profiles.js";
import type { IrDeviceType, IrFunction } from "@thermite/compiler";
import { symbolFunctionStateMismatch } from "@thermite/compiler";
import {
  PRINTABLE_SYMBOL_POLICY,
  motorLegend,
  sourceEnclosure,
  sourceEnclosureInk,
  windingPolyline,
} from "./printable-policy.js";
import { escapeXmlText as xml } from "../svg/escape.js";

import { composedCircuitMark, type CircuitMark } from "./circuit-mark.js";
export {
  emitCircuitMark,
  composedCircuitMark,
  circuitMarkLegendInk,
  circuitLegendReservation,
  circuitMarkSegments,
  type CircuitMark,
} from "./circuit-mark.js";

export const CIRCUIT_PROFILES = Object.freeze([
  "thermite:sensor-3wire",
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
  "thermite:disconnector",
  "thermite:pushbutton",
  "thermite:estop",
  "thermite:selector",
  "thermite:thermocouple",
  "thermite:pressure-switch",
  "thermite:level-switch",
  "thermite:level-sensor",
  "thermite:conductivity-probe",
  "thermite:receptacle",
] as const);

export function circuitProfile(type: IrDeviceType): string {
  const profile = symbolProfile(type);
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
  return symbolProfile(type) === "thermite:terminal-strip";
}

function protectiveContactMark(
  type: IrDeviceType,
  f: Extract<IrFunction, { kind: "contact" }>,
  profile: string,
): CircuitMark | undefined {
  if (profile === "thermite:breaker") {
    const roles = f.terminals.map(
      (t) => type.terminals.find((p) => p.key === t.terminalKey)?.role,
    );
    return roles.includes("power_input") && roles.includes("power_output")
      ? "breaker"
      : f.normal_state === "open"
        ? "contact-no"
        : "contact-nc";
  }
  if (profile === "thermite:overload")
    return f.terminals.every(
      (t, i) =>
        type.terminals.find((p) => p.key === t.terminalKey)?.role ===
        (i === 0 ? "power_input" : "power_output"),
    )
      ? "overload"
      : f.normal_state === "open"
        ? "contact-no"
        : "contact-nc";
  if (profile === "thermite:fuse")
    return f.normal_state === "open" ? "contact-no" : "fuse";
  if (
    profile === "thermite:disconnector" &&
    f.terminals.every(
      (t) =>
        type.terminals.find((p) => p.key === t.terminalKey)?.role === "aux",
    )
  )
    return f.normal_state === "open" ? "contact-no" : "contact-nc";
  if (profile === "thermite:disconnector" && f.normal_state === "open")
    return "disconnector";
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
          "pressure-no",
          "pressure-nc",
          "level-no",
          "level-nc",
        ].includes(explicit)) ||
      (f.kind === "coil" &&
        count === 2 &&
        ["coil", "solenoid"].includes(explicit)) ||
      (f.kind === "load" &&
        (([2, 3].includes(count) &&
          ["motor", "heater", "load", "receptacle", "ac-input"].includes(
            explicit,
          )) ||
          (count === 2 && ["lamp", "winding"].includes(explicit)))) ||
      (f.kind === "source" &&
        ((count >= 1 && count <= 4 && explicit === "source") ||
          (count === 2 && ["winding", "dc-output"].includes(explicit)))) ||
      (f.kind === "bus" &&
        count === 1 &&
        ["terminal", "earth"].includes(explicit)) ||
      (f.kind === "channel" &&
        [1, 2].includes(count) &&
        ["interface", "level-sensor"].includes(explicit)) ||
      (f.kind === "other" &&
        ((count >= 1 && count <= 32 && explicit === "interface") ||
          (count === 2 && ["thermocouple", "fuse"].includes(explicit)) ||
          ([2, 3].includes(count) && explicit === "level-sensor") ||
          (count >= 2 && count <= 8 && explicit === "conductivity-probe")));
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
    const protective = protectiveContactMark(type, f, profile);
    if (protective) return protective;
    if (profile === "thermite:switch")
      return f.normal_state === "open" ? "switch-no" : "switch-nc";
    if (profile === "thermite:pressure-switch")
      return f.normal_state === "open" ? "pressure-no" : "pressure-nc";
    if (profile === "thermite:level-switch")
      return f.normal_state === "open" ? "level-no" : "level-nc";
    if (profile === "thermite:estop" || profile === "thermite:selector")
      return `${profile === "thermite:estop" ? "estop" : "selector"}-${f.normal_state === "open" ? "no" : "nc"}`;
    if (profile === "thermite:pushbutton")
      return f.normal_state === "open" ? "pushbutton-no" : "pushbutton-nc";
  }
  if (f.kind === "coil" && count === 2) {
    if (["thermite:contactor", "thermite:relay"].includes(profile))
      return "coil";
    if (profile === "thermite:solenoid") return "solenoid";
  }
  if (
    profile === "thermite:sensor-3wire" &&
    ((f.kind === "load" && count === 2) ||
      (f.kind === "channel" && f.direction === "output" && count === 1))
  )
    return "sensor-3wire";
  if (f.kind === "load") {
    if (profile === "thermite:motor-3ph" && count === 3) return "motor";
    if (profile === "thermite:motor" && count === 2) return "motor";
    if (profile === "thermite:heater" && [2, 3].includes(count))
      return "heater";
    if (profile === "thermite:lamp" && count === 2) return "lamp";
    if (profile === "thermite:receptacle" && [2, 3].includes(count))
      return "receptacle";
    if (profile === "thermite:transformer" && count === 2) return "winding";
    if (profile === "thermite:dc-supply" && count === 2) return "dc-output";
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
    if (profile === "thermite:dc-supply" && count === 2) return "dc-output";
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
    count <= 32
  )
    return "interface";
  if (
    profile === "thermite:level-sensor" &&
    ((f.kind === "other" && [2, 3].includes(count)) ||
      (f.kind === "channel" && [1, 2].includes(count)))
  )
    return "level-sensor";
  if (
    profile === "thermite:conductivity-probe" &&
    f.kind === "other" &&
    count >= 2 &&
    count <= 8
  )
    return "conductivity-probe";
  if (profile === "thermite:fuse" && f.kind === "other" && count === 2)
    return "fuse";
  if (profile === "thermite:thermocouple" && f.kind === "other" && count === 2)
    return "thermocouple";
  const stateProblem = symbolFunctionStateMismatch(type, f, "circuit");
  throw new Error(
    `Unsupported circuit function ${type.id}/${f.id.functionKey}: ${profile} does not map ${stateProblem && f.kind === "contact" ? `${f.normal_state} contact/${count}` : `${f.kind} with ${count} terminals`}.`,
  );
}

type Point = readonly [number, number];
const n = (v: number) => String(Number(v.toFixed(3)));

export type CircuitSide = "WEST" | "EAST" | "NORTH" | "SOUTH";
const SYMBOL_SIDE = {
  WEST: "west",
  EAST: "east",
  NORTH: "north",
  SOUTH: "south",
} as const;

export function circuitBlock(
  width: number,
  height: number,
  sourcePins?: readonly { x: number; y: number; side: CircuitSide }[],
  onlySources = true,
): string {
  if (sourcePins?.length) {
    const ink = sourceEnclosureInk();
    const outline = sourceEnclosure(
      { x: 0, y: 0, width, height },
      sourcePins.map((p) => ({
        side: SYMBOL_SIDE[p.side],
        at: p.side === "WEST" || p.side === "EAST" ? p.y : p.x,
      })),
      1.5,
    );
    const lines = outline
      .map((p) => {
        const side =
          p.from.x === p.to.x
            ? p.from.x === 0
              ? "WEST"
              : "EAST"
            : p.from.y === 0
              ? "NORTH"
              : "SOUTH";
        const isolated =
          onlySources || sourcePins.some((pin) => pin.side === side);
        return `<line x1="${n(p.from.x)}" y1="${n(p.from.y)}" x2="${n(p.to.x)}" y2="${n(p.to.y)}" stroke="${ink.color}" stroke-width="${n(isolated ? ink.strokeWidth : PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}"${isolated ? ` stroke-dasharray="${ink.dash}"` : ""}/>`;
      })
      .join("");
    return `<g data-source-enclosure="true" fill="none"><rect width="${n(width)}" height="${n(height)}" fill="white" stroke="none"/>${lines}</g>`;
  }
  return `<rect width="${n(width)}" height="${n(height)}" fill="white" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}"/>`;
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
  threePhase = false,
): string {
  const cx = width / 2,
    cy = top + span / 2,
    r = Math.min(width / 2 - 2, Math.max(5, span / 2 - 2));
  return `<g data-circuit-mark="motor" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}" fill="none"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>${portYs
    .map((y) => {
      const dy = Math.max(-r, Math.min(r, y - cy)),
        x = cx - Math.sqrt(r * r - dy * dy);
      return `<line x1="0" y1="${n(y)}" x2="${n(x)}" y2="${n(y)}"/>`;
    })
    .join(
      "",
    )}<text x="${n(cx)}" y="${n(cy + 1.2)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="3.5" text-anchor="middle" stroke="none" fill="#17212b">${motorLegend(threePhase)[0]}</text>${threePhase ? `<text x="${n(cx)}" y="${n(cy + 5)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="2.5" text-anchor="middle" stroke="none" fill="#17212b">3~</text>` : ""}</g>`;
}

export function circuitMotorVertical(
  cx: number,
  cy: number,
  span: number,
  portXs: readonly number[],
  threePhase = false,
): string {
  const r = Math.max(5, span / 2 - 2);
  return `<g data-circuit-mark="motor" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}" fill="none"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>${portXs
    .map((x) => {
      const dx = Math.max(-r, Math.min(r, x - cx)),
        y = cy - Math.sqrt(r * r - dx * dx);
      return `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(y)}"/>`;
    })
    .join(
      "",
    )}<text x="${n(cx)}" y="${n(cy + 1.2)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="3.5" text-anchor="middle" stroke="none" fill="#17212b">${motorLegend(threePhase)[0]}</text>${threePhase ? `<text x="${n(cx)}" y="${n(cy + 5)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="2.5" text-anchor="middle" stroke="none" fill="#17212b">3~</text>` : ""}</g>`;
}

/** Both winding terminals remain distinct; this local mark has no IR net effect. */
export function circuitWinding(
  width: number,
  y1: number,
  y2: number,
  source: boolean,
  coupled = false,
  terminalXs?: readonly [number, number],
): string {
  const x = width / 2 + (coupled ? (source ? 3 : -3) : 0),
    edge = source ? width : 0;
  const points = windingPolyline(
    x,
    y1,
    y2,
    edge,
    coupled && source ? -2 : 2,
    terminalXs,
  );
  return `<g data-circuit-mark="winding" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}" fill="none"><polyline points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}"/>${coupled ? "" : `<line x1="${n(x + 4)}" x2="${n(x + 4)}" y1="${n(y1 - 1)}" y2="${n(y2 + 1)}"/>`}</g>`;
}

export function circuitWindingVertical(
  height: number,
  x1: number,
  x2: number,
  source: boolean,
  coupled = false,
  center = height / 2,
  terminalYs?: readonly [number, number],
): string {
  const y = center + (coupled ? (source ? 3 : -3) : 0),
    edge = source ? height : 0;
  const points = windingPolyline(
    y,
    x1,
    x2,
    edge,
    coupled && source ? -2 : 2,
    terminalYs,
  ).map(([cross, along]): Point => [along, cross]);
  return `<g data-circuit-mark="winding" stroke="#17212b" stroke-width="${n(PRINTABLE_SYMBOL_POLICY.conductorStrokeMm)}" fill="none"><polyline points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}"/>${coupled ? "" : `<line x1="${n(Math.min(x1, x2) - 1)}" x2="${n(Math.max(x1, x2) + 1)}" y1="${n(y + 4)}" y2="${n(y + 4)}"/>`}</g>`;
}

/** Local catalog attachment for a function terminal, including a reused physical common. */
export function circuitAttachmentPoints(
  from: { x: number; y: number; side: string },
  to: { x: number; y: number },
  targetSide: string,
  width: number,
  height: number,
): Point[] {
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
  return points;
}
export function circuitAttachment(
  ...args: Parameters<typeof circuitAttachmentPoints>
): string {
  const points = circuitAttachmentPoints(...args);
  const path = points
    .map((p, i) => `${i ? "L" : "M"} ${n(p[0])} ${n(p[1])}`)
    .join(" ");
  return `<path d="${path}" fill="none" stroke="white" stroke-width=".8"/><path d="${path}" fill="none" stroke="#17212b" stroke-width=".35"/>`;
}

/** A shared magnetic core is a presentation association, never a conductor. */
export function circuitTransformerCore(
  center: number,
  from: number,
  to: number,
  vertical: boolean,
): string {
  const lines = [-0.5, 0.5]
    .map((offset) =>
      vertical
        ? `<line x1="${n(from)}" x2="${n(to)}" y1="${n(center + offset)}" y2="${n(center + offset)}"/>`
        : `<line y1="${n(from)}" y2="${n(to)}" x1="${n(center + offset)}" x2="${n(center + offset)}"/>`,
    )
    .join("");
  return `<g data-magnetic-association="shared-core" data-presentation-only="true" stroke="#17212b" stroke-width=".35">${lines}</g>`;
}

/** Interface leads land on their enclosure; isolated source stubs stop clear of the mark. */
export function circuitInterfaceMark(
  mark: CircuitMark,
  cx: number,
  cy: number,
  pins: readonly { x: number; y: number; side: string }[],
  vertical: boolean,
  source = false,
): string {
  const coordinates = pins.map((p) => (vertical ? p.x : p.y));
  const low = Math.min(...coordinates) - 2,
    high = Math.max(...coordinates) + 2;
  const outline = vertical
    ? `<rect x="${n(low)}" y="${n(cy - 5)}" width="${n(high - low)}" height="10"/>`
    : `<rect x="${n(cx - 5)}" y="${n(low)}" width="10" height="${n(high - low)}"/>`;
  const sensorOutput = mark === "sensor-3wire" && pins.length === 1;
  const leadEnd = source ? 6 : sensorOutput ? 10 / 3 : 5;
  const leads = pins
    .map((p) =>
      vertical
        ? `<line${source ? ' data-source-stub="true"' : ""} x1="${n(p.x)}" x2="${n(p.x)}" y1="${n(p.y)}" y2="${n(cy + (p.side === "NORTH" ? -leadEnd : leadEnd))}"/>`
        : `<line${source ? ' data-source-stub="true"' : ""} y1="${n(p.y)}" y2="${n(p.y)}" x1="${n(p.x)}" x2="${n(cx + (p.side === "WEST" ? -leadEnd : leadEnd))}"/>`,
    )
    .join("");
  return `<g data-function-interface="${mark}" fill="none" stroke="#17212b" stroke-width=".35">${source || sensorOutput ? "" : outline}${leads}</g>${composedCircuitMark(mark, cx, cy, vertical)}`;
}
