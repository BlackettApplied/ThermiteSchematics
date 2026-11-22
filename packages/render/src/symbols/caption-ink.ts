import { printableTextMetrics } from "../text-metrics.js";
import type { CaptionBox, CaptionSegment } from "./circuit-caption.js";

export const CAPTION_CLEARANCE_MM = 1;
export class CaptionPlacementError extends Error {
  constructor(readonly value: string) {
    super(
      `No ink-safe caption position for ${value}: needs 1 mm clearance inside its device.`,
    );
    this.name = "CaptionPlacementError";
  }
}
export function captionInk(
  value: string,
  x: number,
  y: number,
  size: number,
  anchor = "start",
  bold = false,
): CaptionBox {
  const m = printableTextMetrics(value, size, bold);
  const left =
    x -
    (anchor === "middle" ? m.advance / 2 : anchor === "end" ? m.advance : 0);
  return {
    left: left + m.left,
    right: left + m.right,
    top: y - m.top,
    bottom: y - m.bottom,
  };
}

export function inkGap(a: CaptionBox, b: CaptionBox): number {
  return Math.hypot(
    Math.max(a.left - b.right, b.left - a.right, 0),
    Math.max(a.top - b.bottom, b.top - a.bottom, 0),
  );
}

export function strokeBoxes(
  segments: readonly CaptionSegment[],
  stroke: number,
): CaptionBox[] {
  return segments.map(([a, b]) => ({
    left: Math.min(a.x, b.x) - stroke / 2,
    right: Math.max(a.x, b.x) + stroke / 2,
    top: Math.min(a.y, b.y) - stroke / 2,
    bottom: Math.max(a.y, b.y) + stroke / 2,
  }));
}

const shifted = (box: CaptionBox, dx: number, dy: number): CaptionBox => ({
  left: box.left + dx,
  right: box.right + dx,
  top: box.top + dy,
  bottom: box.bottom + dy,
});

/** Keep a legal anchor unchanged; otherwise use the nearest clear position
 * inside the owner. No routing, font fitting or node growth. */
export function ownerCaption(
  value: string,
  x: number,
  y: number,
  size: number,
  anchor: string,
  bold: boolean,
  bounds: CaptionBox,
  strokes: readonly CaptionBox[],
  captions: readonly CaptionBox[] = [],
) {
  const box = captionInk(value, x, y, size, anchor, bold);
  const obstacles = [
    ...strokes.map((box) => ({ box, clearance: CAPTION_CLEARANCE_MM + 0.002 })),
    ...captions.map((box) => ({ box, clearance: 0.3 + 0.002 })),
  ];
  const valid = (dx: number, dy: number) => {
    const b = shifted(box, dx, dy);
    return (
      b.left >= bounds.left &&
      b.right <= bounds.right &&
      b.top >= bounds.top &&
      b.bottom <= bounds.bottom &&
      obstacles.every((o) => inkGap(b, o.box) >= o.clearance)
    );
  };
  if (valid(0, 0)) return { x, y, anchor, box };
  const shifts = obstacles.flatMap(({ box: o, clearance }) => [
    o.left - clearance - box.right,
    o.right + clearance - box.left,
  ]);
  shifts.push(bounds.left - box.left, bounds.right - box.right);
  const vertical = [
    0,
    ...obstacles.flatMap(({ box: o, clearance }) => [
      o.top - clearance - box.bottom,
      o.bottom + clearance - box.top,
    ]),
    bounds.top - box.top,
    bounds.bottom - box.bottom,
  ];
  const candidates = [0, ...shifts]
    .flatMap((dx) => vertical.map((dy) => ({ dx, dy })))
    .filter((p) => valid(p.dx, p.dy));
  candidates.sort(
    (a, b) =>
      Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy) ||
      Math.abs(a.dy) - Math.abs(b.dy) ||
      a.dy - b.dy ||
      a.dx - b.dx,
  );
  const p = candidates[0];
  if (!p) throw new CaptionPlacementError(value);
  return {
    x: x + p.dx,
    y: y + p.dy,
    anchor,
    box: shifted(box, p.dx, p.dy),
  };
}
