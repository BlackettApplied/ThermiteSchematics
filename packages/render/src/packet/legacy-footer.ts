import { wrapText } from "../text-metrics.js";
import { text } from "./svg.js";

// The existing 14 mm title allowance reserves two footer rows at 4 mm pitch,
// below the title rows. Wrap before emission, never into the right-hand cells.
export function legacyFooterNote(
  note: string,
  x: number,
  width: number,
  bottom: number,
  nextTitleBaseline: number,
): string[] {
  const rows = wrapText(note, width, 2.5);
  const first = bottom - 3 - (rows.length - 1) * 4;
  if (first < nextTitleBaseline)
    throw Error(
      `Frame note needs ${rows.length * 4} mm at 2.5 mm em; ${Math.max(0, bottom - 3 - nextTitleBaseline + 4).toFixed(3)} mm are available below the title. Use larger paper or a shorter supplied title.`,
    );
  return rows.map((row, i) => text(x, first + i * 4, row, 2.5));
}
