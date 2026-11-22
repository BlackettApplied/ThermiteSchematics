import { invariant } from "../presentation/util.js";
import { emitSchematicSvg } from "../svg/emitter.js";
import { sideSections } from "./fold-side.js";
import { rootedLocationContent } from "./location-headings.js";
import { compositionFits } from "./composition-fit.js";
import { routeGrowth } from "./rooted-clipped-routes.js";
import { compareCandidates } from "./rooted-score.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { RootedCandidate } from "./rooted-build.js";
import type { PaperPage } from "./types.js";

/** Compare only the original materialized winner and one symmetric alternative.
 * This runs after search, including its early exit, and cannot add ELK work. */
export function composeRootedWinner(
  ir: Readonly<ElectricalIr>,
  original: RootedCandidate,
  native: RootedCandidate,
  page: PaperPage,
): RootedCandidate {
  // Discover final viewports before filtering original location headings.
  const geometry = sideSections(original, "");
  if (!geometry) return original;
  const p = original.prepared;
  const emitted = emitSchematicSvg(
    p.graph,
    p.layout,
    p.titleContext,
    undefined,
    true,
    original.scale,
    ir,
  );
  // Defensive invariant: the validated winner has already passed this emitter.
  invariant(
    emitted.ok,
    "Validated rooted winner failed re-emission during composition",
  );
  const inner = emitted.value
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(/^<svg[^>]*>\s*/, "")
    .replace(/<\/svg>\s*$/, "");
  const drafts = sideSections(
    original,
    rootedLocationContent(inner, p, geometry),
  );
  if (!drafts) return original;
  const alternative: RootedCandidate = { ...original, drafts };
  delete alternative.printableDrafts;
  if (
    routeGrowth(alternative, original, false).some((n) => n > 0) ||
    routeGrowth(alternative, original).some((n) => n > 0) ||
    compareCandidates(
      alternative,
      original,
      native.jogs,
      page,
      native.detours,
      native,
      original,
    ) >= 0 ||
    !compositionFits(alternative, native, page)
  )
    return original;
  return alternative;
}
