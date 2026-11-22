import type { PresentationLabel, SymbolPresentationNode } from "../types.js";
import { printableTextMetrics } from "../text-metrics.js";
import { CAPTION_CLEARANCE_MM } from "../symbols/caption-ink.js";
import { GANG_CLEARANCE, gangAnchor } from "../symbols/gang-geometry.js";

export function contactCaptionSymbol(
  symbolId: SymbolPresentationNode["symbolId"],
): boolean {
  return /(?:contact|pushbutton|switch|estop|selector)-(?:no|nc)$/.test(
    symbolId,
  );
}

export function verticalContactCaption(
  orientation: string,
  label: PresentationLabel,
  symbolId: SymbolPresentationNode["symbolId"],
): boolean {
  return (
    orientation === "top-to-bottom" &&
    label.role === "function" &&
    contactCaptionSymbol(symbolId)
  );
}

export function contactCaptionWidth(label: PresentationLabel): number {
  return (
    Math.ceil(
      (printableTextMetrics(label.printableText ?? label.text, 10).advance +
        6) *
        1000,
    ) / 1000
  );
}

/** Native 10-unit type at 0.25 mm/unit. The full former leaf lane remains
 * reserved; only the caption's measured slot moves beside its own mark. */
export function contactCaptionRegion(
  node: Pick<
    SymbolPresentationNode,
    | "symbolId"
    | "orientation"
    | "primitiveOrigin"
    | "symbolSize"
    | "contentBox"
    | "mechanicalGangId"
  >,
  label: PresentationLabel,
) {
  const anchor = node.mechanicalGangId && gangAnchor(node);
  const gangedContact =
    anchor && label.role === "function" && contactCaptionSymbol(node.symbolId);
  if (gangedContact && node.orientation === "left-to-right")
    return {
      x:
        node.primitiveOrigin.x -
        (node.contentBox?.x ?? 0) +
        anchor.x +
        GANG_CLEARANCE +
        0.5,
      y: 4,
      width: label.width,
      height: label.height,
    };
  if (!verticalContactCaption(node.orientation, label, node.symbolId))
    return undefined;
  const m = printableTextMetrics(label.printableText ?? label.text, 10);
  const gap = CAPTION_CLEARANCE_MM / 0.25 + 1.5 / 2 + 0.01;
  const x = node.primitiveOrigin.x - (node.contentBox?.x ?? 0);
  const y = node.primitiveOrigin.y - (node.contentBox?.y ?? 0);
  return {
    x: Number((x - gap - m.right - 3).toFixed(3)),
    y: Number(
      (gangedContact
        ? y + anchor.y + GANG_CLEARANCE + 0.5
        : y + node.symbolSize.height / 2 - label.height / 2
      ).toFixed(3),
    ),
    width: label.width,
    height: label.height,
  };
}
