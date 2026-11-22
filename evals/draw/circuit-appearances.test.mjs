import { expect, it } from "vitest";
import { fullCircuitAppearances } from "./circuit-appearances.mjs";
const terminal = (terminalKey) => ({ deviceUid: "k", terminalKey });
function fixture() {
  const ends = ["A1", "A2"].map((t) => [
    terminal(t),
    { deviceUid: "peer", terminalKey: "1" },
  ]);
  const ir = {
    functions: [
      {
        id: { deviceUid: "k", functionKey: "coil" },
        terminals: [terminal("A1"), terminal("A2")],
      },
    ],
    wires: [
      {
        uid: "a",
        designation: "W1",
        endpoints: ends[0].map((terminal) => ({ terminal })),
      },
      {
        uid: "z",
        designation: "W2",
        endpoints: ends[1].map((terminal) => ({ terminal })),
      },
    ],
  };
  const request = {
    views: [
      {
        format: "circuit-view-request/0.1",
        groups: [
          {
            id: "g",
            functions: [{ device: { by: "uid", value: "k" }, key: "coil" }],
            conductors: ["W1", "W2"],
          },
        ],
      },
    ],
  };
  const appearances = [0, 1].map((i) => ({
    uid: "k",
    functionKey: "coil",
    view: 0,
    circuitGroup: "g",
    geometryIndex: i,
    sheet: i + 1,
    ports: [
      { terminal: "A1", point: { x: 30, y: 40 } },
      { terminal: "A2", point: { x: 40, y: 40 } },
    ],
  }));
  const geometries = [0, 1].map((i) => ({
    shapes: [
      {
        conductor: true,
        circuitGroup: "g",
        wire: i ? "z" : "a",
        endpoints: ends[i],
        points: [
          { x: 30 + 10 * i, y: 40 },
          { x: 0, y: 40 },
        ],
      },
    ],
  }));
  return { ir, request, appearances, geometries };
}
const full = (f) =>
  fullCircuitAppearances(f.appearances, f.geometries, f.ir, f.request);
it("native selected endpoint units explain whole-wire circuit copies without reading export roles", () => {
  const f = fixture();
  expect(full(f).map((a) => a.sheet)).toEqual([1]);
  f.appearances[0].role = "boundary-fragment";
  f.appearances[1].role = "full-function";
  expect(full(f).map((a) => a.sheet)).toEqual([1]);
  // The stable native source unit, rather than final page order, owns full status.
  [f.geometries[0], f.geometries[1]] = [f.geometries[1], f.geometries[0]];
  expect(full(f).map((a) => a.sheet)).toEqual([2]);
});
it.each(["source", "landing", "ends", "primary"])(
  "forged circuit context %s cannot erase a full obligation",
  (kind) => {
    const f = fixture();
    if (kind === "source") f.geometries[1].shapes[0].wire = "forged";
    if (kind === "landing") f.geometries[1].shapes[0].points[0].x = 150;
    if (kind === "ends")
      f.geometries[1].shapes[0].endpoints = [
        terminal("A2"),
        { deviceUid: "peer", terminalKey: "forged" },
      ];
    if (kind === "primary") f.geometries[0].shapes = [];
    expect(full(f)).toHaveLength(2);
  },
);
it("different authored circuit groups remain distinct full placements", () => {
  const f = fixture();
  f.request.views[0].groups.push({
    ...f.request.views[0].groups[0],
    id: "other",
  });
  f.appearances[1].circuitGroup = "other";
  expect(full(f)).toHaveLength(2);
});
it("circuit context resolves authored cable/core selectors to native core endpoint identity", () => {
  const f = fixture(),
    id = { cableUid: "cable", conductorId: "1" };
  f.ir.cables = [{ uid: "cable", designation: "CBL1" }];
  f.ir.cableConductors = [{ id, endpoints: f.ir.wires[1].endpoints }];
  f.ir.wires.pop();
  f.request.views[0].groups[0].conductors = ["W1", "CBL1/1"];
  f.geometries[1].shapes[0].wire = JSON.stringify(id);
  expect(full(f).map((a) => a.sheet)).toEqual([1]);
});
