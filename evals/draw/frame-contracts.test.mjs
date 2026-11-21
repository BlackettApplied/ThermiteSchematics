import { expect, it } from "vitest";
import { verifyFrameCounts } from "./frame-census/contracts.mjs";
const baseline = [
  { case: "narrow", before: 22 },
  { case: "impossible", before: null },
];
it("admits a legal unchanged packet and an explicit impossible-fit refusal", () => {
  expect(
    verifyFrameCounts(baseline, [
      { case: "narrow", pages: 22 },
      { case: "impossible", pages: null, error: { code: "R006" } },
    ]),
  ).toEqual({ cases: 2, before: 22, after: 22, refusals: 1 });
});
it("refuses silent growth even without a new R006", () => {
  expect(() =>
    verifyFrameCounts(baseline, [
      { case: "narrow", pages: 23 },
      { case: "impossible", pages: null },
    ]),
  ).toThrow(/narrow/);
});
it("refuses a new R006 rather than treating it as zero cost", () => {
  expect(() =>
    verifyFrameCounts(
      [{ case: "narrow", before: 22 }],
      [{ case: "narrow", pages: null, error: { code: "R006" } }],
    ),
  ).toThrow(/narrow/);
});
it("does not offset a refusal against another packet's growth", () => {
  expect(() =>
    verifyFrameCounts(
      [
        { case: "narrow", before: 22 },
        { case: "other", before: 2 },
      ],
      [
        { case: "narrow", pages: null },
        { case: "other", pages: 24 },
      ],
    ),
  ).toThrow();
});
it("does not drop or invent a case, even if total pages match", () => {
  expect(() =>
    verifyFrameCounts(baseline, [{ case: "narrow", pages: 22 }]),
  ).toThrow(/cohort/);
  expect(() =>
    verifyFrameCounts(baseline, [
      { case: "narrow", pages: 22 },
      { case: "unowned", pages: null },
    ]),
  ).toThrow(/cohort/);
});
