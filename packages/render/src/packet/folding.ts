import { viewportSize } from "./viewport-size.js";
import { sectionGroups, stackSections } from "./fold-stack.js";
import { stripEnvelope } from "./strip-envelope.js";
import { rootedDraft } from "./rooted-draft.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import { required } from "../presentation/util.js";
import type { Draft, DrawingBounds } from "./types.js";
import type { NormalizedSchematicLayout } from "../types.js";
import { shiftRootedInk, clipRootedInk, type InkBox } from "./rooted-ink.js";

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
  context?: {
    prepared: PreparedSchematicDrawing;
    inner: string;
    profile?: "compact" | "dense";
    groups?: readonly (readonly number[])[];
  },
): Draft[] {
  const pad = OUTER_SVG_PADDING,
    nx = xs.length - 1;
  const untrimmed = structuredClone(drafts);
  const heights: number[] = [];
  for (let col = 0; col < nx; col++) {
    const x0 = xs[col]! - pad,
      x1 = xs[col + 1]! - pad;
    if (context) {
      const envelope = stripEnvelope(context.prepared, x0, x1, fullH - pad);
      if (!envelope) return untrimmed;
      const source = required(drafts[col], "Missing strip");
      const next = rootedDraft(
        context.prepared,
        {
          xs: [x0 + pad, x1 + pad],
          ys: [envelope.y + pad, envelope.y + envelope.h + pad],
        },
        0,
        0,
        source.drawingBounds ?? b,
        scale,
        context.inner,
        context.profile,
        source.continuedCaptionY,
      );
      if (source.rootedScoreBounds)
        next.rootedScoreBounds = source.rootedScoreBounds;
      const oldY = required(
        source.rootedSections?.[0],
        "Missing strip viewport",
      ).viewport.y;
      next.links = source.links.map((l) => ({
        ...l,
        y: l.y + (oldY - envelope.y) * scale,
      }));
      drafts[col] = next;
      heights.push(envelope.h * scale);
      continue;
    }
    // Layout-only test callers retain this crop; production supplies context.
    const spans = sectionSpans(layout, x0, x1);
    if (!spans.length) return untrimmed;
    const start = Math.max(0, Math.min(...spans.map((s) => s.y)) + pad - 12);
    const end = Math.min(
      fullH,
      Math.max(...spans.map((s) => s.y + s.h)) + pad + 12,
    );
    const h = viewportSize(end - start, scale),
      draft = required(drafts[col], "Missing strip");
    heights.push(h);
    trimSectionViewport(draft, {
      x: x0,
      y: start - pad,
      w: x1 - x0,
      h: end - start,
    });
    // Only the first viewport belongs to this section; drawing text is unchanged.
    draft.content = draft.content.replace(/<svg\b[^>]*>/u, (tag) =>
      tag
        .replace(/\bheight="[^"]*"/u, `height="${h}"`)
        .replace(
          /\bviewBox="[^"]*"/u,
          `viewBox="${n(xs[col]!)} ${n(start)} ${n(xs[col + 1]! - xs[col]!)} ${n(end - start)}"`,
        ),
    );
    shiftRootedInk(draft, -start * scale);
    clipRootedInk(draft, { x: b.x, y: b.y, w: (x1 - x0) * scale, h });
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
  const groups = context?.groups ?? sectionGroups(heights, b.h);
  return groups.length < drafts.length
    ? stackSections(drafts, heights, groups, b)
    : untrimmed;
}

function trimSectionViewport(draft: Draft, viewport: InkBox) {
  if (draft.rootedSections)
    draft.rootedSections = draft.rootedSections.map((section) => ({
      ...section,
      viewport,
    }));
}

function sectionSpans(
  layout: NormalizedSchematicLayout,
  x0: number,
  x1: number,
) {
  const spans: { y: number; h: number }[] = [];
  for (const box of [
    ...layout.nodes.filter((n) => n.kind !== "location"),
    ...layout.labels,
  ]) {
    if (box.x < x1 && box.x + box.width > x0)
      spans.push({ y: box.y, h: box.height });
  }
  for (const edge of layout.edges)
    for (let i = 1; i < edge.points.length; i++) {
      const a = required(edge.points[i - 1], "Missing route point"),
        z = required(edge.points[i], "Missing route point");
      if (Math.max(a.x, z.x) >= x0 && Math.min(a.x, z.x) <= x1)
        spans.push({ y: Math.min(a.y, z.y), h: Math.abs(a.y - z.y) });
    }
  return spans;
}
