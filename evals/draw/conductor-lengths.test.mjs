import { expect, it } from "vitest";
import { conductorLengths, clipParameters } from "./conductor-lengths.mjs";
const ir = { wires: [{ uid: "w", designation: "W1" }], jumpers: [] };
const packet = { sheets: [{ number: 1, view: { title: "Routes" } }] };
const shape = (routePath, extra = {}) => ({
  conductor: true,
  wire: "w",
  routePath,
  routeMatrix: [1, 0, 0, 1, 0, 0],
  navigationView: "view1",
  ...extra,
});
const measure = (shapes, reference) =>
  conductorLengths(packet, [{ shapes }], ir, reference);
it("Q5 per-conductor length and bends compare with that conductor's own reference without a fail status", () => {
  const reference = measure([shape("M0 0 H100")]);
  expect(reference.conductors[0]).toMatchObject({
    lengthMm: 100,
    bends: 0,
    comparison: "no-reference",
  });
  const same = measure([shape("M0 0 H100")], reference.conductors);
  expect(same.conductors[0]).toMatchObject({
    deltaLengthMm: 0,
    deltaBends: 0,
    comparison: "paired",
  });
  const changed = measure([shape("M0 0 H50 V20 H100")], reference.conductors);
  expect(changed.conductors[0]).toMatchObject({
    lengthMm: 120,
    bends: 2,
    referenceLengthMm: 100,
    deltaLengthMm: 20,
    deltaBends: 2,
  });
  expect(changed.reportOnly).toBe(true);
  expect(changed).not.toHaveProperty("status");
  expect(changed.conductors[0]).not.toHaveProperty("status");
});
it("Q5 transforms, clips and unions tiled copies without counting invisible bends or duplicate route length", () => {
  const route = shape("M0 0 H100 V100", {
    routeMatrix: [0.5, 0, 0, 0.5, 20, 30],
    viewport: { x: 20, y: 30, w: 25, h: 50 },
  });
  expect(measure([route]).conductors[0]).toMatchObject({
    lengthMm: 25,
    bends: 0,
  });
  const other = { ...route, viewport: { x: 45, y: 30, w: 25, h: 50 } };
  expect(measure([route, other, other]).conductors[0]).toMatchObject({
    lengthMm: 100,
    bends: 1,
  });
  expect(
    clipParameters({ x: 0, y: 0 }, { x: 100, y: 0 }, [
      { x: 10, y: -10, w: 20, h: 20 },
    ]),
  ).toEqual([0.1, 0.3]);
});
it("Q5 discloses missing native ownership and unsupported curved/masked routes, never invents measurements", () => {
  const result = measure([
    shape("M0 0 C10 0 10 10 20 10"),
    shape("M0 0 H10", { wire: "forged" }),
    shape("M0 0 H10", { clips: null }),
  ]);
  expect(result.conductors).toEqual([]);
  expect(result.measurementGaps).toHaveLength(3);
});
it("Q5 preserves wire/jumper/core identity and reports added/removed reference conductors", () => {
  const native = {
    ...ir,
    jumpers: [{ uid: "j", designation: "J1" }],
    cables: [{ uid: "c", designation: "C1" }],
    cableConductors: [{ id: { cableUid: "c", conductorId: "1" } }],
  };
  const rows = conductorLengths(
    packet,
    [
      {
        shapes: [
          shape("M0 0 H10", { edgeOwnerKey: ["jumper", "j"] }),
          shape("M0 0 H20", { edgeOwnerKey: ["cable_conductor", "c", "1"] }),
        ],
      },
    ],
    native,
  ).conductors;
  expect(rows.map((r) => r.source[0]).sort()).toEqual(["core", "jumper"]);
  const removed = measure([], rows);
  expect(removed.removed).toHaveLength(2);
});
it.each(["core", "cable_conductor", "cable-conductor"])(
  "Q5 resolves native cable/core edge spelling %s",
  (kind) => {
    const native = {
      ...ir,
      cables: [{ uid: "c", designation: "C1" }],
      cableConductors: [{ id: { cableUid: "c", conductorId: "1+" } }],
    };
    const result = conductorLengths(
      packet,
      [{ shapes: [shape("M0 0 H20", { edgeOwnerKey: [kind, "c", "1+"] })] }],
      native,
    );
    expect(result.measurementGaps).toEqual([]);
    expect(result.conductors[0]).toMatchObject({
      source: ["core", "c", "1+"],
      lengthMm: 20,
    });
  },
);
