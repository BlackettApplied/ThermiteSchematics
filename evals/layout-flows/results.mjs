import { createHash } from "node:crypto";
import assert from "node:assert/strict";
export const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export function outcome(result) {
  if (!result.ok) {
    assert.match(
      result.error.code,
      /^R00[1-6]$/u,
      "Every render refusal needs an R-code",
    );
    return {
      ok: false,
      pages: 0,
      code: result.error.code,
      error: result.error,
      sha256: sha256(result),
    };
  }
  return {
    ok: true,
    pages: result.value.sheets.length,
    sha256: sha256(result),
    sheets: result.value.sheets.map((s) => ({
      number: s.number,
      sha256: sha256(s.svg),
    })),
  };
}
export function compare(before, after) {
  return {
    positiveToRefusal: before.ok && !after.ok,
    recovered: !before.ok && after.ok,
    pageGrowth: before.ok && after.ok && after.pages > before.pages,
    refusalCodeChanged: !before.ok && !after.ok && before.code !== after.code,
    identical: before.sha256 === after.sha256,
  };
}
export function regressed(row) {
  return row.positiveToRefusal || row.pageGrowth || row.refusalCodeChanged;
}
export function summary(inputRows, expected) {
  const rows = [...inputRows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    expected,
    completed: rows.length,
    complete: rows.length === expected,
    positiveToRefusal: rows.filter((r) => r.positiveToRefusal).map((r) => r.id),
    pageGrowth: rows.filter((r) => r.pageGrowth).map((r) => r.id),
    recovered: rows.filter((r) => r.recovered).map((r) => r.id),
    refusalCodeChanged: rows
      .filter((r) => r.refusalCodeChanged)
      .map((r) => r.id),
    beforePages: rows.reduce((n, r) => n + r.before.pages, 0),
    afterPages: rows.reduce((n, r) => n + r.after.pages, 0),
    refusals: rows.flatMap((r) =>
      ["before", "after"]
        .filter((side) => !r[side].ok)
        .map((side) => ({
          id: r.id,
          side,
          code: r[side].code,
          error: r[side].error,
        })),
    ),
    results: rows,
  };
}
