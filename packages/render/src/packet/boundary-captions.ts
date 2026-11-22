import {
  inside,
  intersection,
  project,
  expand,
} from "../device-legend/geometry.js";
import { printableTextMetrics } from "../text-metrics.js";
import { decodeSvgSemanticId, svgSemanticId } from "../svg/escape.js";
import { conductorEndpoints } from "./navigation-incidence.js";
import {
  navigationGeometry,
  type NavigationGeometry,
} from "./navigation-walk.js";
import {
  CONTINUATION_CLEARANCE,
  CONTINUATION_PITCH,
} from "./continuation-label.js";
import type { Draft, Link } from "./types.js";

function nativeEdge(link: Link) {
  const source = link.provenance;
  if (!source) return undefined;
  return JSON.stringify(
    source.kind === "cable_conductor"
      ? ["cable-conductor", source.cableUid, source.conductorId]
      : [source.kind, source.uid],
  );
}

function captionEdge(clip: string) {
  const id = /(?:^|-)(clip-[a-f0-9]+)$/u.exec(clip)?.[1];
  if (!id) return undefined;
  const [label] = decodeSvgSemanticId("clip", id);
  if (!label) return undefined;
  const [kind, owner, edge, role] = JSON.parse(label);
  return kind === "label" && owner === "edge" && role === "conductor"
    ? edge
    : undefined;
}

function captionInk(caption: NavigationGeometry) {
  const { x, y, "font-size": size, textLength } = caption.node.attrs;
  const font = printableTextMetrics(caption.node.text, Number(size));
  const ratio = textLength ? Number(textLength) / font.advance : 1;
  return project(
    {
      x: Number(x) + font.left * ratio,
      y: Number(y) - font.top,
      w: (font.right - font.left) * ratio,
      h: font.top - font.bottom,
    },
    caption.matrix,
  );
}

function nearSameCut(
  link: Link,
  caption: NavigationGeometry,
  route: NavigationGeometry,
) {
  // Restrict to an uninterrupted straight route. Its final viewport must
  // contain the caption and meet the continuation's actual stroke anchor.
  const d = route.node.attrs.d ?? "";
  if (!/^M [-.\d]+ [-.\d]+ [HV] [-.\d]+$/u.test(d)) return false;
  if (route.matrix.some((value, i) => value !== caption.matrix[i]))
    return false;
  const [a, b] = conductorEndpoints(d).map((p) =>
    project({ ...p, w: 0, h: 0 }, route.matrix),
  );
  if (
    !a ||
    !b ||
    !inside({ x: link.x, y: link.y, w: 0, h: 0 }, expand(route.clip, 0.01))
  )
    return false;
  const vertical = link.side === "top" || link.side === "bottom";
  const ink = captionInk(caption);
  if (!inside(ink, expand(caption.clip, 0.002))) return false;
  const run = vertical ? [a.y, b.y] : [a.x, b.x],
    across = vertical ? [a.x, b.x, link.x] : [a.y, b.y, link.y],
    cut = vertical ? link.y : link.x,
    start = vertical ? ink.y : ink.x,
    end = start + (vertical ? ink.h : ink.w),
    distance = Math.max(start - cut, cut - end, 0),
    side = vertical ? ink.x : ink.y,
    sideEnd = side + (vertical ? ink.w : ink.h),
    anchor = vertical ? link.x : link.y,
    gap = Math.max(side - anchor, anchor - sideEnd, 0);
  return (
    Math.max(...across) - Math.min(...across) <= 0.01 &&
    Math.min(...run) < cut &&
    cut < Math.max(...run) &&
    Math.min(...run) <= start &&
    end <= Math.max(...run) &&
    gap <= 2 &&
    distance <= CONTINUATION_PITCH + CONTINUATION_CLEARANCE
  );
}

type CaptionDraft = Pick<Draft, "content" | "links">;

function continuationCandidates(links: readonly Link[]) {
  return links.filter(
    (link) =>
      link.toZone &&
      link.label &&
      nativeEdge(link) &&
      link.label.rows.some(
        (r) =>
          r.text === link.conductor ||
          (link.label?.single && r.text.endsWith(` / ${link.conductor}`)),
      ),
  );
}

function conductorCaptions(draft: CaptionDraft, candidates: readonly Link[]) {
  if (!draft.content.includes("label-conductor")) return [];
  const geometry = navigationGeometry(draft.content);
  return geometry.flatMap((g, index) => {
    if (
      !g.visible ||
      g.node.name !== "text" ||
      !g.node.attrs.class?.split(" ").includes("label-conductor")
    )
      return [];
    const clip = /url\(#([^)]+)\)/u.exec(g.node.attrs["clip-path"] ?? "")?.[1];
    if (!clip) return [];
    const edge = captionEdge(clip);
    if (!edge) return [];
    const key = svgSemanticId("edge", [edge]);
    const replacement =
      geometry[index - 2]?.node.attrs.class !== "wire-label-leader-arrow" &&
      candidates.some(
        (link) =>
          link.conductor === g.node.text &&
          nativeEdge(link) === edge &&
          geometry.some(
            (r) =>
              r.visible &&
              r.node.name === "path" &&
              r.node.attrs["data-edge-key"] === key &&
              r.node.attrs["data-net-id"] === link.netId &&
              nearSameCut(link, g, r),
          ),
      );
    return [
      {
        clip,
        source: g.viewKey && JSON.stringify([g.viewKey, edge, g.node.text]),
        replacement,
        clipped: !intersection(captionInk(g), expand(g.clip, 0.01)),
      },
    ];
  });
}

function blankCaptionInk(content: string, clips: ReadonlySet<string>) {
  if (!clips.size) return content;
  return content.replace(
    /(<rect\b[^>]*\bclass="label-background label-conductor"[^>]*\/>\s*)(<text\b[^>]*\bclip-path="url\(#([^"]+)\)"[^>]*>)[^<]*<\/text>/gu,
    (block, plate: string, text: string, clip: string) =>
      clips.has(clip)
        ? plate.replace("<rect ", '<rect visibility="hidden" ') +
          text +
          "</text>"
        : block,
  );
}

/** Keep the elements in their original order across tiled copies. When a
 * continuation carries the source caption, discard only its redundant ink
 * and the fully clipped replicas of that caption in the same authored view. */
export function boundaryCaptionContents(drafts: readonly CaptionDraft[]) {
  const candidates = drafts.map((draft) => continuationCandidates(draft.links));
  if (!candidates.some((links) => links.length))
    return drafts.map((draft) => draft.content);
  const captions = drafts.map((draft, i) =>
    conductorCaptions(draft, candidates[i] ?? []),
  );
  const replaced = new Set(
    captions
      .flat()
      .flatMap((c) => (c.replacement && c.source ? [c.source] : [])),
  );
  return drafts.map((draft, i) =>
    blankCaptionInk(
      draft.content,
      new Set(
        (captions[i] ?? []).flatMap((c) =>
          c.replacement || (c.clipped && replaced.has(c.source))
            ? [c.clip]
            : [],
        ),
      ),
    ),
  );
}
