import { fallbackOf, valuesOf } from "./health-budget.mjs";
import { lineAdditions, exactMove, moveProof } from "./health-continuity.mjs";
import { currentOwners } from "./health-owners.mjs";

// A continuation can be one rename or several parts. Each part must retain
// at least a fifth of the old normalized lines; together they retain four
// fifths. Multiset intersections consume occurrences, including repeated lines.
export const RENAME_PART_SHARE = Object.freeze({
  numerator: 1,
  denominator: 5,
});
export const RENAME_RETAINED_SHARE = Object.freeze({
  numerator: 4,
  denominator: 5,
});
// A new large part needs a header, closing brace and call/import/export line.
// Small unbudgeted parts need no grant and earn no extra credit.
export const SPLIT_PART_OVERHEAD_LINES = 3;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const covers = (common, total, share) =>
  common * share.denominator >= total * share.numerator;

function continuationRows(section, current, reference, budget) {
  const base = reference.metrics,
    before = reference.budget,
    oldValues = valuesOf(base, section),
    field = section === "files" ? "fileLines" : "bodyLines",
    hashes = section === "files" ? "fileHashes" : "bodyHashes",
    newBodies = Object.entries(current[field] ?? {})
      .filter(([key]) => !Object.hasOwn(oldValues, key))
      .sort(([a], [b]) => compare(a, b));
  const rows = [];
  for (const [from, limit] of Object.entries(before[section]).sort(([a], [b]) =>
    compare(a, b),
  )) {
    const old = base[field]?.[from];
    // Content loss, not physical size, determines whether a source can split.
    // A source retaining four fifths is intact, even if a new helper overlaps.
    if (
      !old?.length ||
      covers(
        lineAdditions(old, current[field]?.[from] ?? []).common,
        old.length,
        RENAME_RETAINED_SHARE,
      )
    )
      continue;
    for (const [key, lines] of newBodies) {
      // A proven transfer chooses its authenticated origin. The existing
      // monotonicity ledger still verifies that origin funds the allowance.
      if (
        budget?.moves &&
        exactMove(section, key, budget, base, current) &&
        moveProof(section, key, budget).from !== from
      )
        continue;
      const { common, added } = lineAdditions(old, lines);
      if (covers(common, old.length, RENAME_PART_SHARE))
        rows.push({
          id: from,
          from,
          key,
          limit,
          common,
          added,
          exact: base[hashes][from] === current[hashes][key],
        });
    }
  }
  return rows.sort(
    (a, b) =>
      b.common - a.common ||
      a.added - b.added ||
      Number(b.exact) - Number(a.exact) ||
      compare(a.id, b.id) ||
      compare(a.key, b.key),
  );
}

function contains(current, outer, inner) {
  const a = current.bodyRanges?.[outer],
    b = current.bodyRanges?.[inner];
  return (
    outer !== inner &&
    outer.split("#", 1)[0] === inner.split("#", 1)[0] &&
    a &&
    b &&
    a[0] <= b[0] &&
    a[1] >= b[1]
  );
}

function disjointParts(rows, current) {
  const result = [];
  for (const row of rows)
    if (
      !result.some(
        (other) =>
          contains(current, other.key, row.key) ||
          contains(current, row.key, other.key),
      )
    )
      result.push(row);
  return result;
}

function qualifiedGroups(section, rows, current, reference) {
  const field = section === "files" ? "fileLines" : "bodyLines",
    result = new Map();
  for (const from of [...new Set(rows.map((r) => r.from))].sort(compare)) {
    const parts = disjointParts(
        rows.filter((r) => r.from === from),
        current,
      ),
      old = reference.metrics[field][from],
      retained = lineAdditions(
        old,
        (current[field][from] ?? []).concat(
          parts.flatMap((r) => current[field][r.key]),
        ),
      );
    if (covers(retained.common, old.length, RENAME_RETAINED_SHARE))
      result.set(from, {
        section,
        from,
        limit: reference.budget[section][from],
        oldLines: old.length,
        retained: retained.common,
      });
  }
  return result;
}

export function sizeContinuations(section, current, reference, budget) {
  if (!reference) return [];
  const rows = continuationRows(section, current, reference, budget),
    qualified = qualifiedGroups(section, rows, current, reference),
    eligible = rows.filter((r) => qualified.has(r.from)),
    owners =
      section === "functions"
        ? currentOwners(eligible, current, reference.metrics)
        : new Map(),
    groups = [];
  for (const [from, group] of qualified) {
    const parts = eligible.filter(
      (r) =>
        r.from === from && (!owners.has(r.key) || owners.get(r.key) === from),
    );
    const targets = parts
      .filter(
        (r) =>
          section === "files" ||
          !parts.some((other) => contains(current, other.key, r.key)),
      )
      .map((r) => r.key)
      .sort(compare);
    if (targets.length) groups.push({ ...group, targets });
  }
  return groups;
}

export function renameRegressions(current, budget, reference) {
  const errors = [];
  for (const section of ["files", "functions"]) {
    const values = valuesOf(current, section);
    for (const group of sizeContinuations(
      section,
      current,
      reference,
      budget,
    )) {
      // Retained stale source records consume credit too. Every group is
      // checked independently: ambiguous origins cannot pool extra credit.
      const remaining = budget[section][group.from] ?? 0,
        claimed = group.targets.reduce(
          (n, key) =>
            n +
            (budget[section][key] ??
              (values[key] > fallbackOf(budget, section) ? values[key] : 0)),
          remaining,
        ),
        newParts = group.targets.filter(
          (key) => values[key] > fallbackOf(budget, section),
        ).length,
        overhead = newParts * SPLIT_PART_OVERHEAD_LINES,
        limit = group.limit + overhead;
      if (claimed > limit)
        errors.push(
          `Allowance cannot rise through rename: ${section}:${group.from} ${group.limit} + ${overhead} structural = ${limit} -> ${claimed} shared by ${group.targets.join(", ")}${remaining ? " (source allowance retained)" : ""}`,
        );
    }
  }
  return errors;
}
