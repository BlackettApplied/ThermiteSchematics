import { expect, it } from "vitest";
import { pdfGlyphRuns } from "./pdf-ink-operators.mjs";
const names = [
  "save",
  "restore",
  "transform",
  "setGState",
  "setFont",
  "setTextMatrix",
  "setHScale",
  "setTextRise",
  "setCharSpacing",
  "setWordSpacing",
  "setTextRenderingMode",
  "beginText",
  "endText",
  "showText",
  "moveText",
  "setLeadingMoveText",
  "nextLine",
  "nextLineShowText",
  "nextLineSetSpacingShowText",
  "setLeading",
  "showSpacedText",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
  "beginGroup",
  "endGroup",
];
const ops = Object.fromEntries(names.map((k, i) => [k, i])),
  id = [1, 0, 0, 1, 0, 0],
  glyph = { unicode: "Q", fontChar: "Q", width: 700, isInFont: true },
  metric = () => ({
    sha256: "a".repeat(64),
    unitsPerEm: 1000,
    box: { minX: 50, minY: -170, maxX: 700, maxY: 725 },
  }),
  start = [
    ["save"],
    ["setFont", ["f", 2.2]],
    ["beginText"],
    ["setTextMatrix", [[1, 0, 0, 1, 10, 20]]],
  ],
  end = [["endText"], ["restore"]],
  show = ["showText", [[glyph]]];
const parse = (rows) =>
  pdfGlyphRuns(
    { fnArray: rows.map(([k]) => ops[k]), argsArray: rows.map(([, a]) => a) },
    ops,
    id,
    metric,
  );
it("positions embedded Q tails with absolute matrices, TJ, spacing, rise and horizontal scale", () => {
  const [r] = parse([
    ...start,
    ["setHScale", [50]],
    ["setTextRise", [1]],
    ["setCharSpacing", [0.1]],
    ["setWordSpacing", [0.2]],
    ["showText", [[glyph, 100, { ...glyph, unicode: " ", isSpace: true }]]],
    ...end,
  ]);
  expect(r.text).toBe("Q ");
  expect(r.start).toEqual([10, 21]);
  expect(r.points[0]).toEqual([10.055, 20.626]);
  expect(r.end[0]).toBeCloseTo(11.63);
  expect(r.operators).toEqual([8]);
});
it("preserves cursor advances across separate show-text operations and font switches", () => {
  const [r] = parse([...start, show, ["setFont", ["g", 2.2]], show, ...end]);
  expect(r.text).toBe("QQ");
  expect(r.end[0]).toBeCloseTo(13.08);
});
it("transforms glyph bounds through page rotation and graphics scale", () => {
  const [r] = parse([
    ["transform", [0, 2, -2, 0, 100, 0]],
    ...start,
    show,
    ...end,
  ]);
  expect(r.start).toEqual([60, 20]);
  expect(r.points[0]).toEqual([60.748, 20.22]);
});
it.each([
  ["unbalanced restore", [["restore"]]],
  ["restore in text", [...start, ["restore"]]],
  ["bad graphics matrix", [["transform", [NaN, 0, 0, 1, 0, 0]]]],
  ["nontrivial GState", [["setGState", [[["ca", 0.5]]]]]],
  ["bad font", [["setFont", ["f", 0]]]],
  ["bad text matrix", [...start, ["setTextMatrix", [[1, 0, 0, NaN, 0, 0]]]]],
  ["text matrix outside text", [["setTextMatrix", [id]]]],
  ["negative scale", [["setHScale", [-1]]]],
  ["nested text", [...start, ["beginText"]]],
  ["unbalanced text end", [["endText"]]],
  ["missing font", [["beginText"], show]],
  ["stroke mode", [...start, ["setTextRenderingMode", [1]], show]],
  ["NaN rise", [...start, ["setTextRise", [NaN]], show]],
  [
    "singular matrix",
    [...start, ["setTextMatrix", [[0, 0, 0, 0, 0, 0]]], show],
  ],
  ["bad TJ", [...start, ["showText", [[NaN]]]]],
  ["glyph accent", [...start, ["showText", [[{ ...glyph, accent: {} }]]]]],
  [
    "glyph vertical metric",
    [...start, ["showText", [[{ ...glyph, vmetric: [1, 2, 3] }]]]],
  ],
  [
    "rotated glyph",
    [...start, ["showText", [[{ ...glyph, isRotated: true }]]]],
  ],
  [
    "nonfinite glyph width",
    [...start, ["showText", [[{ ...glyph, width: NaN }]]]],
  ],
  ["mixed em", [...start, show, ["setFont", ["f", 3]], show]],
  ["unterminated text", start],
  ["unterminated save", [["save"]]],
  ...names.slice(14).map((k) => [k, [[k]]]),
])("refuses unsupported association: %s", (name, rows) => {
  const messages = {
    "unbalanced restore": /Unsupported PDF restore/,
    "restore in text": /Unsupported PDF restore/,
    "bad graphics matrix": /Invalid PDF graphics matrix/,
    "nontrivial GState": /Unsupported PDF graphics state/,
    "bad font": /Invalid PDF embedded font selection/,
    "bad text matrix": /Invalid PDF text matrix/,
    "text matrix outside text": /Invalid PDF text matrix/,
    "negative scale": /horizontal scale/,
    "nested text": /Nested PDF text scope/,
    "unbalanced text end": /Unbalanced PDF text scope/,
    "missing font": /Unsupported PDF text painting state/,
    "stroke mode": /Unsupported PDF text painting state/,
    "NaN rise": /Unsupported PDF text painting state/,
    "singular matrix": /Singular PDF glyph matrix/,
    "bad TJ": /Invalid PDF TJ spacing/,
    "glyph accent": /glyph mapping or accent/,
    "glyph vertical metric": /glyph mapping or accent/,
    "rotated glyph": /glyph mapping or accent/,
    "nonfinite glyph width": /glyph mapping or accent/,
    "mixed em": /Unsupported mixed PDF em sizes/,
    "unterminated text": /Unbalanced PDF text\/graphics scope/,
    "unterminated save": /Unbalanced PDF text\/graphics scope/,
  };
  expect(() => parse(rows)).toThrow(
    messages[name] ?? /Unsupported PDF text positioning or form/,
  );
});

it("accepts opaque GState and flat independent text scopes", () => {
  expect(
    parse([
      [
        "setGState",
        [
          [
            ["ca", 1],
            ["CA", 1],
          ],
        ],
      ],
      ...start,
      show,
      ...end,
      ...start,
      show,
      ...end,
    ]),
  ).toHaveLength(2);
});
it("bounds operator and glyph resource use", () => {
  expect(() =>
    pdfGlyphRuns({ fnArray: new Array(1_000_001) }, ops, id, metric),
  ).toThrow(/resource/);
  expect(() =>
    parse([...start, ["showText", [Array(10001).fill(glyph)]], ...end]),
  ).toThrow(/resource/);
  expect(() =>
    parse([
      ...start,
      ["showText", [[{ ...glyph, unicode: "Q".repeat(100001) }]]],
      show,
      ...end,
    ]),
  ).toThrow(/resource/);
});
