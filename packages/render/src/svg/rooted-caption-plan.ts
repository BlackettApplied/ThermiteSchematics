import type { LayoutLabel, NormalizedSchematicLayout } from "../types.js";
import { printableLabelGeometry } from "../symbols/printable-label.js";
import { besideCaption } from "../layout/beside-caption.js";
import { rectInkBox } from "../layout/ink-geometry.js";
import {
  labelFrameObstacles,
  ownedLabelLeader,
} from "../layout/wire-label-support.js";
type Position = ReturnType<typeof printableLabelGeometry>;
type Plan =
  | { ok: true; position: Position; leader?: { x: number; y: number }[] }
  | { ok: false };
function context(
  label: LayoutLabel,
  layout: Readonly<NormalizedSchematicLayout>,
) {
  return {
    foreign: layout.edges
      .filter((e) => e.id !== label.ownerId)
      .map((e) => e.points),
    obstacles: [
      ...layout.nodes
        .filter((n) => ["symbol", "rail", "junction"].includes(n.kind))
        .map(rectInkBox),
      ...layout.labels.filter((l) => l.id !== label.id).map(rectInkBox),
      ...layout.nodes
        .filter((n) => n.kind === "location" || n.kind === "device")
        .flatMap((n) => labelFrameObstacles(rectInkBox(n))),
    ],
    bounds: { left: 0, top: 0, right: layout.width, bottom: layout.height },
    strokeClearance: 1,
  };
}
export function rootedCaptionPlan(
  label: LayoutLabel,
  position: Position,
  layout: Readonly<NormalizedSchematicLayout>,
  mmPerUnit: number,
): Plan {
  if (
    label.ownerKind !== "edge" ||
    layout.contextReferences?.some((r) => r.id === label.ownerId)
  )
    return { ok: true, position };
  const own = [layout.edges.find((e) => e.id === label.ownerId)?.points ?? []],
    surroundings = context(label, layout),
    reservation = rectInkBox(label),
    placement = besideCaption(
      position.ink,
      reservation,
      own,
      surroundings,
      mmPerUnit,
      1.5,
    );
  if (!placement) return { ok: false };
  const moved = {
    ...position,
    x: position.x + placement.ink.left - position.ink.left,
    y: position.y + placement.ink.top - position.ink.top,
    baseline: position.baseline + placement.ink.top - position.ink.top,
    ink: placement.ink,
  };
  if (!placement.needsLeader) return { ok: true, position: moved };
  const points = ownedLabelLeader(
    moved.ink,
    reservation,
    own,
    surroundings,
    2 / mmPerUnit,
  );
  return points ? { ok: true, position: moved, leader: points } : { ok: false };
}
