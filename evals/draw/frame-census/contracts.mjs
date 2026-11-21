import assert from "node:assert/strict";

/** Paired case identities and counts are the gate. An aggregate cannot pay for
 * a new refusal with growth elsewhere, or silently omit an impossible case. */
export function verifyFrameCounts(expected, actual) {
  const names = expected.map((r) => r.case);
  assert.equal(new Set(names).size, names.length, "Duplicate baseline case");
  assert.equal(
    new Set(actual.map((r) => r.case)).size,
    actual.length,
    "Duplicate measured case",
  );
  assert.deepEqual(
    actual.map((r) => r.case).sort(),
    [...names].sort(),
    "Incomplete measured cohort",
  );
  const index = new Map(actual.map((r) => [r.case, r]));
  for (const row of expected) {
    const measured = index.get(row.case);
    assert(measured, `Missing ${row.case}`);
    assert(
      measured.pages === null ||
        (Number.isInteger(measured.pages) &&
          measured.pages > 0 &&
          measured.pages <= 100),
      `Invalid sheet count for ${row.case}`,
    );
    assert.equal(
      measured.pages,
      row.before,
      `Page/refusal gate: ${row.case}; expected ${row.before}, measured ${measured.pages}`,
    );
  }
  return {
    cases: names.length,
    before: expected.reduce((n, r) => n + (r.before ?? 0), 0),
    after: actual.reduce((n, r) => n + (r.pages ?? 0), 0),
    refusals: actual.filter((r) => r.pages === null).length,
  };
}
