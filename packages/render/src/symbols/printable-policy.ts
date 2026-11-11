import { symbolProfile } from "./profiles.js";
import type { IrFunction, IrDeviceType, IrDevice } from "@thermite/compiler";
import type {
  SymbolDefinition,
  SymbolPoint,
  SymbolPrimitive,
  SymbolSide,
} from "./types.js";

export type FunctionWord =
  | "NO"
  | "NC"
  | "DI"
  | "DO"
  | "AI"
  | "AO"
  | "IN"
  | "OUT"
  | "PNP"
  | "NPN"
  | "coil"
  | "motor"
  | "source"
  | "load";
export type PrintableMark = SymbolDefinition["id"] | `circuit:${string}`;
export type GlyphWords = Readonly<
  Partial<Record<PrintableMark, readonly FunctionWord[]>>
>;
const GLYPH_WORDS: GlyphWords = Object.freeze({
  "ais:disconnector": ["NO"] as const,
  "ais:motor": ["motor"] as const,
  "ais:motor-3ph": ["motor"] as const,
  "ais:motor-3ph-unbonded": ["motor"] as const,
});
// Legacy electrical models use contact/2 for protection poles. Their printable
// marks represent protection elements, not NO/NC contact state.
const PROTECTION_MARKS = new Set<PrintableMark>([
  "ais:breaker-pole",
  "ais:overload-pole",
  "ais:fuse",
  "circuit:breaker",
  "circuit:overload",
  "circuit:fuse",
]);

/** Physical ink dimensions; rooted drawing units are converted at composition time. */
export const PRINTABLE_SYMBOL_POLICY = Object.freeze({
  enclosureStrokeMm: 0.18,
  conductorStrokeMm: 0.4,
  enclosureDashMm: Object.freeze([0.6, 0.6] as const),
  minimumGapMm: 0.3,
  color: "#17212b",
  rootedMmPerUnit: 0.25,
  // R4 may list a word here only after that mark carries the same fact in ink.
  glyphWords: GLYPH_WORDS,
});

export function sourceEnclosureInk(mmPerUnit = 1) {
  return {
    strokeWidth: PRINTABLE_SYMBOL_POLICY.enclosureStrokeMm / mmPerUnit,
    dash: PRINTABLE_SYMBOL_POLICY.enclosureDashMm
      .map((v) => v / mmPerUnit)
      .join(" "),
    color: PRINTABLE_SYMBOL_POLICY.color,
  };
}

export type PrintableCaption =
  | { readonly kind: "internal-key" }
  | {
      readonly kind: "aggregate";
      readonly mark: SymbolDefinition["id"];
      readonly type?: IrDeviceType;
    }
  | {
      readonly kind: "function";
      readonly fn: IrFunction;
      readonly type: IrDeviceType;
      readonly mark: PrintableMark;
    }
  | {
      readonly kind: "channel";
      readonly fn: IrFunction;
      readonly type: IrDeviceType;
      readonly address?: string;
      readonly spare: boolean;
    }
  | {
      readonly kind: "relation" | "relation-summary";
      readonly functions: readonly IrFunction[];
      readonly destination: string;
    };

// The current schema has no channel signal/interface-class field. Only explicit
// terminal roles establish A/D; direction, keys, signal prose and type names do not.
function functionWord(
  fn: IrFunction,
  type: IrDeviceType,
): FunctionWord | undefined {
  if (fn.kind === "contact") return fn.normal_state === "open" ? "NO" : "NC";
  if (fn.kind === "coil") return "coil";
  if (fn.kind === "source") return "source";
  if (fn.kind === "load") return "load";
  if (fn.kind !== "channel") return undefined;
  const neutral = fn.direction === "input" ? "IN" : "OUT";
  const classes = new Set<string>();
  for (const terminal of fn.terminals) {
    const role = type.terminals.find(
      (p) => p.key === terminal.terminalKey,
    )?.role;
    const fact = role?.match(
      /^(analog|digital)_(input|output)(?:_\d+)?(?:_(?:positive|negative))?$/u,
    );
    if (!fact) continue;
    // Conflicting direction/class declarations do not establish one class.
    if (fact[2] !== fn.direction) return neutral;
    classes.add(fact[1] as string);
  }
  if (classes.size !== 1) return neutral;
  if (classes.has("analog")) return fn.direction === "input" ? "AI" : "AO";
  return fn.direction === "input" ? "DI" : "DO";
}

