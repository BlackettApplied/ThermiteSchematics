import type { InkBox } from "./rooted-ink.js";

export type FoldAxis = "x" | "y";
/** Work in a Y-oriented coordinate space without rotating any drawing ink. */
export function axisBox(box: InkBox, axis: FoldAxis): InkBox {
  return axis === "y" ? box : { x: box.y, y: box.x, w: box.h, h: box.w };
}
