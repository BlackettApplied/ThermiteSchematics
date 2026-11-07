import type { Draft, DrawingBounds } from "./types.js";
import type { NormalizedSchematicLayout } from "../types.js";
import { zone } from "./page.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import { n } from "./svg.js";

/** Pack existing horizontal sections without changing ELK geometry or endpoints. */
export function foldDrawingDrafts(
  drafts: Draft[],
  layout: NormalizedSchematicLayout,
  xs: readonly number[],
  b: DrawingBounds,
  scale: number,
  fullH: number,
): Draft[] {
  const pad = OUTER_SVG_PADDING,
    nx = xs.length - 1;
  const untrimmed = structuredClone(drafts);
  const heights: number[] = [];
  for (let col = 0; col < nx; col++) {
    const x0 = xs[col]! - pad,
      x1 = xs[col + 1]! - pad;
    const spans: { y: number; h: number }[] = [];
    for (const box of [...layout.nodes, ...layout.labels]) {
      if (box.x < x1 && box.x + box.width > x0)
        spans.push({ y: box.y, h: box.height });
    }
    for (const edge of layout.edges)
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!,
          z = edge.points[i]!;
        if (Math.max(a.x, z.x) >= x0 && Math.min(a.x, z.x) <= x1)
          spans.push({ y: Math.min(a.y, z.y), h: Math.abs(a.y - z.y) });
      }
    const start = Math.max(0, Math.min(...spans.map((s) => s.y)) + pad - 12);
    const end = Math.min(
      fullH,
      Math.max(...spans.map((s) => s.y + s.h)) + pad + 12,
    );
    const h = (end - start) * scale,
      draft = drafts[col]!;
    heights.push(h);
    // Only the first viewport belongs to this section; text/metadata is unchanged.
    draft.content = draft.content.replace(/<svg\b[^>]*>/u, (tag) =>
      tag
        .replace(/\bheight="[^"]*"/u, `height="${n(h)}"`)
        .replace(
          /\bviewBox="[^"]*"/u,
          `viewBox="${n(xs[col]!)} ${n(start)} ${n(xs[col + 1]! - xs[col]!)} ${n(end - start)}"`,
        ),
    );
    draft.links = draft.links.map((link) => ({
      ...link,
      y: link.y - start * scale,
    }));
    if (draft.references)
      draft.references = draft.references.map((r) => ({
        ...r,
        ...(r.yMm === undefined ? {} : { yMm: r.yMm - start * scale }),
      }));
  }
  const groups: number[][] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (!groups.length || used + h + 14 > b.h) {
      groups.push([i]);
      used = h;
    } else {
      groups.at(-1)!.push(i);
      used += 14 + h;
    }
  });
  if (groups.length < drafts.length) {
    const destinations = new Map(
      groups.flatMap((group, index) =>
        group.map((i) => [i + 1, index + 1] as const),
      ),
    );
    const folded = groups.map((group) => {
      const draft: Draft = {
        ...drafts[group[0]!]!,
        content: "",
        links: [],
        references: [],
        note: "Folded circuit sections; follow paired conductor references.",
        drawingBounds: b,
      };
      let offset = 0;
      for (const i of group) {
        const source = drafts[i]!;
        const scoped = source.content.replace(/<[^>]+>/gu, (tag) =>
          tag
            .replace(
              /(?<=\s)id="([^"]+)"/gu,
              (_, id: string) => `id="section-${i}-${id}"`,
            )
            .replace(
              /(?<=\s)clip-path="url\(#([^)]+)\)"/gu,
              (_, id: string) => `clip-path="url(#section-${i}-${id})"`,
            ),
        );
        draft.content += `<g transform="translate(0 ${n(offset)})">${scoped}</g>`;
        draft.links.push(
          ...source.links.map((link) => ({
            ...link,
            to: destinations.get(link.to)!,
            y: link.y + offset,
          })),
        );
        draft.references!.push(
          ...(source.references ?? []).map((r) => ({
            ...r,
            ...(r.yMm === undefined ? {} : { yMm: r.yMm + offset }),
            zone:
              r.xMm === undefined || r.yMm === undefined
                ? r.zone
                : zone(r.xMm, r.yMm + offset, b),
          })),
        );
        offset += heights[i]! + 14;
      }
      return draft;
    });
    return folded;
  }
  // If packing is not possible, keep the untrimmed draft geometry/references.
  return untrimmed;
}
