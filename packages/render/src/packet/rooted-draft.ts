import { viewportSize } from "./viewport-size.js";
import { textInk } from "./rooted-caption.js";
import { viewportContent } from "./rooted-content.js";
import { required } from "../presentation/util.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { RailPresentationNode, SymbolPresentationNode } from "../types.js";
import type { Draft, DrawingBounds } from "./types.js";
import type { RootedGrid } from "./rooted-plans.js";
import { OUTER_SVG_PADDING as pad } from "../symbols/catalog.js";
import { LAYOUT_CONFIG_VERSION } from "../types.js";
import { viewportShapes, unionInk } from "./rooted-ink.js";
import { zone } from "./page.js";
import { n, text } from "./svg.js";
import {
  nativeOccurrenceSeeds,
  markNativeOccurrences,
} from "./navigation-seeds.js";

function nodeReference(node: SymbolPresentationNode | RailPresentationNode) {
  return {
    deviceUid: node.deviceUid,
    designation: node.designation,
    functions: node.functionIds.map((f) => f.functionKey),
    ...(node.kind === "symbol" && node.representation === "terminal"
      ? { representation: "terminal" as const }
      : {}),
  };
}
function continuedLocations(
  p: PreparedSchematicDrawing,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  return p.graph.locationGroups.filter((group) => {
    const box = required(
        p.layout.nodes.find((n) => n.id === group.id),
        "Missing rooted geometry",
      ),
      label = required(
        p.layout.labels.find((l) => l.id === group.label.id),
        "Missing rooted geometry",
      );
    const intersects =
      box.x + pad < x + w &&
      box.x + box.width + pad > x &&
      box.y + pad < y + h &&
      box.y + box.height + pad > y;
    const visible =
      label.x + pad >= x &&
      label.x + label.width + pad <= x + w &&
      label.y + pad >= y &&
      label.y + label.height + pad <= y + h;
    return intersects && !visible;
  });
}
function references(
  p: PreparedSchematicDrawing,
  x: number,
  y: number,
  w: number,
  h: number,
  b: DrawingBounds,
  scale: number,
) {
  return p.graph.nodes.flatMap((node) => {
    if (!("deviceUid" in node)) return [];
    const box = required(
      p.layout.nodes.find((n) => n.id === node.id),
      "Missing rooted geometry",
    );
    const cx = box.x + box.width / 2 + pad,
      cy = box.y + box.height / 2 + pad;
    if (cx < x || cx >= x + w || cy < y || cy >= y + h) return [];
    const xMm = b.x + (cx - x) * scale,
      yMm = b.y + (cy - y) * scale;
    return [{ ...nodeReference(node), xMm, yMm, zone: zone(xMm, yMm, b) }];
  });
}
export function rootedDraft(
  p: PreparedSchematicDrawing,
  grid: RootedGrid,
  col: number,
  row: number,
  b: DrawingBounds,
  scale: number,
  inner: string,
  profile?: "compact" | "dense",
  captionY = b.y - 9,
): Draft {
  const x = required(grid.xs[col], "Missing rooted geometry"),
    y = required(grid.ys[row], "Missing rooted geometry"),
    w = required(grid.xs[col + 1], "Missing rooted geometry") - x,
    h = required(grid.ys[row + 1], "Missing rooted geometry") - y;
  const continued = continuedLocations(p, x, y, w, h);
  const caption = continued.length
    ? `CONTINUED LOCATION: ${continued.map((g) => g.label.text).join(" / ")}`
    : "";
  const shapes = viewportShapes(
    p,
    { x: x - pad, y: y - pad, w, h },
    scale,
    b.x,
    b.y,
  );
  const ink = unionInk(shapes);
  const navigationSeeds = nativeOccurrenceSeeds(p);
  return {
    navigationSeeds,
    rootedSections: [
      {
        viewport: { x: x - pad, y: y - pad, w, h },
        continuedLocationIds: continued.map((g) => g.label.id),
      },
    ],
    rootedShapes: shapes,
    rootedContent: viewportContent(p, { x: x - pad, y: y - pad, w, h }),
    view: p.view,
    title: p.titleContext,
    links: [],
    drawingBounds: b,
    continuedCaption: caption,
    continuedCaptionY: captionY,
    rootedCaptionInk: caption ? [textInk(caption, b.x, captionY, 2.5)] : [],
    ...(ink ? { rootedInk: ink } : {}),
    references: references(p, x, y, w, h, b, scale),
    note: `Layout: ${profile ?? "standard"}. Drawing scale: ${n(scale)} mm/unit. Continuations: reference / destination sheet.`,
    content:
      `<svg data-layout-config-version="${LAYOUT_CONFIG_VERSION}" x="${n(b.x)}" y="${n(b.y)}" width="${viewportSize(w, scale)}" height="${viewportSize(h, scale)}" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" overflow="hidden">${markNativeOccurrences(inner, navigationSeeds)}</svg>` +
      (caption ? text(b.x, captionY, caption, 2.5) : ""),
  };
}
