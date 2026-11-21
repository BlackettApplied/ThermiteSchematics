// Counterfactual paint census: preserve raster state and operation order.
import { identifyZones } from "./zones.mjs";
import { launch } from "../browser.mjs";
import { embedPrintableFont } from "../../../packages/cli/dist/printable-font.js";
import { textGeometry, textVisibility } from "./text-geometry.mjs";
import { textRaster } from "./text-raster.mjs";
import { textContacts, laneContacts, titleContacts } from "./text-contacts.mjs";

export async function measureText(
  page,
  svg,
  {
    artifactDir,
    tag = "sheet",
    cropPositives = true,
    lanes = true,
    title = true,
  } = {},
) {
  await page.setContent(
    "<style>body{margin:0}</style>" +
      (svg.includes("data-thermite-font")
        ? svg
        : embedPrintableFont(svg)
      ).replace(/<\?xml[^>]*>/, ""),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(identifyZones);
  const broad = await page.evaluate(`(${textGeometry})(${textVisibility})`),
    raster = await textRaster(page, broad);
  const { hits, nearHits } = await textContacts(page, broad, raster, {
    artifactDir,
    tag,
    cropPositives,
  });
  const laneHits = lanes ? await laneContacts(broad, raster) : [];
  const titleHits = title ? await titleContacts(broad, raster) : [];
  return {
    zones: broad.zones.length,
    texts: broad.texts.length,
    clippedTexts: broad.clipped.length,
    clippedExamples: broad.clipped.slice(0, 4),
    broadPairs: broad.pairs.length,
    inkCollisions: hits,
    nearInk: nearHits,
    laneViolations: laneHits,
    titleRuleCollisions: titleHits,
    dimensions: { w: broad.W, h: broad.H },
    titleTop: broad.titleTop,
  };
}
export async function startCensus() {
  const browser = await launch(),
    context = await browser.newContext({
      viewport: { width: 1800, height: 1800 },
      deviceScaleFactor: 300 / 96,
      offline: true,
      serviceWorkers: "block",
      javaScriptEnabled: false,
    }),
    page = await context.newPage();
  const measure = (svg, options) => measureText(page, svg, options);
  return { measure, page, browser, close: () => browser.close() };
}
