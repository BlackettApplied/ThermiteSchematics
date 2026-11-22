import { formatTerminalSet } from "@thermite/query";
import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "./navigation-types.js";
import type { Rect } from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";
import { printableTextMetrics } from "../text-metrics.js";
import { MIRROR_HEADING_MM, MIRROR_ROW_MM } from "./mirror-plan.js";
import {
  measureNavigationText,
  wrapNavigationText,
} from "./navigation-labels.js";
import { unionInk } from "./rooted-ink.js";
import { n } from "./svg.js";

interface MirrorTextRun {
  x: number;
  y: number;
  value: string;
  size: number;
  row?: string;
}
/** Shared with SVG emission so heading insets, wrapping and row leading agree. */
export function mirrorTextRuns(annotation: NavigationAnnotation, box: Rect) {
  const runs: MirrorTextRun[] = [];
  const put = (
    x: number,
    y: number,
    value: string,
    size: number,
    row?: string,
  ) =>
    runs.push({
      x: Number(n(x)),
      y: Number(n(y)),
      value,
      size,
      ...(row ? { row } : {}),
    });
  const mirror = annotation.mirror;
  if (mirror) {
    put(box.x + 1.5, box.y + 4.3, mirror.heading, MIRROR_HEADING_MM);
    let y = box.y + 10;
    const terminalsWidth = Math.max(
      23.5,
      ...mirror.rows.map(
        (r) => measureNavigationText(formatTerminalSet(r.terminals)) + 2,
      ),
    );
    for (const row of mirror.rows) {
      const destinations = row.destinations.length
        ? row.destinations
        : ["not drawn"];
      put(box.x + 1.5, y, row.state, MIRROR_ROW_MM, row.primitiveId);
      put(
        box.x + 10,
        y,
        formatTerminalSet(row.terminals),
        MIRROR_ROW_MM,
        row.primitiveId,
      );
      for (const [i, destination] of destinations.entries())
        put(
          box.x + 10 + terminalsWidth,
          y + i * 4.5,
          destination,
          MIRROR_ROW_MM,
          row.primitiveId,
        );
      y += 4.5 * destinations.length;
    }
    if (!mirror.rows.length)
      for (const s of wrapNavigationText(
        "Contact associations unspecified",
        box.w - 3,
      ).split("\n")) {
        put(box.x + 1.5, y, s, MIRROR_ROW_MM);
        y += 4.5;
      }
  } else
    for (const [i, s] of annotation.text.split("\n").entries())
      put(
        box.x + 1,
        box.y + 3.7 + i * 4.5,
        s,
        annotation.role === "contact-notice" ? 2.7 : MIRROR_ROW_MM,
      );
  return runs;
}

/** Glyph bounds and the printed rule, rather than blank reserved capacity. */
export function mirrorInk(annotation: NavigationAnnotation, box: Rect): Rect {
  return required(
    unionInk([
      ...mirrorTextRuns(annotation, box).map((r) => {
        const m = printableTextMetrics(r.value, r.size);
        return {
          x: r.x + m.left,
          y: r.y - m.top,
          w: m.right - m.left,
          h: m.top - m.bottom,
        };
      }),
      ...(annotation.mirror
        ? [
            {
              x: Number(n(box.x + 1)),
              y: Number(n(box.y + 6)),
              w: Number(n(box.x + box.w - 1)) - Number(n(box.x + 1)),
              h: 0,
            },
          ]
        : []),
    ]),
    "Missing mirror ink",
  );
}

export function mirrorLocalityInk(
  annotation: NavigationAnnotation,
  reservation: AnnotationReservation,
): ReadonlyMap<string, Rect> {
  return new Map([["local", mirrorInk(annotation, reservation.inkMm)]]);
}
