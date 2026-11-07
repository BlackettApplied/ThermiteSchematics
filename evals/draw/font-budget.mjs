export const SVG_FONT_BUDGET = 60 * 1024;
/** The delivered UTF-8 style bytes, including all faces and base64 expansion. */
export function checkSvgFontBudget(svg, exportName) {
  const bytes = [
    ...svg.matchAll(/<style\b[^>]*data-thermite-font=[\s\S]*?<\/style>/gu),
  ].reduce((sum, match) => sum + Buffer.byteLength(match[0]), 0);
  if (bytes > SVG_FONT_BUDGET)
    throw Error(
      `SVG_FONT_BUDGET: ${exportName}: ${bytes} font bytes exceeds ${SVG_FONT_BUDGET}`,
    );
  return bytes;
}
