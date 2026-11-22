import { it, expect } from "vitest";
import { pngFixture } from "./png-fixture.mjs";
import { GATE_MODE, GATE_ARGS } from "./paired-raster-plan.mjs";
import {
  checkSampleCount,
  evaluateEnvelope,
} from "./paired-raster-envelope.mjs";

function sample(count = 0, shade = 0) {
  return {
    png: pngFixture({
      width: 4,
      height: 1,
      pixel: (x) =>
        x < count ? [shade, shade, shade, 255] : [255, 255, 255, 255],
    }),
    sourceSha256: "base",
    capture: { mode: GATE_MODE, browser: "145.0.7632.6", args: [...GATE_ARGS] },
  };
}
const population = (s) => Array.from({ length: 10 }, () => s);

it("identical paired bytes pass without calibration", () => {
  const base = sample(),
    result = evaluateEnvelope(base, base);
  expect(result).toMatchObject({
    pass: true,
    verdict: "pass",
    N: 0,
    baseVariantCount: 1,
    acceptance: "byte-identical",
  });
});
it("a differing head fails when identical base self-samples give a zero envelope", () => {
  const base = sample(),
    result = evaluateEnvelope(base, sample(1, 254), population(base));
  expect(result.envelope).toEqual({ changedPixels: 0, maxChannelDelta: 0 });
  expect(result.headDistance).toEqual({ changedPixels: 1, maxChannelDelta: 1 });
  expect(result.pass).toBe(false);
  expect(result.verdict).toBe("fail");
});
it("N below ten is refused before an identical pair can pass", () => {
  const base = sample();
  expect(() => checkSampleCount(9)).toThrow(/N.*10/);
  expect(() => evaluateEnvelope(base, base, [], 9)).toThrow(/N.*10/);
});
it("a self-sample mode mismatch is refused", () => {
  const base = sample(),
    samples = population(base);
  samples[9] = { ...base, capture: { ...base.capture, mode: "default" } };
  expect(() => evaluateEnvelope(base, sample(1), samples)).toThrow(/mode/);
});
it("the maximum pairwise base distance includes pairs away from the first sample", () => {
  const base = sample(1, 5),
    samples = population(base);
  samples[1] = sample(1, 0);
  samples[2] = sample(1, 10);
  const result = evaluateEnvelope(base, sample(1, 15), samples);
  expect(result.envelope).toEqual({ changedPixels: 1, maxChannelDelta: 10 });
  expect(result.headDistance).toEqual({
    changedPixels: 1,
    maxChannelDelta: 10,
  });
  expect(result).toMatchObject({
    pass: true,
    acceptance: "base-envelope",
    N: 10,
    baseVariantCount: 3,
  });
});
it("head bytes matching a base variant pass even beyond the reference envelope", () => {
  const base = sample(),
    variant = sample(1),
    result = evaluateEnvelope(base, variant, population(variant));
  expect(result.envelope).toEqual({ changedPixels: 0, maxChannelDelta: 0 });
  expect(result).toMatchObject({
    pass: true,
    acceptance: "base-variant",
    N: 10,
    baseVariantCount: 1,
  });
});
it("both envelope dimensions must hold, with inclusive boundaries", () => {
  const base = sample(),
    samples = population(base);
  samples[1] = sample(2, 245);
  expect(evaluateEnvelope(base, sample(1, 245), samples).pass).toBe(true);
  expect(evaluateEnvelope(base, sample(3, 254), samples).pass).toBe(false);
  expect(evaluateEnvelope(base, sample(1, 244), samples).pass).toBe(false);
});
it("calibration requires the requested number of source-identical samples", () => {
  const base = sample();
  expect(() =>
    evaluateEnvelope(base, sample(1), population(base).slice(1)),
  ).toThrow(/sample count/);
  const samples = population(base);
  samples[9] = { ...base, sourceSha256: "different source" };
  expect(() => evaluateEnvelope(base, sample(1), samples)).toThrow(/source/);
});
