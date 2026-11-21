import { readFile } from "node:fs/promises";
import { sheetMeasurementSource, openSheet } from "./browser.mjs";
import { classifyTextGeometry } from "./text-classification.mjs";
import { retainLostText } from "./lost-text.mjs";
import { viewKey } from "./locators.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";
import {
  identifierContext,
  IdentifierMeasurementError,
} from "./identifier-errors.mjs";
export async function measurePacketGeometry(
  page,
  htmlPath,
  packet,
  ir,
  geometries,
) {
  await page.setContent(await readFile(htmlPath, "utf8"));
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.evaluate(
    ({ source }) => {
      const measure = (0, eval)(`(${source})`);
      return Array.from(document.querySelectorAll("section>svg")).map((_, i) =>
        (() => {
          try {
            return {
              geometry: measure({
                selector: `#sheet-${i + 1}>svg`,
                textOnly: true,
              }),
            };
          } catch (error) {
            if (
              error.name !== "IdentifierMeasurementError" ||
              error.code !== "THERMITE_IDENTIFIER_MEASUREMENT"
            )
              throw error;
            return { error: error.message, sheet: i + 1 };
          }
        })(),
      );
    },
    { source: sheetMeasurementSource() },
  );
  const htmlGeometry = measured.map((r) => {
    if (r.error)
      throw identifierContext(
        new IdentifierMeasurementError(r.error),
        r.sheet,
        "html",
      );
    return r.geometry;
  });
  const htmlSvgs = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll("section>svg"),
      (svg) => svg.outerHTML,
    ),
  );
  for (const g of htmlGeometry) classifyTextGeometry(g, ir);
  retainLostText(
    htmlGeometry,
    packet.sheets.map((s) => viewKey(s.view)),
  );
  // Collect all tiled copies before deciding whether a semantic label was lost.
  await measureSvgSheets(page, packet, geometries);
  retainLostText(
    geometries,
    packet.sheets.map((s) => viewKey(s.view)),
  );
  return { htmlGeometry, htmlSvgs };
}
async function measureSvgSheets(page, packet, geometries) {
  for (const sheet of packet.sheets) {
    try {
      const geometry = await openSheet(page, sheet.svg);
      if (["terminals", "terminal-strip"].includes(sheet.view.kind))
        geometry.terminalStripInk = await page.evaluate(stripInkScript);
      geometries.push(geometry);
    } catch (error) {
      throw identifierContext(error, sheet.number, "svg");
    }
  }
}
