import { expect, it } from "vitest";
import { pdfGlyphClips } from "./pdf-clip-operators.mjs";
import { paintedItems } from "./pdf-painted.mjs";
const names = [
  "save",
  "restore",
  "transform",
  "clip",
  "eoClip",
  "constructPath",
  "showText",
  "endPath",
];
const ops = Object.fromEntries(names.map((k, i) => [k, i + 1])),
  id = [1, 0, 0, 1, 0, 0],
  viewport = { width: 100, height: 100, transform: id };
const rect = (x = 10, y = 10, w = 10, h = 10) => [
  ops.endPath,
  [new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4])],
  [x, y, x + w, y + h],
];
const parse = (rows) =>
  pdfGlyphClips(
    { fnArray: rows.map(([n]) => ops[n]), argsArray: rows.map(([, a]) => a) },
    ops,
    viewport,
  );
it("intersects native nested clips and restores the previous graphics state", () => {
  const c = parse([
    ["save"],
    ["clip"],
    ["constructPath", rect()],
    ["save"],
    ["transform", [2, 0, 0, 2, 0, 0]],
    ["eoClip"],
    ["constructPath", rect(8, 8, 10, 10)],
    ["showText"],
    ["restore"],
    ["showText"],
    ["restore"],
    ["showText"],
  ]);
  expect(c.get(7)).toEqual({ x: 16, y: 16, w: 4, h: 4 });
  expect(c.get(9)).toEqual({ x: 10, y: 10, w: 10, h: 10 });
  expect(c.get(11)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
});
it.each([
  "curve",
  "extra-segment",
  "diagonal",
  "backtrack",
  "rotation",
  "NaN",
  "pending",
  "restore",
])("refuses unsupported native clip %s", (name) => {
  let rows = [["clip"], ["constructPath", rect()], ["showText"]];
  if (name === "curve") rows[1][1][1][0][0] = 2;
  if (name === "extra-segment")
    rows[1][1][1][0] = new Float32Array([...rows[1][1][1][0], 0, 0, 0]);
  if (name === "diagonal") rows[1][1][1][0][5] = 12;
  if (name === "backtrack") {
    rows[1][1][1][0][10] = 20;
    rows[1][1][1][0][11] = 10;
  }
  if (name === "rotation") rows.unshift(["transform", [1, 0.1, 0, 1, 0, 0]]);
  if (name === "NaN") rows.unshift(["transform", [NaN, 0, 0, 1, 0, 0]]);
  if (name === "pending") rows = [["clip"], ["showText"]];
  if (name === "restore") rows = [["restore"]];
  expect(() => parse(rows)).toThrow(/PDF/);
});
const item = {
    text: "ABC",
    renderedString: "ABC",
    fontSize: 2,
    bbox: { x: 10, y: 18, w: 6, h: 2 },
  },
  raw = [{ fontName: "f", transform: [2, 0, 0, 2, 10, 20] }];
const glyph = (text, x, visible, run = 1) => ({
  text,
  font: "f",
  size: 2,
  base: [x, 20],
  end: [x + 2, 20],
  points: [
    [x, 18],
    [x + 2, 20],
  ],
  visible,
  run,
});
it("uses font/geometry rather than strings and retains partially visible glyphs", () => {
  const gs = [
    glyph("X", 10, true),
    glyph("Y", 12, true),
    glyph("Z", 14, false),
  ];
  expect(paintedItems([item], raw, gs, viewport)[0]).toMatchObject({
    text: "XY",
    bbox: { x: 10, y: 18, w: 4, h: 2 },
  });
  expect(
    paintedItems(
      [item],
      raw,
      gs.map((g) => ({ ...g, visible: false })),
      viewport,
    ),
  ).toEqual([]);
  expect(
    paintedItems(
      [item],
      raw,
      gs.map((g) => ({ ...g, visible: true })),
      viewport,
    ),
  ).toEqual([item]);
  expect(() => paintedItems([item], raw, [], viewport)).toThrow(/association/);
  expect(() =>
    paintedItems([item], raw, [gs[0], { ...gs[1], run: 2 }, gs[2]], viewport),
  ).toThrow(/Ambiguous/);
});
