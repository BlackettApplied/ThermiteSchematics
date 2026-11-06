import { createHash } from "node:crypto";
import type { Browser, Page } from "playwright-core";
import { printableTextMetrics } from "../../../render/src/symbols/printable-font.js";

/** Keep the original assertions while collecting comparable evidence on CI hosts. */
export async function printDiagnostics(
  browser: Browser,
  page: Page,
  svg: string,
  name: string,
  labels: string[],
  measurements: unknown,
) {
  const data = await page.evaluate((labels) => {
    const context = document.createElement("canvas").getContext("2d")!;
    const texts = [...document.querySelectorAll("text")]
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => labels.includes(text.textContent ?? ""))
      .slice(0, 4)
      .map(({ text, index }) => {
        const css = getComputedStyle(text);
        context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const metrics = context.measureText(text.textContent!),
          font = context.font,
          box = text.getBBox(),
          matrix = text.getScreenCTM()!,
          start = text.getStartPositionOfChar(0);
        // Distinguish tiny-size raster metric quantization from font outlines.
        context.font = `${css.fontWeight} ${parseFloat(css.fontSize) * 1000}px ${css.fontFamily}`;
        const large = context.measureText(text.textContent!);
        return {
          index,
          text: text.textContent!,
          element: text.outerHTML,
          font,
          fontSize: parseFloat(css.fontSize),
          bold: Number(css.fontWeight) >= 600,
          fontLoaded: document.fonts.check(font, text.textContent!),
          metrics: {
            width: metrics.width,
            left: metrics.actualBoundingBoxLeft,
            right: metrics.actualBoundingBoxRight,
            ascent: metrics.actualBoundingBoxAscent,
            descent: metrics.actualBoundingBoxDescent,
          },
          scaledMetrics: {
            width: large.width / 1000,
            left: large.actualBoundingBoxLeft / 1000,
            right: large.actualBoundingBoxRight / 1000,
            ascent: large.actualBoundingBoxAscent / 1000,
            descent: large.actualBoundingBoxDescent / 1000,
          },
          svgBox: { x: box.x, y: box.y, width: box.width, height: box.height },
          screenBox: text.getBoundingClientRect().toJSON(),
          matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
          start: { x: start.x, y: start.y },
          advance: text.getComputedTextLength(),
          baseline: `${css.dominantBaseline}/${css.alignmentBaseline}`,
        };
      });
    return {
      fontsStatus: document.fonts.status,
      faces: [...document.fonts].map((face) => ({
        family: face.family,
        weight: face.weight,
        status: face.status,
      })),
      texts,
    };
  }, labels);
  // FontFaceSet.check also succeeds when no matching face exists. CDP identifies
  // the font that actually painted each SVG text node, including fallback.
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeIds } = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "text",
    });
    const texts = await Promise.all(
      data.texts.map(async (text) => ({
        ...text,
        outlineMetrics: printableTextMetrics(
          text.text,
          text.fontSize,
          text.bold,
        ),
        paintedFonts: (
          await session.send("CSS.getPlatformFontsForNode", {
            nodeId: nodeIds[text.index]!,
          })
        ).fonts,
      })),
    );
    const hash = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    process.stderr.write(
      "THERMITE_PRINT_DIAGNOSTIC " +
        JSON.stringify({
          name,
          platform: process.platform,
          arch: process.arch,
          bun: process.versions.bun,
          browser: browser.version(),
          svgSha256: hash(svg),
          fontBlockSha256: hash(
            (await page.locator("style[data-thermite-font]").textContent()) ??
              "",
          ),
          ...data,
          texts,
          measurements,
        }) +
        "\n",
    );
  } finally {
    await session.detach();
  }
}
