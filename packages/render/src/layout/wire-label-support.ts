import {
  routeSegments as segments,
  pointInsideBox as inside,
  segmentTouchesBox as touchesBox,
  type InkBox,
} from "./ink-geometry.js";
import type { LayoutPoint } from "../types.js";
import { required } from "../presentation/util.js";

type Point = LayoutPoint;
export type LabelInkBox = InkBox;
export type LabelSupportContext = {
  foreign: readonly (readonly Point[])[];
  obstacles: readonly LabelInkBox[];
  bounds: LabelInkBox;
  strokeClearance?: number;
  foreignStrokes?: readonly number[];
};
const EPSILON = 1e-7;
function contact(a: Point, b: Point, c: Point, d: Point) {
  return touchesBox(a, b, {
    left: Math.min(c.x, d.x),
    right: Math.max(c.x, d.x),
    top: Math.min(c.y, d.y),
    bottom: Math.max(c.y, d.y),
  });
}

/** A whole upright caption needs a supporting horizontal run, not a corner's
 * minimum distance to an unrelated vertical leg. Inline plates remain legal. */
export function horizontalLabelSupport(
  ink: LabelInkBox,
  own: readonly (readonly Point[])[],
  maxGap: number,
  foreign: readonly (readonly Point[])[] = [],
) {
  return own.some((route) =>
    segments(route).some(({ a, b }) => {
      if (
        Math.abs(a.y - b.y) > EPSILON ||
        Math.min(a.x, b.x) > ink.left + EPSILON ||
        Math.max(a.x, b.x) < ink.right - EPSILON ||
        Math.max(ink.top - a.y, a.y - ink.bottom, 0) > maxGap
      )
        return false;
      const corridor = {
        left: ink.left,
        right: ink.right,
        top: Math.min(ink.top, a.y),
        bottom: Math.max(ink.bottom, a.y),
      };
      return !foreign.some((r) =>
        segments(r).some((s) => touchesBox(s.a, s.b, corridor)),
      );
    }),
  );
}

/** Open arrow, kept distinct from electrical junction dots and physical routes. */
export function labelLeaderArrow(points: readonly Point[], size = 3) {
  const end = required(points.at(-1), "Missing leader endpoint"),
    before = required(points.at(-2), "Missing leader approach");
  const length = Math.hypot(end.x - before.x, end.y - before.y),
    dx = (end.x - before.x) / length,
    dy = (end.y - before.y) / length;
  return [
    {
      x: end.x - dx * size - (dy * size) / 2,
      y: end.y - dy * size + (dx * size) / 2,
    },
    end,
    {
      x: end.x - dx * size + (dy * size) / 2,
      y: end.y - dy * size - (dx * size) / 2,
    },
  ];
}
function clearLeader(
  points: readonly Point[],
  ink: LabelInkBox,
  context: LabelSupportContext,
  arrowSize: number,
) {
  const paths = [points, labelLeaderArrow(points, arrowSize)];
  const pad = (box: LabelInkBox) => ({
    left: box.left - (context.strokeClearance ?? 0),
    right: box.right + (context.strokeClearance ?? 0),
    top: box.top - (context.strokeClearance ?? 0),
    bottom: box.bottom + (context.strokeClearance ?? 0),
  });
  return paths.every(
    (path) =>
      path.every((p) => inside(p, context.bounds)) &&
      segments(path).every(
        ({ a, b }) =>
          !touchesBox(a, b, pad(ink)) &&
          !context.obstacles.some((o) => touchesBox(a, b, pad(o))) &&
          !context.foreign.some((r) =>
            segments(r).some((s) =>
              touchesBox(
                a,
                b,
                pad({
                  left: Math.min(s.a.x, s.b.x),
                  right: Math.max(s.a.x, s.b.x),
                  top: Math.min(s.a.y, s.b.y),
                  bottom: Math.max(s.a.y, s.b.y),
                }),
              ),
            ),
          ),
      ),
  );
}

