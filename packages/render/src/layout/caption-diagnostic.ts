import type { InvalidLayoutError } from "../errors.js";
export function captionPlacementDiagnostic(
  text: string,
  ownerId: string,
  root: string,
  family: InvalidLayoutError["family"],
): InvalidLayoutError {
  return {
    code: "R004",
    root,
    family,
    message: `Conductor caption ${JSON.stringify(text)} has no clear owned placement or drafting leader. Use a roomier view or shorter authored caption.`,
    details: { reason: "ambiguous-conductor-caption", ownerId, caption: text },
  };
}
