import { required } from "../presentation/util.js";
import { rootedDraft } from "./rooted-draft.js";
import { stripEnvelope } from "./strip-envelope.js";
import type { Draft, RootedLegendSource } from "./types.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";

/** Remove only empty space perpendicular to the cuts. The existing envelope
 * includes symbols, routes, cards and whole headings; print scale is unchanged. */
export function trimLegendStrip(
  source: RootedLegendSource,
  draft: Draft,
  inner: string,
): Draft {
  const p = source.prepared,
    v = required(draft.rootedSections?.[0], "Missing legend strip").viewport,
    vertical = p.view.flow === "top-to-bottom",
    envelope = vertical
      ? stripEnvelope(p, v.y, v.y + v.h, p.layout.width + pad, "x")
      : stripEnvelope(p, v.x, v.x + v.w, p.layout.height + pad);
  if (!envelope || !draft.rootedContent?.figures) return draft;
  const crop = vertical
    ? {
        ...v,
        x: Math.max(v.x, envelope.x),
        w:
          Math.min(v.x + v.w, envelope.x + envelope.w) -
          Math.max(v.x, envelope.x),
      }
    : {
        ...v,
        y: Math.max(v.y, envelope.y),
        h:
          Math.min(v.y + v.h, envelope.y + envelope.h) -
          Math.max(v.y, envelope.y),
      };
  const next = rootedDraft(
    p,
    {
      xs: [crop.x + pad, crop.x + crop.w + pad],
      ys: [crop.y + pad, crop.y + crop.h + pad],
    },
    0,
    0,
    required(draft.drawingBounds, "Missing strip bounds"),
    source.scale,
    inner,
    source.profile,
    draft.continuedCaptionY,
  );
  next.links = draft.links.map((link) => ({
    ...link,
    x: link.x + (v.x - crop.x) * source.scale,
    y: link.y + (v.y - crop.y) * source.scale,
  }));
  return next;
}
