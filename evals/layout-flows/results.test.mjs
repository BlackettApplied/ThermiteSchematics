import { expect, it } from "vitest";
import { outcome, compare, summary, regressed } from "./results.mjs";
it("pins positive-to-refusal, every R-code and page growth without exemptions", () => {
  const success = outcome({
      ok: true,
      value: { sheets: [{ number: 1, svg: "<svg/>" }] },
    }),
    refused = outcome({
      ok: false,
      error: { code: "R006", reason: "unprintable-layout" },
    }),
    growth = outcome({
      ok: true,
      value: {
        sheets: [
          { number: 1, svg: "<svg/>" },
          { number: 2, svg: "<svg/>" },
        ],
      },
    });
  expect(compare(success, refused)).toEqual({
    positiveToRefusal: true,
    recovered: false,
    refusalCodeChanged: false,
    pageGrowth: false,
    identical: false,
  });
  expect(compare(success, growth)).toEqual({
    positiveToRefusal: false,
    recovered: false,
    refusalCodeChanged: false,
    pageGrowth: true,
    identical: false,
  });
  expect(compare(refused, success)).toEqual({
    positiveToRefusal: false,
    recovered: true,
    refusalCodeChanged: false,
    pageGrowth: false,
    identical: false,
  });
  expect(() => outcome({ ok: false, error: { code: "E001" } })).toThrow(
    "Every render refusal needs an R-code",
  );
  const report = summary(
    [
      {
        id: "one",
        before: success,
        after: refused,
        ...compare(success, refused),
      },
    ],
    2,
  );
  expect(report.complete).toBe(false);
  expect(report.positiveToRefusal).toEqual(["one"]);
  expect(report.refusals).toEqual([
    {
      id: "one",
      side: "after",
      code: "R006",
      error: { code: "R006", reason: "unprintable-layout" },
    },
  ]);
});
it("recovers refusals without stopping and rejects every changed refusal code", () => {
  const success = { ok: true, pages: 1, sha256: "success" },
    r006 = { ok: false, pages: 0, code: "R006", sha256: "r006" },
    r004 = { ok: false, pages: 0, code: "R004", sha256: "r004" };
  expect(regressed(compare(r006, success))).toBe(false);
  expect(regressed(compare(r006, r004))).toBe(true);
  expect(regressed(compare(r004, r006))).toBe(true);
  expect(regressed(compare(r006, r006))).toBe(false);
  const rows = [
    {
      id: "recovered",
      before: r006,
      after: success,
      ...compare(r006, success),
    },
    { id: "code-change", before: r006, after: r004, ...compare(r006, r004) },
  ];
  const report = summary(rows, 2);
  expect(report.complete).toBe(true);
  expect(report.pageGrowth).toEqual([]);
  expect(report.recovered).toEqual(["recovered"]);
  expect(report.refusalCodeChanged).toEqual(["code-change"]);
});
