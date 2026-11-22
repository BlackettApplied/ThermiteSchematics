import { expect, it } from "vitest";
import { pdfInkRegion, outwardBox, PDF_INK_MARGIN } from "./pdf-ink-policy.mjs";
import { hash } from "./support.mjs";
const fixture = () => ({
  page: { widthMm: 200, heightMm: 100 },
  em: { x: 10, y: 10, w: 5, h: 2.2 },
  shape: {
    kind: "pdf-em-ink/1.0",
    inkBbox: { x: 9.9, y: 10.5, w: 5.3, h: 2.1 },
    marginPixels: 1,
    textItem: 0,
    operators: [2, 4],
    fontPrograms: [hash("font")],
  },
});
it("unions em and overhang/descender ink and rounds every edge outward", () => {
  const c = fixture(),
    b = pdfInkRegion(c.page, c.em, c.shape);
  expect(b).toEqual({ x: 9.815, y: 9.915, w: 5.47, h: 2.77 });
  expect(PDF_INK_MARGIN).toBe(25.4 / 300);
  expect(outwardBox(1.0009, 2.0009, 3.0001, 4.0001)).toEqual({
    x: 1,
    y: 2,
    w: 2.001,
    h: 2.001,
  });
});
it("clips only the margin at a page edge", () => {
  const c = fixture();
  c.em.x = 0;
  c.shape.inkBbox.x = 0;
  expect(pdfInkRegion(c.page, c.em, c.shape).x).toBe(0);
});
it.each([
  ["shape omitted", (c) => (c.shape = undefined)],
  ["kind", (c) => (c.shape.kind = "em-only")],
  ["margin", (c) => (c.shape.marginPixels = 0)],
  ["extra field", (c) => (c.shape.bypass = true)],
  ["text item", (c) => (c.shape.textItem = -1)],
  ["operators omitted", (c) => delete c.shape.operators],
  ["operators empty", (c) => (c.shape.operators = [])],
  ["operators repeated", (c) => (c.shape.operators = [2, 2])],
  ["operators reordered", (c) => (c.shape.operators = [4, 2])],
  ["operators NaN", (c) => (c.shape.operators = [NaN])],
  ["font omitted", (c) => (c.shape.fontPrograms = [])],
  ["font hash", (c) => (c.shape.fontPrograms = ["fake"])],
  ["font duplicate", (c) => c.shape.fontPrograms.push(c.shape.fontPrograms[0])],
  ["ink off page", (c) => (c.shape.inkBbox.x = -1)],
  ["ink zero area", (c) => (c.shape.inkBbox.w = 0)],
  ["ink NaN", (c) => (c.shape.inkBbox.w = NaN)],
  ["em off page", (c) => (c.em.y = 101)],
  ["em zero area", (c) => (c.em.h = 0)],
  [
    "raster budget",
    (c) => {
      c.page = { widthMm: 10000, heightMm: 10000 };
      c.em.w = 1000;
      c.em.h = 1000;
    },
  ],
])("refuses %s", (_, edit) => {
  const c = fixture();
  edit(c);
  expect(() => pdfInkRegion(c.page, c.em, c.shape)).toThrow();
});
