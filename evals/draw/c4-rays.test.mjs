import { expect, it } from "vitest";
import { mergeRayAngles } from "./ray-directions.mjs";
import { junctionRayAudit } from "./junction-rays-oracle.mjs";
import { geometry4, ir4, wire4, end, box } from "./tranche4-fixtures.mjs";
it.each([
  [4.9, 5.1, 180],
  [354.9, 355.1, 180],
  [359, 1, 180],
])("N14 merges split direction %j", (...angles) => {
  expect(mergeRayAngles(angles)).toHaveLength(2);
  expect(mergeRayAngles(angles.slice().reverse())).toEqual(
    mergeRayAngles(angles),
  );
});
it("N14 positive: three separated directions remain distinct", () =>
  expect(mergeRayAngles([0, 90, 180])).toEqual([0, 90, 180]));
it("N14 mutation killed: 4.9 and 5.1 degrees cannot authorize a two-way dot", () => {
  const ir = ir4(),
    g = geometry4(),
    p = { x: 40, y: 40 };
  for (const [i, angle] of [4.9, 5.1, 180].entries()) {
    const w = wire4(String(i), String(i), [end("D"), end("E")]);
    ir.wires.push(w);
    g.shapes.push({
      element: w.uid,
      wire: w.uid,
      conductor: true,
      endpoints: w.endpoints.map((e) => e.terminal),
      appearanceScope: "one",
      stroke: 0.4,
    });
    g.tranche3.routeInk[w.uid] = [
      [
        p,
        {
          x: p.x + 20 * Math.cos((angle * Math.PI) / 180),
          y: p.y + 20 * Math.sin((angle * Math.PI) / 180),
        },
      ],
    ];
  }
  const t = {
    element: "native-terminal",
    deviceUid: "D",
    terminal: "T",
    point: p,
    bbox: box(39.35, 39.35, 1.3, 1.3),
    appearanceScope: "one",
  };
  g.terminals = [t];
  g.tranche4.markers = [
    {
      ...t,
      deviceUid: undefined,
      terminal: undefined,
      filled: true,
      painted: true,
    },
  ];
  const a = junctionRayAudit(g, ir);
  expect(a.findings).toHaveLength(1);
  expect(a.findings[0]).toMatchObject({
    incidentRays: 2,
    nativeTerminal: { deviceUid: "D", terminalKey: "T" },
    designation: "D",
  });
});
it("N14 evidence labels cannot collide for the reviewer's 267.5/273.7/277.6 probe", () => {
  const rays = mergeRayAngles([267.5, 273.7, 277.6]);
  expect(rays).toHaveLength(2);
  expect(new Set(rays).size).toBe(2);
  expect(rays).toEqual(mergeRayAngles([277.6, 267.5, 273.7]));
  expect(mergeRayAngles([45])).toEqual([45]);
});
it("N14 retains the inclusive ten-degree uncertainty without changing direction counts", () => {
  expect(mergeRayAngles([0, 10])).toHaveLength(1);
  expect(mergeRayAngles([0, 10.01])).toHaveLength(2);
});
