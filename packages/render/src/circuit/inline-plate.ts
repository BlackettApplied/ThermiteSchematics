import { circuitCaptionGeometry } from "./caption-geometry.js";
import type { CircuitLabelState } from "./layout-routes.js";
import {
  rectInkBox,
  routeInkDistance,
  segmentTouchesBox,
  pointInsideBox,
  type InkBox,
} from "../layout/ink-geometry.js";

const BEND_CLEARANCE = 0.36;
// The painted circuit terminal is the .65 mm radius plus half its .3 mm
// stroke. Leave 0.01 mm for formatting the SVG coordinates.
const TERMINAL_EDGE = 0.81;

function terminalClearance(
  point: { x: number; y: number },
  route: readonly { x: number; y: number }[],
  height: number,
) {
  return point === route[0] || point === route.at(-1)
    ? Math.max(2, height) + TERMINAL_EDGE
    : BEND_CLEARANCE;
}

/** A plate may interrupt one straight owned run, with printed ink clear
 * of both terminals and bends. Beside and leader plates leave the run whole. */
export function circuitCaptionPlateFits(
  label: CircuitLabelState["labels"][number],
  state: CircuitLabelState,
) {
  return circuitCaptionPlate(label, state) !== undefined;
}

export function circuitCaptionPlate(
  label: CircuitLabelState["labels"][number],
  state: CircuitLabelState,
  printedInk?: readonly InkBox[],
) {
  if (plateFits(label, state)) return label;
  const ink =
    printedInk ??
    label.text
      .split("\n")
      .map((line, i) => circuitCaptionGeometry(line, i, label, state).ink);
  // Keep a visible pad around the measured glyphs. The original ELK
  // reservation still protects neighbours and is the maximum painted area.
  const pad = 0.25;
  const x = Math.max(label.x, Math.min(...ink.map((b) => b.left)) - pad),
    y = Math.max(label.y, Math.min(...ink.map((b) => b.top)) - pad),
    right = Math.min(
      label.x + label.width,
      Math.max(...ink.map((b) => b.right)) + pad,
    ),
    bottom = Math.min(
      label.y + label.height,
      Math.max(...ink.map((b) => b.bottom)) + pad,
    );
  const plate = { ...label, x, y, width: right - x, height: bottom - y };
  if (plateFits(plate, state)) return plate;
}

function plateFits(
  label: CircuitLabelState["labels"][number],
  state: CircuitLabelState,
) {
  const box = rectInkBox(label);
  if ([...state.dots.values()].some((point) => pointInsideBox(point, box)))
    return false;
  if (
    state.segments.some(
      (s) =>
        s.index !== label.index &&
        routeInkDistance(
          box,
          [[s.a, s.b]],
          state.cs[s.index]?.jumper ? 0.55 : 0.32,
        ) <= 0.01,
    )
  )
    return false;
  const hidden = state.segments.filter(
    (s) => s.index === label.index && segmentTouchesBox(s.a, s.b, box),
  );
  if (!hidden.length) return true;
  const run = hidden[0],
    owner = state.routes.find((r) => r.index === label.index);
  if (hidden.length !== 1 || !run || !owner) return false;
  const { a, b } = run,
    horizontal = Math.abs(a.y - b.y) < 1e-7,
    axis = horizontal ? "x" : "y",
    [start, end] = a[axis] < b[axis] ? [a, b] : [b, a],
    low = horizontal ? box.left : box.top,
    high = horizontal ? box.right : box.bottom;
  return (
    low - start[axis] >= terminalClearance(start, owner.points, label.height) &&
    end[axis] - high >= terminalClearance(end, owner.points, label.height)
  );
}
