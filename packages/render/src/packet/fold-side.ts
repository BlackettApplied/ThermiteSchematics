import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";
import { required } from "../presentation/util.js";
import { stripEnvelope } from "./strip-envelope.js";
import { sectionGroups, stackSections } from "./fold-stack.js";
import { rootedDraft } from "./rooted-draft.js";
import type { RootedCandidate } from "./rooted-build.js";
import type { Draft, DrawingBounds } from "./types.js";

function trimStrip(
  c: RootedCandidate,
  source: Draft,
  b: DrawingBounds,
  inner: string,
) {
  const viewport = required(
    source.rootedSections?.[0],
    "Missing source strip",
  ).viewport;
  const envelope = stripEnvelope(
    c.prepared,
    viewport.y,
    viewport.y + viewport.h,
    c.prepared.layout.width + pad,
    "x",
  );
  if (!envelope) return undefined;
  const next = rootedDraft(
    c.prepared,
    {
      xs: [envelope.x + pad, envelope.x + envelope.w + pad],
      ys: [viewport.y + pad, viewport.y + viewport.h + pad],
    },
    0,
    0,
    b,
    c.scale,
    inner,
    c.profile,
    source.continuedCaptionY,
  );
  if (source.rootedScoreBounds)
    next.rootedScoreBounds = source.rootedScoreBounds;
  next.links = source.links.map((link) => ({
    ...link,
    x: link.x + (viewport.x - envelope.x) * c.scale,
  }));
  return { draft: next, width: envelope.w * c.scale };
}

/** One deterministic composition of a selected TB winner's existing strips.
 * No ELK, new cuts, placement alternatives, strip reordering or route edits. */
export function sideSections(
  c: RootedCandidate,
  inner: string,
): Draft[] | undefined {
  if (
    c.prepared.view.flow !== "top-to-bottom" ||
    c.grid.xs.length !== 2 ||
    c.grid.ys.length <= 2 ||
    c.drafts.some(
      (d) =>
        d.rootedSections?.length !== 1 ||
        d.links.some((l) => l.to < 1 || l.to > c.drafts.length),
    )
  )
    return undefined;
  const b = required(c.drafts[0]?.drawingBounds, "Missing composition bounds");
  const strips = c.drafts.map((d) => trimStrip(c, d, b, inner));
  // A merged page's figures cannot hide an empty/enclosure-only or tail strip.
  if (
    strips.some((s) => !s || !s.draft.rootedContent?.figures || s.width > b.w)
  )
    return undefined;
  const valid = strips.map((s) => required(s, "Missing trimmed strip"));
  const widths = valid.map((s) => s.width),
    groups = sectionGroups(widths, b.w);
  if (groups.length >= c.drafts.length) return undefined;
  return stackSections(
    valid.map((s) => s.draft),
    widths,
    groups,
    b,
    "x",
  );
}
