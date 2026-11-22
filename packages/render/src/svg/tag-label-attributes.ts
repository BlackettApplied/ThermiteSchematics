import type { PresentationLabel, PresentationGraph } from "../types.js";
import type { SvgAttributes } from "./writer.js";
import { decodeSvgSemanticId } from "./escape.js";
export function tagLabelAttributes(
  presentation: PresentationLabel,
  view: PresentationGraph["view"],
): SvgAttributes {
  const source =
    presentation.role === "device"
      ? presentation.textSources.find((s) => s.field === "device.designation")
      : undefined;
  if (!source) return {};
  const owner = decodeSvgSemanticId("device", source.ownerId)[0];
  return {
    "data-tag-owner-uid": owner,
    ...(view.format === "schematic-view/0.2" && view.intent === "conductors"
      ? { "data-tag-field": "designation" }
      : { "data-tag-key": presentation.text }),
    "data-tag-kind": "body",
    "data-tag-block": owner,
  };
}
