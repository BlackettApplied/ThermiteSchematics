import type { Fact } from "./model.js";
import type { PatternToken } from "#title-schema/pattern";
export { parsePattern, type PatternToken } from "#title-schema/pattern";
export function expandPattern(
  tokens: readonly PatternToken[],
  base: Fact<string>,
  number: number,
  total: number,
): string | null {
  // Patterns are opt-in drawing numbers; an absent drawing base is unknown.
  if (!base.known) return null;
  return tokens
    .map((t) =>
      "literal" in t
        ? t.literal
        : t.token === "drawingBase"
          ? base.value
          : String(t.token === "sheetNumber" ? number : total).padStart(
              t.padding,
              "0",
            ),
    )
    .join("");
}
