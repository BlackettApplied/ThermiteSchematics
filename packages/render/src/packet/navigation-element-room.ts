import type { Rect } from "../device-legend/geometry.js";
import { boxDistance } from "./navigation-symbols.js";
import {
  NAVIGATION_CLEARANCE_MM,
  NAVIGATION_TEXT_CLEARANCE_MM,
} from "./navigation-clearance.js";

/** Keep final element ink visibly inside the drawing field, independently of rounding. */
export const ELEMENT_FRAME_CLEARANCE_MM = 1;
export function elementDrawingArea(area: Rect): Rect {
  return {
    x: area.x + ELEMENT_FRAME_CLEARANCE_MM,
    y: area.y + ELEMENT_FRAME_CLEARANCE_MM,
    w: area.w - 2 * ELEMENT_FRAME_CLEARANCE_MM,
    h: area.h - 2 * ELEMENT_FRAME_CLEARANCE_MM,
  };
}
function room(
  box: Rect,
  area: Rect,
  obstacles: readonly Rect[],
  texts: readonly Rect[],
  bestRoom: number,
) {
  let spare = Math.min(
    box.x - area.x,
    box.y - area.y,
    area.x + area.w - box.x - box.w,
    area.y + area.h - box.y - box.h,
  );
  // Further obstacles can only reduce the score, so ties cannot replace best.
  if (spare <= bestRoom) return spare;
  for (const o of obstacles) {
    spare = Math.min(spare, boxDistance(box, o) - NAVIGATION_CLEARANCE_MM);
    if (spare <= bestRoom) return spare;
  }
  for (const t of texts) {
    spare = Math.min(spare, boxDistance(box, t) - NAVIGATION_TEXT_CLEARANCE_MM);
    if (spare <= bestRoom) return spare;
  }
  return spare;
}
/** Maximise the tightest spare clearance; retain deterministic distance/edge ties. */
export function roomiestElementSlot(
  legal: readonly Rect[],
  area: Rect,
  obstacles: readonly Rect[],
  texts: readonly Rect[],
) {
  let best: Rect | undefined,
    bestRoom = -Infinity;
  for (const box of legal) {
    const spare = room(box, area, obstacles, texts, bestRoom);
    if (spare > bestRoom) {
      best = box;
      bestRoom = spare;
    }
  }
  return best;
}
