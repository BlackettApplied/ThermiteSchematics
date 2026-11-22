import type { CircuitLabelState } from "./layout-routes.js";
import { circuitCaptionGeometry } from "./caption-geometry.js";
import { circuitCaptionContext } from "./caption-context.js";
import { existingCircuitCaption } from "./caption-association.js";
import { besideCaption } from "../layout/beside-caption.js";
import { ownedLabelLeader } from "../layout/wire-label-support.js";
import { required } from "../presentation/util.js";
import { circuitCaptionPlateFits } from "./inline-plate.js";
type Label = CircuitLabelState["labels"][number];
/** The same final glyph and leader admission is used during whole-block search
 * and emission. No candidate changes native paths, plate size or font metrics. */
export function circuitCaptionPlacement(
  line: string,
  i: number,
  label: Label,
  state: CircuitLabelState,
) {
  if (!circuitCaptionPlateFits(label, state)) return undefined;
  const original = circuitCaptionGeometry(line, i, label, state),
    own = state.segments
      .filter((s) => s.index === label.index)
      .map((s) => [s.a, s.b]),
    others = state.segments.filter((s) => s.index !== label.index),
    owner = required(state.cs[label.index], "Missing circuit caption owner"),
    foreignStrokes = others.map((s) =>
      required(state.cs[s.index], "Missing circuit conductor").jumper
        ? 0.55
        : 0.32,
    ),
    stroke = owner.jumper ? 0.55 : 0.32,
    context = circuitCaptionContext(state, label, others, foreignStrokes),
    reservation = {
      left: label.x,
      right: label.x + label.width,
      top: label.y + i * 3.1,
      bottom: label.y + (i + 1) * 3.1 + 0.7,
    },
    placement = existingCircuitCaption(
      original.ink,
      own,
      others.map((s) => [s.a, s.b]),
      foreignStrokes,
      stroke,
    )
      ? { ink: original.ink, needsLeader: false }
      : besideCaption(original.ink, reservation, own, context, 1, stroke);
  if (!placement) return undefined;
  const points = placement.needsLeader
    ? ownedLabelLeader(placement.ink, reservation, own, context, 2, 0.25)
    : undefined;
  if (placement.needsLeader && !points) return undefined;
  return {
    ...original,
    x: original.x + placement.ink.left - original.ink.left,
    baseline: original.baseline + placement.ink.top - original.ink.top,
    ink: placement.ink,
    points,
  };
}
