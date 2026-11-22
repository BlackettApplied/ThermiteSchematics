import {
  routeSegments,
  segmentTouchesBox,
  type InkBox,
} from "./ink-geometry.js";
import { WIRING_TERMINAL_RADIUS } from "./wiring-landings.js";
import type { LayoutPoint } from "../types.js";

const RING_EDGE = WIRING_TERMINAL_RADIUS + 0.15;
const ROUNDING = 0.01;
const BEND_CLEARANCE = 0.35 + ROUNDING;

export function wiringPlateRuns(
  routes: readonly (readonly LayoutPoint[])[],
  height: number,
) {
  const terminalClearance = Math.max(2, height) + RING_EDGE + ROUNDING;
  return routes.flatMap((route) =>
    routeSegments(route).map(({ a, b }) => {
      const aClearance = a === route[0] ? terminalClearance : BEND_CLEARANCE;
      const bClearance =
        b === route.at(-1) ? terminalClearance : BEND_CLEARANCE;
      return {
        a,
        b,
        lo: Math.min(a.x, b.x) + (a.x <= b.x ? aClearance : bClearance),
        hi: Math.max(a.x, b.x) - (a.x <= b.x ? bClearance : aClearance),
      };
    }),
  );
}

export function wiringPlateFits(
  box: InkBox,
  routes: readonly (readonly LayoutPoint[])[],
) {
  const hidden = wiringPlateRuns(routes, box.bottom - box.top).filter(
    ({ a, b }) => segmentTouchesBox(a, b, box),
  );
  const run = hidden[0];
  return (
    hidden.length === 1 &&
    run !== undefined &&
    run.a.y === run.b.y &&
    run.lo <= box.left &&
    run.hi >= box.right
  );
}
