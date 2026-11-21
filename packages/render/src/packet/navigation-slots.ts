import { generatedSvgInk } from "../device-legend/svg-ink.js";
import { intersection, project, type Rect } from "../device-legend/geometry.js";
import { navigationGeometry, cachedNavigationTree } from "./navigation-walk.js";
import type { SymbolGeometry } from "./navigation-symbols.js";
import type {
  AnnotationReservation,
  NavigationShape,
} from "./navigation-types.js";
import {
  searchNavigationSlot,
  NAVIGATION_CLEARANCE_MM,
} from "./navigation-slot-search.js";
import {
  navigationPlacementFamily,
  navigationPlacementInk,
  type NavigationPlacementFamily,
} from "./navigation-placement.js";
import { measureNavigationVacancy } from "./navigation-vacancy.js";
export { NAVIGATION_CLEARANCE_MM } from "./navigation-slot-search.js";
export interface SheetSlotRequest {
  reservation: AnnotationReservation;
  owner: Rect;
  locality?: SymbolGeometry;
  preferBesideBelow?: boolean;
  families?: readonly NavigationPlacementFamily[];
  localityInkMm?: ReadonlyMap<string, Rect> | undefined;
  fitPrintedInk?: boolean;
}
export class NavigationSlotFailure extends Error {
  constructor(
    message: string,
    readonly search: unknown,
  ) {
    super(message);
  }
}
export function navigationObstacles(svg: string, openDeviceFrames = false) {
  const measured = generatedSvgInk(svg, 1, cachedNavigationTree(svg));
  const ink = [
    ...measured.ink,
    ...measured.regions,
    ...navigationGeometry(svg).flatMap((g) => {
      const a = g.node.attrs;
      if (!g.visible) return [];
      const rect =
        g.node.name === "g" && a["data-report-column"]
          ? {
              x: Number(a["data-cell-x"]),
              y: Number(a["data-cell-y"]),
              w: Number(a["data-cell-width"]),
              h: Number(a["data-cell-height"]),
            }
          : g.node.name === "rect" &&
              (openDeviceFrames
                ? /off-view-card|device-legend-frame/
                : /device-frame|off-view-card|device-legend-frame/
              ).test(a.class ?? "")
            ? {
                x: Number(a.x ?? 0),
                y: Number(a.y ?? 0),
                w: Number(a.width),
                h: Number(a.height),
              }
            : undefined;
      const visible = rect && intersection(project(rect, g.matrix), g.clip);
      return visible && visible.w > 0 && visible.h > 0 ? [visible] : [];
    }),
  ];
  return { ink, texts: measured.texts };
}
/** Vacant sheet-mm space after real continuation/legend ink. Never grows an ELK leaf. */
export function allocateNavigationSlots(
  requests: readonly SheetSlotRequest[],
  area: Rect,
  svg: string,
  sheet: number,
  reservedBoxes: readonly Rect[] = [],
): AnnotationReservation[] {
  const measured = navigationObstacles(svg),
    obstacles = measured.ink,
    texts = measured.texts;
  obstacles.push(...reservedBoxes);
  texts.push(...reservedBoxes);
  return requests.map(({ reservation, owner, locality, ...options }) => {
    const legacy = legacyShapes(reservation);
    const result = searchNavigationSlot(
      reservation.shapes ?? legacy,
      area,
      owner,
      obstacles,
      locality,
      texts,
      options.preferBesideBelow,
      options.families,
      options.localityInkMm,
      options.fitPrintedInk,
    );
    if (!result)
      throw new NavigationSlotFailure(
        `Navigation ${reservation.profileId} cannot fit sheet ${sheet}: required ${reservation.inkMm.w.toFixed(2)} × ${reservation.inkMm.h.toFixed(2)} mm with ${NAVIGATION_CLEARANCE_MM} mm clearance; owner ${reservation.ownerAppearance}`,
        {
          fieldMm: area,
          ownerMm: owner,
          requiredMm: reservation.inkMm,
          families: measureNavigationVacancy(
            reservation.inkMm,
            area,
            owner,
            obstacles,
            texts,
            locality,
          ),
        },
      );
    const placedInk = options.localityInkMm?.get(result.shape.id);
    obstacles.push(result.protectedBox);
    texts.push(result.protectedBox);
    return {
      ...reservation,
      inkMm: result.shape.inkMm,
      maximumForms: result.shape.maximumForms,
      allocatedMm: {
        sheet,
        rect: result.box,
        ...(reservation.shapes ? { shapeId: result.shape.id } : {}),
        ...(locality ? { placement: result.shape.mode } : {}),
        ...(options.preferBesideBelow
          ? {
              family: navigationPlacementFamily(
                navigationPlacementInk(result.box, placedInk),
                area,
                owner,
                locality,
              ),
              familyRule: "approach-or-outer-zone-row/1" as const,
            }
          : {}),
      },
    };
  });
}

function legacyShapes(reservation: AnnotationReservation): NavigationShape[] {
  return (["local", "self-located"] as const).map((mode) => ({
    id: mode,
    mode,
    inkMm: reservation.inkMm,
    maximumForms: reservation.maximumForms,
    wrapWidthMm: reservation.inkMm.w - 2,
  }));
}
