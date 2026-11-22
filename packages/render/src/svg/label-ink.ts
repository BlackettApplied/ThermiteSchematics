import { labelLeaderArrow } from "../layout/wire-label-support.js";
import { captionPlacementDiagnostic } from "../layout/caption-diagnostic.js";
import { rootedCaptionPlan } from "./rooted-caption-plan.js";
import type {
  LayoutLabel,
  NormalizedSchematicLayout,
  NormalizedSchematicView,
  RenderOutcome,
} from "../types.js";
import type { SvgWriter, SvgAttributes } from "./writer.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import { printableLabelGeometry } from "../symbols/printable-label.js";
import { printableFitAttributes } from "../text-metrics.js";
import { svgSemanticId } from "./escape.js";
const global = (value: number) => value + OUTER_SVG_PADDING;
export function emitLabelInk(
  writer: SvgWriter,
  label: LayoutLabel,
  printed: string,
  capacity: number,
  layout: Readonly<NormalizedSchematicLayout>,
  mmPerUnit: number,
  attributes: SvgAttributes,
  view: NormalizedSchematicView,
): RenderOutcome<void> {
  const original = printableLabelGeometry(
      label,
      printed,
      capacity,
      label.ownerKind === "edge"
        ? [layout.edges.find((e) => e.id === label.ownerId)?.points ?? []]
        : undefined,
    ),
    plan = rootedCaptionPlan(label, original, layout, mmPerUnit);
  if (!plan.ok)
    return {
      ok: false,
      error: captionPlacementDiagnostic(
        printed,
        label.ownerId,
        view.root.designation,
        view.family,
      ),
    };
  const position = plan.position;
  emitOwnedLabelLeader(writer, label, plan.leader);
  writer.element(1, "rect", {
    class: `label-background label-${label.role}`,
    x: global(position.ink.left),
    y: global(position.ink.top),
    width: position.ink.right - position.ink.left,
    height: position.ink.bottom - position.ink.top,
  });
  writer.element(
    1,
    "text",
    {
      class: `label-text label-${label.role}`,
      ...attributes,
      "clip-path": `url(#${svgSemanticId("clip", [label.id])})`,
      x: global(position.x),
      y: global(position.baseline),
      "font-family": "Thermite Sans, Thermite Math, sans-serif",
      "font-size": 10,
      "text-anchor": "start",
      "dominant-baseline": "alphabetic",
      ...printableFitAttributes(printed, 10, capacity),
    },
    printed,
  );
  return { ok: true, value: undefined };
}
function emitOwnedLabelLeader(
  writer: SvgWriter,
  label: LayoutLabel,
  points: readonly { x: number; y: number }[] | undefined,
) {
  if (!points) return;
  const path = (ps: readonly { x: number; y: number }[]) =>
    ps
      .map((p, i) => `${i ? "L" : "M"} ${global(p.x)} ${global(p.y)}`)
      .join(" ");
  writer.element(1, "path", {
    class: "wire-label-leader",
    "data-label-leader-owner": label.ownerId,
    d: path(points),
    fill: "none",
    stroke: "#475467",
    "stroke-width": 0.5,
    "stroke-dasharray": "2 1.5",
  });
  writer.element(1, "path", {
    class: "wire-label-leader-arrow",
    d: path(labelLeaderArrow(points)),
    fill: "none",
    stroke: "#475467",
    "stroke-width": 0.5,
  });
}
