import { fullyCoincidentCaption } from "./coincident-caption.js";
import { circuitCaptionGeometry } from "./caption-geometry.js";
import { circuitCaptionPlacement } from "./caption-placement.js";
import type { CircuitLabelState } from "./layout-routes.js";
import { labelLeaderArrow } from "../layout/wire-label-support.js";
import { InlineLabelCollisionError } from "../layout/inline-label-error.js";
import { required } from "../presentation/util.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
type Label = CircuitLabelState["labels"][number];
export function plannedCircuitCaption(
  line: string,
  i: number,
  label: Label,
  state: CircuitLabelState,
  basePlacementFallback = false,
) {
  const fallback = basePlacementFallback
    ? "unhostable"
    : fullyCoincidentCaption(label.index, state.segments)
      ? "fully-coincident"
      : undefined;
  if (fallback)
    return {
      ...circuitCaptionGeometry(line, i, label, state),
      leader: "",
      fallback,
    };
  const placement = circuitCaptionPlacement(line, i, label, state),
    owner = required(state.cs[label.index], "Missing circuit caption owner");
  if (!placement)
    throw new InlineLabelCollisionError(
      `Circuit ${state.group.id}: caption ${line} (${owner.id}) cannot be associated with its conductor without obscuring other drawing content.`,
    );
  const path = (ps: readonly { x: number; y: number }[]) =>
      ps
        .map((p, j) => `${j ? "L" : "M"} ${state.n(p.x)} ${state.n(p.y)}`)
        .join(" "),
    points = placement.points,
    leader = points
      ? `<path class="wire-label-leader" data-label-leader-owner="${attr(owner.id)}" d="${path(points)}" fill="none" stroke="#475467" stroke-width=".15" stroke-dasharray=".5 .375"/><path class="wire-label-leader-arrow" d="${path(labelLeaderArrow(points, 0.75))}" fill="none" stroke="#475467" stroke-width=".15"/>`
      : "";
  return { ...placement, leader, fallback };
}
