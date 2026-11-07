import { sharedMarkPrimitives, sourceEnclosure } from "./printable-policy.js";
import { validateSymbolCatalog } from "./validate.js";
import type {
  SymbolDefinition,
  SymbolOrientation,
  SymbolPoint,
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
): SymbolPrimitive {
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
      line(13, 8, 21, 8, "annotation"),
      line(17, 4, 17, 12, "annotation"),
      line(13, 56, 21, 56, "annotation"),
    ],
  ),
  symbol(
    "ais:dc-load",
    40,
    64,
    [port("positive", "west", 1 / 8, 0), port("return", "west", 7 / 8, 1)],
    [
      line(0, 8, 8, 8, "body"),
      line(0, 56, 8, 56, "body"),
      rect(8, 4, 24, 56, "body", 2),
      line(13, 8, 19, 8, "annotation"),
      line(16, 5, 16, 11, "annotation"),
      line(13, 56, 19, 56, "annotation"),
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
      line(0, 10, 8, 10, "body"),
      line(0, 30, 8, 30, "body"),
      rect(8, 4, 30, 32, "body", 2),
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
          [28, 32],
        ],
        "body",
      ),
      polyline(
        [
          [0, 36],
          [16, 36],
        ],
        "body",
      ),
      polyline(
        [
          [0, 60],
          [16, 60],
        ],
        "body",
      ),
      line(0, 84, 18, 84, "body"),
      circle(28, 48, 18, "body"),
      line(18, 80, 18, 88, "annotation"),
      line(13, 88, 23, 88, "annotation"),
      line(15, 91, 21, 91, "annotation"),
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
      line(0, 8, 8, 8, "body"),
      line(0, 56, 8, 56, "body"),
      rect(8, 4, 28, 56, "body"),
    ],
  ),
  symbol(
    "ais:motor",
    48,
    64,
    [port("positive", "west", 1 / 8, 0), port("return", "west", 7 / 8, 1)],
    [
      line(0, 8, 24, 8, "body"),
      line(24, 8, 24, 14, "body"),
      line(0, 56, 24, 56, "body"),
      line(24, 56, 24, 50, "body"),
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
      line(24, 8, 24, 14, "body"),
      line(0, 56, 24, 56, "body"),
      line(24, 56, 24, 50, "body"),
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

function rotatePointClockwise(
  value: SymbolPoint,
  sourceHeight: number,
): SymbolPoint {
  return { x: sourceHeight - value.y, y: value.x };
}

function rotatePrimitiveClockwise(
  primitive: SymbolPrimitive,
  sourceHeight: number,
): SymbolPrimitive {
  switch (primitive.kind) {
    case "line":
      return {
        kind: "line",
        from: rotatePointClockwise(primitive.from, sourceHeight),
        to: rotatePointClockwise(primitive.to, sourceHeight),
        style: primitive.style,
      };
    case "polyline":
      return {
        kind: "polyline",
        points: primitive.points.map((value) =>
          rotatePointClockwise(value, sourceHeight),
        ),
        style: primitive.style,
      };
    case "rect":
      return {
        kind: "rect",
        x: sourceHeight - primitive.y - primitive.height,
        y: primitive.x,
        width: primitive.height,
        height: primitive.width,
        ...(primitive.radius === undefined ? {} : { radius: primitive.radius }),
        style: primitive.style,
      };
    case "circle":
      return {
        kind: "circle",
        center: rotatePointClockwise(primitive.center, sourceHeight),
        radius: primitive.radius,
        style: primitive.style,
      };
    case "arc":
      return {
        kind: "arc",
        from: rotatePointClockwise(primitive.from, sourceHeight),
        to: rotatePointClockwise(primitive.to, sourceHeight),
        radiusX: primitive.radiusY,
        radiusY: primitive.radiusX,
        clockwise: primitive.clockwise,
        style: primitive.style,
      };
  }
}

function rotatePortClockwise(
  value: SymbolPortDefinition,
): SymbolPortDefinition {
  switch (value.side) {
    case "west":
      return { ...value, side: "north", offset: 1 - value.offset };
    case "east":
      return { ...value, side: "south", offset: 1 - value.offset };
    case "north":
      return { ...value, side: "east" };
    case "south":
      return { ...value, side: "west" };
  }
}

export function orientSymbolDefinition(
  definition: SymbolDefinition,
  orientation: SymbolOrientation,
): SymbolDefinition {
  if (orientation === "left-to-right") {
    return deepFreeze(structuredClone(definition));
  }

  const rotated: SymbolDefinition = {
    format: definition.format,
    id: definition.id,
    size: {
      width: definition.size.height,
      height: definition.size.width,
    },
    ports: definition.ports.map(rotatePortClockwise),
    primitives: definition.primitives.map((primitive) =>
      rotatePrimitiveClockwise(primitive, definition.size.height),
    ),
  };
  validateSymbolCatalog([rotated]);
  return deepFreeze(rotated);
}
