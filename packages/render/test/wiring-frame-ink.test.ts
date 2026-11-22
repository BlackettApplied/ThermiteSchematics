import { expect, it } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { wiringLandingInkFits } from "../src/layout/wiring-landing-ink.js";
import { assertTopologyRouteEndpoints } from "../src/layout/topology-conservation.js";

function channel(
  distance: number,
  overlap: number,
  vertical: boolean,
): ElkNode {
  const point = (along: number, cross: number) =>
    vertical ? { x: cross, y: along } : { x: along, y: cross };
  return {
    id: "frame-clearance",
    children: [
      { id: "device", x: 0, y: 0, width: 20, height: 20, ports: [] },
      { id: "start", x: 0, y: 0, ports: [{ id: "a", ...point(5, -distance) }] },
      {
        id: "end",
        x: 0,
        y: 0,
        ports: [{ id: "b", ...point(5 + overlap, -distance) }],
      },
    ],
    edges: [
      {
        id: "wire",
        sources: ["a"],
        targets: ["b"],
        sections: [
          {
            id: "route",
            startPoint: point(5, -distance),
            endPoint: point(5 + overlap, -distance),
          },
        ],
      },
    ],
  };
}
it.each([false, true])(
  "checks device frame ink on both axes (vertical=%s)",
  (vertical) => {
    const aliases = new Map<string, string>();
    expect(wiringLandingInkFits(channel(0.5, 10, vertical), aliases)).toBe(
      false,
    );
    expect(wiringLandingInkFits(channel(1.024, 10, vertical), aliases)).toBe(
      false,
    );
    expect(wiringLandingInkFits(channel(1.025, 10, vertical), aliases)).toBe(
      true,
    );
    expect(wiringLandingInkFits(channel(1.026, 10, vertical), aliases)).toBe(
      true,
    );
    expect(wiringLandingInkFits(channel(0.5, 3, vertical), aliases)).toBe(true);
    expect(wiringLandingInkFits(channel(0.5, 3.001, vertical), aliases)).toBe(
      false,
    );
    expect(
      wiringLandingInkFits(
        channel(1.025, 10, vertical),
        aliases,
        new Map([["wire", 0.7]]),
      ),
    ).toBe(false);
    expect(
      wiringLandingInkFits(
        channel(1.2, 10, vertical),
        aliases,
        new Map([["wire", 0.7]]),
      ),
    ).toBe(true);
  },
);

it("does not exempt a later long frame run merely because it passes near an endpoint", () => {
  const graph: ElkNode = {
    id: "later-frame-run",
    children: [
      {
        id: "source",
        x: 0,
        y: 0,
        width: 10,
        height: 20,
        ports: [{ id: "a", x: 10, y: 4 }],
      },
      {
        id: "target",
        x: 20,
        y: 0,
        width: 20,
        height: 20,
        ports: [{ id: "b", x: 0, y: 6 }],
      },
    ],
    edges: [
      {
        id: "wire",
        sources: ["a"],
        targets: ["b"],
        sections: [
          {
            id: "bound-route",
            startPoint: { x: 10, y: 4 },
            bendPoints: [
              { x: 19.5, y: 4 },
              { x: 19.5, y: 8 },
              { x: 18, y: 8 },
              { x: 18, y: 6 },
            ],
            endPoint: { x: 20, y: 6 },
          },
        ],
      },
    ],
  };
  // The 4 mm run lies inside the endpoint's 3 mm radius, but is not the
  // short terminal approach. Frame clearance must still reject its 0.175 mm gap.
  expect(() => assertTopologyRouteEndpoints(graph)).not.toThrow();
  expect(wiringLandingInkFits(graph, new Map())).toBe(false);
});
