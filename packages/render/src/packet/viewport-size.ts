import { n } from "./svg.js";

/** Keep the printed scale at least the planned scale after viewBox rounding.
 * Neither axis may make the other axis's text smaller under SVG meet fitting. */
export function viewportSize(span: number, scale: number): number {
  return Math.max(Number(n(span * scale)), Number(n(span)) * scale);
}
