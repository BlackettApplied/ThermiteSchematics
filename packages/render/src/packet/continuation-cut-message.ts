import type { PresentationEdge } from "../types.js";
import { required } from "../presentation/util.js";
import { continuationIdentityConstraint } from "./continuation-identity.js";

export function continuationCutMessage(
  edge: Parameters<typeof continuationIdentityConstraint>[0] & {
    readonly kind?: PresentationEdge["kind"];
  },
) {
  if (edge.kind === "boundary-segment")
    return `A candidate cut crosses presentation-only boundary segment ${JSON.stringify(edge.id)}, which has no unique authored conductor identity and must remain uncut. Change paper or flow so the segment stays on one sheet.`;
  return `A candidate cut crosses this conductor. ${required(
    continuationIdentityConstraint(edge),
    "Missing identity constraint",
  )} Use larger paper, landscape, or the other flow so no cut crosses this conductor.`;
}
