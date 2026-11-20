import {
  PRINTABLE_SYMBOL_POLICY,
  sharedMarkPrimitives,
  sourceEnclosure,
  windingPolyline,
} from "./printable-policy.js";
import { validateSymbolCatalog } from "./validate.js";
import type {
  SymbolDefinition,
  SymbolOrientation,
  SymbolPoint,
  SymbolPolarityQualifier,
  SymbolPortDefinition,
  SymbolPrimitive,
  SymbolSide,
  SymbolStyle,
} from "./types.js";

export const DEFAULT_SYMBOL_STROKE = 1.5;
export const TERMINAL_JUNCTION_RADIUS = 3;
export const LEAF_SYMBOL_INSET = 8;
export const LABEL_GAP = 4;
export const ROOT_LOCATION_SIDE_PADDING = 16;
export const DEVICE_GROUP_SIDE_PADDING = 8;
export const OUTER_SVG_PADDING = 20;
const SEPARATE_STUB_GAP =
  PRINTABLE_SYMBOL_POLICY.separateStubGapMm /
  PRINTABLE_SYMBOL_POLICY.rootedMmPerUnit;
const CIRCULAR_STUB_GAP =
  PRINTABLE_SYMBOL_POLICY.circularStubGapMm /
  PRINTABLE_SYMBOL_POLICY.rootedMmPerUnit;
const CIRCULAR_STUB_INSET = Math.ceil(CIRCULAR_STUB_GAP);
const LOAD_FACE_EDGE = 11;
const LOAD_STUB_TIP = LOAD_FACE_EDGE - SEPARATE_STUB_GAP;
const THREE_PHASE_MOTOR_SIDE_TIP = Math.floor(
  28 - Math.sqrt((18 + CIRCULAR_STUB_GAP) ** 2 - 12 ** 2),
);

function point(x: number, y: number): SymbolPoint {
  return { x, y };
}

function port(
  id: string,
  side: SymbolSide,
  offset: number,
  order: number,
): SymbolPortDefinition {
  return { id, side, offset, order };
}

function line(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  style: SymbolStyle,
): Extract<SymbolPrimitive, { kind: "line" }> {
  return {
    kind: "line",
    from: point(fromX, fromY),
    to: point(toX, toY),
    style,
  };
}

function polyline(
  points: readonly (readonly [number, number])[],
  style: SymbolStyle,
): SymbolPrimitive {
  return {
    kind: "polyline",
    points: points.map(([x, y]) => point(x, y)),
    style,
  };
}

function polarityQualifier(
  polarity: SymbolPolarityQualifier["polarity"],
  portId: string,
  x: number,
  y: number,
  radius: number,
): SymbolPrimitive[] {
  const qualifier = { polarity, portId, center: point(x, y) };
  return [
    { ...line(x - radius, y, x + radius, y, "annotation"), qualifier },
    ...(polarity === "positive"
      ? [{ ...line(x, y - radius, x, y + radius, "annotation"), qualifier }]
      : []),
  ];
}

// The lead follows the PE port. From its inner endpoint the stem and bars
// are drawn in page axes, with no contact to the motor body or a phase lead.
const MOTOR_EARTH_ORIGIN = point(18, 84);
function motorEarthBars(): SymbolPrimitive[] {
  return [
    line(18, 84, 18, 88, "annotation"),
    line(13, 88, 23, 88, "annotation"),
    line(15, 91, 21, 91, "annotation"),
    line(17, 94, 19, 94, "annotation"),
  ].map((stroke) => ({ ...stroke, uprightOrigin: MOTOR_EARTH_ORIGIN }));
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  style: SymbolStyle,
  radius?: number,
): SymbolPrimitive {
  return {
    kind: "rect",
    x,
    y,
    width,
    height,
    ...(radius === undefined ? {} : { radius }),
    style,
  };
}

function circle(
  x: number,
  y: number,
  radius: number,
  style: SymbolStyle,
): SymbolPrimitive {
  return { kind: "circle", center: point(x, y), radius, style };
}

