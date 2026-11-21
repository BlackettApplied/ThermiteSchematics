import type { ElectricalIr } from "@thermite/compiler";
import type {
  NavigationAnnotation,
  AnnotationReservation,
} from "./navigation-types.js";
import {
  anchorDistance,
  localNavigationSlot,
  type SymbolGeometry,
} from "./navigation-symbols.js";
import { destinationToken, roundNavigation } from "./navigation-location.js";
import type { DrawingBounds } from "./types.js";
import { printableTextMetrics } from "../text-metrics.js";
import { inside, type Rect } from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";
import { text, line } from "./svg.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { mirrorInk, mirrorTextRuns } from "./mirror-layout.js";
import { mirrorTag } from "./mirror-facts.js";

export function mirrorIsLocal(
  box: Rect,
  geometry: SymbolGeometry,
  field: DrawingBounds,
) {
  return localNavigationSlot(box, {
    ...geometry,
    localBandMm: mirrorLocalBand(geometry, field),
  });
}
export function mirrorLocalBand(
  geometry: SymbolGeometry,
  field: DrawingBounds,
): Rect {
  const row = "ABCD".indexOf(geometry.ownerLocation.zone[0] ?? ""),
    col = Number(geometry.ownerLocation.zone.slice(1)) - 1;
  const x = (i: number) =>
    roundNavigation(
      roundNavigation(field.x) + (roundNavigation(field.w) * i) / 6,
    );
  const y = (i: number) =>
    roundNavigation(
      roundNavigation(field.y) + (roundNavigation(field.h) * i) / 4,
    );
  const band = {
    x: x(Math.max(0, col - 1)),
    y: y(Math.max(0, row - 1)),
    w: x(Math.min(6, col + 2)) - x(Math.max(0, col - 1)),
    h: y(Math.min(4, row + 2)) - y(Math.max(0, row - 1)),
  };
  return band;
}
export function resolveMirrorLocality(
  ir: Readonly<ElectricalIr>,
  annotation: NavigationAnnotation,
  slot: AnnotationReservation,
  geometry: SymbolGeometry,
  field: DrawingBounds,
): NavigationAnnotation {
  const allocated = required(slot.allocatedMm, "Missing mirror slot");
  if (allocated.sheet !== geometry.ownerLocation.sheet)
    throw Error("Mirror locality: coil and mirror must share a sheet");
  const local = mirrorIsLocal(
    mirrorInk(annotation, allocated.rect),
    geometry,
    field,
  );
  const mirror = required(annotation.mirror, "Missing mirror rows");
  const heading = `${annotation.text}${local ? "" : ` /${destinationToken(geometry.ownerLocation)}`}`;
  const result = {
    ...annotation,
    text: heading,
    mirror: { ...mirror, heading },
    locality: {
      mode: local ? ("local" as const) : ("self-located" as const),
      ...geometry,
      distanceMm: anchorDistance(
        geometry.anchorMm,
        mirrorInk(
          { ...annotation, mirror: { ...mirror, heading } },
          allocated.rect,
        ),
      ),
    },
  };
  validateMirrorLocality(ir, result, slot, geometry, field);
  return result;
}
/** Renderer self-check uses final geometry and the printed heading, never the allocation family. */
export function validateMirrorLocality(
  ir: Readonly<ElectricalIr>,
  annotation: NavigationAnnotation,
  slot: AnnotationReservation,
  geometry: SymbolGeometry,
  field: DrawingBounds,
) {
  const allocated = required(slot.allocatedMm, "Missing mirror slot"),
    mirror = required(annotation.mirror, "Missing mirror facts");
  const own = `${mirrorTag(ir, mirror.coil)}${mirror.part ? ` (${mirror.part}/${mirror.parts})` : ""}`;
  const located = `${own} /${destinationToken(geometry.ownerLocation)}`;
  if (
    allocated.sheet !== geometry.ownerLocation.sheet ||
    (mirrorIsLocal(mirrorInk(annotation, allocated.rect), geometry, field)
      ? ![own, located].includes(mirror.heading)
      : mirror.heading !== located)
  )
    throw Error("Mirror locality: heading does not locate its coil");
}
export function mirrorAnnotationSvg(
  annotation: NavigationAnnotation,
  slot: AnnotationReservation,
): string {
  const box = required(slot.allocatedMm, "Unallocated mirror").rect;
  const runs: string[] = [];
  const put = (x: number, y: number, s: string, size: number) => {
    const m = printableTextMetrics(s, size);
    if (
      !inside(
        {
          x: x + m.left,
          y: y - m.top,
          w: m.right - m.left,
          h: m.top - m.bottom,
        },
        box,
      )
    )
      throw Error(`Navigation actual ink exceeds ${slot.profileId}`);
    return text(x, y, s, size);
  };
  const mirror = annotation.mirror;
  const textRuns = mirrorTextRuns(annotation, box);
  runs.push(
    ...textRuns
      .filter((r) => !r.row)
      .map((r) => put(r.x, r.y, r.value, r.size)),
  );
  if (mirror) {
    runs.push(line(box.x + 1, box.y + 6, box.x + box.w - 1, box.y + 6));
    for (const row of mirror.rows)
      runs.push(
        `<g id="${attr(row.primitiveId)}" data-navigation-mirror-row="${attr(JSON.stringify(row.source))}">${textRuns
          .filter((r) => r.row === row.primitiveId)
          .map((r) => put(r.x, r.y, r.value, r.size))
          .join("")}</g>`,
      );
  }
  return `<g id="${attr(required(annotation.primitiveIds[0], "Missing mirror primitive"))}" data-navigation-annotation="${attr(annotation.id)}" data-navigation-owner="${attr(annotation.ownerOccurrence)}" data-navigation-role="${annotation.role}">${runs.join("")}</g>`;
}
