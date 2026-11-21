import type { Rect } from "../device-legend/geometry.js";
import {
  localNavigationSlot,
  type SymbolGeometry,
} from "./navigation-symbols.js";
export type NavigationPlacementFamily =
  "beside" | "below" | "below-right" | "zone-column" | "margin-band";
/** Project a shape's relative printed ink without changing its fit reservation. */
export function navigationPlacementInk(box: Rect, ink?: Rect): Rect {
  return ink ? { ...ink, x: box.x + ink.x, y: box.y + ink.y } : box;
}
/** Locator policy /1. Local approaches precede the outer-row and vacant-column fallbacks. */
export function navigationPlacementFamily(
  box: Rect,
  field: Rect,
  owner: Rect,
  locality?: SymbolGeometry,
): NavigationPlacementFamily {
  if (locality && localNavigationSlot(box, locality)) {
    if (box.y >= owner.y + owner.h && box.x >= owner.x + owner.w)
      return "below-right";
    if (
      box.y >= owner.y + owner.h &&
      box.x < owner.x + owner.w &&
      box.x + box.w > owner.x
    )
      return "below";
    if (
      (box.x >= owner.x + owner.w || box.x + box.w <= owner.x) &&
      box.y < owner.y + owner.h &&
      box.y + box.h > owner.y
    )
      return "beside";
  }
  return box.y + box.h <= field.y + field.h / 4 ||
    box.y >= field.y + (3 * field.h) / 4
    ? "margin-band"
    : "zone-column";
}
