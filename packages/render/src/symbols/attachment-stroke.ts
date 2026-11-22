import { required } from "../presentation/util.js";

/** Without selected port incidence, retain the 0.35 mm symbol attachment ink. */
export const UNSELECTED_ATTACHMENT_STROKE_MM = 0.35;

/** Route ownership distinguishes two faces of the same physical terminal. */
export function attachmentStrokeWeights(
  edges: readonly {
    id: string;
    sources: readonly string[];
    targets: readonly string[];
  }[],
  conductors: readonly { jumper: boolean }[],
): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    const weight = required(
      conductors[Number(edge.id.slice(1))],
      "Missing circuit conductor",
    ).jumper
      ? 0.55
      : 0.32;
    for (const id of [...edge.sources, ...edge.targets])
      weights.set(id, Math.min(weights.get(id) ?? Infinity, weight));
  }
  return weights;
}

/** The inner catalog ray and its tag-lane extension share one visual port. */
export function terminalAttachmentStroke(
  portId: string,
  weights?: ReadonlyMap<string, number>,
): number {
  return weights?.get(portId) ?? UNSELECTED_ATTACHMENT_STROKE_MM;
}