function prematureOwnerContact(
  points: readonly Point[],
  own: readonly (readonly Point[])[],
) {
  const runs = segments(points),
    end = required(points.at(-1), "Missing leader tip");
  return runs.some((s, i) =>
    own.some((route) =>
      segments(route).some((t) => {
        if (!contact(s.a, s.b, t.a, t.b)) return false;
        const left = Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x)),
          right = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)),
          top = Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y)),
          bottom = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y));
        return (
          i !== runs.length - 1 ||
          Math.hypot(right - left, bottom - top) > EPSILON ||
          !inside(end, { left, right, top, bottom })
        );
      }),
    ),
  );
}

function leaderProposals(
  start: Point,
  end: Point,
  area: LabelInkBox,
  arrowSize: number,
) {
  const proposals: Point[][] = [];
  for (const raw of [
    [start, end],
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ]) {
    const points = raw.filter(
      (p, i) =>
        i === 0 ||
        Math.hypot(
          p.x - required(raw[i - 1], "Missing leader point").x,
          p.y - required(raw[i - 1], "Missing leader point").y,
        ) > EPSILON,
    );
    if (points.length < 2 || points.some((p) => !inside(p, area))) continue;
    const runs = segments(points);
    if (
      runs.some(
        ({ a, b }) =>
          Math.abs(a.x - b.x) > EPSILON && Math.abs(a.y - b.y) > EPSILON,
      ) ||
      Math.hypot(
        end.x - required(points.at(-2), "Missing leader approach").x,
        end.y - required(points.at(-2), "Missing leader approach").y,
      ) < arrowSize
    )
      continue;
    proposals.push(points);
  }
  return proposals;
}

/** Bounded annotation search within the existing label reservation and its
 * established 2 mm association reach. No route, endpoint, font or clip moves. */
export function ownedLabelLeader(
  ink: LabelInkBox,
  reservation: LabelInkBox,
  own: readonly (readonly Point[])[],
  context: LabelSupportContext,
  reach: number,
  unit = 1,
) {
  const arrowSize = 3 * unit;
  const area = {
    left: reservation.left - reach,
    right: reservation.right + reach,
    top: reservation.top - reach,
    bottom: reservation.bottom + reach,
  };
  const starts = [
    { x: (ink.left + ink.right) / 2, y: ink.top - arrowSize },
    { x: (ink.left + ink.right) / 2, y: ink.bottom + arrowSize },
    { x: ink.left - arrowSize, y: (ink.top + ink.bottom) / 2 },
    { x: ink.right + arrowSize, y: (ink.top + ink.bottom) / 2 },
  ];
  const candidates: { points: Point[]; length: number }[] = [];
  for (const route of own)
    for (const { a, b } of segments(route))
      for (const start of starts) {
        // Projection onto the actual owner segment, never onto another same-net wire.
        const end = {
          x: Math.max(
            Math.min(a.x, b.x),
            Math.min(Math.max(a.x, b.x), start.x),
          ),
          y: Math.max(
            Math.min(a.y, b.y),
            Math.min(Math.max(a.y, b.y), start.y),
          ),
        };
        for (const points of leaderProposals(start, end, area, arrowSize)) {
          const runs = segments(points);
          if (!clearLeader(points, ink, context, arrowSize)) continue;
          if (prematureOwnerContact(points, own)) continue;
          candidates.push({
            points,
            length: runs.reduce(
              (sum, s) => sum + Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y),
              0,
            ),
          });
        }
      }
  return candidates.sort((a, b) => a.length - b.length)[0]?.points;
}

export function labelFrameObstacles(box: LabelInkBox): LabelInkBox[] {
  return [
    { ...box, bottom: box.top },
    { ...box, top: box.bottom },
    { ...box, right: box.left },
    { ...box, left: box.right },
  ];
}
