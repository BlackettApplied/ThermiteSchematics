import { clippedSegment, strokeMetadata } from "./painted-ink.js";
import type { Page } from "playwright-core";
import {
  svgOutlineGeometry,
  bounds,
  distance,
  primitiveDistance,
} from "../../../cli/test/helpers/svg-outline-geometry.js";

/** Independent painted-ink oracle. No renderer slots, reference DTOs or
 * production obstacle inventory; coordinates are the packet's printed mm. */
export async function referenceInkOracle(page: Page, svg: string) {
  const g = await svgOutlineGeometry(page, svg);
  const meta = await page.evaluate(strokeMetadata, true);
  const shapes = g.shapes.flatMap((s, i) => {
    const m = meta[i];
    if (!m?.ink) return [];
    const pieces = s.points.slice(1).flatMap((p, j) => {
      const a = s.points[j]!;
      const ps = clippedSegment(a, p, m.clip);
      return ps.length ? [ps] : [];
    });
    return pieces.length ? [{ ...s, ...m, index: i, pieces }] : [];
  });
  const texts = g.texts.filter((t) => t.painted);
  const labels = texts
    .filter((t) => t.text.includes("(reference, no wire)"))
    .map((t) => ({
      text: t.text,
      box: t.box,
      sizeMm: t.size * Math.hypot(t.matrix[0], t.matrix[1]),
      strokeGap: Math.min(
        ...shapes.flatMap((s) =>
          s.pieces.map((ps) => primitiveDistance(t.box, ps) - s.stroke / 2),
        ),
      ),
      textGap: Math.min(
        ...texts.filter((x) => x !== t).map((x) => distance(t.box, x.box)),
      ),
    }));
  const leaders = shapes
    .filter((s) => s.leader)
    .map((s) => {
      const start = s.points[0]!,
        anchor = {
          left: start.x,
          right: start.x,
          top: start.y,
          bottom: start.y,
        },
        box = bounds(s.points);
      const attached = (other: typeof s) =>
        primitiveDistance(anchor, other.points) <= other.stroke / 2 + 1e-4 ||
        (other.circle &&
          Math.hypot(
            (bounds(other.points).left + bounds(other.points).right) / 2 -
              start.x,
            (bounds(other.points).top + bounds(other.points).bottom) / 2 -
              start.y,
          ) < 1e-4);
      return {
        box,
        points: s.points,
        length: s.points
          .slice(1)
          .reduce(
            (sum, p, i) =>
              sum + Math.hypot(p.x - s.points[i]!.x, p.y - s.points[i]!.y),
            0,
          ),
        paintedLength: s.pieces.reduce(
          (sum, ps) =>
            sum + Math.hypot(ps[1]!.x - ps[0]!.x, ps[1]!.y - ps[0]!.y),
          0,
        ),
        strokeGap: Math.min(
          ...shapes
            .filter((x) => x.index !== s.index && !attached(x))
            .flatMap((x) =>
              x.pieces.map(
                (ps) => primitiveDistance(box, ps) - (s.stroke + x.stroke) / 2,
              ),
            ),
        ),
        textGap: Math.min(
          ...texts.map(
            (t) => primitiveDistance(t.box, s.points) - s.stroke / 2,
          ),
        ),
      };
    });
  return { labels, leaders };
}
