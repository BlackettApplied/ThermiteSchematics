import type { PlacedOccurrence } from "./navigation-types.js";
import type { DrawingBounds } from "./types.js";
import {
  navigationGeometry,
  type NavigationGeometry,
} from "./navigation-walk.js";
import { descendants } from "../device-legend/svg-tree.js";
import {
  inside,
  intersection,
  project,
  type Rect,
} from "../device-legend/geometry.js";
import { unionInk } from "./rooted-ink.js";
import { required } from "../presentation/util.js";
import { terminalCentroid } from "./navigation-occurrences.js";
import { navigationZone } from "./navigation-location.js";
export interface SymbolGeometry {
  anchorMm: { x: number; y: number };
  frameMm: Rect;
  framesMm: readonly Rect[];
  ownerLocation: { sheet: number; zone: string };
  localBandMm?: Rect;
  /** Shared element locators must remain local to every native source. */
  sourceAnchorsMm?: readonly { x: number; y: number }[];
}
function frameCandidates(all: readonly NavigationGeometry[]) {
  return all.flatMap((g) => {
    if (!g.visible || !g.node.attrs["data-device-uid"]) return [];
    const rect = descendants(g.node).find(
      (n) => n.name === "rect" && /device-frame/.test(n.attrs.class ?? ""),
    );
    const measured = rect && all.find((n) => n.node === rect);
    if (!rect || !measured?.visible) return [];
    const visible = intersection(
      project(
        {
          x: Number(rect.attrs.x ?? 0),
          y: Number(rect.attrs.y ?? 0),
          w: Number(rect.attrs.width),
          h: Number(rect.attrs.height),
        },
        measured.matrix,
      ),
      measured.clip,
    );
    if (!visible || visible.w <= 0 || visible.h <= 0) return [];
    return [
      {
        scope: g.node,
        uid: g.node.attrs["data-device-uid"],
        viewKey: g.viewKey,
        rect: visible,
      },
    ];
  });
}
export function symbolGeometry(
  owner: PlacedOccurrence,
  occurrences: readonly PlacedOccurrence[],
  svg: string,
  field: DrawingBounds,
  frameOccurrences: readonly PlacedOccurrence[] = occurrences,
): SymbolGeometry {
  const members = occurrences.filter(
    (o) =>
      o.role !== "lookup-row" &&
      o.source.deviceUid === owner.source.deviceUid &&
      o.destination.sheet === owner.destination.sheet &&
      o.provenance.view.key === owner.provenance.view.key,
  );
  const all = navigationGeometry(svg),
    ids = new Set(members.flatMap((o) => o.terminalPrimitiveIds));
  const markers = all.filter((g) => ids.has(g.node.attrs.id ?? ""));
  const keys = [...new Set(members.flatMap((o) => o.terminalKeys))];
  const anchorMm = terminalCentroid(keys, markers);
  const primitives = new Set(members.flatMap((o) => o.primitiveIds));
  const frames = frameCandidates(all);
  const own = frames
    .filter(
      (f) =>
        f.uid === owner.source.deviceUid &&
        ([f.scope, ...descendants(f.scope)].some((n) =>
          primitives.has(n.attrs.id ?? ""),
        ) ||
          (f.viewKey === owner.provenance.view.key &&
            inside({ ...anchorMm, w: 0, h: 0 }, f.rect))),
    )
    .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
  const frameMm =
    own?.rect ??
    required(
      unionInk(members.map((o) => o.provenance.bodyMm)),
      "Missing symbol body",
    );
  return {
    anchorMm,
    frameMm,
    framesMm: [
      ...frames.filter((f) => f !== own).map((f) => f.rect),
      ...frameOccurrences
        .filter(
          (o) =>
            o.role === "full-function" &&
            o.representation === "circuit" &&
            o.source.deviceUid !== owner.source.deviceUid &&
            o.destination.sheet === owner.destination.sheet &&
            !members.some((m) => m.id === o.id),
        )
        .map((o) => o.provenance.bodyMm),
    ],
    ownerLocation: {
      sheet: owner.destination.sheet,
      zone: navigationZone(anchorMm.x, anchorMm.y, field),
    },
  };
}
export const boxDistance = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(a.x - b.x - b.w, b.x - a.x - a.w, 0),
    Math.max(a.y - b.y - b.h, b.y - a.y - a.h, 0),
  );
export const anchorDistance = (anchor: { x: number; y: number }, box: Rect) =>
  boxDistance({ x: anchor.x, y: anchor.y, w: 0, h: 0 }, box);
// Checker ambiguity (0.01 mm) plus 0.01 mm for metric/browser distance error.
const NEAREST_FRAME_MARGIN_MM = 0.02;
export function localNavigationSlot(box: Rect, symbol: SymbolGeometry) {
  const distance = boxDistance(box, symbol.frameMm);
  return (
    anchorDistance(symbol.anchorMm, box) <= 60 &&
    (symbol.sourceAnchorsMm ?? []).every(
      (anchor) => anchorDistance(anchor, box) <= 60,
    ) &&
    (!symbol.localBandMm ||
      (box.x <= symbol.localBandMm.x + symbol.localBandMm.w &&
        box.x + box.w >= symbol.localBandMm.x &&
        box.y <= symbol.localBandMm.y + symbol.localBandMm.h &&
        box.y + box.h >= symbol.localBandMm.y)) &&
    symbol.framesMm.every(
      (other) => distance < boxDistance(box, other) - NEAREST_FRAME_MARGIN_MM,
    )
  );
}
