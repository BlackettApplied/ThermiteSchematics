import { expect, it } from "vitest";
import { ir4, geometry4, wire4, end, box } from "./tranche4-fixtures.mjs";
import { junctionRayAudit } from "./junction-rays-oracle.mjs";
function junctionFixture(n = 3) {
  const ir = ir4(),
    g = geometry4(),
    p = { x: 40, y: 40 };
  for (let i = 0; i < n; i++) {
    const w = wire4("W" + i, "" + i, [end("D"), end("E", "T" + i)]);
    ir.wires.push(w);
    const q =
      i === 0
        ? { x: 20, y: 40 }
        : i === 1
          ? { x: 60, y: 40 }
          : { x: 40, y: 60 };
    const s = {
      element: w.uid,
      wire: w.uid,
      conductor: true,
      endpoints: w.endpoints.map((e) => e.terminal),
      appearanceScope: "one",
      stroke: 0.4,
    };
    g.shapes.push(s);
    g.tranche3.routeInk[s.element] = [[p, q]];
  }
  g.tranche4.markers = [
    {
      element: "dot",
      deviceUid: "D",
      terminal: "T",
      appearanceScope: "one",
      filled: true,
      painted: true,
      point: p,
      bbox: box(39.35, 39.35, 1.3, 1.3),
    },
  ];
  return { ir, g };
}
it("N14 positive: real native three-way painted rays authorize filled marker", () => {
  const x = junctionFixture();
  expect(junctionRayAudit(x.g, x.ir).findings).toEqual([]);
  expect(junctionRayAudit(x.g, x.ir).measurements[0].rays).toHaveLength(3);
});
it.each([1, 2])("N14 mutation killed: filled ordinary %s-ray endpoint", (n) => {
  const x = junctionFixture(n);
  expect(junctionRayAudit(x.g, x.ir).findings.map((f) => f.kind)).toContain(
    "filled-endpoint-without-three-native-rays",
  );
  x.g.tranche4.markers[0].filled = false;
  expect(junctionRayAudit(x.g, x.ir).findings).toEqual([]);
});
it.each([
  ["hidden route", (x) => delete x.g.tranche3.routeInk.W2],
  ["erased route", (x) => (x.g.tranche3.routeInk.W2 = [])],
  ["wrong native route owner", (x) => (x.g.shapes[2].wire = "FOREIGN")],
  [
    "foreign endpoints",
    (x) => (x.g.shapes[2].endpoints = [end("E"), end("FOREIGN")]),
  ],
  [
    "duplicate ray",
    (x) => (x.g.tranche3.routeInk.W2 = x.g.tranche3.routeInk.W1),
  ],
  ["foreign terminal", (x) => (x.g.tranche4.markers[0].terminal = "WRONG")],
  ["missing geometry", (x) => delete x.g.tranche4],
  ["missing source", (x) => delete x.ir.wires],
])("N14 mutation killed: %s", (_name, mutate) => {
  const x = junctionFixture();
  expect(junctionRayAudit(x.g, x.ir).findings).toEqual([]);
  mutate(x);
  expect(junctionRayAudit(x.g, x.ir).findings.length).toBeGreaterThan(0);
});
it("N14 positive and mutation: native terminal attachment contributes a ray; wrong owner does not", () => {
  const x = junctionFixture(2),
    s = {
      element: "lead",
      deviceUid: "D",
      attachment: JSON.stringify(["D", "T"]),
      appearanceScope: "one",
      stroke: 0.4,
      inkSegments: [
        [
          { x: 40, y: 40 },
          { x: 40, y: 60 },
        ],
      ],
    };
  x.g.shapes.push(s);
  expect(junctionRayAudit(x.g, x.ir).findings).toEqual([]);
  s.attachment = JSON.stringify(["E", "T"]);
  expect(junctionRayAudit(x.g, x.ir).findings.length).toBeGreaterThan(0);
});

it("N14 mutation killed: a forged coincident terminal cannot authorize three unrelated native rays", () => {
  const x = junctionFixture(),
    m = x.g.tranche4.markers[0];
  delete m.terminal;
  x.g.terminals = [{ ...m, deviceUid: "FOREIGN", terminal: "T" }];
  expect(junctionRayAudit(x.g, x.ir).findings.map((f) => f.kind)).toContain(
    "filled-junction-native-node-unavailable",
  );
});
