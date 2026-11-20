import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { dolFixture, actuation } from "./dol-control-junctions-fixture.js";
import {
  displaySheet,
  evaluateSheetGeometry,
  launch,
  drawingContextOptions,
} from "../../../evals/draw/browser.mjs";
import { deviceTags } from "../../../evals/draw/checks.mjs";
import {
  svgOutlineGeometry,
  bounds,
  distance,
  primitiveDistance,
  type Box,
} from "../../cli/test/helpers/svg-outline-geometry.js";
import { strokeMetadata } from "./helpers/painted-ink.js";
let browser: Awaited<ReturnType<typeof launch>>, page: any;
beforeAll(async () => {
  browser = await launch();
  const context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
  // CI can spend 30 s loading the dense plate after the full packet render.
  page.setDefaultTimeout(60000);
});
afterAll(async () => {
  await browser?.close();
});
function clippedBox(box: Box, clips: any[]): Box {
  for (const pts of clips) {
    const b = bounds(pts);
    box = {
      left: Math.max(box.left, b.left),
      top: Math.max(box.top, b.top),
      right: Math.min(box.right, b.right),
      bottom: Math.min(box.bottom, b.bottom),
    };
  }
  return box;
}
// The tag checker uses painted text, device and terminal measurements.
// The outline oracle measures clipped conductor and border ink separately.
async function audit(svg: string, ir: any, refs: any[]) {
  await displaySheet(page, svg);
  const measured = await evaluateSheetGeometry(page, { textOnly: true }),
    owned = new Set(
      measured.texts
        .filter((t) => t.tagKind === "legend")
        .map((t) => t.tagOwnerUid),
    );
  expect(
    deviceTags(measured, ir, refs, true).filter((f) =>
      ir.devices.some(
        (d) => owned.has(d.uid) && d.designation === f.designation,
      ),
    ),
  ).toEqual([]);
  const legends = await page.evaluate(() => {
    const root = document.querySelector("svg")!,
      inverse = (root as unknown as SVGSVGElement).getScreenCTM()!.inverse();
    return [...root.querySelectorAll("rect.device-legend-frame")].map((e) => {
      const b = (e as SVGGraphicsElement).getBBox(),
        m = inverse.multiply((e as SVGGraphicsElement).getScreenCTM()!),
        a = new DOMPoint(b.x, b.y).matrixTransform(m),
        z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
      return { left: a.x, top: a.y, right: z.x, bottom: z.y };
    });
  });
  expect(legends.length).toBeGreaterThan(0);
  const native = await page.evaluate(() => {
    document
      .querySelectorAll("[data-device-legend]")
      .forEach((e) => e.remove());
    return document.querySelector("svg")!.outerHTML;
  });
  const geometry = await svgOutlineGeometry(page, native),
    metadata = await page.evaluate(strokeMetadata, true),
    locations = await page.evaluate(() =>
      [...document.querySelectorAll("line,path,polyline,rect,circle")]
        .filter(
          (e) =>
            !e.closest("defs") &&
            getComputedStyle(e).display !== "none" &&
            getComputedStyle(e).visibility !== "hidden",
        )
        .map((e) => e.classList.contains("location-frame")),
    );
  const regionMetadata = metadata.map((m, i) => ({
    ...m,
    location: locations[i],
  }));
  for (const legend of legends) {
    let minimum = Infinity,
      closest = "";
    for (const text of geometry.texts.filter((t) => t.painted)) {
      const box = clippedBox(text.box, text.clips);
      if (box.left >= box.right || box.top >= box.bottom) continue;
      const d = distance(legend, box) - 0.125;
      if (d < minimum) {
        minimum = d;
        closest = text.text;
      }
    }
    for (const [i, shape] of geometry.shapes.entries()) {
      const info = regionMetadata[i];
      if (info?.location) {
        const box = clippedBox(bounds(shape.points), [
          [
            { x: info.clip.left, y: info.clip.top },
            { x: info.clip.right, y: info.clip.bottom },
          ],
        ]);
        if (box.left < box.right && box.top < box.bottom) {
          const points = [
            { x: box.left, y: box.top },
            { x: box.right, y: box.top },
            { x: box.right, y: box.bottom },
            { x: box.left, y: box.bottom },
            { x: box.left, y: box.top },
          ];
          const d = primitiveDistance(legend, points) - 0.125;
          if (d < minimum) {
            minimum = d;
            closest = "clipped location border";
          }
        }
      }
      if (!info?.ink) continue;
      for (let j = 1; j < shape.points.length; j++) {
        const raw = bounds([shape.points[j - 1]!, shape.points[j]!]),
          half = shape.stroke / 2;
        // Clip painted stroke, not its centreline: a cut viewport also clips
        // the cap/half-stroke at its edge. This retains the full 3 mm rule.
        const painted = {
          left: Math.max(raw.left - half, info.clip.left),
          top: Math.max(raw.top - half, info.clip.top),
          right: Math.min(raw.right + half, info.clip.right),
          bottom: Math.min(raw.bottom + half, info.clip.bottom),
        };
        if (painted.left > painted.right || painted.top > painted.bottom)
          continue;
        const d = distance(legend, painted) - 0.125;
        if (d < minimum) {
          minimum = d;
          closest = JSON.stringify(info);
        }
      }
    }
    expect(minimum, closest).toBeGreaterThanOrEqual(2.999);
  }
}
// Runner audits exceed 60 s; preserve each complete flow within a 120 s budget.
it.each(["left-to-right", "top-to-bottom"] as const)(
  "has at least 3 mm from all final ink and location borders after letter-portrait trim/fold/stack in %s",
  async (flow) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw c;
    const r = await renderSchematicPacket(
      c.ir,
      {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        page: { size: "letter", orientation: "portrait" },
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow,
          },
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "K1" },
            family: "control",
            flow,
          },
        ],
      },
      c.presentation,
    );
    if (!r.ok) throw r;
    for (const s of r.value.sheets) await audit(s.svg, c.ir, s.references);
  },
  120000,
);
async function captionClearance() {
  const captions = await page.evaluate(() => {
    const root = document.querySelector("svg")! as unknown as SVGSVGElement,
      inverse = root.getScreenCTM()!.inverse();
    return [...root.querySelectorAll("text")]
      .filter((e) => e.textContent?.startsWith("CONTINUED LOCATION:"))
      .map((e) => {
        const b = e.getBBox(),
          m = inverse.multiply(e.getScreenCTM()!),
          a = new DOMPoint(b.x, b.y).matrixTransform(m),
          z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
        return { left: a.x, top: a.y, right: z.x, bottom: z.y };
      });
  });
  expect(captions.length).toBeGreaterThan(1);
  for (const [i, caption] of captions.entries())
    for (const other of captions.slice(i + 1))
      expect(distance(caption, other)).toBeGreaterThanOrEqual(0.999);
}
it("protects the dense DOL one-sheet packet and PLC1 tags in both flows", async () => {
  const f = await dolFixture("saved");
  try {
    const r = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      layout: "standard",
      views: [actuation("K1", "top-to-bottom")],
    });
    if (!r.ok) throw r;
    expect(r.value.sheets).toHaveLength(1);
    await audit(r.value.sheets[0]!.svg, f.ir, r.value.sheets[0]!.references);
    await captionClearance();
  } finally {
    await f.dispose();
  }
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw c;
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const r = await renderSchematicPacket(
      c.ir,
      {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "K1" },
            family: "control",
            flow,
          },
        ],
      },
      c.presentation,
    );
    if (!r.ok) throw r;
    for (const s of r.value.sheets) await audit(s.svg, c.ir, s.references);
  }
}, 120000);
