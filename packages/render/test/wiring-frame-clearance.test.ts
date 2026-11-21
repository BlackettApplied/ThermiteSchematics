import { afterAll, beforeAll, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { renderSchematicPacket } from "../src/sheets.js";
import { consoleWiringFixture } from "./wiring-landings-fixture.js";
import { required } from "./fixtures.js";
import { launchBrowser } from "../../cli/test/helpers/pdf-raster.js";
import { svgOutlineGeometry } from "../../cli/test/helpers/svg-outline-geometry.js";

let browser: Awaited<ReturnType<typeof launchBrowser>>;
const packets = new Map<
  string,
  Awaited<ReturnType<typeof renderSchematicPacket>>
>();
beforeAll(async () => {
  const fixture = await consoleWiringFixture();
  for (const flow of ["left-to-right", "top-to-bottom"]) {
    const request = structuredClone(fixture.request);
    // Wiring views are flow-neutral under the corpus preparation policy.
    // Both named corpus variants retain their authored wiring requests.
    expect(
      request.views.map((view: { format: string }) => view.format),
    ).toEqual([
      ...Array.from({ length: 8 }, () => "wiring-view-request/0.1"),
      "communication-view-request/0.1",
      "documentation-view-request/0.1",
    ]);
    packets.set(flow, await renderSchematicPacket(fixture.ir, request));
  }
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

async function paintedFrames(
  page: Awaited<ReturnType<typeof browser.newPage>>,
) {
  return page.evaluate(() => {
    const root = document.querySelector<SVGSVGElement>("svg"),
      inverse = root?.getScreenCTM()?.inverse();
    if (!inverse) throw Error("Missing sheet transform");
    return [
      ...document.querySelectorAll<SVGRectElement>("[data-device-uid] > rect"),
    ].map((frame) => {
      const ctm = frame.getScreenCTM();
      if (!ctm) throw Error("Missing frame transform");
      const m = inverse.multiply(ctm),
        x = frame.x.baseVal.value,
        y = frame.y.baseVal.value,
        right = x + frame.width.baseVal.value,
        bottom = y + frame.height.baseVal.value;
      return {
        device: frame.parentElement?.getAttribute("data-device-uid"),
        stroke:
          parseFloat(getComputedStyle(frame).strokeWidth) *
          Math.hypot(m.a, m.b),
        points: [
          [x, y],
          [right, y],
          [right, bottom],
          [x, bottom],
          [x, y],
        ].map(([a, b]) => {
          const p = new DOMPoint(a, b).matrixTransform(m);
          return { x: p.x, y: p.y };
        }),
      };
    });
  });
}
function channels(
  geometry: Awaited<ReturnType<typeof svgOutlineGeometry>>,
  frames: Awaited<ReturnType<typeof paintedFrames>>,
) {
  const rows: {
    wire: string | null;
    device: string | null | undefined;
    gap: number;
    overlap: number;
  }[] = [];
  for (const wire of geometry.shapes.filter((s) => s.wire))
    for (let i = 1; i < wire.points.length; i++)
      for (const frame of frames)
        for (let j = 1; j < frame.points.length; j++) {
          const a = required(wire.points[i - 1]),
            b = required(wire.points[i]),
            c = required(frame.points[j - 1]),
            d = required(frame.points[j]);
          for (const [axis, cross] of [
            ["x", "y"],
            ["y", "x"],
          ] as const) {
            if (
              Math.abs(a[cross] - b[cross]) > 1e-6 ||
              Math.abs(c[cross] - d[cross]) > 1e-6
            )
              continue;
            const overlap =
              Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
              Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
            if (overlap > 3 + 1e-6)
              rows.push({
                wire: wire.wire,
                device: frame.device,
                overlap,
                gap:
                  Math.abs(a[cross] - c[cross]) -
                  (wire.stroke + frame.stroke) / 2,
              });
          }
        }
  return { frames: frames.length, rows };
}
it.each([
  ["left-to-right", 1],
  ["left-to-right", 4],
  ["top-to-bottom", 1],
  ["top-to-bottom", 4],
])(
  "keeps printed conductor/frame gaps at least 0.7 mm beyond the fan: %s sheet %s",
  async (flow, number) => {
    const result = required(packets.get(flow));
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const svg = required(
        result.value.sheets.find((s) => s.number === number),
      ).svg,
      page = await browser.newPage();
    try {
      const geometry = await svgOutlineGeometry(page, svg, true),
        measured = channels(geometry, await paintedFrames(page));
      expect(await page.locator("[data-wiring-landing-for]").count()).toBe(2);
      expect(measured.frames).toBe(4);
      expect(measured.rows.filter((r) => r.gap < 0.7 - 1e-6)).toEqual([]);
      expect(
        Math.min(...measured.rows.map((r) => r.gap)),
      ).toBeGreaterThanOrEqual(0.7 - 1e-6);
      if (process.env.THERMITE_LAYOUT_RECEIPTS)
        await writeFile(
          `${process.env.THERMITE_LAYOUT_RECEIPTS}/printed-frame-${flow}-${number}.json`,
          JSON.stringify({ flow, number, ...measured }, null, 2) + "\n",
        );
    } finally {
      await page.close();
    }
  },
);
