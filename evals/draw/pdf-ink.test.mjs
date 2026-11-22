import { expect, it, vi, beforeEach } from "vitest";
const c = vi.hoisted(() => ({
  items: [],
  face: null,
  font: null,
  list: null,
  ops: Object.fromEntries(
    ["setFont", "beginText", "setTextMatrix", "showText", "endText"].map(
      (k, i) => [k, i + 1],
    ),
  ),
}));
vi.mock("./pdf.mjs", () => ({ pdfText: async () => c.items }));
vi.mock("fontkit", () => ({ create: () => c.font }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ OPS: c.ops }));
import { derivePdfInk } from "./pdf-ink.mjs";
const row = () => ({
  text: "Q",
  instanceBbox: { x: 10, y: 18, w: 1, h: 2 },
  sourceRender: { page: { widthMm: 100, heightMm: 100 } },
});
const page = () => ({
    getOperatorList: async () => c.list,
    getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0] }),
    commonObjs: { get: () => c.face },
  }),
  doc = { assertNoExternalResources: () => {} };
beforeEach(() => {
  c.items = [{ text: "Q", bbox: { x: 10, y: 18, w: 1, h: 2 } }];
  c.face = {
    data: Buffer.from("embedded"),
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
  };
  c.font = {
    unitsPerEm: 1000,
    hasGlyphForCodePoint: () => true,
    glyphForCodePoint: () => ({
      bbox: { minX: 0, minY: -200, maxX: 500, maxY: 700 },
    }),
  };
  c.list = {
    fnArray: [1, 2, 3, 4, 5],
    argsArray: [
      ["f", 2],
      null,
      [[1, 0, 0, -1, 10, 20]],
      [[{ unicode: "Q", fontChar: "Q", width: 500, isInFont: true }]],
      null,
    ],
  };
});
it("associates exact em/text with actual embedded fontChar outlines including the tail", async () => {
  const r = await derivePdfInk(page(), doc, row());
  expect(r.cropShape).toMatchObject({
    kind: "pdf-em-ink/1.0",
    textItem: 0,
    operators: [3],
    marginPixels: 1,
  });
  expect(r.cropShape.inkBbox.y + r.cropShape.inkBbox.h).toBeGreaterThan(20);
  expect(r.sourceBbox.y + r.sourceBbox.h).toBeGreaterThan(20.4);
});
it.each([
  ["missing item", () => (c.items = [])],
  ["ambiguous item", () => c.items.push(c.items[0])],
  ["missing embedded program", () => (c.face.data = null)],
  ["Type3", () => (c.face.isType3Font = true)],
  ["vertical font", () => (c.face.vertical = true)],
  ["missing font", () => (c.face.missingFile = true)],
  ["invalid pdfjs font", () => (c.face.isInvalidPDFjsFont = true)],
  ["remeasure fallback", () => (c.face.remeasure = true)],
  ["font units", () => (c.font.unitsPerEm = 0)],
  [
    "unsupported advance matrix",
    () => (c.face.fontMatrix = [1, 0, 0, 1, 0, 0]),
  ],
  ["missing glyph", () => (c.list.argsArray[3][0][0].isInFont = false)],
  ["fontChar omitted", () => (c.list.argsArray[3][0][0].fontChar = "")],
  ["fontChar unavailable", () => (c.font.hasGlyphForCodePoint = () => false)],
  [
    "nonfinite path",
    () =>
      (c.font.glyphForCodePoint = () => ({
        bbox: { minX: NaN, minY: 0, maxX: 10, maxY: 10 },
      })),
  ],
  [
    "empty outlines",
    () =>
      (c.font.glyphForCodePoint = () => ({
        bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      })),
  ],
  ["wrong glyph text", () => (c.list.argsArray[3][0][0].unicode = "R")],
  ["wrong glyph origin", () => (c.list.argsArray[2][0][4] += 0.01)],
  ["wrong glyph width", () => (c.list.argsArray[3][0][0].width += 10)],
  [
    "ambiguous operators",
    () => {
      c.list.fnArray.push(...c.list.fnArray);
      c.list.argsArray.push(...c.list.argsArray);
    },
  ],
])("structurally refuses %s", async (_, edit) => {
  edit();
  const specific = {
    "font units": /Invalid embedded PDF font units/,
    "missing glyph": /Missing embedded PDF glyph/,
    "nonfinite path": /Nonfinite PDF glyph bounds/,
    "empty outlines": /Missing or excessive PDF glyph outlines/,
  };
  await expect(derivePdfInk(page(), doc, row())).rejects.toThrow(
    specific[_] ?? /PDF/,
  );
});
it("allows an unmapped space to advance without inventing an outline", async () => {
  c.list.argsArray[3][0].unshift({
    unicode: " ",
    fontChar: " ",
    width: 0,
    isInFont: false,
  });
  await expect(derivePdfInk(page(), doc, row())).resolves.toHaveProperty(
    "cropShape",
  );
});
