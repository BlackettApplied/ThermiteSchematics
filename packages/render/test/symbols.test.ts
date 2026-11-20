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
import { orientedSide } from "../src/presentation/util.js";

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
    id: "ais:estop-no",
    width: 40,
    height: 28,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:estop-nc",
    width: 40,
    height: 28,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:selector-no",
    width: 40,
    height: 24,
    ports: [
      ["in", "west", 1 / 2, 0],
      ["out", "east", 1 / 2, 1],
    ],
  },
  {
    id: "ais:selector-nc",
    width: 40,
    height: 24,
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
    expect(SYMBOL_CATALOG).toHaveLength(32);
    expect(
      SYMBOL_CATALOG.filter(
        (s) => !EXPECTED_SYMBOLS.some((e) => e.id === s.id),
      ).map((s) => s.id),
    ).toEqual([
      "ais:source-winding",
      "ais:disconnector",
      "ais:motor-3ph-unbonded",
      "ais:power-source-3wire",
      "ais:ac-load",
      "ais:motor",
      "ais:lamp",
    ]);
    expect(
      SYMBOL_CATALOG.filter((s) =>
        EXPECTED_SYMBOLS.some((e) => e.id === s.id),
      ).map((definition) => ({
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
    ).toEqual(
      [...EXPECTED_SYMBOLS].sort(
        (a, b) =>
          SYMBOL_CATALOG.findIndex((s) => s.id === a.id) -
          SYMBOL_CATALOG.findIndex((s) => s.id === b.id),
      ),
    );
    expect(validateSymbolCatalog(SYMBOL_CATALOG)).toBe(SYMBOL_CATALOG);
  });

  it("uses finite integer in-bounds geometry with finite integer in-bounds geometry", () => {
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
    expect([...kinds].sort()).toEqual(["circle", "line", "polyline", "rect"]);
  });

  it("keeps B1 DC anchors and reserves detached qualifier ink within the existing sizes", () => {
    for (const [id, width, side] of [
      ["ais:power-source-dc", 36, "east"],
      ["ais:dc-load", 40, "west"],
    ] as const) {
      const definition = SYMBOL_CATALOG.find((s) => s.id === id)!;
      expect(definition.size).toEqual({ width, height: 64 });
      expect(definition.ports).toEqual([
        { id: "positive", side, offset: 1 / 8, order: 0 },
        { id: "return", side, offset: 7 / 8, order: 1 },
      ]);
      const leads = definition.primitives.filter(
        (p) => p.kind === "line" && p.style === "body",
      );
      expect(leads).toEqual(
        [8, 56].map((y) => ({
          kind: "line",
          from: { x: side === "east" ? 8 : 0, y },
          to: { x: side === "east" ? 36 : 7, y },
          style: "body",
        })),
      );
      expect(
        definition.primitives
          .filter((p) => p.kind === "line" && p.qualifier)
          .map(
            (p) =>
              p.kind === "line" && [p.qualifier!.polarity, p.qualifier!.portId],
          ),
      ).toEqual([
        ["positive", "positive"],
        ["positive", "positive"],
        ["negative", "return"],
      ]);
      if (side === "east")
        expect(
          definition.primitives.filter((p) => p.style === "enclosure"),
        ).toHaveLength(6);
    }
  });

  it("keeps the three-phase motor port anchors and separates the leads from the face", () => {
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
    for (const [index, lead] of leads.entries()) {
      if (lead?.kind !== "polyline") continue;
      expect(lead.points[0]).toEqual(anchors[index]);
      const clearance = lead.points.slice(1).map((to, pointIndex) => {
        const from = lead.points[pointIndex]!;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const fx = from.x - circle.center.x;
        const fy = from.y - circle.center.y;
        const t = Math.min(
          1,
          Math.max(0, -(fx * dx + fy * dy) / (dx * dx + dy * dy)),
        );
        return Math.hypot(fx + t * dx, fy + t * dy) - circle.radius;
      });
      expect(Math.min(...clearance)).toBeGreaterThanOrEqual(2.8);
      expect(Math.min(...clearance)).toBeLessThanOrEqual(3);
    }
  });

  it.each(["ais:motor", "ais:lamp"] as const)(
    "leaves an ink gap at both poles of %s in both flows",
    (id) => {
      const symbol = SYMBOL_CATALOG.find((definition) => definition.id === id)!;
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const { primitives } = orientSymbolDefinition(symbol, flow);
        const [first, second, face] = [
          primitives[1],
          primitives[3],
          primitives[4],
        ];
        if (
          first?.kind !== "line" ||
          second?.kind !== "line" ||
          face?.kind !== "circle"
        )
          throw Error("Expected two lead tips and a circular face.");
        expect(first.to.x + second.to.x).toBe(2 * face.center.x);
        expect(first.to.y + second.to.y).toBe(2 * face.center.y);
        for (const { to } of [first, second])
          expect(
            Math.hypot(to.x - face.center.x, to.y - face.center.y) -
              face.radius,
          ).toBe(3);
      }
    },
  );

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
      y: 11,
      width: 32,
      height: 27,
      radius: 2,
      style: "body",
    });
    expectDeepFrozen(horizontal);
    expectDeepFrozen(vertical);
  });

  it("rotates points and asymmetric arc radii exactly clockwise", () => {
    const coil = SYMBOL_CATALOG.find(({ id }) => id === "ais:coil")!;
    const synthetic = {
      ...coil,
      primitives: [
        ...coil.primitives,
        {
          kind: "arc" as const,
          from: { x: 12, y: 12 },
          to: { x: 20, y: 12 },
          radiusX: 4,
          radiusY: 6,
          clockwise: true,
          style: "operator" as const,
        },
      ],
    };
    const vertical = orientSymbolDefinition(synthetic, "top-to-bottom");
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

  it.each([
    ["ais:power-source-3ph", ["L1", "L2", "L3", "PE"], "south"],
    ["ais:power-source-3wire", ["L1", "L2", "L3"], "south"],
    ["ais:motor-3ph", ["U", "V", "W", "PE"], "north"],
    ["ais:motor-3ph-unbonded", ["U", "V", "W"], "north"],
  ] as const)(
    "preserves physical phase lanes and glyph landings for %s",
    (id, ids, side) => {
      const original = SYMBOL_CATALOG.find((s) => s.id === id)!;
      expect(orientSymbolDefinition(original, "left-to-right")).toEqual(
        original,
      );
      const vertical = orientSymbolDefinition(original, "top-to-bottom");
      expect(vertical.ports.map((p) => p.id)).toEqual(ids);
      for (const [i, port] of vertical.ports.entries()) {
        expect(port).toEqual({ ...original.ports[i], side });
        const landing = {
          x: port.offset * vertical.size.width,
          y: side === "north" ? 0 : vertical.size.height,
        };
        // Physical ink reaches the port; reversing captions alone cannot pass.
        expect(
          vertical.primitives.some((p) =>
            p.kind === "line"
              ? [p.from, p.to].some(
                  (v) => v.x === landing.x && v.y === landing.y,
                )
              : p.kind === "polyline" &&
                p.points.some((v) => v.x === landing.x && v.y === landing.y),
          ),
        ).toBe(true);
      }
      expectDeepFrozen(vertical);
    },
  );

  it("keeps presentation ports aligned with catalog geometry for every symbol and flow", () => {
    for (const symbol of SYMBOL_CATALOG) {
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const oriented = orientSymbolDefinition(symbol, flow);
        expect(
          symbol.ports.map((p) => ({
            ...p,
            ...orientedSide(p.side, p.offset, flow, symbol.id),
          })),
        ).toEqual(oriented.ports);
      }
    }
    // Other multi-port and asymmetric symbols keep their original handedness.
    for (const id of [
      "ais:power-source-dc",
      "ais:dc-load",
      "ais:switch-sensor-pnp",
    ] as const) {
      const symbol = SYMBOL_CATALOG.find((s) => s.id === id)!;
      expect(
        orientSymbolDefinition(symbol, "top-to-bottom").ports[0]!.offset,
      ).toBe(1 - symbol.ports[0]!.offset);
    }
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
          .primitives.find(({ kind }) => kind === "rect")!.radius = 13),
    ],
    [
      "invalid arc radii",
      (catalog: SymbolDefinition[]) =>
        catalog
          .find((s) => s.id === "ais:coil")!
          .primitives.push({
            kind: "arc",
            from: { x: 12, y: 12 },
            to: { x: 20, y: 12 },
            radiusX: 0,
            radiusY: 6,
            clockwise: true,
            style: "operator",
          }),
    ],
    [
      "illegal offsets",
      (catalog: SymbolDefinition[]) => (catalog[0]!.ports[0]!.offset = 1 / 3),
    ],
    [
      "insufficient polyline points",
      (catalog: SymbolDefinition[]) =>
        (catalog
          .find(({ id }) => id === "ais:motor-3ph")!
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
