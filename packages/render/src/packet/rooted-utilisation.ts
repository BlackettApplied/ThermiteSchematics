import {
  OUTER_SVG_PADDING,
  SYMBOL_CATALOG,
  orientSymbolDefinition,
} from "../symbols/catalog.js";
import type { SymbolPrimitive } from "../symbols/types.js";
import type { LayoutPoint } from "../types.js";
import type { RootedCandidate } from "./rooted-build.js";
import { intersectInk, unionInk, type InkBox } from "./rooted-ink.js";
import type { PaperPage } from "./types.js";

/**
 * Conservative floor above DQ-12's 0.40 threshold to absorb downstream
 * legend-fitting reduction (~6% relative) and estimator/Chromium differences.
 */
export const WRAPPED_UTILISATION_FLOOR = 0.45;

export interface UtilisationCandidate {
  readonly prepared: {
    readonly graph: Pick<
      RootedCandidate["prepared"]["graph"],
      "nodes" | "edges"
    >;
    readonly layout: Pick<
      RootedCandidate["prepared"]["layout"],
      "nodes" | "edges"
    >;
  };
  readonly drafts: readonly Pick<
    RootedCandidate["drafts"][number],
    "content"
  >[];
}

interface SheetViewport {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly vx: number;
  readonly vy: number;
  readonly vw: number;
  readonly vh: number;
}

interface ViewportTransform {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
}

type Segment = readonly [LayoutPoint, LayoutPoint];

interface VisibleGeometry {
  readonly boxes: readonly InkBox[];
  readonly paths: readonly (readonly Segment[])[];
}

const SYMBOL_BY_ID = new Map(
  SYMBOL_CATALOG.map((definition) => [definition.id, definition]),
);

function clipSegmentToBox(
  a: LayoutPoint,
  b: LayoutPoint,
  box: InkBox,
): InkBox | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bounds: readonly (readonly [number, number])[] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.w - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.h - a.y],
  ];
  for (const [p, q] of bounds) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return undefined;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return undefined;
      if (r < t1) t1 = r;
    }
  }
  const x0 = a.x + t0 * dx;
  const y0 = a.y + t0 * dy;
  const x1 = a.x + t1 * dx;
  const y1 = a.y + t1 * dy;
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

function addPrimitiveGeometry(
  prim: SymbolPrimitive,
  ox: number,
  oy: number,
  boxes: InkBox[],
  paths: Segment[][],
): void {
  if (prim.kind === "line") {
    paths.push([
      [
        { x: ox + prim.from.x, y: oy + prim.from.y },
        { x: ox + prim.to.x, y: oy + prim.to.y },
      ],
    ]);
    return;
  }
  if (prim.kind === "polyline") {
    const segments: Segment[] = [];
    for (let i = 1; i < prim.points.length; i++) {
      const prev = prim.points[i - 1];
      const next = prim.points[i];
      if (!prev || !next) continue;
      segments.push([
        { x: ox + prev.x, y: oy + prev.y },
        { x: ox + next.x, y: oy + next.y },
      ]);
    }
    if (segments.length > 0) paths.push(segments);
    return;
  }
  if (prim.kind === "rect") {
    boxes.push({
      x: ox + prim.x,
      y: oy + prim.y,
      w: prim.width,
      h: prim.height,
    });
    return;
  }
  if (prim.kind === "circle") {
    boxes.push({
      x: ox + prim.center.x - prim.radius,
      y: oy + prim.center.y - prim.radius,
      w: 2 * prim.radius,
      h: 2 * prim.radius,
    });
    return;
  }
  const x0 = ox + prim.from.x;
  const y0 = oy + prim.from.y;
  const x1 = ox + prim.to.x;
  const y1 = oy + prim.to.y;
  boxes.push({
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  });
}

function collectVisibleGeometry(
  candidate: UtilisationCandidate,
): VisibleGeometry {
  const { graph, layout } = candidate.prepared;
  const boxes: InkBox[] = [];
  const paths: Segment[][] = [];
  const nodeLayout = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    if (node.kind !== "symbol") continue;
    const pos = nodeLayout.get(node.id);
    const base = SYMBOL_BY_ID.get(node.symbolId);
    if (!pos || !base) continue;
    const def = orientSymbolDefinition(
      base,
      node.orientation,
      node.symbolSize.width,
    );
    const ox = pos.x + node.primitiveOrigin.x + OUTER_SVG_PADDING;
    const oy = pos.y + node.primitiveOrigin.y + OUTER_SVG_PADDING;
    for (const prim of def.primitives) {
      addPrimitiveGeometry(prim, ox, oy, boxes, paths);
    }
  }
  const conductorIds = new Set(
    graph.edges.filter((edge) => edge.kind === "conductor").map((e) => e.id),
  );
  for (const edge of layout.edges) {
    if (!conductorIds.has(edge.id)) continue;
    const segments: Segment[] = [];
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      segments.push([
        { x: a.x + OUTER_SVG_PADDING, y: a.y + OUTER_SVG_PADDING },
        { x: b.x + OUTER_SVG_PADDING, y: b.y + OUTER_SVG_PADDING },
      ]);
    }
    if (segments.length > 0) paths.push(segments);
  }
  return { boxes, paths };
}

function parseSvgAttr(attrs: string, name: string): number | undefined {
  const match = new RegExp(`\\b${name}="([0-9.+-]+)"`, "u").exec(attrs);
  return match ? Number(match[1]) : undefined;
}

