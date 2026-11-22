import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { deviceTags } from "./checks.mjs";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";

let browser, page;
beforeAll(async () => {
  // Accurate Canvas bounds for this small-font calibration (crbug.com/479240778).
  browser = await launch([
    "--enable-blink-features=CanvasTextMetricsPreciseBounds",
  ]);
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
const name = "MMMMMMMMMMMMMM";
const ir = {
  devices: [{ uid: "a", designation: name, typeId: "t" }],
  deviceTypes: [{ id: "t" }],
};
const body = `<g data-device-uid="a"><rect x="5" y="5" width="185" height="45" fill="white" stroke="black"/><text x="0" y="0" transform="translate(10 30) scale(${10 / 3.5})" font-family="Thermite Sans" font-size="3.5" data-tag-owner-uid="a" data-tag-kind="body" data-tag-block="a" data-tag-field="designation">${name}</text>COVER</g>`;
const svg = (cover = "") =>
  embedPrintableFont(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="60mm" viewBox="0 0 200 60">${body.replace("COVER", cover)}</svg>`,
  );
// Same 10 mm lettering. Reviewed native glyph masks contain 77 CoreText samples
// or 73 Skia samples; each plate changes coverage by exactly one real sample.
const covered =
  process.platform === "darwin" ? [38 / 77, 39 / 77] : [36 / 73, 37 / 73];
it.each([
  { stepWidth: 0.02, height: 0.3, covered: covered[0], pass: true },
  { stepWidth: 0.04, height: 0.1, covered: covered[1], pass: false },
])(
  "262.4 partial glyph coverage $covered preserves the strict majority boundary",
  async ({ stepWidth, height, covered, pass }) => {
    const clear = await openSheet(page, svg());
    expect(deviceTags(clear, ir, [{ deviceUid: "a" }], true)).toEqual([]);
    const b = clear.texts.find((t) => t.tagOwnerUid === "a").bbox;
    // Continuous stepped white overpaint changes one actual glyph sample.
    // No glyph/paint flags are forged, and the complete native tag stays intact.
    const cover = `<rect x="${b.x + b.w * 0.44}" y="8" width="190" height="35" fill="white"/><rect x="${b.x + b.w * (0.44 - stepWidth)}" y="${b.y}" width="${b.w * stepWidth}" height="${b.h * height}" fill="white"/>`;
    const g = await openSheet(page, svg(cover)),
      row = g.texts.find((t) => t.tagOwnerUid === "a");
    expect(row.tagOcclusion).toBeCloseTo(covered, 10);
    expect(Math.abs(row.tagOcclusion - 0.5)).toBeLessThan(0.01);
    expect(row.tagPainted).toBe(pass);
    expect(deviceTags(g, ir, [{ deviceUid: "a" }], true).length === 0).toBe(
      pass,
    );
  },
);
