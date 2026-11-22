import { printableLabelGeometry } from "../symbols/printable-label.js";
import type { CircuitLabelState } from "./layout-routes.js";
export function circuitCaptionGeometry(
  line: string,
  i: number,
  label: CircuitLabelState["labels"][number],
  state: CircuitLabelState,
) {
  return printableLabelGeometry(
    { x: label.x, y: label.y + i * 3.1, width: label.width, height: 3.8 },
    line,
    label.width - 1.5,
    state.segments
      .filter((s) => s.index === label.index)
      .map((s) => [s.a, s.b]),
    2.5,
    false,
  );
}
