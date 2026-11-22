import { required } from "../presentation/util.js";
import type { RenderedPacket } from "../packet/types.js";
import { svgTree, type SvgNode } from "../device-legend/svg-tree.js";
import {
  identity,
  multiply,
  transform,
  project,
  expand,
  intersection,
  type Matrix,
  type Rect,
} from "../device-legend/geometry.js";

interface Placed {
  node: SvgNode;
  matrix: Matrix;
  clip: Rect;
  owner?: string;
}
function placements(
  node: SvgNode,
  matrix: Matrix,
  clip: Rect,
  owner?: string,
  nested = false,
  view?: string,
): Placed[] {
  const a = node.attrs;
  const nativeView = a["data-navigation-view"] ?? view;
  let m = multiply(matrix, transform(a.transform));
  if (node.name === "svg" && nested && a.viewBox) {
    const [x, y, w, h] = a.viewBox.split(/[ ,]+/).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const width = Number.parseFloat(
        required(a.width, "Missing native circuit geometry"),
      ),
      height = Number.parseFloat(
        required(a.height, "Missing native circuit geometry"),
      );
    const scale = Math.min(width / w, height / h);
    m = multiply(m, [
      scale,
      0,
      0,
      scale,
      Number(a.x ?? 0) - x * scale + (width - w * scale) / 2,
      Number(a.y ?? 0) - y * scale + (height - h * scale) / 2,
    ]);
    clip = intersection(clip, project({ x, y, w, h }, m)) ?? {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  }
  const next = a["data-off-view-terminal-id"]
    ? JSON.stringify([
        a["data-off-view-terminal-id"],
        a["data-off-view-conductors"],
        nativeView,
      ])
    : owner;
  return [
    { node, matrix: m, clip, ...(next ? { owner: next } : {}) },
    ...node.children.flatMap((n) =>
      placements(n, m, clip, next, nested || node.name === "svg", nativeView),
    ),
  ];
}
const visible = (box: Rect, clip: Rect) =>
  !!intersection(expand(box, 0.001), clip);
export function circuitPacketCards(packet: RenderedPacket) {
  return packet.sheets.flatMap((sheet) => {
    const placed = placements(svgTree(sheet.svg), identity, {
      x: 0,
      y: 0,
      w: packet.page.widthMm,
      h: packet.page.heightMm,
    });
    const pins = cardPins(placed);
    return placed
      .filter(
        (p) =>
          p.owner &&
          p.node.name === "rect" &&
          p.node.attrs.class?.split(" ").includes("off-view-card"),
      )
      .flatMap((p) => {
        const a = p.node.attrs;
        const rect = project(
          {
            x: Number(a.x),
            y: Number(a.y),
            w: Number(a.width),
            h: Number(a.height),
          },
          p.matrix,
        );
        if (!visible(rect, p.clip)) return [];
        const terminal = required(
          (JSON.parse(required(p.owner, "Missing card owner")) as string[])[0],
          "Missing native circuit geometry",
        );
        const border = expand(
          rect,
          (Number(a["stroke-width"]) * Math.hypot(p.matrix[0], p.matrix[1])) /
            2,
        );
        const distances = pins
          .filter((pin) => pin.terminal === terminal && pin.visible)
          .map(({ point: q }) =>
            Math.hypot(
              Math.max(border.x - q.x, 0, q.x - border.x - border.w),
              Math.max(border.y - q.y, 0, q.y - border.y - border.h),
            ),
          );
        return [
          {
            key: required(p.owner, "Missing native circuit geometry"),
            sheet: sheet.number,
            rect,
            distance: distances.length ? Math.min(...distances) : null,
          },
        ];
      });
  });
}
/** Match native terminal/conductor identities within their issued view, never
 * sheet numbers or printed titles. Multiplicity survives page renumbering.
 * Off-sheet owners have no fabricated distance: require unchanged geometry. */
export function circuitCardGuard(
  candidate: RenderedPacket,
  original: RenderedPacket,
) {
  const old = circuitPacketCards(original),
    current = circuitPacketCards(candidate);
  if (old.length !== current.length) return false;
  return old.every((b) => {
    const index = current.findIndex((a) => a.key === b.key);
    if (index < 0) return false;
    const a = required(
      current.splice(index, 1)[0],
      "Missing native circuit geometry",
    );
    return a.distance === null || b.distance === null
      ? a.distance === b.distance &&
          JSON.stringify(a.rect) === JSON.stringify(b.rect)
      : a.distance <= b.distance + 0.1;
  });
}

function cardPins(placed: Placed[]) {
  const pins = placed
    .filter(
      (p) => p.node.name === "circle" && p.node.attrs["data-terminal-key"],
    )
    .map((p) => {
      const a = p.node.attrs,
        point = project(
          { x: Number(a.cx), y: Number(a.cy), w: 0, h: 0 },
          p.matrix,
        );
      return {
        terminal: JSON.stringify({
          deviceUid: a["data-device-uid"],
          terminalKey: a["data-terminal-key"],
        }),
        point,
        visible: visible(point, p.clip),
      };
    });
  return pins;
}
