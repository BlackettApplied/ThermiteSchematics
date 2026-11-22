import type { ElectricalIr } from "@thermite/compiler";
import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "./navigation-types.js";
import {
  anchorDistance,
  localNavigationSlot,
  type SymbolGeometry,
} from "./navigation-symbols.js";
import { destinationToken } from "./navigation-location.js";
import { wrapNavigationText } from "./navigation-labels.js";
import { navigationLabelInk } from "./navigation-label-ink.js";
import { required } from "../presentation/util.js";
export function resolveLabelLocality(
  ir: Readonly<ElectricalIr>,
  annotation: NavigationAnnotation,
  reservation: AnnotationReservation,
  symbol: SymbolGeometry,
  deviceUid: string,
): NavigationAnnotation {
  const allocated = required(
    reservation.allocatedMm,
    "Missing navigation allocation",
  );
  const mode = required(allocated.placement, "Missing navigation locality");
  const tag = required(
    ir.devices.find((d) => d.uid === deviceUid),
    "Missing label device",
  ).designation;
  const selfPrefix = `${tag} (${destinationToken(symbol.ownerLocation)}): `;
  const unwrapped =
    mode === "self-located"
      ? selfPrefix + annotation.text.slice(`${tag}: `.length)
      : annotation.text;
  const shape = reservation.shapes?.find((s) => s.id === allocated.shapeId);
  const text = shape
    ? wrapNavigationText(unwrapped, shape.wrapWidthMm)
    : unwrapped;
  const ink = navigationLabelInk(text, allocated.rect);
  if (
    allocated.sheet !== symbol.ownerLocation.sheet ||
    (symbol.sourceAnchorsMm && !localNavigationSlot(ink, symbol)) ||
    (mode === "local"
      ? !localNavigationSlot(ink, symbol)
      : !unwrapped.startsWith(selfPrefix))
  )
    throw Error("Navigation locality: label is neither local nor self-located");
  return {
    ...annotation,
    text,
    locality: {
      mode,
      anchorMm: symbol.anchorMm,
      frameMm: symbol.frameMm,
      ownerLocation: symbol.ownerLocation,
      distanceMm: anchorDistance(symbol.anchorMm, ink),
    },
  };
}
