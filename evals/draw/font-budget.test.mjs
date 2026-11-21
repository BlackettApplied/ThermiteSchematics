import { it, expect } from "vitest";
import { checkSvgFontBudget, SVG_FONT_BUDGET } from "./font-budget.mjs";
it("checks every delivered face and includes base64/style overhead", () => {
  const style =
    '<style data-thermite-font="pinned">' +
    "x".repeat(SVG_FONT_BUDGET) +
    "</style>";
  expect(() =>
    checkSvgFontBudget("<svg>" + style + "</svg>", "case/sheet-001.svg"),
  ).toThrow(/case\/sheet-001.svg.*61440/);
  expect(checkSvgFontBudget("<svg/>", "raw")).toBe(0);
});
