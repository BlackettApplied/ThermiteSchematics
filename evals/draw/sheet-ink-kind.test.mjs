import { beforeAll, afterAll, expect, it } from "vitest";
import { launch, displaySheet, drawingContextOptions } from "./browser.mjs";
import { sheetInkKindScript } from "./sheet-ink-kind.mjs";
import { reportScaleScript } from "./report-scale.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const source = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">${body}</svg>`;
const strip =
  '<g data-sheet-kind="terminal-strip"><g data-strip-terminal="native"><rect x="10" y="10" width="16" height="8" fill="white" stroke="black"/><text x="12" y="15" font-size="2.5">T1/R1</text></g></g>';
it("classifies actual strip ink and measures its font scale independently", async () => {
  await displaySheet(page, source(strip));
  expect(await page.evaluate(sheetInkKindScript)).toEqual([
    { kind: "terminal-strip", issues: [], terminalCount: 1 },
  ]);
  expect(await page.evaluate(reportScaleScript)).toEqual([]);
});
it("does not discharge real report no-report-text with a forged strip kind", async () => {
  await displaySheet(
    page,
    source(strip + '<g data-report-column="1" data-column-name=""></g>'),
  );
  expect(
    (await page.evaluate(reportScaleScript)).some(
      (i) => i.kind === "no-report-text",
    ),
  ).toBe(true);
});
it.each([
  [
    "missing body",
    strip.replace(/<rect[^>]+\/>/u, ""),
    "strip-sheet-missing-ink",
  ],
  [
    "tiny text",
    strip.replace('font-size="2.5"', 'font-size="2.4"'),
    "strip-unprintable-text",
  ],
  [
    "hidden body",
    strip.replace('fill="white"', 'style="display:none" fill="white"'),
    "strip-sheet-missing-ink",
  ],
])("rejects %s", async (name, body, kind) => {
  await displaySheet(page, source(body));
  expect(
    (await page.evaluate(reportScaleScript)).some((i) => i.kind === kind),
  ).toBe(true);
});
it("keeps the same compression and stretching limits on strip ink", async () => {
  await displaySheet(page, source(strip));
  await page.evaluate(() => {
    const t = document.querySelector("text");
    t.setAttribute("textLength", String(t.getComputedTextLength() * 0.9));
    t.setAttribute("lengthAdjust", "spacingAndGlyphs");
  });
  expect(
    (await page.evaluate(reportScaleScript)).some(
      (i) => i.kind === "glyph-scale",
    ),
  ).toBe(true);
});
