import type { CircuitLabelState } from "./layout-routes.js";
import { circuitLandingPort } from "./landing-ports.js";
import { rectInkBox, routeInkDistance } from "../layout/ink-geometry.js";
import { horizontalLabelSupport } from "../layout/wire-label-support.js";
import { required } from "../presentation/util.js";

/** New independent approaches can leave ELK's caption beside a loop corner.
 * Prefer a free upright horizontal host in the existing bounded label search.
 * Existing inline plates and layouts without incidence ports stay unchanged. */
export function circuitLandingCaptionNeedsMove(
  label: CircuitLabelState["labels"][number],
  state: CircuitLabelState,
) {
  const edge = state.graph.edges?.find((e) => e.id === `e${label.index}`);
  if (
    !edge ||
    ![...edge.sources, ...edge.targets].some(
      (id) => circuitLandingPort(id).offset !== 0,
    )
  )
    return false;
  const own = state.segments
    .filter((s) => s.index === label.index)
    .map((s) => [s.a, s.b]);
  const box = rectInkBox(label);
  const stroke = required(
    state.cs[label.index],
    "Missing landing caption owner",
  ).jumper
    ? 0.55
    : 0.32;
  if (routeInkDistance(box, own, stroke) === 0) return false;
  const foreign = state.segments
    .filter((s) => s.index !== label.index)
    .map((s) => [s.a, s.b]);
  return !horizontalLabelSupport(box, own, 2, foreign);
}
