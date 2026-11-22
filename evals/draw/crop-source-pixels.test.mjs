import { expect, it } from "vitest";
import { pngFixture } from "./png-fixture.mjs";
import { compareSourcePixels } from "./crop-source-pixels.mjs";
const make = (pixel = () => [255, 255, 255, 255], width = 100, height = 100) =>
  pngFixture({ width, height, pixel });
it("accepts exact source pixels", () =>
  expect(compareSourcePixels(make(), make()).changed).toBe(0));
it("accepts sparse small antialiasing drift", () => {
  const b = make((x, y) =>
    x === 1 && y === 1 ? [235, 235, 235, 255] : [255, 255, 255, 255],
  );
  expect(compareSourcePixels(b, make())).toMatchObject({
    changed: 1,
    maximum: 20,
  });
});
it("refuses a different glyph or erased ink", () => {
  const b = make((x, y) =>
    x === 1 && y === 1 ? [190, 190, 190, 255] : [255, 255, 255, 255],
  );
  expect(() => compareSourcePixels(b, make())).toThrow(/pixel delta/);
});
it("refuses widespread low-amplitude changes", () => {
  expect(() =>
    compareSourcePixels(
      make((x, y) =>
        x < 31 && y < 10 ? [254, 255, 255, 255] : [255, 255, 255, 255],
      ),
      make(),
    ),
  ).toThrow(/fraction/);
});
it("refuses accumulated error within the pixel-count and channel limits", () => {
  const b = make((x, y) =>
    x < 20 && y < 10 ? [235, 235, 235, 255] : [255, 255, 255, 255],
  );
  expect(() => compareSourcePixels(b, make())).toThrow(/mean pixel/);
});
it("refuses changed alpha", () =>
  expect(() =>
    compareSourcePixels(
      make(() => [255, 255, 255, 254]),
      make(),
    ),
  ).toThrow(/alpha/));
it.each([
  [99, 100],
  [100, 99],
  [101, 100],
])("refuses source dimension mismatch %s x %s", (w, h) => {
  expect(() => compareSourcePixels(make(), make(undefined, w, h))).toThrow(
    /dimensions/,
  );
});
function stamped(extra = false) {
  return make(
    (x, y) =>
      y < 86
        ? x === 1 && y === 1
          ? [20, 20, 20, 255]
          : [255, 255, 255, 255]
        : extra && x === 759
          ? [0, 0, 0, 255]
          : [255, 255, 255, 255],
    760,
    186,
  );
}
it("accepts stamp headers and white right padding", () =>
  expect(compareSourcePixels(stamped(), make(), 86).changed).toBe(0));
it("refuses extra drawing ink hidden in stamp padding", () =>
  expect(() => compareSourcePixels(stamped(true), make(), 86)).toThrow(
    /padding/,
  ));
it("validates header rather than trusting its declaration", () =>
  expect(() =>
    compareSourcePixels(make(undefined, 760, 186), make(), 86),
  ).toThrow(/header band/));

it("accepts the measured sixty-level straight-edge noise within all bounds", () => {
  const a = make((x, y) =>
    x === 1 && y === 1 ? [195, 195, 195, 255] : [255, 255, 255, 255],
  );
  expect(compareSourcePixels(a, make()).maximum).toBe(60);
});
