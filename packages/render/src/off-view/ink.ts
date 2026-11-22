import type { PresentationLabel } from "../types.js";
import { pinnedMetrics } from "./metrics.js";
import { CARD_FONT, CARD_PAD, CARD_PITCH } from "./card.js";

/** Check final natural ink independently of the wrapping/width calculation. */
export function cardInkFits(label: PresentationLabel): boolean {
  return (
    !!label.offView &&
    label.offView.lines.every((line) => {
      const m = pinnedMetrics(line.text, CARD_FONT, line.bold);
      const x = CARD_PAD + line.offsetX;
      return (
        x + m.left >= CARD_PAD - 0.001 &&
        x + Math.max(m.right, m.advance) <= label.width - CARD_PAD + 0.001 &&
        line.baseline - m.top >= CARD_PAD - 0.001 &&
        line.baseline - m.bottom <= label.height - CARD_PAD + 0.001 &&
        m.top - m.bottom <= CARD_PITCH
      );
    })
  );
}
