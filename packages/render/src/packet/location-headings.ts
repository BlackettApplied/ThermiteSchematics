import type { Draft } from "./types.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import { required } from "../presentation/util.js";
import type { LayoutLabel } from "../types.js";
import { printableLabelGeometry } from "../symbols/printable-label.js";
import { svgSemanticId } from "../svg/escape.js";
import type { InkBox } from "./rooted-ink.js";

/** Only headings represented by an emitted continued-location caption. */
export interface ReplacedLocationHeading {
  readonly label: LayoutLabel;
  readonly text: string;
  readonly capacity: number;
}

/** Remove only the obsolete text node, retaining all frames, backgrounds, clips
 * and layout. Coordinates are unpadded layout units, including after trimming. */
export function omitUnpaintedLocationHeadings(
  content: string,
  headings: readonly ReplacedLocationHeading[],
  viewports: readonly InkBox[],
): string {
  const omitted = new Set<string>();
  for (const { label, text, capacity } of headings) {
    if (label.ownerKind !== "location" || label.role !== "location") continue;
    const ink = printableLabelGeometry(label, text, capacity).ink;
    // Keep touching/near-touching ink: SVG coordinates round to 0.001 units.
    const outside =
      viewports.length > 0 &&
      viewports.every(
        (viewport) =>
          ink.right < viewport.x - 0.002 ||
          ink.left > viewport.x + viewport.w + 0.002 ||
          ink.bottom < viewport.y - 0.002 ||
          ink.top > viewport.y + viewport.h + 0.002,
      );
    if (outside) omitted.add(svgSemanticId("clip", [label.id]));
  }
  if (!omitted.size) return content;
  // Canonical emitter text is XML-escaped and has no nested markup. Match the
  // semantic clip identity, never the literal location name or arbitrary text.
  return content.replace(
    /<text\b[^>]*\bclip-path="url\(#([^"]+)\)"[^>]*>[^<]*<\/text>/gu,
    (element, clip: string) => (omitted.has(clip) ? "" : element),
  );
}

/** Filter the shared source once, using the final (possibly trimmed) viewports.
 * A heading painted in any section stays in every copy, preserving source text
 * identity across sheets. Only captions actually emitted can replace a heading. */
export function rootedLocationContent(
  content: string,
  p: PreparedSchematicDrawing,
  drafts: readonly Draft[],
): string {
  const sections = drafts.flatMap((d) => d.rootedSections ?? []);
  const replaced = new Set(sections.flatMap((s) => s.continuedLocationIds));
  const headings = p.graph.locationGroups
    .filter((g) => replaced.has(g.label.id))
    .map(({ label }) => ({
      label: required(
        p.layout.labels.find((l) => l.id === label.id),
        "Missing continued-location heading",
      ),
      text: label.printableText ?? label.text,
      capacity: label.textLength,
    }));
  return omitUnpaintedLocationHeadings(
    content,
    headings,
    sections.map((s) => s.viewport),
  );
}
