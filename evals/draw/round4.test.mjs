import { it, expect } from "vitest";
import * as c from "./checks.mjs";
import { contentSeal } from "./corpus.mjs";
const b = (x, y, w = 4, h = 2) => ({ x, y, w, h });
const g = (texts = [], shapes = []) => ({
  width: 100,
  height: 80,
  texts,
  shapes,
  terminals: [],
});
const t = (extra = {}) => ({
  element: "text-1",
  text: "W1",
  bbox: b(20, 20),
  font: "mono",
  fontSize: 2.5,
  capHeightMm: 1.5,

  advanceRatio: 1,
  painted: true,
  ...extra,
});
const wire = (id, y = 23) => ({
  element: "path-" + id,
  wire: id,
  conductor: true,
  stroke: 0.35,
  points: [
    { x: 10, y },
    { x: 60, y },
  ],
});
it("compares em size with primary/secondary minima, keeping ISO cap policy separate", () => {
  expect(c.legibility(g([t()]))).toEqual([]);
  expect(
    c.legibility(
      g([t({ fontSize: 2.3, secondaryReference: true, capHeightMm: 1.38 })]),
    ),
  ).toEqual([]);
  expect(
    c.legibility(g([t({ fontSize: 2.2, capHeightMm: 1.32 })]))[0].kind,
  ).toBe("text-below-minimum-em");
  expect(
    c.legibility(g([t({ capReferenceEmMm: 5 })])).map((f) => f.kind),
  ).toContain("distorted-glyphs");
  expect(c.capPolicy([t()], "svg")[0].kind).toBe("iso-cap-height-policy");
});
it("treats every line of an inline wire block as belonging to its own route only", () => {
  const texts = [
    t({
      wire: "w",
      wireBlock: "block",
      plate: { element: "p", bbox: b(18, 18, 20, 8) },
      bbox: b(20, 18),
    }),
    t({
      element: "text-2",
      wire: "w",
      wireBlock: "block",
      plate: { element: "p", bbox: b(18, 18, 20, 8) },
      bbox: b(20, 22),
    }),
  ];
  expect(c.wirePlacement(g(texts, [wire("w")]))).toEqual([]);
  expect(
    c
      .conductorInterference(g(texts, [wire("w"), wire("other")]))
      .some((f) => f.kind === "plate-over-foreign-conductor"),
  ).toBe(true);
});
it("uses measured ink accuracy at the 2mm distance threshold", () => {
  const text = t({ wire: "w", bbox: b(20, 18.957) });
  expect(c.wirePlacement(g([text], [wire("w")]))).toEqual([]);
  expect(
    c.wirePlacement(g([t({ wire: "w", bbox: b(20, 18.6) })], [wire("w")])),
  ).toHaveLength(1);
});
it("tests foreign plates against conductor stroke width and later plates against foreign text ink", () => {
  const a = t({
    element: "text-10",
    plate: { element: "rect-9", order: 9, bbox: b(19, 19, 8, 5) },
  });
  expect(
    c.conductorInterference(g([a], [wire("foreign")])).map((f) => f.kind),
  ).toContain("plate-over-foreign-conductor");
  const target = t({ element: "text-2", order: 2, bbox: b(21, 20) });
  expect(c.plateOcclusion(g([a, target]))[0].kind).toBe("plate-hides-text");
  expect(
    c.plateOcclusion(g([{ ...a, plate: { ...a.plate, order: 1 } }, target])),
  ).toEqual([]);
});
it("reports only the outermost violated container for lost text", () => {
  const fs = c.textBounds(
    g([
      t({
        bbox: b(600, 20),
        viewport: b(0, 0, 100, 80),
        cell: b(0, 0, 10, 10),
        clip: b(0, 0, 10, 10),
      }),
    ]),
  );
  expect(fs.map((f) => f.kind)).toEqual(["text-outside-sheet"]);
});
it("hashes content rather than commit provenance", () => {
  const a = {
    format: "test",
    files: { x: "abc" },
    casesSha256: "xyz",
    base: "one",
  };
  expect(contentSeal(a)).toBe(contentSeal({ ...a, base: "two" }));
  expect(contentSeal(a)).not.toBe(
    contentSeal({ ...a, files: { x: "changed" } }),
  );
});
it("reconciles non-semantic nested copies uniquely without merging unrelated lost labels", async () => {
  const { retainLostText } = await import("./lost-text.mjs");
  const gs = [
    {
      texts: [],
      hiddenTexts: [
        { element: "text-1", nested: true, sourceTextKey: "one" },
        { element: "text-2", nested: true, sourceTextKey: "two" },
        { element: "text-3", nested: true, sourceTextKey: "visible" },
      ],
    },
    { texts: [{ sourceTextKey: "visible" }], hiddenTexts: [] },
  ];
  retainLostText(gs, ["v", "v"]);
  expect(gs[0].texts.map((t) => t.element)).toEqual(["text-1", "text-2"]);
});
it("clips route-detour evidence and length to the physical sheet", () => {
  const pieces = c.clipRoute(
    [
      { x: -300, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 90 },
      { x: 60, y: 90 },
    ],
    b(0, 0, 100, 80),
  );
  expect(pieces).toEqual([
    [
      { x: 0, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 80 },
    ],
  ]);
});
it("checks the PDF medium actual em size while retaining source label roles", () => {
  const source = t({ fontSize: 2.5 });
  const measured = {
    text: "W1",
    font: "NotoSansMono",
    fontSize: 2.1,
    bbox: b(20, 20),
    capHeightMm: 1.4994,
  };
  const texts = c.pdfGeometryTexts([source], [measured]);
  expect(texts[0].medium).toBe("pdf");
  expect(c.legibility(g(texts))[0].fontSizeMm).toBe(2.1);
});
it("chooses the frame before a nested viewport when both are violated", () => {
  const geometry = g([t({ bbox: b(94, 20), viewport: b(20, 20, 60, 40) })]);
  geometry.frame = b(10, 10, 80, 60);
  expect(c.textBounds(geometry).map((f) => f.kind)).toEqual([
    "text-outside-frame",
  ]);
});
it("detects em anisotropy against the horizontal em reference", () => {
  const x = t({
    fontSize: 3,
    capReferenceEmMm: 4,
    capHeightMm: 1.8,
  });
  expect(c.legibility(g([x])).map((f) => f.kind)).toEqual(["distorted-glyphs"]);
});

it("excludes clipped PDF duplicates before matching the visible text", () => {
  const svg = [
    {
      element: "m1",
      text: "M1",
      fontSize: 2.5,
      bbox: { x: 50, y: 164, w: 3, h: 2 },
    },
  ];
  const hidden = {
    text: "M1",
    fontSize: 2.5,
    bbox: { x: 423, y: 67, w: 3, h: 2.5 },
  };
  const visible = { ...hidden, bbox: { x: 50, y: 163, w: 3, h: 2.5 } };
  const result = c.pdfGeometryTexts(svg, [hidden, visible]);
  expect(result).toHaveLength(1);
  expect(result[0].bbox).toEqual(visible.bbox);
});
