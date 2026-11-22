import type {
  LayoutEdge,
  LayoutLabel,
  LayoutPoint,
  NormalizedSchematicView,
} from "../types.js";
import type { Bounds } from "./validate-output.js";

export interface Segment {
  readonly edge: LayoutEdge;
  readonly start: LayoutPoint;
  readonly end: LayoutPoint;
  readonly horizontal: boolean;
}

export interface NetLabelOverlap {
  readonly labelId: string;
  readonly edgeId: string;
}

export function segmentIntersectsInterior(segment: Segment, bounds: Bounds) {
  if (segment.horizontal) {
    const left = Math.min(segment.start.x, segment.end.x);
    const right = Math.max(segment.start.x, segment.end.x);
    return (
      segment.start.y > bounds.top &&
      segment.start.y < bounds.bottom &&
      Math.min(right, bounds.right) > Math.max(left, bounds.left)
    );
  }
  const top = Math.min(segment.start.y, segment.end.y);
  const bottom = Math.max(segment.start.y, segment.end.y);
  return (
    segment.start.x > bounds.left &&
    segment.start.x < bounds.right &&
    Math.min(bottom, bounds.bottom) > Math.max(top, bounds.top)
  );
}

export function netLabelOverlaps(
  view: NormalizedSchematicView,
  first: LayoutLabel,
  labels: readonly LayoutLabel[],
  segments: readonly Segment[],
  inkBounds: (label: LayoutLabel) => Bounds,
): NetLabelOverlap[] | undefined {
  if (
    first.role !== "net" ||
    view.family !== "power" ||
    view.flow !== "top-to-bottom"
  )
    return;
  const overlaps: NetLabelOverlap[] = [];
  for (const label of labels) {
    if (label.role !== "net") continue;
    const bounds = inkBounds(label);
    for (const segment of segments)
      if (segmentIntersectsInterior(segment, bounds))
        overlaps.push({ labelId: label.id, edgeId: segment.edge.id });
  }
  return overlaps;
}
