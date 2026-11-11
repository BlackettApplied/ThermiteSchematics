import { expect, it } from "vitest";
import { wrapDeviceTagText } from "../src/device-tag-wrap.js";
const measure = (s: string) =>
  [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].length;

it("prefers whole description words before punctuation within a word", () => {
  expect(wrapDeviceTagText("word abc-def", 8, measure, true)).toEqual([
    "word ",
    "abc-def",
  ]);
});
it.each([true, false])(
  "breaks after retained separators before splitting graphemes (description=%s)",
  (description) => {
    const value = "ABCD-EFGH/IJKL.MNOP_QRST";
    const rows = wrapDeviceTagText(value, 7, measure, description);
    expect(rows).toEqual(["ABCD-", "EFGH/", "IJKL.", "MNOP_", "QRST"]);
    expect(rows.join("")).toBe(value);
    expect(wrapDeviceTagText(value, 7, measure, description)).toEqual(rows);
  },
);
it("retains literal part whitespace and falls back to whole graphemes only", () => {
  expect(wrapDeviceTagText("AB  /CD-EF", 5, measure, false)).toEqual([
    "AB  /",
    "CD-EF",
  ]);
  const value = "e\u0301".repeat(10);
  const rows = wrapDeviceTagText(value, 4, measure, true);
  expect(rows).toEqual([
    "e\u0301".repeat(4),
    "e\u0301".repeat(4),
    "e\u0301".repeat(2),
  ]);
  expect(rows.join("")).toBe(value);
});
