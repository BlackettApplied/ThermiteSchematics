import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { breakerAuxiliaryFixture } from "../../render/test/breaker-auxiliary-fixture.js";
import { embedPrintableFont } from "../src/printable-font.js";
import { launchBrowser, browserPath } from "./helpers/pdf-raster.js";
import { printDiagnostics } from "./helpers/print-diagnostics.js";
it.skipIf(!browserPath)(
  "keeps adjacent breaker NO/NC caption ink nearest its owner and clear of every primitive",
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
        const page = await browser.newPage({ deviceScaleFactor: 300 / 96 });
        try {
          await page.setContent(embedPrintableFont(r.value.sheets[0]!.svg));
          await page.evaluate(() => document.fonts.ready);
          const results = await page.evaluate(() => {
            const distance = (
                a: { left: number; right: number; top: number; bottom: number },
                b: { left: number; right: number; top: number; bottom: number },
              ) =>
                Math.hypot(
                  Math.max(a.left - b.right, b.left - a.right, 0),
                  Math.max(a.top - b.bottom, b.top - a.bottom, 0),
                ),
              out = [];
            for (const g of document.querySelectorAll(
              "[data-contact-caption]",
            )) {
              const t = g.querySelector("text")!,
                cs = getComputedStyle(t),
                c = document.createElement("canvas").getContext("2d")!;
              c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
              const m = c.measureText(t.textContent!),
                matrix = t.getScreenCTM()!,
                x = Number(t.getAttribute("x")),
                y = Number(t.getAttribute("y")),
                p = (x: number, y: number) =>
                  new DOMPoint(x, y).matrixTransform(matrix),
                a = p(
                  x - m.actualBoundingBoxLeft,
                  y - m.actualBoundingBoxAscent,
                ),
                b = p(
                  x + m.actualBoundingBoxRight,
                  y + m.actualBoundingBoxDescent,
                ),
                box = { left: a.x, right: b.x, top: a.y, bottom: b.y };
              const own = g
                  .parentElement!.querySelector("[data-circuit-mark]")!
                  .getBoundingClientRect(),
                others = [
                  ...g
                    .closest("[data-device-uid]")!
                    .querySelectorAll("[data-circuit-mark]"),
                ]
                  .filter(
                    (e) =>
                      e !==
                      g.parentElement!.querySelector("[data-circuit-mark]"),
                  )
                  .map((e) => e.getBoundingClientRect());
              let nearest = Infinity,
                nearestPrimitive;
              for (const shape of document.querySelectorAll(
                "line,path,polyline,rect,circle",
              )) {
                if (shape.closest("defs") || !("getTotalLength" in shape))
                  continue;
                const e = shape as SVGGeometryElement,
                  sm = e.getScreenCTM()!,
                  length = e.getTotalLength();
                for (
                  let at = 0;
                  at <= length;
                  at += Math.max(0.05, length / 500)
                ) {
                  const q = e.getPointAtLength(at),
                    v = new DOMPoint(q.x, q.y).matrixTransform(sm);
                  const gap = distance(box, {
                    left: v.x,
                    right: v.x,
                    top: v.y,
                    bottom: v.y,
                  });
                  if (gap < nearest) {
                    nearestPrimitive = {
                      element: e.outerHTML,
                      length,
                      at,
                      localPoint: { x: q.x, y: q.y },
                      screenPoint: { x: v.x, y: v.y },
                      stroke: getComputedStyle(e).stroke,
                      fill: getComputedStyle(e).fill,
                      matrix: [sm.a, sm.b, sm.c, sm.d, sm.e, sm.f],
                    };
                  }
                  nearest = Math.min(nearest, gap);
                }
              }
              let nearestText = Infinity;
              for (const other of document.querySelectorAll("text")) {
                if (
                  other === t ||
                  !other.textContent?.trim() ||
                  !other.getNumberOfChars()
                )
                  continue;
                const style = getComputedStyle(other);
                c.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const tm = c.measureText(other.textContent),
                  start = other.getStartPositionOfChar(0),
                  ctm = other.getScreenCTM()!,
                  p1 = new DOMPoint(
                    start.x - tm.actualBoundingBoxLeft,
                    start.y - tm.actualBoundingBoxAscent,
                  ).matrixTransform(ctm),
                  p2 = new DOMPoint(
                    start.x + tm.actualBoundingBoxRight,
                    start.y + tm.actualBoundingBoxDescent,
                  ).matrixTransform(ctm);
                nearestText = Math.min(
                  nearestText,
                  distance(box, {
                    left: p1.x,
                    right: p2.x,
                    top: p1.y,
                    bottom: p2.y,
                  }),
                );
              }
              out.push({
                text: t.textContent,
                own: distance(box, own),
                other: Math.min(...others.map((b) => distance(box, b))),
                nearest,
                nearestText,
                box,
                nearestPrimitive,
              });
            }
            return out;
          });
          await printDiagnostics(
            browser,
            page,
            r.value.sheets[0]!.svg,
            `breaker-${flow}`,
            ["NO", "NC"],
            results,
          );
          expect(results).toHaveLength(2);
          for (const r of results) {
            expect(r.own, r.text!).toBeLessThan(r.other);
            expect(r.nearestText, r.text!).toBeGreaterThan(0);
            expect(r.nearest, r.text!).toBeGreaterThan((0.1 * 96) / 25.4);
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