/** Recognize standalone positive declarations, including the unchanged core
 * description. Free prose, negation, names, ratings and pinouts establish no
 * output type. Keep this deliberately narrower than natural-language inference. */
export function declaredSensorOutput(
  type: Pick<IrDeviceType, "description">,
): "PNP" | "NPN" | undefined {
  return type.description
    ?.trim()
    .match(
      /^(?:Three-wire )?(PNP|NPN) (?:proximity sensor|output sensor)\.?$/u,
    )?.[1] as "PNP" | "NPN" | undefined;
}

/** Keys identify source objects; printable captions carry authored or derived facts. */
export function printableCaption(
  caption: PrintableCaption,
  glyphWords: GlyphWords = PRINTABLE_SYMBOL_POLICY.glyphWords,
): string {
  switch (caption.kind) {
    case "internal-key":
      return "";
    case "aggregate": {
      const word =
        caption.mark === "ais:motor-3ph" ||
        caption.mark === "ais:motor-3ph-unbonded"
          ? "motor"
          : caption.mark === "ais:switch-sensor-pnp"
            ? caption.type
              ? declaredSensorOutput(caption.type)
              : "PNP"
            : caption.mark === "ais:power-source-3ph" ||
                caption.mark === "ais:power-source-dc" ||
                caption.mark === "ais:power-source-3wire"
              ? "source"
              : undefined;
      return word && !glyphWords[caption.mark]?.includes(word) ? word : "";
    }
    case "function": {
      if (caption.mark === "ais:source-winding")
        return caption.fn.id.functionKey;
      if (PROTECTION_MARKS.has(caption.mark)) return "";
      if (caption.mark === "ais:motor") return "";
      const word = functionWord(caption.fn, caption.type);
      return word && !glyphWords[caption.mark]?.includes(word) ? word : "";
    }
    case "channel":
      return [
        caption.address ?? functionWord(caption.fn, caption.type),
        caption.spare ? "SPARE" : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "relation-summary": {
      const kinds = new Set(caption.functions.map((fn) => fn.kind));
      const kind = kinds.size === 1 ? caption.functions[0]?.kind : undefined;
      const noun =
        kind === "contact"
          ? "contact"
          : kind === "coil"
            ? "coil"
            : kind === "channel"
              ? "channel"
              : kind === "source"
                ? "source"
                : kind === "load"
                  ? "load"
                  : "function";
      return `${caption.functions.length} ${noun}${caption.functions.length === 1 ? "" : "s"}: ${caption.destination}`;
    }
    case "relation":
      return `${caption.functions.map((fn) => (fn.kind === "coil" ? "coil" : fn.terminals.map((t) => t.terminalKey).join("-"))).join(", ")}: ${caption.destination}`;
  }
}

/** Selected-loop captions share channel vocabulary; object keys stay metadata. */
export function selectedChannelCaption(channel: {
  function: IrFunction;
  device: IrDevice;
  type: IrDeviceType;
}): string {
  const address =
    channel.device.io?.channels[channel.function.id.functionKey]?.address;
  return `${printableCaption({
    kind: "channel",
    fn: channel.function,
    type: channel.type,
    ...(address === undefined ? {} : { address }),
    spare: false,
  })} / selected channel`;
}

export interface SourceEnclosureOpening {
  readonly side: SymbolSide;
  /** Coordinate along the enclosure edge, in the caller's drawing units. */
  readonly at: number;
}

/**
 * An enclosure with gaps around each terminal stub. Callers retain their port
 * anchors and draw independent leads; no outline segment may touch a lead.
 * Both symbol families use this geometry, in their own drawing units.
 */
export function sourceEnclosure(
  bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  openings: readonly SourceEnclosureOpening[],
  clearance: number,
): readonly Extract<SymbolPrimitive, { kind: "line" }>[] {
  const { x, y, width, height } = bounds;
  const edges = [
    {
      side: "west",
      low: y,
      high: y + height,
      point: (v: number): SymbolPoint => ({ x, y: v }),
    },
    {
      side: "east",
      low: y,
      high: y + height,
      point: (v: number): SymbolPoint => ({ x: x + width, y: v }),
    },
    {
      side: "north",
      low: x,
      high: x + width,
      point: (v: number): SymbolPoint => ({ x: v, y }),
    },
    {
      side: "south",
      low: x,
      high: x + width,
      point: (v: number): SymbolPoint => ({ x: v, y: y + height }),
    },
  ] as const;
  return edges.flatMap((edge) => {
    const cuts = openings
      .filter((o) => o.side === edge.side)
      .map((o) => o.at)
      .sort((a, b) => a - b);
    const lines: Extract<SymbolPrimitive, { kind: "line" }>[] = [];
    let start = edge.low;
    for (const at of [...cuts, edge.high + clearance]) {
      const end = Math.min(edge.high, at - clearance);
      if (end > start)
        lines.push({
          kind: "line",
          from: edge.point(start),
          to: edge.point(end),
          style: "enclosure",
        });
      start = Math.max(start, at + clearance);
    }
    return lines;
  });
}

/** Independently authored, IEC-informed marks. Coordinates are rooted units;
 * circuit marks scale the same primitives, never reinterpret their meaning. */
export type SharedMark =
  | "disconnector"
  | "coil"
  | "breaker"
  | "overload"
  | "contact-no"
  | "contact-nc"
  | "pushbutton-no"
  | "pushbutton-nc"
  | "switch-no"
  | "switch-nc"
  | "estop-no"
  | "estop-nc"
  | "selector-no"
  | "selector-nc";
export function sharedMarkHeight(mark: SharedMark): number {
  return mark.startsWith("pushbutton") || mark.startsWith("estop")
    ? 28
    : mark === "coil" ||
        mark.startsWith("switch") ||
        mark.startsWith("selector")
      ? 24
      : 20;
}
export function sharedMarkPrimitives(
  mark: SharedMark,
): readonly SymbolPrimitive[] {
  const h = sharedMarkHeight(mark),
    y = h / 2;
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    style: "body" | "operator" | "actuator" = "body",
  ): SymbolPrimitive => ({
    kind: "line",
    from: { x: x1, y: y1 },
    to: { x: x2, y: y2 },
    style,
  });
  const poly = (
    points: readonly (readonly [number, number])[],
    style: "operator" | "actuator" = "operator",
  ): SymbolPrimitive => ({
    kind: "polyline",
    points: points.map(([x, y]) => ({ x, y })),
    style,
  });
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
  ): SymbolPrimitive => ({ kind: "rect", x, y, width, height, style: "body" });
  if (mark === "coil")
    return [line(0, y, 8, y), rect(8, 1, 24, 22), line(32, y, 40, y)];
  // Open blade and fixed-contact bar assert function identity, no operator means.
  if (mark === "disconnector")
    return [
      line(0, y, 10, y),
      line(10, y, 27, 3),
      line(30, y, 40, y),
      line(30, y - 4, 30, y + 4),
    ];
  // The cross identifies a breaker, without asserting a thermal/magnetic trip class.
  if (mark === "breaker")
    return [
      line(0, y, 10, y),
      line(10, y, 27, 3, "operator"),
      line(30, y, 40, y),
      line(26, 7, 32, 13, "operator"),
      line(26, 13, 32, 7, "operator"),
    ];
  // Stepped thermal element, distinct from a resistive zigzag or auxiliary contact.
  if (mark === "overload")
    return [
      line(0, y, 10, y),
      rect(10, 3, 20, 14),
      poly([
        [10, y],
        [16, y],
        [16, 6],
        [24, 6],
        [24, y],
        [30, y],
      ]),
      line(30, y, 40, y),
    ];
  const contact = [
    line(0, y, 14, y),
    line(26, y, 40, y),
    line(14, y - 5, 14, y + 5, "operator"),
    line(26, y - 5, 26, y + 5, "operator"),
  ];
  if (mark.endsWith("-nc"))
    contact.push(line(11, y + 7, 29, y - 7, "operator"));
  if (mark.startsWith("pushbutton"))
    contact.push(
      line(20, 2, 20, y - 6, "actuator"),
      line(14, 2, 26, 2, "actuator"),
    );
  if (mark.startsWith("switch"))
    contact.push(
      line(20, 2, 20, y - 6, "actuator"),
      line(20, 2, 28, 2, "actuator"),
    );
  if (mark.startsWith("estop"))
    contact.push(
      // Mushroom head and retaining latch; no safety-performance assertion.
      line(20, 5, 20, y - 6, "actuator"),
      poly(
        [
          [10, 5],
          [10, 3],
          [14, 1],
          [26, 1],
          [30, 3],
          [30, 5],
          [10, 5],
        ],
        "actuator",
      ),
      poly(
        [
          [22, 6],
          [26, 6],
          [26, 9],
        ],
        "actuator",
      ),
    );
  if (mark.startsWith("selector"))
    contact.push(
      // Maintained rotary handle with two detents.
      line(17, 6, 23, 1, "actuator"),
      line(13, 1, 13, 3, "actuator"),
      line(27, 1, 27, 3, "actuator"),
      line(20, 4, 20, y - 6, "actuator"),
    );
  return contact;
}

