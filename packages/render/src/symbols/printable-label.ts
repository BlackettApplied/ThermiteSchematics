import type { LayoutLabel, LayoutPoint } from "../types.js";
import {
  boundedPrintableAdvance,
  printableTextMetrics,
} from "./printable-font.js";

/** Keep the conductor-facing ink edge of the reserved (formerly forced-width)
 * caption. Only text moves inside its existing clip; routes and label DTOs do not. */
export function printableLabelGeometry(
  label: Readonly<Pick<LayoutLabel, "x" | "y" | "width" | "height">>,
  text: string,
  capacity: number,
  routes: readonly (readonly LayoutPoint[])[] = [],
  size = 10,
  fit = true,
) {
  const m = printableTextMetrics(text, size),
    // Circuit captions already print at natural advance; only rooted captions fit.
    advance = fit ? boundedPrintableAdvance(text, size, capacity) : m.advance,
    scale = m.advance ? advance / m.advance : 1,
    emInset = (label.height - size) / 2;
  let x = label.x + 0.3 * size;
  let y = label.y + label.height / 2;
  const reserved = {
    left: label.x + (fit ? 0 : 0.3 * size),
    right: fit ? label.x + label.width : label.x + 0.3 * size + capacity,
    top: label.y + (fit ? 0 : emInset),
    bottom: label.y + label.height - (fit ? 0 : emInset),
  };
  let best = Infinity,
    movement = Infinity;
  const width = (m.right - m.left) * scale,
    height = m.top - m.bottom;
  const position = (
    lo: number,
    hi: number,
    size: number,
    current: number,
    a: number,
    b: number,
  ) => {
    const min = Math.min(lo, hi - size),
      max = Math.max(lo, hi - size);
    return Math.max(
      min,
      Math.min(max, Math.max(a - size, Math.min(b, current))),
    );
  };
  for (const ownRoute of routes)
    for (let i = 1; i < ownRoute.length; i++) {
      const a = ownRoute[i - 1]!,
        b = ownRoute[i]!;
      const left = Math.min(a.x, b.x),
        right = Math.max(a.x, b.x),
        top = Math.min(a.y, b.y),
        bottom = Math.max(a.y, b.y);
      const inkLeft = position(
          reserved.left,
          reserved.right,
          width,
          (reserved.left + reserved.right - width) / 2,
          left,
          right,
        ),
        inkTop = position(
          reserved.top,
          reserved.bottom,
          height,
          (reserved.top + reserved.bottom - height) / 2,
          top,
          bottom,
        ),
        candidateX = inkLeft - m.left * scale,
        candidateY = inkTop + m.top - m.middleBaseline;
      const dx = Math.max(left - (inkLeft + width), inkLeft - right, 0),
        dy = Math.max(top - (inkTop + height), inkTop - bottom, 0),
        distance = Math.hypot(dx, dy),
        shift = Math.hypot(
          candidateX - (label.x + 0.3 * size),
          candidateY - (label.y + label.height / 2),
        );
      if (distance < best || (distance === best && shift < movement)) {
        best = distance;
        movement = shift;
        x = candidateX;
        y = candidateY;
      }
    }
  return {
    x,
    y,
    baseline: y + m.middleBaseline,
    ink: {
      left: x + m.left * scale,
      right: x + m.right * scale,
      top: y + m.middleBaseline - m.top,
      bottom: y + m.middleBaseline - m.bottom,
    },
  };
}
