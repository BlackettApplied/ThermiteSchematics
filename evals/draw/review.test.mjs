import { it, expect } from "vitest";
import * as c from "./checks.mjs";
const b = (x, y, w = 3, h = 2) => ({ x, y, w, h });
const text = (extra = {}) => ({
  element: "text-1",
  text: "K1",
  bbox: b(20, 20),
  painted: true,
  ...extra,
});
const g = (extra = {}) => ({
  width: 100,
  height: 80,
  texts: [],
  shapes: [],
  terminals: [],
  devices: [],
  ...extra,
});
it("uses supplied ink bounds and frame bounds, retaining lost/offsheet text", () => {
  expect(
    c.textBounds(
      g({
        texts: [
          text({ emBbox: b(20, 19, 3, 3) }),
          text({ element: "text-2", text: "T1", bbox: b(20, 22.7) }),
        ],
      }),
    ),
  ).toEqual([]);
  expect(
    c
      .textBounds(
        g({ frame: b(10, 10, 80, 60), texts: [text({ bbox: b(1, 20) })] }),
      )
      .map((f) => f.kind),
  ).toContain("text-outside-frame");
  expect(
    c
      .textBounds(g({ texts: [text({ bbox: b(600, 20), painted: false })] }))
      .map((f) => f.kind),
  ).toContain("text-outside-sheet");
  expect(
    c
      .textBounds(
        g({ texts: [text({ painted: false, viewport: b(10, 10, 10, 10) })] }),
      )
      .map((f) => f.kind),
  ).toContain("text-outside-viewport");
});
it("detects small and squeezed text but accepts uniform scaling and natural glyphs", () => {
  expect(
    c.legibility(g({ texts: [text({ capHeightMm: 2.6, advanceRatio: 1 })] })),
  ).toEqual([]);
  expect(
    c
      .legibility(
        g({
          texts: [text({ fontSize: 2.4, capHeightMm: 2.4, advanceRatio: 0.5 })],
        }),
      )
      .map((f) => f.kind),
  ).toEqual(["text-below-minimum-em", "distorted-glyphs"]);
});
it("derives zones from printed grid geometry rather than exported zones", () => {
  const ts = [
    ...Array.from({ length: 6 }, (_, i) =>
      text({
        text: String(i + 1),
        anchor: { x: 15 + 10 * i, y: 5 },
        bbox: b(14 + 10 * i, 4),
      }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      text({
        text: "ABCD"[i],
        anchor: { x: 3, y: 20 + 10 * i },
        bbox: b(2, 19 + 10 * i),
      }),
    ),
  ];
  const geom = g({
    texts: ts,
    devices: [{ deviceUid: "d1", bbox: b(58, 43, 4, 4) }],
  });
  expect(c.zoneAt(geom, { x: 60, y: 45 })).toBe("D6");
  expect(
    c
      .zones(geom, [{ deviceUid: "d1", designation: "D1", zone: "A1" }])
      .some((f) => f.kind === "wrong-reference-zone"),
  ).toBe(true);
});
it("detects foreign body penetration and ink over a wire, keeping terminal entry and wire crossings clean", () => {
  const body = {
    element: "symbol",
    symbol: "coil",
    deviceUid: "d",
    bbox: b(40, 30, 10, 10),
    points: [
      { x: 40, y: 30 },
      { x: 50, y: 30 },
      { x: 50, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 30 },
    ],
    stroke: 0.2,
    fill: "none",
  };
  const wire = (points) => ({
    element: "wire",
    conductor: true,
    stroke: 0.3,
    points,
  });
  expect(
    c
      .conductorInterference(
        g({
          shapes: [
            body,
            wire([
              { x: 35, y: 35 },
              { x: 55, y: 35 },
            ]),
          ],
        }),
      )
      .map((f) => f.kind),
  ).toContain("conductor-through-symbol");
  expect(
    c.conductorInterference(
      g({
        shapes: [
          body,
          wire([
            { x: 30, y: 35 },
            { x: 40, y: 35 },
          ]),
        ],
        terminals: [{ point: { x: 40, y: 35 }, deviceUid: "d" }],
      }),
    ),
  ).toEqual([]);
  expect(
    c.conductorInterference(
      g({
        shapes: [
          wire([
            { x: 10, y: 20 },
            { x: 30, y: 20 },
          ]),
          wire([
            { x: 20, y: 10 },
            { x: 20, y: 30 },
          ]),
        ],
      }),
    ),
  ).toEqual([]);
  expect(
    c
      .conductorInterference(
        g({
          shapes: [
            wire([
              { x: 10, y: 21 },
              { x: 30, y: 21 },
            ]),
          ],
          texts: [text()],
        }),
      )
      .map((f) => f.kind),
  ).toContain("text-across-conductor");
});
it("sheet-level findings have no invented box and finding kinds cannot be overwritten", () => {
  expect(c.zones(g(), [])[0].bbox).toBeUndefined();
  expect(
    c.reports(g({ reportRows: ["row"] }), { view: { kind: "wires" } }, {})[0]
      .kind,
  ).toBe("wire-schedule-without-sheet-zones");
});

it("detects the portable soft-mask label-loss construct using only PDF operator geometry", async () => {
  const { maskLossRegions } = await import("./pdf-operators.mjs");
  const ops = {
    save: 1,
    restore: 2,
    transform: 3,
    setFont: 4,
    setTextMatrix: 5,
    setGState: 6,
    showText: 7,
  };
  const list = {
    fnArray: [3, 4, 5, 6, 7],
    argsArray: [
      [0.25, 0, 0, 0.25, 0, 0],
      ["font", 10],
      [new Float32Array([1, 0, 0, 1, 1100, 50])],
      [[["SMask", true]]],
      [[{ unicode: "X", width: 600 }]],
    ],
  };
  expect(
    maskLossRegions(list, ops, [0, 0, 1000, 700], [1, 0, 0, 1, 0, 0]),
  ).toHaveLength(1);
  list.argsArray[3] = [[["SMask", false]]];
  expect(
    maskLossRegions(list, ops, [0, 0, 1000, 700], [1, 0, 0, 1, 0, 0]),
  ).toEqual([]);
});

it("does not excuse a foreign conductor crossing a port in the middle of its route", () => {
  const body = {
    element: "pole",
    symbol: "breaker",
    deviceUid: "cb",
    bbox: b(40, 30, 10, 10),
    points: [
      { x: 40, y: 35 },
      { x: 50, y: 35 },
    ],
    stroke: 0.2,
  };
  const wire = {
    element: "foreign",
    conductor: true,
    stroke: 0.3,
    points: [
      { x: 40, y: 20 },
      { x: 40, y: 50 },
    ],
  };
  expect(
    c
      .conductorInterference(
        g({
          shapes: [wire, body],
          terminals: [
            { deviceUid: "cb", terminal: "L1", point: { x: 40, y: 35 } },
          ],
        }),
      )
      .some((f) => f.kind === "conductor-through-symbol"),
  ).toBe(true);
});

it("checks a continuation's destination zone against the peer connector geometry", () => {
  const top = Array.from({ length: 6 }, (_, i) =>
      text({
        text: String(i + 1),
        anchor: { x: 15 + 10 * i, y: 5 },
        bbox: b(14 + 10 * i, 4),
      }),
    ),
    left = Array.from({ length: 4 }, (_, i) =>
      text({
        text: "ABCD"[i],
        anchor: { x: 3, y: 20 + 10 * i },
        bbox: b(2, 19 + 10 * i),
      }),
    );
  const peer = g({
    texts: [...top, ...left],
    connectors: [{ id: "C1", toSheet: 1, anchor: { x: 58, y: 48 } }],
  });
  const sheets = [
    {
      number: 1,
      continuations: [{ id: "C1", toSheet: 2, conductor: "W1", netId: "N" }],
    },
    {
      number: 2,
      continuations: [{ id: "C1", toSheet: 1, conductor: "W1", netId: "N" }],
    },
  ];
  expect(
    c.continuations(
      sheets[0],
      { sheets },
      g({ texts: [text({ text: "C1 / 02.A1 W1" })] }),
      [g(), peer],
    )[0].missing,
  ).toContain("printed destination zone");
  expect(
    c.continuations(
      sheets[0],
      { sheets },
      g({ texts: [text({ text: "C1 / 02.D5 W1" })] }),
      [g(), peer],
    ),
  ).toEqual([]);
});

it("excludes mechanical enclosures, symbolic terminal circles, and own-wire labels", () => {
  const wire = {
    element: "wire",
    wire: "w",
    conductor: true,
    points: [
      { x: 10, y: 21 },
      { x: 30, y: 21 },
    ],
    stroke: 0.3,
  };
  const boundary = {
    element: "boundary",
    mark: "source",
    outline: true,
    bbox: b(20, 15, 10, 10),
    points: [
      { x: 20, y: 15 },
      { x: 20, y: 25 },
    ],
  };
  const terminal = { ...boundary, outline: false, cls: "symbol-terminal" };
  expect(
    c.conductorInterference(
      g({
        shapes: [wire, boundary, terminal],
        texts: [text({ knockout: true, wire: "w" })],
      }),
    ),
  ).toEqual([]);
});

it("ignores a route's hidden continuation beyond its viewport", () => {
  const wire = {
    element: "wire",
    conductor: true,
    points: [
      { x: 10, y: 21 },
      { x: 40, y: 21 },
    ],
    stroke: 0.3,
    viewport: b(10, 10, 5, 30),
  };
  expect(
    c.conductorInterference(g({ shapes: [wire], texts: [text()] })),
  ).toEqual([]);
});

it("measures wire-label separation from ink rather than the bbox centre", () => {
  const route = {
    conductor: true,
    wire: "w",
    points: [
      { x: 0, y: 20 },
      { x: 30, y: 20 },
    ],
  };
  expect(
    c.wirePlacement(
      g({
        shapes: [route],
        texts: [text({ wire: "w", bbox: b(10, 17, 3, 2) })],
      }),
    ),
  ).toEqual([]);
  expect(
    c.wirePlacement(
      g({
        shapes: [route],
        texts: [text({ wire: "w", bbox: b(10, 14, 3, 2) })],
      }),
    )[0].ownDistanceMm,
  ).toBe(4);
});

it("includes electrical function-interface leads when checking text ink", () => {
  expect(
    c
      .conductorInterference(
        g({
          texts: [text()],
          shapes: [
            {
              element: "lead",
              lead: true,
              points: [
                { x: 21, y: 10 },
                { x: 21, y: 30 },
              ],
              stroke: 0.35,
            },
          ],
        }),
      )
      .map((f) => f.kind),
  ).toContain("text-across-conductor");
});

it("detects a route through independent ports even if open contact strokes are missed", () => {
  const ports = [
    {
      element: "p1",
      deviceUid: "cb",
      terminal: "L1",
      point: { x: 40, y: 30 },
      bbox: b(39.5, 29.5, 1, 1),
      net: "n1",
    },
    {
      element: "p2",
      deviceUid: "cb",
      terminal: "L2",
      point: { x: 40, y: 40 },
      bbox: b(39.5, 39.5, 1, 1),
      net: "n2",
    },
  ];
  const route = {
    element: "route",
    conductor: true,
    points: [
      { x: 40, y: 20 },
      { x: 40, y: 50 },
    ],
  };
  expect(
    c.conductorInterference(g({ shapes: [route], terminals: ports })),
  ).toHaveLength(2);
  expect(
    c.conductorInterference(
      g({
        shapes: [{ ...route, net: "n1" }],
        terminals: ports.map((t) => ({ ...t, net: "n1" })),
      }),
    ),
  ).toEqual([]);
  expect(
    c.conductorInterference(
      g({
        shapes: [
          {
            ...route,
            points: [
              { x: 40, y: 20 },
              { x: 40, y: 30 },
            ],
          },
        ],
        terminals: [ports[0]],
      }),
    ),
  ).toEqual([]);
});
