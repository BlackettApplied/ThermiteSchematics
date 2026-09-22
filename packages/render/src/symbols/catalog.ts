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

function arc(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radiusX: number,
  radiusY: number,
  clockwise: boolean,
  style: SymbolStyle,
): SymbolPrimitive {
  return {
    kind: "arc",
    from: point(fromX, fromY),
    to: point(toX, toY),
    radiusX,
    radiusY,
    clockwise,
    style,
  };
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
      line(8, 12, 8, 84, "body"),
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
      line(8, 4, 8, 60, "body"),
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
    [
      line(0, 10, 9, 10, "body"),
      circle(12, 10, 3, "terminal"),
      line(15, 9, 25, 5, "operator"),
      circle(28, 10, 3, "terminal"),
      line(31, 10, 40, 10, "body"),
      polyline(
        [
          [19, 3],
          [22, 1],
          [25, 3],
        ],
        "actuator",
      ),
    ],
  ),
  symbol(
    "ais:contact-no",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 10, 10, 10, "body"),
      circle(13, 10, 3, "terminal"),
      line(16, 9, 24, 5, "operator"),
      circle(27, 10, 3, "terminal"),
      line(30, 10, 40, 10, "body"),
    ],
  ),
  symbol(
    "ais:contact-nc",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 10, 10, 10, "body"),
      circle(13, 10, 3, "terminal"),
      line(16, 9, 24, 10, "operator"),
      circle(27, 10, 3, "terminal"),
      line(30, 10, 40, 10, "body"),
    ],
  ),
  symbol(
    "ais:pushbutton-no",
    40,
    28,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 14, 10, 14, "body"),
      circle(13, 14, 3, "terminal"),
      line(16, 13, 24, 9, "operator"),
      circle(27, 14, 3, "terminal"),
      line(30, 14, 40, 14, "body"),
      line(20, 2, 20, 8, "actuator"),
      line(15, 8, 25, 8, "actuator"),
    ],
  ),
  symbol(
    "ais:pushbutton-nc",
    40,
    28,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 14, 10, 14, "body"),
      circle(13, 14, 3, "terminal"),
      line(16, 13, 24, 14, "operator"),
      circle(27, 14, 3, "terminal"),
      line(30, 14, 40, 14, "body"),
      line(20, 2, 20, 8, "actuator"),
      line(15, 8, 25, 8, "actuator"),
    ],
  ),
  symbol(
    "ais:switch-no",
    40,
    24,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 12, 10, 12, "body"),
      circle(13, 12, 3, "terminal"),
      line(16, 11, 24, 7, "operator"),
      circle(27, 12, 3, "terminal"),
      line(30, 12, 40, 12, "body"),
      polyline(
        [
          [18, 3],
          [21, 6],
          [24, 3],
        ],
        "actuator",
      ),
    ],
  ),
  symbol(
    "ais:switch-nc",
    40,
    24,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 12, 10, 12, "body"),
      circle(13, 12, 3, "terminal"),
      line(16, 11, 24, 12, "operator"),
      circle(27, 12, 3, "terminal"),
      line(30, 12, 40, 12, "body"),
      polyline(
        [
          [18, 3],
          [21, 6],
          [24, 3],
        ],
        "actuator",
      ),
    ],
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
    [
      line(0, 12, 8, 12, "body"),
      rect(8, 4, 24, 16, "body", 8),
      arc(12, 12, 20, 12, 4, 6, true, "operator"),
      arc(20, 12, 28, 12, 4, 6, false, "operator"),
      line(32, 12, 40, 12, "body"),
    ],
  ),
  symbol(
    "ais:overload-pole",
    40,
    20,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 10, 8, 10, "body"),
      polyline(
        [
          [8, 10],
          [13, 5],
          [18, 15],
          [23, 5],
          [28, 15],
          [32, 10],
        ],
        "operator",
      ),
      line(32, 10, 40, 10, "body"),
    ],
  ),
  symbol(
    "ais:overload-contact-nc",
    40,
    24,
    [port("in", "west", 1 / 2, 0), port("out", "east", 1 / 2, 1)],
    [
      line(0, 12, 10, 12, "body"),
      circle(13, 12, 3, "terminal"),
      line(16, 11, 24, 12, "operator"),
      circle(27, 12, 3, "terminal"),
      line(30, 12, 40, 12, "body"),
      polyline(
        [
          [18, 3],
          [20, 7],
          [22, 3],
          [24, 7],
        ],
        "actuator",
      ),
    ],
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
      arc(18, 43, 38, 43, 10, 6, true, "operator"),
      line(18, 48, 38, 48, "operator"),
      arc(18, 53, 38, 53, 10, 6, false, "operator"),
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

export const SYMBOL_CATALOG: readonly SymbolDefinition[] =
  deepFreeze(CATALOG_DEFINITIONS);

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
