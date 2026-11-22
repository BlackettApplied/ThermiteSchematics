import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  composedCircuitMark,
  circuitMarkSegments,
  type CircuitMark,
} from "../src/symbols/circuit-mark.js";
import { paintedShape } from "./circuit-fidelity-oracle.js";

const rounded = (n: number) => Number(n.toFixed(3));
function ink(mark: CircuitMark, vertical: boolean) {
  const root = parseHTML(
    `<svg>${composedCircuitMark(mark, 40, 60, vertical)}</svg>`,
  ).document.querySelector("svg");
  if (!root) throw new Error("missing SVG");
  const body = root.querySelector("rect");
  if (!body) throw new Error("missing body");
  const strokes = [...root.querySelectorAll("line,polyline")].map((e) =>
    paintedShape(root, e).points.map((p) => [
      rounded(p.x - 40),
      rounded(p.y - 60),
    ]),
  );
  return { root, body: paintedShape(root, body).points, strokes };
}
it.each([false, true])(
  "keeps the AC waveform upright and centred, vertical=%s",
  (vertical) => {
    const drawing = ink("ac-input", vertical);
    expect(drawing.strokes).toEqual([
      [
        [-2.667, 0],
        [-2, -1.333],
        [-1.333, -2],
        [-0.667, -1.333],
        [0.667, 1.333],
        [1.333, 2],
        [2, 1.333],
        [2.667, 0],
      ],
    ]);
  },
);
it.each([false, true])(
  "keeps the DC solid and broken lines horizontal in their native association, vertical=%s",
  (vertical) => {
    expect(ink("dc-output", vertical).strokes).toEqual([
      [
        [-2, -1.333],
        [2, -1.333],
      ],
      [
        [-2, 0.667],
        [-1.333, 0.667],
      ],
      [
        [-0.667, 0.667],
        [0.667, 0.667],
      ],
      [
        [1.333, 0.667],
        [2, 0.667],
      ],
    ]);
  },
);
it.each(["ac-input", "dc-output"] as const)(
  "retains the body attachment frame and reports the actual %s stroke obstacles in both flows",
  (mark) => {
    for (const vertical of [false, true]) {
      const drawing = ink(mark, vertical);
      for (const axis of ["x", "y"] as const) {
        const centre = axis === "x" ? 40 : 60;
        expect(
          rounded(Math.min(...drawing.body.map((p) => p[axis])) - centre),
        ).toBe(-3.333);
        expect(
          rounded(Math.max(...drawing.body.map((p) => p[axis])) - centre),
        ).toBe(3.333);
      }
      const strokes = drawing.strokes.flatMap((points) =>
        points.slice(1).map((p, i) => [points[i], p]),
      );
      const reported = circuitMarkSegments(mark, 40, 60, vertical)
        .slice(4)
        .map((s) => s.map((p) => [rounded(p.x - 40), rounded(p.y - 60)]));
      expect(reported).toEqual(strokes);
    }
  },
);
