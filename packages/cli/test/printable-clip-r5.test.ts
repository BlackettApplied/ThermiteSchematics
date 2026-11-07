import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { conveyor } from "../../../evals/draw/corpus/requests.mjs";
import { embedPrintableFont } from "../src/printable-font.js";
import { browserPath, launchBrowser } from "./helpers/pdf-raster.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
it.skipIf(!browserPath)(
  "leaves one clear 300 dpi pixel around every unclipped conveyor label",
  async () => {
    const c = await compileProject("examples/conveyor-line");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const r = await renderSchematicPacket(c.ir, conveyor, c.presentation);
    if (!r.ok) throw Error(JSON.stringify(r));
    const scale = 300 / 96,
      browser = await launchBrowser(),
      page = await browser.newPage({
        deviceScaleFactor: scale,
        viewport: { width: 1700, height: 1100 },
      });
    try {
      await page.setContent(
        `<style>body{margin:0}</style>${embedPrintableFont(r.value.sheets[0]!.svg)}`,
      );
      await page.evaluate(() => document.fonts.ready);
      const labels = await page.evaluate(() => {
        // Isolate real, un-clipped text at its unchanged print transform. Raster-cache
        // differences between clipped/unclipped Skia draws are not clipped pixels.
        document
          .querySelectorAll(
            "path,rect,circle,line,polyline,polygon,ellipse,text",
          )
          .forEach(
            (e) =>
              !e.closest("defs") &&
              ((e as SVGElement).style.visibility = "hidden"),
          );
        return [...document.querySelectorAll("text.label-text")].map((t) => {
          const rect = document
              .getElementById(t.getAttribute("clip-path")!.slice(5, -1))!
              .querySelector("rect")!,
            b = rect.getBBox(),
            m = t.getScreenCTM()!,
            a = new DOMPoint(b.x, b.y).matrixTransform(m),
            z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
          t.removeAttribute("clip-path");
          return {
            text: t.textContent!,
            left: a.x,
            right: z.x,
            top: a.y,
            bottom: z.y,
          };
        });
      });
      expect(labels).toHaveLength(104);
      let visible = 0;
      for (const [index, b] of labels.entries()) {
        // Full continuous geometry is repeated behind the sheet's fold viewport.
        if (b.left < 3 || b.top < 3 || b.right > 1697 || b.bottom > 1097)
          continue;
        await page.evaluate((i) => {
          document
            .querySelectorAll<SVGTextElement>("text.label-text")
            .forEach(
              (t, j) => (t.style.visibility = i === j ? "visible" : "hidden"),
            );
        }, index);
        const crop = {
          x: Math.floor(b.left - 3),
          y: Math.floor(b.top - 3),
          width: Math.ceil(b.right - b.left + 6),
          height: Math.ceil(b.bottom - b.top + 6),
        };
        const image = await loadImage(await page.screenshot({ clip: crop })),
          canvas = createCanvas(image.width, image.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        let gap = Infinity,
          ink = 0;
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++)
            if (pixels[(y * image.width + x) * 4]! < 255) {
              ink++;
              gap = Math.min(
                gap,
                x + (crop.x - b.left) * scale,
                (b.right - crop.x) * scale - x - 1,
                y + (crop.y - b.top) * scale,
                (b.bottom - crop.y) * scale - y - 1,
              );
            }
        // Continuous source labels outside this folded sheet have no painted ink.
        if (!ink) continue;
        visible++;
        expect(gap, b.text).toBeGreaterThanOrEqual(1);
      }
      expect(visible).toBe(52);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);
