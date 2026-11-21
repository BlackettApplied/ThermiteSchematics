import { expect, it } from "vitest";
import { pngFixture } from "./png-fixture.mjs";
import { compareRepeats, repeatPixelStats } from "./repeat-capture-stats.mjs";

const make = (delta = 0, width = 100) =>
  pngFixture({
    width,
    height: 100,
    pixel: (x, y) =>
      x === 0 && y === 0 ? [128 + delta, 128, 128, 255] : [255, 255, 255, 255],
  });
it("counts changed pixels separately from pixels exceeding the channel bound", () => {
  expect(repeatPixelStats(make(), make(64))).toMatchObject({
    changed: 1,
    maximum: 64,
    overChannel: 0,
    changedFraction: 0.0001,
  });
  expect(repeatPixelStats(make(), make(65))).toMatchObject({
    changed: 1,
    maximum: 65,
    overChannel: 1,
    overChannelFraction: 0.0001,
  });
});
it("compares every variant pair, including extremes around the first sample", () => {
  expect(compareRepeats([make(), make(-33), make(33)])).toMatchObject({
    variants: 3,
    worst: { maximum: 66 },
    margin: { channel: -2 },
    withinBindLimits: false,
  });
});
it("distinguishes PNG byte identity from identical decoded pixels", () => {
  const alternate = pngFixture({
    width: 100,
    height: 100,
    filter: 1,
    pixel: (x, y) =>
      x === 0 && y === 0 ? [128, 128, 128, 255] : [255, 255, 255, 255],
  });
  expect(compareRepeats([make(), alternate, make()])).toMatchObject({
    captures: 3,
    variants: 2,
    worst: { changed: 0 },
    withinBindLimits: true,
  });
});
it("fails closed on mismatched dimensions", () => {
  expect(() => compareRepeats([make(), make(0, 101)])).toThrow(/dimensions/);
});
it.each([
  [31, 1, "fraction"],
  [20, 20, "mean"],
])(
  "checks widespread drift against the %s-column envelope",
  (columns, delta, limit) => {
    const base = pngFixture({
      width: 100,
      height: 100,
      pixel: () => [255, 255, 255, 255],
    });
    const changed = pngFixture({
      width: 100,
      height: 100,
      pixel: (x, y) =>
        x < columns && y < 10
          ? [255 - delta, 255 - delta, 255 - delta, 255]
          : [255, 255, 255, 255],
    });
    const result = compareRepeats([base, changed]);
    expect(result.withinBindLimits).toBe(false);
    expect(result.margin[limit]).toBeLessThan(0);
  },
);
