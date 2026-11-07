import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { breakerAuxiliaryFixture } from "../../render/test/breaker-auxiliary-fixture.js";
import { embedPrintableFont } from "../src/printable-font.js";
import { printableTextMetrics } from "../../render/src/symbols/printable-font.js";
import { launchBrowser, browserPath } from "./helpers/pdf-raster.js";
import {
  bounds,
  distance,
  primitiveDistance,
  svgOutlineGeometry,
} from "./helpers/svg-outline-geometry.js";
import type { Page } from "playwright-core";

async function captionClearances(page: Page, svg: string) {
  const g = await svgOutlineGeometry(page, svg);
  return g.texts
    .filter((t) => t.caption)
    .map((t) => {
      const markBox = (index: number) =>
        bounds(
          g.shapes.filter((s) => s.mark === index).flatMap((s) => s.points),
        );
      return {
        text: t.text,
        own: distance(t.box, markBox(t.owner)),
        other: Math.min(
          ...g.marks
            .map((m, i) => ({ ...m, i }))
            .filter((m) => m.device === t.device && m.i !== t.owner)
            .map((m) => distance(t.box, markBox(m.i))),
        ),
        nearestText: Math.min(
          ...g.texts
            .filter((other) => other !== t && other.painted)
            .map((other) => distance(t.box, other.box)),
        ),
        nearest: Math.min(
          ...g.shapes.map((s) =>
            Math.max(0, primitiveDistance(t.box, s.points) - s.stroke / 2),
          ),
        ),
      };
    });
}
function assertCaptionClearances(
  results: Awaited<ReturnType<typeof captionClearances>>,
) {
  expect(results).toHaveLength(2);
  for (const r of results) {
    expect(r.own, r.text).toBeLessThan(r.other);
    expect(r.nearestText, r.text).toBeGreaterThan(0);
    expect(r.nearest, r.text).toBeGreaterThan(0.1); // sheet mm, same 0.1 mm requirement
  }
}

it.skipIf(!browserPath)(
  "keeps pinned NO/NC outlines clear and rejects caption overlap and rect-side mutations",
  async () => {
    const f = await breakerAuxiliaryFixture(),
      browser = await launchBrowser();
    try {
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const r = await renderSchematicPacket(f.ir, {
          ...f.request,
          views: f.request.views.map((v) => ({ ...v, flow })),
        });
        if (!r.ok) throw Error(JSON.stringify(r));
        const page = await browser.newPage();
        try {
          const svg = r.value.sheets[0]!.svg;
          assertCaptionClearances(await captionClearances(page, svg));
          // Move the baseline so the pinned ink's center lies on an actual mark.
          // The inverse SVG transform maps that primitive into the text's frame.
          const m = printableTextMetrics("NO", 2.3);
          const mutated = await page.evaluate((metrics) => {
            const t = [
              ...document.querySelectorAll<SVGTextElement>(
                "[data-contact-caption] text",
              ),
            ].find((e) => e.textContent === "NO")!;
            const primitive = t
              .closest("[data-contact-caption]")!
              .parentElement!.querySelector<SVGGeometryElement>(
                "[data-circuit-mark] line,[data-circuit-mark] path",
              )!;
            const q = primitive.getPointAtLength(
                primitive.getTotalLength() / 2,
              ),
              p = new DOMPoint(q.x, q.y)
                .matrixTransform(primitive.getScreenCTM()!)
                .matrixTransform(t.getScreenCTM()!.inverse());
            t.setAttribute(
              "x",
              String(p.x - (metrics.left + metrics.right) / 2),
            );
            t.setAttribute(
              "y",
              String(p.y + (metrics.top + metrics.bottom) / 2),
            );
            return document.querySelector("svg")!.outerHTML;
          }, m);
          const bad = await captionClearances(page, mutated);
          expect(bad.find((r) => r.text === "NO")!.nearest).toBe(0);
          expect(() => assertCaptionClearances(bad)).toThrow();
          // Each rect extends past the caption vertically. Only its near side
          // violates the gap; row-order corner diagonals miss that collision.
          for (const side of ["left", "right"] as const) {
            const original = await svgOutlineGeometry(page, svg),
              box = original.texts.find(
                (t) => t.caption && t.text === "NO",
              )!.box;
            const beside = await page.evaluate(
              ({ box, side }) => {
                const rect = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "rect",
                );
                for (const [name, value] of Object.entries({
                  x: side === "left" ? box.left - 4 - 0.02 : box.right + 0.02,
                  y: box.top - 10,
                  width: 4,
                  height: box.bottom - box.top + 20,
                  fill: "none",
                  stroke: "#17212b",
                  "stroke-width": 0.01,
                }))
                  rect.setAttribute(name, String(value));
                document.querySelector("svg")!.appendChild(rect);
                return document.querySelector("svg")!.outerHTML;
              },
              { box, side },
            );
            const near = await captionClearances(page, beside),
              gap = near.find((r) => r.text === "NO")!.nearest;
            expect(gap, `${flow} rect on ${side}`).toBeCloseTo(0.015, 3);
            expect(() => assertCaptionClearances(near)).toThrow();
          }
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
      await f.dispose();
    }
  },
);
it.skipIf(!browserPath)(
  "leaves a line in the old opaque reservation gap visible",
  async () => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error();
    const r = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "designation", value: "K1" },
        },
      ],
    });
    if (!r.ok) throw Error(JSON.stringify(r));
    const browser = await launchBrowser(),
      page = await browser.newPage();
    try {
      await page.setContent(embedPrintableFont(r.value.sheets[0]!.svg));
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => {
        for (const t of document.querySelectorAll("text.label-text")) {
          const plate = t.previousElementSibling as SVGRectElement,
            clip = document
              .querySelector(
                t
                  .getAttribute("clip-path")!
                  .replace("url(", "")
                  .replace(")", ""),
              )!
              .querySelector("rect")!,
            y =
              Number(plate.getAttribute("y")) +
              Number(plate.getAttribute("height")) +
              0.5,
            max =
              Number(clip.getAttribute("y")) +
              Number(clip.getAttribute("height"));
          if (y + 0.2 >= max) continue;
          const x = Number(plate.getAttribute("x")) + 0.3,
            line = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "line",
            );
          for (const [k, v] of Object.entries({
            x1: x,
            x2: x + 2,
            y1: y,
            y2: y,
            stroke: "#ff00ff",
            "stroke-width": ".3",
          }))
            line.setAttribute(k, String(v));
          plate.parentElement!.insertBefore(line, plate);
          const before = line.getBoundingClientRect(),
            cover = plate.getBoundingClientRect();
          return {
            gap: before.top - cover.bottom,
            root: document.querySelector("svg")!.outerHTML,
          };
        }
        throw Error("No old reservation gap");
      });
      expect(result.gap).toBeGreaterThan(0);
      // Reinstating the old full-slot plate makes the first assertion fail and covers this probe.
    } finally {
      await page.close();
      await browser.close();
    }
  },
);
