import { it, expect } from "vitest";
import { classifyTextGeometry } from "./text-classification.mjs";
import { wirePlacement, legibility } from "./checks.mjs";
const wire = (id, y) => ({
  conductor: true,
  wire: id,
  stroke: 0.35,
  points: [
    { x: 0, y },
    { x: 200, y },
  ],
});
const line = (extra = {}) => ({
  element: "t1",
  text: "W1",
  wire: "W1",
  wireBlock: "block",
  bbox: { x: 100, y: 49, w: 5, h: 2 },
  plate: { element: "p1", bbox: { x: 99, y: 48.5, w: 20, h: 3 } },
  ...extra,
});
it.each([3, 12, 38])(
  "does not exempt a block line %s mm from its own wire outside the plate",
  (dy) => {
    const moved = line({
      element: "t2",
      text: "detail",
      bbox: { x: 100, y: 50 + dy, w: 12, h: 2 },
      plate: undefined,
    });
    const findings = wirePlacement({
      texts: [line(), moved],
      shapes: [wire("W1", 50), wire("W2", 90)],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].element).toBe("t2");
    if (dy === 38) expect(findings[0].nearestOtherMm).toBe(0);
  },
);
it("keeps a second line inside a shared straddling plate inline", () => {
  const second = line({
    element: "t2",
    bbox: { x: 100, y: 48.7, w: 12, h: 1 },
    plate: undefined,
  });
  expect(
    wirePlacement({ texts: [line(), second], shapes: [wire("W1", 50)] }),
  ).toEqual([]);
});
it("reports one SVG glyph squeeze, while retaining the measured ratios as evidence", () => {
  const f = legibility({
    texts: [
      {
        element: "t",
        fontSize: 2.5,
        font: "mono",
        medium: "svg",
        bbox: { x: 10, y: 40, w: 1, h: 2 },
        capHeightMm: 1.5,
        capReferenceEmMm: 1.25,
        advanceRatio: 0.5,
      },
    ],
  });
  expect(f.map((x) => x.kind)).toEqual(["distorted-glyphs"]);
});

const sheet = (texts, offset = 0) => ({
  texts,
  hiddenTexts: [],
  frame: { x: 10, y: 10 + offset, w: 200, h: 260 },
  headerRule: { x: 10, y: 18 + offset, w: 200, h: 0 },
  titleBlock: { x: 10, y: 240 + offset, w: 200, h: 30 },
});
const text = (element, value, x, y, extra = {}) => ({
  element,
  text: value,
  sheetText: true,
  anchor: { x, y },
  bbox: { x, y: y - 1.6, w: 5, h: 1.6 },
  painted: true,
  fontSize: 2.2,
  font: "Arial",
  ...extra,
});
const numbers = (offset = 0) =>
  [1, 2, 3, 4, 5, 6].map((n) =>
    text("zone-" + n, String(n), 30 + n * 25, 22 + offset),
  );
it("checks top-entry references below the measured zone strip, even above 35mm", () => {
  const g = sheet([
    ...numbers(),
    text("ref", "C011 / 09", 80, 31, { continuation: true }),
  ]);
  classifyTextGeometry(g);
  expect(g.texts.at(-1).furniture).toBe(false);
  expect(legibility(g).map((f) => f.designation)).toEqual(["C011 / 09"]);
});
it("follows measured frame/zone geometry when the sheet header moves", () => {
  const g = sheet(
    [
      ...numbers(25),
      text("head", "HEADER", 25, 40),
      text("ref", "C011 / 09", 80, 56, { continuation: true }),
    ],
    25,
  );
  classifyTextGeometry(g);
  expect(g.texts.at(-2).furniture).toBe(true);
  expect(g.texts.at(-1).furniture).toBe(false);
  expect(legibility(g).map((f) => f.designation)).toEqual(["C011 / 09"]);
});
it("does not hide drawing text without a measured frame or a complete zone row", () => {
  const t = text("ref", "C011 / 09", 80, 31);
  const g = { texts: [t] };
  classifyTextGeometry(g);
  expect(t.furniture).toBe(false);
});
it("never treats owned or continuation text as sheet furniture", () => {
  const g = sheet([
    ...numbers(),
    text("ref", "C011 / 09", 80, 21, { continuation: true }),
    text("tag", "K1", 80, 15, { deviceUid: "k1" }),
  ]);
  classifyTextGeometry(g);
  expect(g.texts.slice(-2).map((t) => t.furniture)).toEqual([false, false]);
});
it("derives secondary captions from circuit/source roles rather than label y", () => {
  const role = { related: true, boundary: false, primaryDesignation: "K1" };
  const primary = text("primary", "K1", 80, 90, {
    deviceUid: "k1",
    fontSize: 2.3,
    circuitText: role,
  });
  const caption = text("ref", "13-14: C010", 80, 3, {
    deviceUid: "k1",
    fontSize: 2.3,
    circuitText: role,
  });
  const boundary = text("boundary", "BOUNDARY", 80, 31, {
    deviceUid: "b1",
    fontSize: 2.3,
    circuitText: { boundary: true, related: false },
  });
  const g = sheet([primary, caption, boundary]);
  classifyTextGeometry(g, {
    devices: [
      { uid: "k1", designation: "K1" },
      { uid: "b1", designation: "B1" },
    ],
  });
  expect(g.texts.map((t) => t.secondaryReference)).toEqual([false, true, true]);
  expect(legibility(g).map((f) => f.designation)).toEqual(["K1"]);
});
it("does not turn literal BOUNDARY or unknown source labels into secondary captions", () => {
  const g = sheet([
    text("p", "BOUNDARY", 80, 31),
    text("unknown", "K1", 90, 90, {
      deviceUid: "k1",
      circuitText: { related: true },
    }),
  ]);
  classifyTextGeometry(g);
  expect(g.texts.map((t) => t.secondaryReference)).toEqual([false, false]);
});
it("uses one distortion finding for PDF em anisotropy too", () => {
  const f = legibility({
    texts: [
      {
        element: "p",
        medium: "pdf",
        fontSize: 2.5,
        capReferenceEmMm: 1.25,
        bbox: { x: 1, y: 40, w: 2, h: 2.5 },
      },
    ],
  });
  expect(f.map((f) => f.kind)).toEqual(["distorted-glyphs"]);
  expect(f[0].measurements).toEqual(["anisotropy"]);
});