function symbol(
  id: SymbolDefinition["id"],
  width: number,
  height: number,
  ports: readonly SymbolPortDefinition[],
  primitives: readonly SymbolPrimitive[],
): SymbolDefinition {
  return {
    format: "ais-symbol/0.1",
    id,
    size: { width, height },
    ports,
    primitives,
  };
}

const CATALOG_DEFINITIONS = [
  symbol(
    "ais:power-source-3ph",
    36,
    96,
    [
      port("L1", "east", 1 / 8, 0),
      port("L2", "east", 3 / 8, 1),
      port("L3", "east", 5 / 8, 2),
      port("PE", "east", 7 / 8, 3),
    ],
    [
      ...sourceEnclosure(
        { x: 2, y: 1, width: 28, height: 94 },
        [12, 36, 60, 84].map((at) => ({ side: "east", at })),
        3,
      ),
      line(8, 12, 11, 12, "body"),
      circle(14, 12, 3, "operator"),
      line(17, 12, 36, 12, "body"),
      line(8, 36, 11, 36, "body"),
      circle(14, 36, 3, "operator"),
      line(17, 36, 36, 36, "body"),
      line(8, 60, 11, 60, "body"),
      circle(14, 60, 3, "operator"),
      line(17, 60, 36, 60, "body"),
      line(8, 84, 11, 84, "body"),
      circle(14, 84, 3, "terminal"),
      line(17, 84, 36, 84, "body"),
    ],
  ),
  symbol(
    "ais:power-source-dc",
    36,
    64,
    [port("positive", "east", 1 / 8, 0), port("return", "east", 7 / 8, 1)],
    [
      ...sourceEnclosure(
        { x: 2, y: 1, width: 28, height: 62 },
        [8, 56].map((at) => ({ side: "east", at })),
        3,
      ),
      line(8, 8, 36, 8, "body"),
      line(8, 56, 36, 56, "body"),
      // Reserve qualifier ink inside the existing size, clear of both leads
      // and the enclosure, including after its centre rotates for vertical flow.
      ...polarityQualifier("positive", "positive", 17, 18, 4),
      ...polarityQualifier("negative", "return", 17, 46, 4),
    ],
  ),
  symbol(
    "ais:source-winding",
    36,
    64,
    [port("feed", "east", 1 / 8, 0), port("return", "east", 7 / 8, 1)],
    [
      polyline(windingPolyline(12, 8, 56, 36, 6), "body"),
      line(24, 12, 24, 52, "body"),
    ],
  ),
  symbol(
    "ais:dc-load",
    40,
    64,
    [port("positive", "west", 1 / 8, 0), port("return", "west", 7 / 8, 1)],
    [
      line(0, 8, LOAD_STUB_TIP, 8, "body"),
      line(0, 56, LOAD_STUB_TIP, 56, "body"),
      rect(LOAD_FACE_EDGE, 4, 32 - LOAD_FACE_EDGE, 56, "body", 2),
      ...polarityQualifier("positive", "positive", 20, 16, 3),
      ...polarityQualifier("negative", "return", 20, 48, 3),
    ],
  ),
  symbol(
    "ais:fuse",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 10, 8, 10, "body"),
      rect(8, 3, 24, 14, "body"),
      line(12, 14, 28, 6, "operator"),
      line(32, 10, 40, 10, "body"),
    ],
  ),
  symbol(
    "ais:breaker-pole",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("breaker"),
  ),
  symbol(
    "ais:disconnector",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("disconnector"),
  ),
  symbol(
    "ais:contact-no",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("contact-no"),
  ),
  symbol(
    "ais:contact-nc",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("contact-nc"),
  ),
  symbol(
    "ais:pushbutton-no",
    40,
    28,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("pushbutton-no"),
  ),
  symbol(
    "ais:pushbutton-nc",
    40,
    28,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("pushbutton-nc"),
  ),
  symbol(
    "ais:switch-no",
    40,
    24,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("switch-no"),
  ),
  symbol(
    "ais:switch-nc",
    40,
    24,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("switch-nc"),
  ),
  symbol(
    "ais:switch-sensor-pnp",
    48,
    40,
    [
      port("supply", "west", 1 / 4, 0),
      port("return", "west", 3 / 4, 1),
      port("signal", "east", 1 / 2, 2),
    ],
    [
      line(0, 10, LOAD_STUB_TIP, 10, "body"),
      line(0, 30, LOAD_STUB_TIP, 30, "body"),
      rect(LOAD_FACE_EDGE, 4, 38 - LOAD_FACE_EDGE, 32, "body", 2),
      circle(21, 20, 6, "actuator"),
      line(27, 20, 48, 20, "body"),
      polyline(
        [
          [29, 14],
          [35, 20],
          [29, 26],
        ],
        "operator",
      ),
    ],
  ),
  symbol(
    "ais:coil",
    40,
    24,
    [port("A1", "west", 1 / 2, 0), port("A2", "east", 1 / 2, 1)],
    sharedMarkPrimitives("coil"),
  ),
  symbol(
    "ais:overload-pole",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("overload"),
  ),
  symbol(
    "ais:overload-contact-nc",
    40,
    24,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    sharedMarkPrimitives("contact-nc").map((p) =>
      p.kind === "line"
        ? {
            ...p,
            from: { ...p.from, y: p.from.y + 2 },
            to: { ...p.to, y: p.to.y + 2 },
          }
        : p,
    ),
  ),
  symbol(
    "ais:motor-3ph",
    48,
    96,
    [
      port("U", "west", 1 / 8, 0),
      port("V", "west", 3 / 8, 1),
      port("W", "west", 5 / 8, 2),
      port("PE", "west", 7 / 8, 3),
    ],
    [
      polyline(
        [
          [0, 12],
          [28, 12],
          [28, 30 - CIRCULAR_STUB_INSET],
        ],
        "body",
      ),
      polyline(
        [
          [0, 36],
          [THREE_PHASE_MOTOR_SIDE_TIP, 36],
        ],
        "body",
      ),
      polyline(
        [
          [0, 60],
          [THREE_PHASE_MOTOR_SIDE_TIP, 60],
        ],
        "body",
      ),
      line(0, 84, 18, 84, "body"),
      circle(28, 48, 18, "body"),
      ...motorEarthBars(),
    ],
  ),
  symbol(
    "ais:terminal",
    20,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 10, 7, 10, "body"),
      circle(10, 10, TERMINAL_JUNCTION_RADIUS, "terminal"),
      line(13, 10, 20, 10, "body"),
    ],
  ),
  symbol(
    "ais:plc-di",
    36,
    24,
    [port("DI", "west", 1 / 2, 0)],
    [
      line(0, 12, 8, 12, "body"),
      rect(8, 4, 24, 16, "body", 2),
      line(12, 12, 25, 12, "operator"),
      polyline(
        [
          [20, 8],
          [25, 12],
          [20, 16],
        ],
        "operator",
      ),
    ],
  ),
  symbol(
    "ais:plc-do",
    36,
    24,
    [port("DO", "east", 1 / 2, 0)],
    [
      rect(4, 4, 24, 16, "body", 2),
      line(11, 12, 36, 12, "body"),
      polyline(
        [
          [19, 8],
          [24, 12],
          [19, 16],
        ],
        "operator",
      ),
    ],
  ),
  symbol(
    "ais:rail-source",
    16,
    32,
    [port("source", "east", 1 / 2, 0)],
    [rect(4, 4, 4, 24, "body"), line(8, 16, 16, 16, "body")],
  ),
  symbol(
    "ais:rail-return",
    16,
    32,
    [port("return", "west", 1 / 2, 0)],
    [line(0, 16, 8, 16, "body"), rect(8, 4, 4, 24, "body")],
  ),
] satisfies readonly SymbolDefinition[];

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

