import { svgSemanticId } from "../svg/escape.js";
import { required } from "../presentation/util.js";
import type { PresentationLabel } from "../types.js";
import { SvgWriter } from "../svg/writer.js";
import { CARD_FONT, CARD_PAD } from "./card.js";

/** Annotation metadata deliberately cannot masquerade as drawn conductors/devices. */
export function offViewCardSvg(
  label: PresentationLabel,
  x: number,
  y: number,
  scale = 1,
): string {
  const card = required(label.offView, "Missing off-view card");
  const writer = new SvgWriter();
  writer.open(1, "g", {
    class: "off-view-annotation",
    "data-off-view-terminal": card.terminalName,
    "data-off-view-terminal-id": JSON.stringify(card.terminal),
    "data-off-view-conductors": JSON.stringify(
      card.connections.map((c) => c.elementId),
    ),
  });
  writer.element(2, "rect", {
    class: "off-view-card",
    x,
    y,
    width: label.width * scale,
    height: label.height * scale,
    fill: "none",
    stroke: "#616b78",
    "stroke-width": 0.75 * scale,
  });
  for (const line of card.lines)
    writer.element(
      2,
      "text",
      {
        class: line.bold ? "off-view-heading" : "off-view-row",
        "data-tag-owner-uid": line.bold ? card.terminal.deviceUid : undefined,
        "data-tag-field": line.bold ? "designation" : undefined,
        "data-tag-kind": line.bold ? "reference" : undefined,
        "data-tag-block": line.bold
          ? svgSemanticId("clip", [label.id])
          : undefined,
        "data-tag-terminal-id": line.bold
          ? JSON.stringify(card.terminal)
          : undefined,
        x: x + (CARD_PAD + line.offsetX) * scale,
        y: y + line.baseline * scale,
        "font-family": "Thermite Sans, Thermite Math, sans-serif",
        "font-size": CARD_FONT * scale,
        ...(line.bold ? { "font-weight": "700" } : {}),
        fill: "#101828",
      },
      line.text,
    );
  writer.close(1, "g");
  return writer.finish().trimEnd();
}
