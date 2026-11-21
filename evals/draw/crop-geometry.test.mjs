import { expect, it } from "vitest";
import { assertCropContainsInstance } from "./crop-geometry.mjs";
const crop = { x: 10, y: 20, w: 30, h: 40 };
it.each([
  ["left", { x: 9, y: 25, w: 2, h: 2 }],
  ["top", { x: 15, y: 19, w: 2, h: 2 }],
  ["right", { x: 39, y: 25, w: 2, h: 2 }],
  ["bottom", { x: 15, y: 59, w: 2, h: 2 }],
])("refuses a single violated %s edge", (_, bbox) => {
  expect(() => assertCropContainsInstance({ bbox }, crop)).toThrow(
    /outside the source crop/,
  );
});
it.each([null, Infinity, "30"])(
  "refuses non-finite/non-numeric crop extent %s",
  (w) => {
    expect(() =>
      assertCropContainsInstance(
        { bbox: { x: 15, y: 25, w: 2, h: 2 } },
        { ...crop, w },
      ),
    ).toThrow(/outside/);
  },
);
it.each([
  ["negative instance width", { x: 15, y: 25, w: -1, h: 2 }, crop],
  ["negative instance height", { x: 15, y: 25, w: 2, h: -1 }, crop],
  ["zero crop width", { x: 10, y: 25, w: 0, h: 2 }, { ...crop, w: 0 }],
  ["zero crop height", { x: 15, y: 20, w: 2, h: 0 }, { ...crop, h: 0 }],
])("refuses %s", (_, bbox, b) =>
  expect(() => assertCropContainsInstance({ bbox }, b)).toThrow(/outside/),
);
it("allows rounded edge equality, not a real excursion", () => {
  expect(() =>
    assertCropContainsInstance(
      { bbox: { x: 9.9995, y: 19.9995, w: 30.001, h: 40.001 } },
      crop,
    ),
  ).not.toThrow();
  expect(() =>
    assertCropContainsInstance({ bbox: { x: 9.998, y: 25, w: 2, h: 2 } }, crop),
  ).toThrow();
});