validateSymbolCatalog(CATALOG_DEFINITIONS);

// Additional shapes have their own port inventories; no absent PE or return pin
// is synthesized to reuse a larger symbol.
const ADDITIONAL_DEFINITIONS: SymbolDefinition[] = [
  ...(["estop-no", "estop-nc", "selector-no", "selector-nc"] as const).map(
    (mark) =>
      symbol(
        `ais:${mark}`,
        40,
        mark.startsWith("estop") ? 28 : 24,
        [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
        sharedMarkPrimitives(mark),
      ),
  ),
  ...(
    [
      ["ais:motor-3ph", "ais:motor-3ph-unbonded"],
      ["ais:power-source-3ph", "ais:power-source-3wire"],
    ] as const
  ).map(([from, id]) => {
    const base = CATALOG_DEFINITIONS.find((s) => s.id === from)!;
    return {
      ...base,
      id,
      ports: base.ports.filter((p) => p.id !== "PE"),
      primitives:
        from === "ais:motor-3ph"
          ? base.primitives.filter((_, i) => i !== 3 && i < 5)
          : [
              ...sourceEnclosure(
                { x: 2, y: 1, width: 28, height: 94 },
                [12, 36, 60].map((at) => ({ side: "east" as const, at })),
                3,
              ),
              ...[12, 36, 60].flatMap((y) => [
                line(8, y, 11, y, "body"),
                circle(14, y, 3, "operator"),
                line(17, y, 36, y, "body"),
              ]),
            ],
    };
  }),
  symbol(
    "ais:ac-load",
    40,
    64,
    [port("line", "west", 1 / 8, 0), port("neutral", "west", 7 / 8, 1)],
    [
      line(0, 8, LOAD_STUB_TIP, 8, "body"),
      line(0, 56, LOAD_STUB_TIP, 56, "body"),
      rect(LOAD_FACE_EDGE, 4, 36 - LOAD_FACE_EDGE, 56, "body"),
    ],
  ),
  symbol(
    "ais:motor",
    48,
    64,
    [port("positive", "west", 1 / 8, 0), port("return", "west", 7 / 8, 1)],
    [
      line(0, 8, 24, 8, "body"),
      line(24, 8, 24, 14 - CIRCULAR_STUB_INSET, "body"),
      line(0, 56, 24, 56, "body"),
      line(24, 56, 24, 50 + CIRCULAR_STUB_INSET, "body"),
      circle(24, 32, 18, "body"),
    ],
  ),
  symbol(
    "ais:lamp",
    48,
    64,
    [port("positive", "west", 1 / 8, 0), port("return", "west", 7 / 8, 1)],
    [
      line(0, 8, 24, 8, "body"),
      line(24, 8, 24, 14 - CIRCULAR_STUB_INSET, "body"),
      line(0, 56, 24, 56, "body"),
      line(24, 56, 24, 50 + CIRCULAR_STUB_INSET, "body"),
      circle(24, 32, 18, "body"),
      line(12, 20, 36, 44, "operator"),
      line(12, 44, 36, 20, "operator"),
    ],
  ),
];
validateSymbolCatalog(ADDITIONAL_DEFINITIONS);

export const SYMBOL_CATALOG: readonly SymbolDefinition[] = deepFreeze([
  ...CATALOG_DEFINITIONS,
  ...ADDITIONAL_DEFINITIONS,
]);

export function findSymbolDefinition(
  id: SymbolDefinition["id"],
  catalog: readonly SymbolDefinition[] = SYMBOL_CATALOG,
): SymbolDefinition | undefined {
  return catalog.find((definition) => definition.id === id);
}

/** Only the three-phase lane families use a transposed vertical composition.
 * Other glyphs retain their clockwise rotation, including asymmetric controls. */
export function preservesVerticalPowerLaneOrder(
  id: SymbolDefinition["id"] | undefined,
): boolean {
  return (
    id === "ais:power-source-3ph" ||
    id === "ais:power-source-3wire" ||
    id === "ais:motor-3ph" ||
    id === "ais:motor-3ph-unbonded"
  );
}

function verticalPoint(
  value: SymbolPoint,
  sourceHeight: number,
  preserveLanes: boolean,
): SymbolPoint {
  return { x: preserveLanes ? value.y : sourceHeight - value.y, y: value.x };
}

function uprightLine(
  primitive: Extract<SymbolPrimitive, { kind: "line" }>,
  transform: (point: SymbolPoint) => SymbolPoint,
) {
  const origin = primitive.qualifier?.center ?? primitive.uprightOrigin;
  if (!origin) return undefined;
  const center = transform(origin);
  const upright = (p: SymbolPoint) => ({
    x: center.x + p.x - origin.x,
    y: center.y + p.y - origin.y,
  });
  return {
    ...primitive,
    from: upright(primitive.from),
    to: upright(primitive.to),
    ...(primitive.qualifier
      ? { qualifier: { ...primitive.qualifier, center } }
      : {}),
    ...(primitive.uprightOrigin ? { uprightOrigin: center } : {}),
  };
}

function verticalPrimitive(
  primitive: SymbolPrimitive,
  sourceHeight: number,
  preserveLanes: boolean,
): SymbolPrimitive {
  const transform = (value: SymbolPoint) =>
    verticalPoint(value, sourceHeight, preserveLanes);
  switch (primitive.kind) {
    case "line":
      return (
        uprightLine(primitive, transform) ?? {
          kind: "line",
          from: transform(primitive.from),
          to: transform(primitive.to),
          style: primitive.style,
        }
      );
    case "polyline":
      return {
        kind: "polyline",
        points: primitive.points.map(transform),
        style: primitive.style,
      };
    case "rect":
      return {
        kind: "rect",
        x: preserveLanes
          ? primitive.y
          : sourceHeight - primitive.y - primitive.height,
        y: primitive.x,
        width: primitive.height,
        height: primitive.width,
        ...(primitive.radius === undefined ? {} : { radius: primitive.radius }),
        style: primitive.style,
      };
    case "circle":
      return {
        kind: "circle",
        center: transform(primitive.center),
        radius: primitive.radius,
        style: primitive.style,
      };
    case "arc":
      return {
        kind: "arc",
        from: transform(primitive.from),
        to: transform(primitive.to),
        radiusX: primitive.radiusY,
        radiusY: primitive.radiusX,
        clockwise: preserveLanes ? !primitive.clockwise : primitive.clockwise,
        style: primitive.style,
      };
  }
}

function verticalPort(
  value: SymbolPortDefinition,
  preserveLanes: boolean,
): SymbolPortDefinition {
  const offset = preserveLanes ? value.offset : 1 - value.offset;
  switch (value.side) {
    case "west":
      return { ...value, side: "north", offset };
    case "east":
      return { ...value, side: "south", offset };
    case "north":
      return { ...value, side: preserveLanes ? "west" : "east" };
    case "south":
      return { ...value, side: preserveLanes ? "east" : "west" };
  }
}

export function orientSymbolDefinition(
  definition: SymbolDefinition,
  orientation: SymbolOrientation,
): SymbolDefinition {
  if (orientation === "left-to-right") {
    return deepFreeze(structuredClone(definition));
  }

  const preserveLanes = preservesVerticalPowerLaneOrder(definition.id);
  const rotated: SymbolDefinition = {
    format: definition.format,
    id: definition.id,
    size: {
      width: definition.size.height,
      height: definition.size.width,
    },
    ports: definition.ports.map((value) => verticalPort(value, preserveLanes)),
    primitives: definition.primitives.map((primitive) =>
      verticalPrimitive(primitive, definition.size.height, preserveLanes),
    ),
  };
  validateSymbolCatalog([rotated]);
  return deepFreeze(rotated);
}
