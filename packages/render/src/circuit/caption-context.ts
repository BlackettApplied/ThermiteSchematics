import type { CircuitLabelState } from "./layout-routes.js";
import { rectInkBox } from "../layout/ink-geometry.js";
import { required } from "../presentation/util.js";
type Label = CircuitLabelState["labels"][number];
export function circuitCaptionContext(
  state: CircuitLabelState,
  label: Label,
  others: CircuitLabelState["segments"],
  foreignStrokes: number[],
) {
  return {
    foreign: others.map((s) => [s.a, s.b]),
    foreignStrokes,
    obstacles: [
      ...(state.graph.children ?? []).map((n) =>
        rectInkBox({
          x: required(n.x, "Unplaced device"),
          y: required(n.y, "Unplaced device"),
          width: required(n.width, "Missing device width"),
          height: required(n.height, "Missing device height"),
        }),
      ),
      ...state.labels.filter((l) => l !== label).map(rectInkBox),
    ],
    bounds: {
      left: 0,
      top: 0,
      right: required(state.graph.width, "Missing circuit width"),
      bottom: required(state.graph.height, "Missing circuit height"),
    },
    strokeClearance: Math.max(
      0.25,
      ...foreignStrokes.map((s) => s / 2 + 0.075),
    ),
  };
}
