import { required } from "../presentation/util.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { Draft } from "./types.js";
import type { InkBox } from "./rooted-ink.js";

export interface RootedContent {
  figures: number;
  conductors: number;
}
const intersects = (a: InkBox, b: InkBox) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Actual segments, rather than their envelopes, distinguish empty cells from
 * conductor-only tails. ELK routes are orthogonal and never modified here. */
export function segmentVisible(
  a: { x: number; y: number },
  z: { x: number; y: number },
  b: InkBox,
) {
  let start = 0,
    end = 1;
  for (const [from, to, low, high] of [
    [a.x, z.x, b.x, b.x + b.w],
    [a.y, z.y, b.y, b.y + b.h],
  ] as const) {
    const delta = to - from;
    if (delta === 0) {
      if (from < low || from > high) return false;
    } else {
      const t1 = (low - from) / delta,
        t2 = (high - from) / delta;
      start = Math.max(start, Math.min(t1, t2));
      end = Math.min(end, Math.max(t1, t2));
      if (end < start) return false;
    }
  }
  return (end - start) * Math.hypot(z.x - a.x, z.y - a.y) > 0.001;
}

export function viewportContent(
  p: PreparedSchematicDrawing,
  view: InkBox,
): RootedContent {
  let figures = 0,
    conductors = 0;
  for (const node of p.graph.nodes) {
    if (node.kind === "junction") continue;
    const pos = p.layout.nodes.find((n) => n.id === node.id);
    if (!pos) continue;
    if (
      intersects(
        {
          x: pos.x + node.primitiveOrigin.x,
          y: pos.y + node.primitiveOrigin.y,
          w: node.symbolSize.width,
          h: node.symbolSize.height,
        },
        view,
      )
    )
      figures++;
    for (const label of node.labels.filter((l) => l.offView)) {
      const box = p.layout.labels.find((l) => l.id === label.id);
      if (
        box &&
        intersects({ x: box.x, y: box.y, w: box.width, h: box.height }, view)
      )
        figures++;
    }
  }
  const ids = new Set(
    p.graph.edges.filter((e) => e.kind === "conductor").map((e) => e.id),
  );
  for (const edge of p.layout.edges.filter((e) => ids.has(e.id)))
    if (
      edge.points.some(
        (z, i) =>
          i > 0 &&
          segmentVisible(
            required(edge.points[i - 1], "Missing route point"),
            z,
            view,
          ),
      )
    )
      conductors++;
  return { figures, conductors };
}

export function sumContent(drafts: readonly Draft[]): RootedContent {
  return drafts.reduce(
    (sum, d) => ({
      figures: sum.figures + (d.rootedContent?.figures ?? 0),
      conductors: sum.conductors + (d.rootedContent?.conductors ?? 0),
    }),
    { figures: 0, conductors: 0 },
  );
}

/** Empty virtual cells carry no source ink or links. Omit them and remap the
 * remaining destinations; never discard a conductor-only tail. */
export function contentPages(drafts: Draft[]): Draft[] | string {
  const keep = drafts
    .map((d, i) => ({ d, old: i + 1 }))
    .filter(
      ({ d }) =>
        (d.rootedContent?.figures ?? 0) > 0 ||
        (d.rootedContent?.conductors ?? 0) > 0 ||
        d.links.length > 0,
    );
  if (!keep.length)
    return "No device, terminal or card fits on a rooted drawing sheet.";
  if (keep.some(({ d }) => !d.rootedContent?.figures))
    return "A conductor-only tail has no device, terminal or card. Use different cuts, a larger sheet or landscape.";
  const destination = new Map(keep.map(({ old }, i) => [old, i + 1]));
  if (keep.some(({ d }) => d.links.some((l) => !destination.has(l.to))))
    return "An empty sheet cannot be removed while a conductor references it.";
  return keep.map(({ d }) => ({
    ...d,
    links: d.links.map((l) => ({
      ...l,
      to: required(destination.get(l.to), "Missing sheet destination"),
    })),
  }));
}
