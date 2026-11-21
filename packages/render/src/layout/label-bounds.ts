import type { LayoutLabel, LayoutEdge, PresentationLabel } from "../types.js";
import { printableLabelGeometry } from "../symbols/printable-label.js";
import type { Bounds } from "./validate-output.js";

export function layoutLabelInk(
  label: LayoutLabel,
  captions: ReadonlyMap<string, PresentationLabel>,
  edges: ReadonlyMap<string, LayoutEdge>,
  reject: (message: string) => never,
): Bounds {
  const caption = captions.get(label.id);
  if (!caption) reject(`label ${label.id} has no presentation caption`);
  if (caption.offView)
    return {
      left: label.x,
      top: label.y,
      right: Number((label.x + label.width).toFixed(3)),
      bottom: Number((label.y + label.height).toFixed(3)),
    };
  return printableLabelGeometry(
    label,
    caption.printableText ?? caption.text,
    caption.textLength,
    label.ownerKind === "edge"
      ? [edges.get(label.ownerId)?.points ?? []]
      : undefined,
  ).ink;
}
