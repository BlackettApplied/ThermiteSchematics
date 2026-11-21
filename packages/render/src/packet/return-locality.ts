import type {
  AnnotationReservation,
  NavigationAnnotation,
  PlacedOccurrence,
} from "./navigation-types.js";
import { anchorDistance } from "./navigation-symbols.js";
import { required } from "../presentation/util.js";

/** Returns retain same-sheet contact ownership. Distances are measured, not thresholded. */
export function resolveReturnLocality(
  annotation: NavigationAnnotation,
  reservation: AnnotationReservation,
  occurrences: readonly PlacedOccurrence[],
): NavigationAnnotation {
  const slot = required(reservation.allocatedMm, "Missing return slot");
  const owners = annotation.ownerOccurrences.map((id) => {
    const owner = required(
      occurrences.find((o) => o.id === id),
      "Missing return contact owner",
    );
    const anchorMm = owner.destination.anchorMm;
    const distanceMm = anchorDistance(anchorMm, slot.rect);
    if (owner.destination.sheet !== slot.sheet || !Number.isFinite(distanceMm))
      throw Error(
        "Return locality: caption must share its contact owners' sheet and have finite measured distances",
      );
    return { occurrenceId: id, anchorMm, distanceMm };
  });
  if (
    !owners.length ||
    !owners.some((o) => o.occurrenceId === annotation.ownerOccurrence)
  )
    throw Error("Return locality: missing primary contact owner");
  return { ...annotation, returnLocality: { sheet: slot.sheet, owners } };
}
