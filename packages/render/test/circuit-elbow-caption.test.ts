import { beforeAll, expect, it } from "vitest";
import { captionHostWitness } from "./helpers/circuit-caption-host.js";
import { circuitCaptionPlacement } from "../src/circuit/caption-placement.js";
import { circuitCaptionPlate } from "../src/circuit/inline-plate.js";
import type { CircuitLabelState } from "../src/circuit/layout-routes.js";
let native: CircuitLabelState;
beforeAll(async () => {
  [, , , native] = await captionHostWitness();
});
const label = { index: 0, x: 10, y: 10, width: 12, height: 3.8, text: "103" };
function fixture(points: readonly { x: number; y: number }[]) {
  return {
    ...native,
    cs: native.cs.slice(0, 1).map((c) => ({ ...c, jumper: false })),
    labels: [label],
    routes: [{ index: 0, points: [...points] }],
    segments: points
      .slice(1)
      .map((b, i) => ({ index: 0, a: points[i] ?? b, b })),
    graph: { id: "plate-host", width: 50, height: 40, children: [], edges: [] },
  };
}
it("keeps an elbow outside the paint when only the reservation reaches it", () => {
  const state = fixture([
    { x: 0, y: 11.9 },
    { x: 21.5, y: 11.9 },
    { x: 21.5, y: 30 },
  ]);
  const p = circuitCaptionPlacement("103", 0, label, state);
  expect(p).toBeDefined();
  const plate = circuitCaptionPlate(label, state, p ? [p.ink] : []);
  expect(plate).toBeDefined();
  if (!plate || !p) throw Error("Expected measured plate");
  expect(plate.x + plate.width).toBeGreaterThan(p.ink.right);
  expect(21.5 - plate.x - plate.width).toBeGreaterThanOrEqual(0.35);
});

it("rejects a bend with less than a stroke of ink outside even the tight plate", () => {
  const state = fixture([
    { x: 0, y: 11.9 },
    { x: 18.4, y: 11.9 },
    { x: 18.4, y: 30 },
  ]);
  expect(circuitCaptionPlacement("103", 0, label, state)).toBeUndefined();
});

it("keeps a valid straight inline plate", () => {
  const state = fixture([
    { x: 0, y: 11.9 },
    { x: 35, y: 11.9 },
  ]);
  expect(
    circuitCaptionPlacement("103", 0, label, state)?.points,
  ).toBeUndefined();
  expect(circuitCaptionPlacement("103", 0, label, state)).toBeDefined();
});

it("shrinks plate padding clear of a foreign stroke past its edge", () => {
  const state = fixture([
    { x: 0, y: 11.9 },
    { x: 35, y: 11.9 },
  ]);
  state.segments.push({
    index: 1,
    a: { x: 22.04, y: 0 },
    b: { x: 22.04, y: 30 },
  });
  const plate = circuitCaptionPlate(label, state);
  expect(plate).toBeDefined();
  if (!plate) throw Error("Expected measured plate");
  expect(plate.x + plate.width).toBeLessThan(22.04 - 0.16);
});
it("leaves at least the painted plate height outside the terminal ring", () => {
  const clear = fixture([
    { x: 6, y: 11.9 },
    { x: 35, y: 11.9 },
  ]);
  const hidden = fixture([
    { x: 11, y: 11.9 },
    { x: 35, y: 11.9 },
  ]);
  expect(circuitCaptionPlacement("103", 0, label, clear)).toBeDefined();
  const plate = circuitCaptionPlate(label, clear);
  expect(plate).toBeDefined();
  if (!plate) throw Error("Expected measured plate");
  expect(plate.x - 6 - 0.8).toBeGreaterThanOrEqual(Math.max(2, plate.height));
  expect(circuitCaptionPlacement("103", 0, label, hidden)).toBeUndefined();
});

it("keeps a straight vertical plate but exposes a terminal hidden in its top margin", () => {
  const clear = fixture([
    { x: 16, y: 0 },
    { x: 16, y: 30 },
  ]);
  const hidden = fixture([
    { x: 16, y: 10.5 },
    { x: 16, y: 30 },
  ]);
  expect(circuitCaptionPlacement("103", 0, label, clear)).toBeDefined();
  expect(circuitCaptionPlacement("103", 0, label, hidden)).toBeUndefined();
});
it("does not hide a second owned leg behind an otherwise valid straight host", () => {
  const state = fixture([
    { x: 0, y: 11.9 },
    { x: 35, y: 11.9 },
    { x: 35, y: 30 },
    { x: 16, y: 30 },
    { x: 16, y: 0 },
  ]);
  expect(circuitCaptionPlacement("103", 0, label, state)).toBeUndefined();
});
