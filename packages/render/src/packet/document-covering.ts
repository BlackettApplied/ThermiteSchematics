import { intersection, project, type Rect } from "../device-legend/geometry.js";
import type { NavigationGeometry } from "./navigation-walk.js";

export interface CoverRectangle {
  index: number;
  box: Rect;
}

/** The same eligible painted rectangle for cached and uncached text checks. */
export function documentCoverRectangle(
  later: NavigationGeometry,
  index: number,
): CoverRectangle | undefined {
  if (!later.visible || later.node.name !== "rect") return undefined;
  const s = later.style ?? later.node.attrs,
    a = later.node.attrs;
  if (
    s.fill === "none" ||
    s.fill === "transparent" ||
    Number(s.opacity ?? 1) === 0
  )
    return undefined;
  const box = intersection(
    project(
      {
        x: Number(a.x ?? 0),
        y: Number(a.y ?? 0),
        w: Number(a.width),
        h: Number(a.height),
      },
      later.matrix,
    ),
    later.clip,
  );
  return box ? { index, box } : undefined;
}

export function laterRectangleCovers(
  ink: Rect,
  index: number,
  later: CoverRectangle | undefined,
): boolean {
  return !!later && later.index > index && !!intersection(ink, later.box);
}
