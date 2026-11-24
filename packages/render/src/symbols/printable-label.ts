import type { LayoutLabel, LayoutPoint } from "../types.js";
import {
  boundedPrintableAdvance,
  printableTextMetrics,
} from "../text-metrics.js";
import { TWO_LINE_NET_LABEL_PITCH } from "../presentation/net-label-wrap.js";

export interface PrintableLabelPlacement {
  readonly x: number;
  readonly y: number;
  readonly baseline: number;
  readonly baselines?: readonly [number, number];
  readonly ink: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

function clampPosition(
  lo: number,
  hi: number,
  size: number,
  current: number,
  a: number,
  b: number,
) {
  const min = Math.min(lo, hi - size),
    max = Math.max(lo, hi - size);
  return Math.max(min, Math.min(max, Math.max(a - size, Math.min(b, current))));
}

function nearestInkOrigin(
  reserved: Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }>,
  width: number,
  height: number,
  leftOffset: number,
  topOffset: number,
  baselineOffset: number,
  defaultX: number,
  defaultY: number,
  routes: readonly (readonly LayoutPoint[])[],
) {
  let x = defaultX,
    y = defaultY,
    best = Infinity,
    movement = Infinity;
  for (const ownRoute of routes)
    for (let i = 1; i < ownRoute.length; i++) {
      const a = ownRoute[i - 1],
        b = ownRoute[i];
      if (!a || !b) continue;
      const left = Math.min(a.x, b.x),
        right = Math.max(a.x, b.x),
        top = Math.min(a.y, b.y),
        bottom = Math.max(a.y, b.y);
      const inkLeft = clampPosition(
          reserved.left,
          reserved.right,
          width,
          (reserved.left + reserved.right - width) / 2,
          left,
          right,
        ),
        inkTop = clampPosition(
          reserved.top,
          reserved.bottom,
          height,
          (reserved.top + reserved.bottom - height) / 2,
          top,
          bottom,
        ),
        candidateX = inkLeft - leftOffset,
        candidateY = inkTop + topOffset - baselineOffset;
      const dx = Math.max(left - (inkLeft + width), inkLeft - right, 0),
        dy = Math.max(top - (inkTop + height), inkTop - bottom, 0),
        distance = Math.hypot(dx, dy),
        shift = Math.hypot(candidateX - defaultX, candidateY - defaultY);
      if (distance < best || (distance === best && shift < movement)) {
        best = distance;
        movement = shift;
        x = candidateX;
        y = candidateY;
      }
    }
  return { x, y };
}

function twoLinePrintableLabelGeometry(
  label: Readonly<Pick<LayoutLabel, "x" | "y" | "width" | "height">>,
  lines: readonly [string, string],
  capacity: number,
  routes: readonly (readonly LayoutPoint[])[],
  size: number,
  fit: boolean,
): PrintableLabelPlacement {
  const m0 = printableTextMetrics(lines[0].normalize("NFC"), size, false, true),
    m1 = printableTextMetrics(lines[1].normalize("NFC"), size, false, true);
  const advance0 = fit
      ? boundedPrintableAdvance(lines[0], size, capacity, true)
      : m0.advance,
    advance1 = fit
      ? boundedPrintableAdvance(lines[1], size, capacity, true)
      : m1.advance;
  const scale0 = m0.advance ? advance0 / m0.advance : 1,
    scale1 = m1.advance ? advance1 / m1.advance : 1;
  const leftOffset = Math.min(m0.left * scale0, m1.left * scale1),
    rightOffset = Math.max(m0.right * scale0, m1.right * scale1);
  const width = rightOffset - leftOffset,
    topAboveY0 = m0.top - m0.middleBaseline,
    height =
      topAboveY0 + TWO_LINE_NET_LABEL_PITCH + m1.middleBaseline - m1.bottom;
  const emInset = (label.height - size) / 2;
  const reserved = {
    left: label.x + (fit ? 0 : 0.3 * size),
    right: fit ? label.x + label.width : label.x + 0.3 * size + capacity,
    top: label.y + (fit ? 0 : emInset),
    bottom: label.y + label.height - (fit ? 0 : emInset),
  };
  const { x, y } = nearestInkOrigin(
    reserved,
    width,
    height,
    leftOffset,
    m0.top,
    m0.middleBaseline,
    label.x + 0.3 * size,
    label.y + (label.height - TWO_LINE_NET_LABEL_PITCH) / 2,
    routes,
  );
  const baseline0 = y + m0.middleBaseline,
    baseline1 = y + TWO_LINE_NET_LABEL_PITCH + m1.middleBaseline;
  const baselines: readonly [number, number] = [baseline0, baseline1];
  return {
    x,
    y,
    baseline: baseline0,
    baselines,
    ink: {
      left: x + leftOffset,
      right: x + rightOffset,
      top: baseline0 - m0.top,
      bottom: baseline1 - m1.bottom,
    },
  };
}

/** Keep the conductor-facing ink edge of the reserved (formerly forced-width)
 * caption. Only text moves inside its existing clip; routes and label DTOs do not. */
export function printableLabelGeometry(
  label: Readonly<Pick<LayoutLabel, "x" | "y" | "width" | "height">>,
  text: string,
  capacity: number,
  routes: readonly (readonly LayoutPoint[])[] = [],
  size = 10,
  fit = true,
  lines?: readonly [string, string],
): PrintableLabelPlacement {
  if (lines !== undefined)
    return twoLinePrintableLabelGeometry(
      label,
      lines,
      capacity,
      routes,
      size,
      fit,
    );
  const m = printableTextMetrics(text, size),
    // Circuit captions already print at natural advance; only rooted captions fit.
    advance = fit ? boundedPrintableAdvance(text, size, capacity) : m.advance,
    scale = m.advance ? advance / m.advance : 1,
    emInset = (label.height - size) / 2;
  const reserved = {
    left: label.x + (fit ? 0 : 0.3 * size),
    right: fit ? label.x + label.width : label.x + 0.3 * size + capacity,
    top: label.y + (fit ? 0 : emInset),
    bottom: label.y + label.height - (fit ? 0 : emInset),
  };
  const { x, y } = nearestInkOrigin(
    reserved,
    (m.right - m.left) * scale,
    m.top - m.bottom,
    m.left * scale,
    m.top,
    m.middleBaseline,
    label.x + 0.3 * size,
    label.y + label.height / 2,
    routes,
  );
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
