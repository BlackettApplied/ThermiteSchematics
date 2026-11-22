import { parseSvg } from "./off-view-fixtures.js";
import { navigationLabelInk } from "../src/packet/navigation-label-ink.js";

/** Read emitted line breaks rather than inferring them from the annotation DTO. */
export function printedElementInk(
  svg: string,
  id: string,
  origin: { x: number; y: number },
) {
  const group = parseSvg(svg).querySelector(
    `[data-navigation-annotation="${id}"]`,
  );
  if (!group) throw Error("Missing printed element group");
  const lines = [...group.querySelectorAll("text")].map(
    (n) => n.textContent ?? "",
  );
  if (!lines.length) throw Error("Missing printed element lines");
  return { lines, ink: navigationLabelInk(lines.join("\n"), origin) };
}
