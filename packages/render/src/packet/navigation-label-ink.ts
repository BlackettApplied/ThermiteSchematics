import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "./navigation-types.js";
import type { Rect } from "../device-legend/geometry.js";
import { unionInk } from "./rooted-ink.js";
import { required } from "../presentation/util.js";
import { printableTextMetrics } from "../text-metrics.js";
import { NAVIGATION_FONT_MM, wrapNavigationText } from "./navigation-labels.js";

/** Printed repeat ink; the larger all-role reservation still guards fit. */
export function navigationLabelInk(
  text: string,
  origin = { x: 0, y: 0 },
): Rect {
  return required(
    unionInk(
      text.split("\n").map((line, i) => {
        const m = printableTextMetrics(line, NAVIGATION_FONT_MM);
        return {
          x: origin.x + 1 + m.left,
          y: origin.y + 3.7 + i * 4.8 - m.top,
          w: m.right - m.left,
          h: m.top - m.bottom,
        };
      }),
    ),
    "Missing repeat ink",
  );
}

/** Measured after native destinations freeze, without changing any envelope. */
export function repeatLocalityInk(
  annotation: NavigationAnnotation,
  reservation: AnnotationReservation,
): ReadonlyMap<string, Rect> | undefined {
  if (
    !["canonical", "repeat", "mixed", "element-location"].includes(
      annotation.role,
    )
  )
    return undefined;
  return new Map(
    (reservation.shapes ?? [])
      .filter((s) => s.mode === "local")
      .map((s) => [
        s.id,
        navigationLabelInk(wrapNavigationText(annotation.text, s.wrapWidthMm)),
      ]),
  );
}
