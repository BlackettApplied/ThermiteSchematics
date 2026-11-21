import { generatedSvgInk } from "../device-legend/svg-ink.js";
import { separated, type Rect } from "../device-legend/geometry.js";
import { cachedNavigationTree } from "./navigation-walk.js";
import type { DocumentCaptionOwner } from "./document-caption-owner.js";

export interface DocumentCaptionLeader {
  from: { x: number; y: number };
  to: { x: number; y: number };
  rect: Rect;
}

/** Optional drafting support, never a conductor: one straight, clear approach.
 * Keep ≥2 mm beyond the painted marker edge; otherwise keep self-located text. */
export function documentCaptionLeader(
  box: Rect,
  owner: DocumentCaptionOwner,
  svg: string,
  claims: readonly Rect[],
): DocumentCaptionLeader | undefined {
  const anchor = owner.anchorMm;
  const from = {
    x: Math.max(box.x, Math.min(box.x + box.w, anchor.x)),
    y: Math.max(box.y, Math.min(box.y + box.h, anchor.y)),
  };
  const length = Math.hypot(anchor.x - from.x, anchor.y - from.y);
  const stop = 2 + (owner.markerRadiusMm ?? 0);
  if (length <= stop) return undefined;
  const to = {
    x: anchor.x + ((from.x - anchor.x) * stop) / length,
    y: anchor.y + ((from.y - anchor.y) * stop) / length,
  };
  const rect = {
    x: Math.min(from.x, to.x) - 0.1,
    y: Math.min(from.y, to.y) - 0.1,
    w: Math.abs(from.x - to.x) + 0.2,
    h: Math.abs(from.y - to.y) + 0.2,
  };
  const ink = generatedSvgInk(svg, 1, cachedNavigationTree(svg));
  return [...ink.ink, ...ink.regions, ...claims].every((other) =>
    separated(rect, other, 0.25),
  )
    ? { from, to, rect }
    : undefined;
}
