import type { Rect } from "../device-legend/geometry.js";
import type { DocumentDependency } from "./document-types.js";
import type { RenderedSheet } from "./types.js";
import { allocateNavigationSlots } from "./navigation-slots.js";
import {
  documentCaptionReservation,
  documentCaptionTextInk,
  type DocumentCaptionSlot,
} from "./document-caption-ink.js";
import { documentCaptionLeader } from "./document-caption-leader.js";
import type { DocumentCaptionOwner } from "./document-caption-owner.js";
import { required } from "../presentation/util.js";

export function documentCaptionSlot(
  need: DocumentDependency,
  tokens: readonly string[],
  field: Rect,
  sheet: RenderedSheet,
  claims: readonly Rect[],
  mode: "local" | "self-located",
  owner?: DocumentCaptionOwner,
): DocumentCaptionSlot {
  const reservation = documentCaptionReservation(need, tokens, field.w);
  const localityInkMm = new Map(
    (reservation.shapes ?? []).map((shape) => [
      shape.id,
      documentCaptionTextInk(
        required(shape.maximumForms[0], "Missing caption form"),
      ),
    ]),
  );
  const slot = required(
    allocateNavigationSlots(
      [
        {
          reservation: {
            ...reservation,
            shapes: (reservation.shapes ?? []).map((shape) => ({
              ...shape,
              mode,
            })),
          },
          owner: owner?.frameMm ?? field,
          ...(owner ? { locality: owner, localityInkMm } : {}),
        },
      ],
      field,
      sheet.svg,
      sheet.number,
      claims,
    )[0],
    "Missing document caption slot",
  );
  const box = required(slot.allocatedMm, "Missing caption allocation").rect;
  const leader =
    owner && mode === "self-located"
      ? documentCaptionLeader(box, owner, sheet.svg, claims)
      : undefined;
  return {
    ...slot,
    ...(owner ? { captionOwner: owner } : {}),
    ...(leader ? { leader } : {}),
  };
}
