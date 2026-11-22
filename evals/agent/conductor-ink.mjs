import { project } from "../../packages/render/dist/device-legend/geometry.js";
import { pathInk } from "../../packages/render/dist/device-legend/shape-ink.js";
import { descendants } from "../../packages/render/dist/device-legend/svg-tree.js";
import { paintedStroke } from "../../packages/render/dist/packet/document-assembly-geometry.js";
import { navigationGeometry } from "../../packages/render/dist/packet/navigation-walk.js";

// Standalone schematic paths own their wire UID. Circuit, wiring and both
// signal-loop emitters put the identity on a group of actual route strokes.
function groupedConductor(node) {
  if (node.name !== "g") return undefined;
  const a = node.attrs;
  return (
    a["data-circuit-conductor"] ??
    a["data-wiring-conductor"] ??
    a["data-loop-conductor"]
  );
}

function rectangularClips(root) {
  return new Set(
    descendants(root)
      .filter((node) => {
        if (node.name !== "clipPath") return false;
        const [rect] = node.children;
        return (
          node.children.length === 1 &&
          rect.name === "rect" &&
          ![node, rect].some(({ attrs }) =>
            ["transform", "style", "class", "display", "visibility"].some(
              (attribute) => Object.hasOwn(attrs, attribute),
            ),
          ) &&
          !rect.attrs.rx &&
          !rect.attrs.ry &&
          [undefined, "userSpaceOnUse"].includes(node.attrs.clipPathUnits)
        );
      })
      .map((node) => "url(#" + node.attrs.id + ")"),
  );
}

function intersectsClip(segment, { matrix, clip }) {
  // Native routes have one axis per segment before any sheet transform.
  const horizontal = segment.w > 0;
  const vertical = segment.h > 0;
  if (horizontal === vertical) return false;
  const start = project({ x: segment.x, y: segment.y, w: 0, h: 0 }, matrix);
  const end = project(
    { x: segment.x + segment.w, y: segment.y + segment.h, w: 0, h: 0 },
    matrix,
  );
  let enter = 0,
    leave = 1;
  for (const [from, to, edge, size] of [
    [start.x, end.x, clip.x, clip.w],
    [start.y, end.y, clip.y, clip.h],
  ]) {
    const travel = to - from;
    if (travel === 0) {
      if (from < edge || from > edge + size) return false;
      continue;
    }
    const atNear = (edge - from) / travel;
    const atFar = (edge + size - from) / travel;
    enter = Math.max(enter, Math.min(atNear, atFar));
    leave = Math.min(leave, Math.max(atNear, atFar));
  }
  return enter < leave;
}

function visibleRun(g) {
  const stroke = g.style?.stroke?.trim().toLowerCase();
  if (
    !/^(?:black|#(?:[0-9a-f]{3}|[0-9a-f]{6}))$/.test(stroke ?? "") ||
    !paintedStroke({ ...g, style: { ...g.style, stroke } }) ||
    !(g.clip.w > 0 && g.clip.h > 0)
  )
    return false;
  const [a, b, c, d] = g.matrix;
  if (!(Math.abs(a * d - b * c) > 0)) return false;
  // Route paths are orthogonal. Requiring a positive-length run after
  // projecting and clipping excludes moves and point contacts. The generated
  // route palette and dash patterns have contrast and positive dash lengths.
  try {
    return pathInk(g.node.attrs.d ?? "").some((segment) =>
      intersectsClip(segment, g),
    );
  } catch {
    return false;
  }
}

function supportedClip(g, clip, clips) {
  if (clip !== g.node.attrs["clip-path"] || !clips.has(clip)) return false;
  const [a, b, c, d] = g.matrix;
  // The geometry reader projects rectangles to axis-aligned bounds.
  const zero = (value) => Math.abs(value) < 1e-10;
  return (zero(b) && zero(c)) || (zero(a) && zero(d));
}

function visibleGeometry(g, parentClip, clips) {
  const style = g.style ?? {};
  const clip = style["clip-path"];
  // Generated documents use rectangular SVG clips. An unsupported clip or
  // mask cannot establish positive evidence that the conductor was painted.
  return (
    g.visible &&
    parseFloat(style.opacity ?? "1") > 0 &&
    !/^none(?:\s*!important)?$/.test(style.display ?? "") &&
    !/^(?:hidden|collapse)(?:\s*!important)?$/.test(style.visibility ?? "") &&
    (!style.mask || style.mask === "none") &&
    (!clip ||
      clip === "none" ||
      (clip === parentClip && !g.node.attrs["clip-path"]) ||
      supportedClip(g, clip, clips))
  );
}

export function paintedWireUids(svg) {
  const geometry = navigationGeometry(svg);
  const root = geometry[0].node;
  const byNode = new Map(geometry.map((entry) => [entry.node, entry]));
  const clips = rectangularClips(root);
  const uids = new Set();
  function visit(node, parentClip, groupUid) {
    if (["clipPath", "mask", "symbol", "pattern", "marker"].includes(node.name))
      return;
    const g = byNode.get(node);
    if (!g || !visibleGeometry(g, parentClip, clips)) return;
    const uid = node.attrs["data-wire-uid"] ?? groupUid;
    if (
      node.name === "path" &&
      uid &&
      !node.attrs["data-label-leader-owner"] &&
      !/\bwire-label-leader\b/.test(node.attrs.class ?? "") &&
      visibleRun(g)
    )
      uids.add(uid);
    const childUid = groupedConductor(node) ?? groupUid;
    for (const child of node.children)
      visit(child, g.style?.["clip-path"], childUid);
  }
  visit(root);
  return uids;
}
