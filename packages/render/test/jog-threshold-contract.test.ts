import { expect, it } from "vitest";
import * as renderer from "../src/packet/route-fragments.js";
import { JOG_NUMERICAL_TOLERANCE_MM } from "../../../evals/draw/checks.mjs";
import { interiorJogs } from "../src/packet/rooted-ink.js";
import { sideCandidate } from "./helpers/side-candidate.js";
import { required } from "../src/presentation/util.js";

it("binds the renderer's named jog epsilon to CHECK's exported constant", () => {
  expect(renderer).toHaveProperty(
    "JOG_NUMERICAL_TOLERANCE_MM",
    JOG_NUMERICAL_TOLERANCE_MM,
  );
});
it.each([
  [3, 0],
  [2.999999, 0],
  [2.99999, 0],
  [2.999989, 1],
  [2.9, 1],
] as const)(
  "uses the documented physical jog threshold at %s mm",
  (length, expected) => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: length },
      { x: 20, y: length },
    ];
    expect(renderer.fragmentDefects(points, 1).jogs).toHaveLength(expected);
    const c = sideCandidate(1);
    const edge = required(c.prepared.layout.edges[0], "Fixture edge");
    const prepared = {
      ...c.prepared,
      layout: {
        ...c.prepared.layout,
        edges: c.prepared.layout.edges.map((e) =>
          e === edge ? { ...e, points } : e,
        ),
      },
    };
    expect(interiorJogs(prepared, 1).get("wire")).toBe(expected);
  },
);