/** Only terminal ratings belonging to this coil can qualify it. Conflicts and
 * unspecified classes stay unqualified; tags, descriptions and IDs are ignored. */
export function coilQualifier(
  type: IrDeviceType,
  fn: IrFunction,
): "AC" | "DC" | undefined {
  if (fn.kind !== "coil") return undefined;
  const classes = new Set(
    fn.terminals.flatMap((t) => {
      const value = type.terminals.find((p) => p.key === t.terminalKey)?.rating
        ?.voltage_type;
      return value ? [value] : [];
    }),
  );
  return classes.size === 1 ? [...classes][0] : undefined;
}

export function motorLegend(threePhase: boolean): readonly string[] {
  return threePhase ? ["M", "3~"] : ["M"];
}

/** Three terminals alone may be L/N/PE. A phase qualifier requires the authored
 * three-phase profile or the explicit U/V/W phase-input function shape. */
export function motorIsThreePhase(type: IrDeviceType, fn: IrFunction): boolean {
  if (fn.kind !== "load") return false;
  if (symbolProfile(type) === "thermite:motor-3ph") return true;
  if (fn.terminals.length !== 3) return false;
  const roles = new Set(
    fn.terminals.map(
      (t) => type.terminals.find((p) => p.key === t.terminalKey)?.role,
    ),
  );
  return ["phase_u_input", "phase_v_input", "phase_w_input"].every((role) =>
    roles.has(role),
  );
}

/** Shared winding points in (cross-axis, along-axis) coordinates. No net effect. */
export function windingPolyline(
  cross: number,
  first: number,
  last: number,
  edge: number,
  amplitude: number,
  terminalCross?: readonly [number, number],
): readonly (readonly [number, number])[] {
  const span = last - first;
  return [
    [terminalCross?.[0] ?? edge, first],
    [cross, first],
    ...[1, 2, 3, 4, 5, 6, 7].map((i): readonly [number, number] => [
      cross + (i % 2 ? amplitude : 0),
      first + (span * i) / 8,
    ]),
    [cross, last],
    [terminalCross?.[1] ?? edge, last],
  ];
}
