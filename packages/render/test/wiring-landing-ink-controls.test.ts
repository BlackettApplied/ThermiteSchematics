import { expect, it } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { wiringLandingInkFits } from "../src/layout/wiring-landing-ink.js";
function approaches(spacing: number, length: number): ElkNode {
  return {
    id: "physical-landings",
    children: [
      {
        id: "terminal",
        x: 0,
        y: 0,
        ports: [
          { id: "mark", x: 0, y: 0 },
          { id: "alias", x: -0.5, y: 0 },
        ],
      },
      {
        id: "remote",
        x: length,
        y: 0,
        ports: [
          { id: "remote-0", x: 0, y: 0 },
          { id: "remote-1", x: 0, y: spacing },
        ],
      },
    ],
    edges: [0, 1].map((i) => ({
      id: `wire-${i}`,
      sources: [`remote-${i}`],
      targets: [i ? "alias" : "mark"],
      sections: [
        {
          id: `route-${i}`,
          startPoint: { x: length, y: i * spacing },
          ...(i ? { bendPoints: [{ x: -0.5, y: spacing }] } : {}),
          endPoint: { x: i ? -0.5 : 0, y: 0 },
        },
      ],
    })),
  };
}
it("rejects half-millimetre parallel centreline spacing outside the physical fan-in, including actual jumper ink", () => {
  const aliases = new Map([["alias", "mark"]]);
  expect(wiringLandingInkFits(approaches(0.5, 10), aliases)).toBe(false);
  expect(wiringLandingInkFits(approaches(1.05, 10), aliases)).toBe(true);
  expect(
    wiringLandingInkFits(
      approaches(1.05, 10),
      aliases,
      new Map([["wire-1", 0.7]]),
    ),
  ).toBe(false);
  expect(wiringLandingInkFits(approaches(0.5, 2), aliases)).toBe(true);
  expect(wiringLandingInkFits(approaches(0.5, 3.1), aliases)).toBe(false);
});
