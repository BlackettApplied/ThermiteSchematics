import type { FoldAxis } from "./fold-axis.js";
import { sumContent } from "./rooted-content.js";
import { required } from "../presentation/util.js";
import type { Draft, DrawingBounds } from "./types.js";
import { unionInk } from "./rooted-ink.js";
import { zone } from "./page.js";
import { n } from "./svg.js";

export const SECTION_GAP = 14;
export function sectionGroups(heights: readonly number[], available: number) {
  const groups: number[][] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (!groups.length || used + h + SECTION_GAP > available) {
      groups.push([i]);
      used = h;
    } else {
      required(groups.at(-1), "Missing fold group").push(i);
      used += SECTION_GAP + h;
    }
  });
  return groups;
}
function scopedSection(content: string, index: number, axis: FoldAxis) {
  return content.replace(/<[^>]+>/gu, (tag) =>
    tag
      .replace(
        /(?<=\s)id="([^"]+)"/gu,
        (_, id: string) =>
          `id="${axis === "y" ? "section" : "side"}-${index}-${id}"`,
      )
      .replace(
        /(?<=\s)clip-path="url\(#([^)]+)\)"/gu,
        (_, id: string) =>
          `clip-path="url(#${axis === "y" ? "section" : "side"}-${index}-${id})"`,
      ),
  );
}
function append(
  draft: Draft,
  source: Draft,
  index: number,
  offset: number,
  destinations: Map<number, number>,
  b: DrawingBounds,
  axis: FoldAxis,
) {
  draft.content += `<g transform="translate(${axis === "y" ? `0 ${n(offset)}` : `${n(offset)} 0`})">${scopedSection(source.content, index, axis)}</g>`;
  draft.links.push(
    ...source.links.map((l) => ({
      ...l,
      to: required(destinations.get(l.to), "Missing folded destination"),
      [axis]: l[axis] + offset,
    })),
  );
  draft.references?.push(
    ...(source.references ?? []).map((r) => ({
      ...r,
      ...(axis === "y"
        ? r.yMm === undefined
          ? {}
          : { yMm: r.yMm + offset }
        : r.xMm === undefined
          ? {}
          : { xMm: r.xMm + offset }),
      zone:
        r.xMm === undefined || r.yMm === undefined
          ? r.zone
          : zone(
              r.xMm + (axis === "x" ? offset : 0),
              r.yMm + (axis === "y" ? offset : 0),
              b,
            ),
    })),
  );
  draft.rootedCaptionInk?.push(
    ...(source.rootedCaptionInk ?? []).map((s) => ({
      ...s,
      [axis]: s[axis] + offset,
    })),
  );
  draft.rootedShapes?.push(
    ...(source.rootedShapes ?? []).map((s) => ({
      ...s,
      [axis]: s[axis] + offset,
    })),
  );
}
export function stackSections(
  drafts: readonly Draft[],
  heights: readonly number[],
  groups: readonly (readonly number[])[],
  b: DrawingBounds,
  axis: FoldAxis = "y",
  gapAfter: (source: number, position: number) => number = () => SECTION_GAP,
) {
  const destinations = new Map(
    groups.flatMap((g, i) => g.map((n) => [n + 1, i + 1] as const)),
  );
  return groups.map((group) => {
    const first = required(
      drafts[required(group[0], "Missing fold index")],
      "Missing fold source",
    );
    const sources = group.map((i) =>
      required(drafts[i], "Missing fold source"),
    );
    const draft: Draft = {
      ...first,
      navigationSeeds: [
        ...new Map(
          sources
            .flatMap((s) => s.navigationSeeds ?? [])
            .map((s) => [JSON.stringify([s.source, s.logicalKey]), s]),
        ).values(),
      ],
      rootedContent: sumContent(sources),
      rootedParts: sources,
      rootedPartAxis: axis,
      rootedPartSizes: group.map((i) =>
        required(heights[i], "Missing source strip size"),
      ),
      rootedSections: sources.flatMap((s) => s.rootedSections ?? []),
      content: "",
      links: [],
      references: [],
      note: "Folded circuit sections; follow paired conductor references.",
      drawingBounds: b,
      rootedShapes: [],
      rootedCaptionInk: [],
    };
    let offset = 0;
    for (const [position, i] of group.entries()) {
      append(
        draft,
        required(drafts[i], "Missing fold source"),
        i,
        offset,
        destinations,
        b,
        axis,
      );
      offset +=
        required(heights[i], "Missing strip height") + gapAfter(i, position);
    }
    const ink = unionInk(draft.rootedShapes ?? []);
    if (ink) draft.rootedInk = ink;
    return draft;
  });
}