function parseSheetViewports(content: string): SheetViewport[] {
  const viewports: SheetViewport[] = [];
  const stack: { readonly tx: number; readonly ty: number }[] = [];
  const tagRe = /<(\/?)(g|svg)\b([^>]*)>/gu;
  for (let m = tagRe.exec(content); m !== null; m = tagRe.exec(content)) {
    const close = m[1] === "/";
    const tag = m[2];
    const attrs = m[3] ?? "";
    if (tag === "g") {
      if (close) {
        stack.pop();
      } else if (!attrs.trimEnd().endsWith("/")) {
        const tm = /transform="translate\(([0-9.+-]+)\s+([0-9.+-]+)\)"/u.exec(
          attrs,
        );
        const prev = stack.at(-1) ?? { tx: 0, ty: 0 };
        stack.push(
          tm
            ? { tx: prev.tx + Number(tm[1]), ty: prev.ty + Number(tm[2]) }
            : prev,
        );
      }
      continue;
    }
    if (tag !== "svg" || close) continue;
    const vb =
      /\bviewBox="([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)"/u.exec(
        attrs,
      );
    const x = parseSvgAttr(attrs, "x");
    const y = parseSvgAttr(attrs, "y");
    const w = parseSvgAttr(attrs, "width");
    const h = parseSvgAttr(attrs, "height");
    if (
      !vb ||
      x === undefined ||
      y === undefined ||
      w === undefined ||
      h === undefined
    ) {
      continue;
    }
    const tr = stack.at(-1) ?? { tx: 0, ty: 0 };
    viewports.push({
      x: x + tr.tx,
      y: y + tr.ty,
      w,
      h,
      vx: Number(vb[1]),
      vy: Number(vb[2]),
      vw: Number(vb[3]),
      vh: Number(vb[4]),
    });
  }
  return viewports;
}

function viewportTransform(vp: SheetViewport): ViewportTransform {
  const scale = Math.min(vp.w / vp.vw, vp.h / vp.vh);
  return {
    scale,
    ox: vp.x + (vp.w - vp.vw * scale) / 2,
    oy: vp.y + (vp.h - vp.vh * scale) / 2,
  };
}

function mapPoint(
  point: LayoutPoint,
  vp: SheetViewport,
  tr: ViewportTransform,
): LayoutPoint {
  return {
    x: tr.ox + (point.x - vp.vx) * tr.scale,
    y: tr.oy + (point.y - vp.vy) * tr.scale,
  };
}

function inDrawingRegion(box: InkBox, page: PaperPage): boolean {
  return box.x >= 20 && box.y >= 25 && box.y + box.h < page.heightMm - 35;
}

function sheetVisibleFraction(
  content: string,
  geometry: VisibleGeometry,
  page: PaperPage,
  area: number,
): number | undefined {
  const sheetBox: InkBox = { x: 0, y: 0, w: page.widthMm, h: page.heightMm };
  const visible: InkBox[] = [];
  for (const vp of parseSheetViewports(content)) {
    if (vp.vw <= 0 || vp.vh <= 0 || vp.w <= 0 || vp.h <= 0) continue;
    const clipBox = intersectInk(
      { x: vp.x, y: vp.y, w: vp.w, h: vp.h },
      sheetBox,
    );
    if (!clipBox || clipBox.w <= 0 || clipBox.h <= 0) continue;
    const tr = viewportTransform(vp);
    for (const box of geometry.boxes) {
      const mapped: InkBox = {
        x: tr.ox + (box.x - vp.vx) * tr.scale,
        y: tr.oy + (box.y - vp.vy) * tr.scale,
        w: box.w * tr.scale,
        h: box.h * tr.scale,
      };
      const clipped = intersectInk(mapped, clipBox);
      if (clipped && inDrawingRegion(clipped, page)) visible.push(clipped);
    }
    for (const path of geometry.paths) {
      const clippedParts: InkBox[] = [];
      for (const [a, b] of path) {
        const clipped = clipSegmentToBox(
          mapPoint(a, vp, tr),
          mapPoint(b, vp, tr),
          clipBox,
        );
        if (clipped) clippedParts.push(clipped);
      }
      const whole = unionInk(clippedParts);
      if (whole && inDrawingRegion(whole, page)) visible.push(whole);
    }
  }
  const envelope = unionInk(visible);
  return envelope ? Math.min(1, (envelope.w * envelope.h) / area) : undefined;
}

/**
 * Median visible drawing-area utilisation across sheets using the same
 * geometry envelope, sheet clipping, drawing-region filter, and nominal area
 * as DQ-12.
 */
export function visibleDrawingAreaUtilisation(
  candidate: UtilisationCandidate,
  page: PaperPage,
): number {
  const area = (page.widthMm - 56) * (page.heightMm - 80);
  if (area <= 0 || candidate.drafts.length === 0) return 0;
  const geometry = collectVisibleGeometry(candidate);
  const fractions = candidate.drafts
    .flatMap((draft) => {
      const fraction = sheetVisibleFraction(
        draft.content,
        geometry,
        page,
        area,
      );
      return fraction === undefined ? [] : [fraction];
    })
    .sort((a, b) => a - b);
  const n = fractions.length;
  if (n === 0) return 0;
  const lo = fractions[Math.floor((n - 1) / 2)] ?? 0;
  const hi = fractions[Math.floor(n / 2)] ?? 0;
  return (lo + hi) / 2;
}
