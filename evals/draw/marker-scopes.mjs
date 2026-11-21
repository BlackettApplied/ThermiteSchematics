import assert from "node:assert/strict";
import { cases } from "./corpus.mjs";
export function expand(pattern) {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) return [pattern];
  return match[1]
    .split(",")
    .flatMap((value) =>
      expand(
        pattern.slice(0, match.index) +
          value +
          pattern.slice(match.index + match[0].length),
      ),
    );
}
function tree(rows, depth = 0) {
  if (depth === rows[0].length) return [""];
  const byValue = new Map();
  for (const row of rows) {
    const value = row[depth];
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(row);
  }
  const byTail = new Map();
  for (const [value, list] of [...byValue].sort())
    for (const tail of tree(list, depth + 1)) {
      if (!byTail.has(tail)) byTail.set(tail, []);
      byTail.get(tail).push(value);
    }
  return [...byTail]
    .map(
      ([tail, values]) =>
        (values.length > 1 ? `{${values.join(",")}}` : values[0]) +
        (tail ? "-" + tail : ""),
    )
    .sort();
}
export function compressCases(ids, specs = cases()) {
  const groups = new Map();
  for (const id of [...new Set(ids)].sort()) {
    const spec = specs.find((c) => c.id === id);
    assert(spec, `Unknown case ${id}`);
    const prefix = spec.sweep
        ? `sweep-${spec.sweep.project}`
        : id.slice(0, -spec.flow.length - 1),
      tuple = spec.sweep
        ? [
            spec.sweep.size,
            spec.sweep.orientation,
            spec.sweep.layout,
            spec.flow,
          ]
        : [spec.flow];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(tuple);
  }
  const patterns = [...groups]
    .sort()
    .flatMap(([prefix, tuples]) => tree(tuples).map((t) => prefix + "-" + t));
  assert.deepEqual(
    patterns.flatMap(expand).sort(),
    [...new Set(ids)].sort(),
    "Case compression must be exact",
  );
  return patterns;
}
export function compressSheets(sheets) {
  const ints = [
      ...new Set(
        sheets.filter((s) => /^sheet:\d+$/.test(s)).map((s) => +s.slice(6)),
      ),
    ].sort((a, b) => a - b),
    result = [...new Set(sheets.filter((s) => !/^sheet:\d+$/.test(s)))].sort();
  for (let i = 0; i < ints.length; i++) {
    let end = i;
    while (ints[end + 1] === ints[end] + 1) end++;
    result.push(`sheet:${ints[i]}${i !== end ? "-" + ints[end] : ""}`);
    i = end;
  }
  return result;
}
export function expandSheets(selector) {
  const m = selector.match(/^sheet:(\d+)-(\d+)$/);
  if (!m) return [selector];
  assert(+m[2] >= +m[1] && +m[2] - +m[1] <= 1000, "Invalid sheet range");
  return Array.from(
    { length: +m[2] - +m[1] + 1 },
    (_, i) => "sheet:" + (+m[1] + i),
  );
}
export const unitKey = (x) => JSON.stringify([x.case, x.sheet, x.medium]);
export function units(marker) {
  return marker.scopes.flatMap((scope) =>
    scope.cases
      .flatMap(expand)
      .flatMap((c) =>
        scope.sheets
          .flatMap(expandSheets)
          .flatMap((sheet) =>
            scope.media.map((medium) => ({ case: c, sheet, medium })),
          ),
      ),
  );
}
export function compressScopes(input, specs = cases()) {
  const byCaseMedium = new Map();
  for (const u of input) {
    const key = JSON.stringify([u.case, u.medium]);
    if (!byCaseMedium.has(key)) byCaseMedium.set(key, []);
    byCaseMedium.get(key).push(u.sheet);
  }
  const grouped = new Map();
  for (const [key, sheets] of byCaseMedium) {
    const [id, medium] = JSON.parse(key),
      selectors = compressSheets(sheets),
      k = JSON.stringify([selectors, medium]);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(id);
  }
  const byCasesSheets = new Map();
  for (const [key, ids] of grouped) {
    const [sheets, medium] = JSON.parse(key),
      cs = compressCases(ids, specs),
      k = JSON.stringify([cs, sheets]);
    if (!byCasesSheets.has(k)) byCasesSheets.set(k, []);
    byCasesSheets.get(k).push(medium);
  }
  return [...byCasesSheets].sort().map(([key, media]) => {
    const [cs, sheets] = JSON.parse(key);
    return { cases: cs, sheets, media: media.sort() };
  });
}
