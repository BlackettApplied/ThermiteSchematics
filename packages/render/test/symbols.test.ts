import { describe, expect, it } from "vitest";

import { InvalidSymbolCatalogError } from "../src/errors.js";
import {
  DEFAULT_SYMBOL_STROKE,
  DEVICE_GROUP_SIDE_PADDING,
  LABEL_GAP,
  LEAF_SYMBOL_INSET,
  orientSymbolDefinition,
  OUTER_SVG_PADDING,
  ROOT_LOCATION_SIDE_PADDING,
  SYMBOL_CATALOG,
  TERMINAL_JUNCTION_RADIUS,
} from "../src/symbols/catalog.js";
import type {
  SymbolDefinition,
  SymbolPortDefinition,
} from "../src/symbols/types.js";
import { validateSymbolCatalog } from "../src/symbols/validate.js";

interface ExpectedSymbol {
  readonly id: SymbolDefinition["id"];
  readonly width: number;
  readonly height: number;
  readonly ports: readonly [
    id: string,
    side: SymbolPortDefinition["side"],
    offset: number,
    order: number,
  ][];
}

const EXPECTED_SYMBOLS: readonly ExpectedSymbol[] = [
  {
    id: "ais:power-source-3ph",
    width: 36,
    height: 96,
    ports: [
      ["L1", "east", 1 / 8, 0],
      ["L2", "east", 3 / 8, 1],
      ["L3", "east", 5 / 8, 2],
      ["PE", "east", 7 / 8, 3],
    ],
  },
  {
    id: "ais:power-source-dc",
    width: 36,
    height: 64,
    ports: [
      ["positive", "east", 1 / 8, 0],
      ["return", "east", 7 / 8, 1],
    ],
  },
  {
    id: "ais:dc-load",
    width: 40,
    height: 64,
    ports: [
      ["positive", "west", 1 / 8, 0],
      ["return", "west", 7 / 8, 1],
    ],
  },
  {
    id: "ais:fuse",
    width: 40,
    height: 20,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:breaker-pole",
    width: 40,
    height: 20,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:contact-no",
    width: 40,
    height: 20,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:contact-nc",
    width: 40,
    height: 20,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:pushbutton-no",
    width: 40,
    height: 28,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:pushbutton-nc",
    width: 40,
    height: 28,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:switch-no",
    width: 40,
    height: 24,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:switch-nc",
    width: 40,
    height: 24,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:switch-sensor-pnp",
    width: 48,
    height: 40,
    ports: [
      ["supply", "west", 1 / 4, 0],
      ["return", "west", 3 / 4, 1],
      ["signal", "east", 1 / 2, 2],
    ],
  },
  {
    id: "ais:coil",
    width: 40,
    height: 24,
    ports: [
      ["A1", "west", 1 / 2, 0],
      ["A2", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:overload-pole",
    width: 40,
    height: 20,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:overload-contact-nc",
    width: 40,
    height: 24,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:motor-3ph",
    width: 48,
    height: 96,
    ports: [
      ["U", "west", 1 / 8, 0],
      ["V", "west", 3 / 8, 1],
      ["W", "west", 5 / 8, 2],
      ["PE", "west", 7 / 8, 3],
    ],
  },
  {
    id: "ais:terminal",
    width: 20,
    height: 20,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:plc-di",
    width: 36,
    height: 24,
    ports: [["DI", "west", 1 / 2, 0]],
  },
  {
    id: "ais:plc-do",
    width: 36,
    height: 24,
    ports: [["DO", "east", 1 / 2, 0]],
  },
  {
    id: "ais:rail-source",
    width: 16,
    height: 32,
    ports: [["source", "east", 1 / 2, 0]],
  },
  {
    id: "ais:rail-return",
    width: 16,
    height: 32,
    ports: [["return", "west", 1 / 2, 0]],
  },
];

function mutableCatalog(): SymbolDefinition[] {
  return structuredClone(SYMBOL_CATALOG);
}

function expectCatalogFailure(
  mutate: (catalog: SymbolDefinition[]) => void,
): void {
  const catalog = mutableCatalog();
  mutate(catalog);
  expect(() => validateSymbolCatalog(catalog)).toThrow(
    InvalidSymbolCatalogError,
  );
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const member of Object.values(value)) expectDeepFrozen(member, seen);
}

describe("D3 original symbol catalog", () => {
  it("freezes the exact v0.1 units, dimensions, ports, offsets, and orders", () => {
    expect({
      DEFAULT_SYMBOL_STROKE,
      TERMINAL_JUNCTION_RADIUS,
      LEAF_SYMBOL_INSET,
      LABEL_GAP,
      ROOT_LOCATION_SIDE_PADDING,
      DEVICE_GROUP_SIDE_PADDING,
      OUTER_SVG_PADDING,
    }).toEqual({
      DEFAULT_SYMBOL_STROKE: 1.5,
      TERMINAL_JUNCTION_RADIUS: 3,
      LEAF_SYMBOL_INSET: 8,
      LABEL_GAP: 4,
      ROOT_LOCATION_SIDE_PADDING: 16,
      DEVICE_GROUP_SIDE_PADDING: 8,
      OUTER_SVG_PADDING: 20,
    });
    expect(SYMBOL_CATALOG).toHaveLength(EXPECTED_SYMBOLS.length);
    expect(
      SYMBOL_CATALOG.map((definition) => ({
        id: definition.id,
        width: definition.size.width,
        height: definition.size.height,
        ports: definition.ports.map(({ id, side, offset, order }) => [
          id,
          side,
          offset,
          order,
        ]),
      })),
    ).toEqual(EXPECTED_SYMBOLS);
    expect(validateSymbolCatalog(SYMBOL_CATALOG)).toBe(SYMBOL_CATALOG);
  });

  it("uses all five typed primitives with finite integer in-bounds geometry", () => {
    const kinds = new Set<string>();
    for (const definition of SYMBOL_CATALOG) {
      expect(definition.format).toBe("ais-symbol/0.1");
      for (const port of definition.ports) {
        expect(Number.isInteger(port.offset * 8)).toBe(true);
      }
      for (const primitive of definition.primitives) {
        kinds.add(primitive.kind);
        const values = Object.values(primitive).flatMap((value) =>
          typeof value === "number" ? [value] : [],
        );
        expect(values.every(Number.isFinite)).toBe(true);
      }
    }
    expect([...kinds].sort()).toEqual([
      "arc",
      "circle",
      "line",
      "polyline",
      "rect",
    ]);
  });

  it("freezes every B1 DC source/load primitive at the exact 64-high anchors", () => {
    expect(
      SYMBOL_CATALOG.filter(
        ({ id }) => id === "ais:power-source-dc" || id === "ais:dc-load",
      ),
    ).toEqual([
      {
        format: "ais-symbol/0.1",
        id: "ais:power-source-dc",
        size: { width: 36, height: 64 },
        ports: [
          { id: "positive", side: "east", offset: 1 / 8, order: 0 },
          { id: "return", side: "east", offset: 7 / 8, order: 1 },
        ],
        primitives: [
          {
            kind: "line",
            from: { x: 8, y: 4 },
            to: { x: 8, y: 60 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 8, y: 8 },
            to: { x: 36, y: 8 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 8, y: 56 },
            to: { x: 36, y: 56 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 13, y: 8 },
            to: { x: 21, y: 8 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 17, y: 4 },
            to: { x: 17, y: 12 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 13, y: 56 },
            to: { x: 21, y: 56 },
            style: "annotation",
          },
        ],
      },
      {
        format: "ais-symbol/0.1",
        id: "ais:dc-load",
        size: { width: 40, height: 64 },
        ports: [
          { id: "positive", side: "west", offset: 1 / 8, order: 0 },
          { id: "return", side: "west", offset: 7 / 8, order: 1 },
        ],
        primitives: [
          {
            kind: "line",
            from: { x: 0, y: 8 },
            to: { x: 8, y: 8 },
            style: "body",
          },
          {
            kind: "line",
            from: { x: 0, y: 56 },
            to: { x: 8, y: 56 },
            style: "body",
          },
          {
            kind: "rect",
            x: 8,
            y: 4,
            width: 24,
            height: 56,
            radius: 2,
            style: "body",
          },
          {
            kind: "line",
            from: { x: 13, y: 8 },
            to: { x: 19, y: 8 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 16, y: 5 },
            to: { x: 16, y: 11 },
            style: "annotation",
          },
          {
            kind: "line",
            from: { x: 13, y: 56 },
            to: { x: 19, y: 56 },
            style: "annotation",
          },
        ],
      },
    ]);
  });

  it("connects every three-phase motor lead to the motor outline", () => {
    const motor = SYMBOL_CATALOG.find(({ id }) => id === "ais:motor-3ph")!;
    const circle = motor.primitives.find(
      (primitive) => primitive.kind === "circle" && primitive.style === "body",
    );
    expect(circle?.kind).toBe("circle");
    if (circle?.kind !== "circle") return;
    const leads = motor.primitives.slice(0, 3);
    expect(leads.every(({ kind }) => kind === "polyline")).toBe(true);
    const anchors = [
      { x: 0, y: 12 },
      { x: 0, y: 36 },
      { x: 0, y: 60 },
    ];
    const epsilon = 1e-9;
    for (const [index, lead] of leads.entries()) {
      if (lead?.kind !== "polyline") continue;
      expect(lead.points[0]).toEqual(anchors[index]);
      const intersections = lead.points.slice(1).flatMap((to, pointIndex) => {
        const from = lead.points[pointIndex]!;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const fx = from.x - circle.center.x;
        const fy = from.y - circle.center.y;
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - circle.radius * circle.radius;
        const discriminant = b * b - 4 * a * c;
        if (discriminant < -epsilon) return [];
        const root = Math.sqrt(Math.max(0, discriminant));
        return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
          .filter((value) => value >= -epsilon && value <= 1 + epsilon)
          .map((value) => ({
            x: from.x + value * dx,
            y: from.y + value * dy,
          }));
      });
      expect(intersections.length).toBeGreaterThan(0);
      expect(
        intersections.some(
          ({ x, y }) =>
            Math.abs(
              Math.hypot(x - circle.center.x, y - circle.center.y) -
                circle.radius,
            ) <= epsilon,
        ),
      ).toBe(true);
    }
  });

  it("deep-freezes built-ins and returns frozen independent orientations", () => {
    expectDeepFrozen(SYMBOL_CATALOG);
    const sensor = SYMBOL_CATALOG.find(
      ({ id }) => id === "ais:switch-sensor-pnp",
    )!;
    const horizontal = orientSymbolDefinition(sensor, "left-to-right");
    const vertical = orientSymbolDefinition(sensor, "top-to-bottom");
    expect(horizontal).toEqual(sensor);
    expect(horizontal).not.toBe(sensor);
    expect(vertical.size).toEqual({ width: 40, height: 48 });
    expect(vertical.ports).toEqual([
      { id: "supply", side: "north", offset: 3 / 4, order: 0 },
      { id: "return", side: "north", offset: 1 / 4, order: 1 },
      { id: "signal", side: "south", offset: 1 / 2, order: 2 },
    ]);
    expect(vertical.primitives[2]).toEqual({
      kind: "rect",
      x: 4,
      y: 8,
      width: 32,
      height: 30,
      radius: 2,
      style: "body",
    });
    expectDeepFrozen(horizontal);
    expectDeepFrozen(vertical);
  });

  it("rotates points and asymmetric arc radii exactly clockwise", () => {
    const coil = SYMBOL_CATALOG.find(({ id }) => id === "ais:coil")!;
    const vertical = orientSymbolDefinition(coil, "top-to-bottom");
    const firstArc = vertical.primitives.find(({ kind }) => kind === "arc");
    expect(firstArc).toEqual({
      kind: "arc",
      from: { x: 12, y: 12 },
      to: { x: 12, y: 20 },
      radiusX: 6,
      radiusY: 4,
      clockwise: true,
      style: "operator",
    });
    expect(vertical.ports).toEqual([
      { id: "A1", side: "north", offset: 1 / 2, order: 0 },
      { id: "A2", side: "south", offset: 1 / 2, order: 1 },
    ]);
  });

  it("contains no free-form drawing fragment or external artwork reference", () => {
    const serialized = JSON.stringify(SYMBOL_CATALOG);
    expect(serialized).not.toMatch(/(?:https?:|iec:|<|>|pathData|markup|uri)/i);
    for (const definition of SYMBOL_CATALOG) {
      for (const primitive of definition.primitives) {
        expect(Object.keys(primitive)).not.toContain("d");
      }
    }
  });

  it.each([
    [
      "duplicate IDs",
      (catalog: SymbolDefinition[]) =>
        catalog.push(structuredClone(catalog[0]!)),
    ],
    [
      "duplicate ports",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.ports = [
          ...catalog[0]!.ports,
          structuredClone(catalog[0]!.ports[0]!),
        ]),
    ],
    [
      "duplicate orders",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.ports[1]!.order = catalog[0]!.ports[0]!.order),
    ],
    [
      "unknown styles",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.primitives[0]!.style = "bogus"),
    ],
    [
      "non-finite geometry",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.primitives[0]!.from.x = Number.NaN),
    ],
    [
      "out-of-bounds geometry",
      (catalog: SymbolDefinition[]) => (catalog[0]!.primitives[0]!.from.x = -1),
    ],
    [
      "invalid dimensions",
      (catalog: SymbolDefinition[]) => (catalog[0]!.size.width = 0),
    ],
    [
      "invalid circle radii",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.primitives.find(({ kind }) => kind === "circle")!.radius =
          0),
    ],
    [
      "invalid rectangle radii",
      (catalog: SymbolDefinition[]) =>
        (catalog
          .find(({ id }) => id === "ais:coil")!
          .primitives.find(({ kind }) => kind === "rect")!.radius = 9),
    ],
    [
      "invalid arc radii",
      (catalog: SymbolDefinition[]) =>
        (catalog
          .find(({ id }) => id === "ais:coil")!
          .primitives.find(({ kind }) => kind === "arc")!.radiusX = 0),
    ],
    [
      "illegal offsets",
      (catalog: SymbolDefinition[]) => (catalog[0]!.ports[0]!.offset = 1 / 3),
    ],
    [
      "insufficient polyline points",
      (catalog: SymbolDefinition[]) =>
        (catalog
          .find(({ id }) => id === "ais:breaker-pole")!
          .primitives.find(({ kind }) => kind === "polyline")!.points = [
          { x: 1, y: 1 },
        ]),
    ],
    [
      "ports off the boundary",
      (catalog: SymbolDefinition[]) => (catalog[0]!.ports[0]!.side = "center"),
    ],
    [
      "unknown primitive kinds",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.primitives[0]!.kind = "path"),
    ],
    [
      "free-form primitive fields",
      (catalog: SymbolDefinition[]) =>
        (catalog[0]!.primitives[0]!.pathData = "external"),
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    expectCatalogFailure(mutate as (catalog: SymbolDefinition[]) => void);
  });
});
