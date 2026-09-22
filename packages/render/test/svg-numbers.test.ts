import { describe, expect, it } from "vitest";

import { formatSvgNumber, MAX_SVG_MAGNITUDE } from "../src/svg/numbers.js";

function nextUp(value: number): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

describe("canonical SVG numbers", () => {
  it.each([
    [0, "0"],
    [-0, "0"],
    [-0.0004, "0"],
    [0.0005, "0.001"],
    [1.2344, "1.234"],
    [1.2345, "1.234"],
    [12, "12"],
    [12.3, "12.3"],
    [-12.3456, "-12.346"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatSvgNumber(value as number)).toBe(expected);
  });

  it("accepts both inclusive safe limits without exponent notation", () => {
    expect(formatSvgNumber(MAX_SVG_MAGNITUDE)).toBe("1000000000");
    expect(formatSvgNumber(-MAX_SVG_MAGNITUDE)).toBe("-1000000000");
  });

  it("rejects the adjacent values beyond the safe limits", () => {
    expect(() => formatSvgNumber(nextUp(MAX_SVG_MAGNITUDE))).toThrow(
      RangeError,
    );
    expect(() => formatSvgNumber(-nextUp(MAX_SVG_MAGNITUDE))).toThrow(
      RangeError,
    );
  });

  it.each([Number.NaN, Infinity, -Infinity, 1e21, -1e21])(
    "rejects unsafe value %s before it can emit an exponent",
    (value) => expect(() => formatSvgNumber(value)).toThrow(RangeError),
  );

  it("never emits exponent, plus, or padding characters", () => {
    for (const value of [-999999999.999, -1, 0.001, 1, 999999999.999]) {
      expect(formatSvgNumber(value)).not.toMatch(/[eE+\s]/);
    }
  });
});
