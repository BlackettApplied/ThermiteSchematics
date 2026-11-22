import type { PreparedSchematicDrawing } from "../renderer.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";
import { required } from "../presentation/util.js";
import { sectionGroups, SECTION_GAP } from "./fold-stack.js";
import { stripEnvelope } from "./strip-envelope.js";
import { rootedDraft } from "./rooted-draft.js";
import { gridLinks, type RootedGrid } from "./rooted-plans.js";
import type { Draft, DrawingBounds } from "./types.js";

export type FoldGroups = readonly (readonly number[])[];
export const MAX_FRAME_FOLD_PLANS = 64;

/** A finite family of contiguous folds over existing routed strips. */
export function frameFoldGroups(
  p: PreparedSchematicDrawing,
  grid: RootedGrid,
  b: DrawingBounds,
  scale: number,
): (FoldGroups | undefined)[] {
  if (grid.ys.length !== 2 || grid.xs.length <= 2) return [undefined];
  const heights: number[] = [];
  for (let i = 0; i < grid.xs.length - 1; i++) {
    const envelope = stripEnvelope(
      p,
      required(grid.xs[i], "Missing strip start") - pad,
      required(grid.xs[i + 1], "Missing strip end") - pad,
      p.layout.height + pad,
    );
    if (!envelope) return [undefined];
    heights.push(envelope.h * scale);
  }
  const plans: FoldGroups[] = [sectionGroups(heights, b.h)];
  const seen = new Set(plans.map((g) => JSON.stringify(g)));
  enumerateFolds(heights, b.h, 0, [], plans, seen);
  return plans;
}
function enumerateFolds(
  heights: readonly number[],
  available: number,
  start: number,
  prefix: number[][],
  plans: FoldGroups[],
  seen: Set<string>,
) {
  if (plans.length >= MAX_FRAME_FOLD_PLANS) return;
  if (start === heights.length) {
    const key = JSON.stringify(prefix);
    if (!seen.has(key)) {
      seen.add(key);
      plans.push(prefix);
    }
    return;
  }
  let used = 0;
  for (let end = start; end < heights.length; end++) {
    used +=
      required(heights[end], "Missing strip height") +
      (end === start ? 0 : SECTION_GAP);
    if (used > available) break;
    enumerateFolds(
      heights,
      available,
      end + 1,
      [...prefix, Array.from({ length: end - start + 1 }, (_, n) => start + n)],
      plans,
      seen,
    );
    if (plans.length >= MAX_FRAME_FOLD_PLANS) break;
  }
}

/** Every part sharing a physical sheet sees the union of that sheet's cuts. */
export function foldedBankProbes(
  probes: Draft[] | undefined,
  groups: FoldGroups | undefined,
): Draft[] | undefined {
  if (!probes || !groups || groups.length === probes.length) return probes;
  const result = [...probes];
  for (const group of groups) {
    const links = group.flatMap(
      (i) => required(probes[i], "Missing fold probe").links,
    );
    for (const i of group)
      result[i] = { ...required(probes[i], "Missing fold probe"), links };
  }
  return result;
}

export function rootedGridDrafts(
  p: PreparedSchematicDrawing,
  grid: RootedGrid,
  boundsFor: (index: number) => DrawingBounds,
  scale: number,
  inner: string,
  profile: "compact" | "dense" | undefined,
  captionY: number,
): Draft[] {
  const drafts: Draft[] = [];
  for (let row = 0; row < grid.ys.length - 1; row++)
    for (let col = 0; col < grid.xs.length - 1; col++)
      drafts.push(
        rootedDraft(
          p,
          grid,
          col,
          row,
          boundsFor(row * (grid.xs.length - 1) + col),
          scale,
          inner,
          profile,
          captionY,
        ),
      );
  return drafts;
}

/** Rejected candidates retain their planned physical fields in the receipt. */
export function previewFrameFields(
  p: PreparedSchematicDrawing,
  grid: RootedGrid,
  b: DrawingBounds,
  scale: number,
  groups: FoldGroups | undefined,
  fieldFor: (probe: Draft) => DrawingBounds,
): DrawingBounds[] {
  const probes = Array.from(
    { length: (grid.xs.length - 1) * (grid.ys.length - 1) },
    () => ({ links: [] }) as unknown as Draft,
  );
  gridLinks(p, grid, b, scale, probes);
  const planned = foldedBankProbes(probes, groups) ?? probes;
  return (groups ?? probes.map((_, i) => [i])).map((g) =>
    fieldFor(
      required(
        planned[required(g[0], "Missing group index")],
        "Missing planned group",
      ),
    ),
  );
}
