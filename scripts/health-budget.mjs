import { migrateReasonLists } from "./health-reasons.mjs";
import { seedDefiniteAssignments } from "./health-definite.mjs";
export const DEFAULT_THRESHOLDS = Object.freeze({
  duplicateTokens: 50,
  fileLines: 850,
  functionLines: 70,
});
export const SIZE_CEILINGS = Object.freeze({
  fileLines: 3000,
  functionLines: 300,
});
export const SECTIONS = [
  "files",
  "functions",
  "nonNullAssertions",
  "typeAssertions",
  "definiteAssignments",
  "skippedTests",
  "duplicates",
];
export const sizeKey = (section) =>
  section === "files" ? "fileLines" : "functionLines";
export const sorted = (entries) =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
export function totals(current) {
  return {
    nonNullAssertions: Object.values(current.files).reduce(
      (n, f) => n + (f.nonNullAssertions ?? 0),
      0,
    ),
    skippedTests: Object.values(current.files).reduce(
      (n, f) => n + f.skippedTests,
      0,
    ),
    definiteAssignments: Object.values(current.files).reduce(
      (n, f) => n + (f.definiteAssignments ?? 0),
      0,
    ),
  };
}
export function valuesOf(current, section) {
  if (section === "functions") return current.functions;
  if (section === "duplicates")
    return Object.fromEntries(
      Object.entries(current.duplicates).map(([k, g]) => [k, g.members.length]),
    );
  return Object.fromEntries(
    Object.entries(current.files).map(([k, f]) => [
      k,
      section === "files" ? (f.lines ?? 0) : (f[section] ?? 0),
    ]),
  );
}
export function fallbackOf(budget, section) {
  return ["files", "functions"].includes(section)
    ? budget.thresholds[sizeKey(section)]
    : section === "duplicates"
      ? 1
      : 0;
}
function numericMap(map, where, minimum = 1) {
  if (!map || typeof map !== "object" || Array.isArray(map))
    throw Error(`Invalid health budget map: ${where} (expected an object)`);
  for (const [key, n] of Object.entries(map))
    if (!Number.isSafeInteger(n) || n < minimum)
      throw Error(`Invalid health budget value: ${where}.${key}`);
}
export function validateBudget(budget) {
  if (budget.version !== 4)
    throw Error("Unsupported health budget version; expected 4");
  for (const key of Object.keys(DEFAULT_THRESHOLDS))
    if (
      !Number.isSafeInteger(budget.thresholds?.[key]) ||
      budget.thresholds[key] < 1
    )
      throw Error(`Invalid health threshold: ${key}`);
  for (const section of SECTIONS)
    if (
      !["definiteAssignments", "typeAssertions"].includes(section) ||
      budget[section] !== undefined
    )
      numericMap(budget[section], section);
  if (
    (budget.definiteAssignments === undefined) !==
    (budget.ceilings?.definiteAssignments === undefined)
  )
    throw Error("Incomplete definiteAssignments baseline");
  numericMap(budget.ceilings, "ceilings", 0);
  for (const key of [
    ...Object.keys(SIZE_CEILINGS),
    "nonNullAssertions",
    "skippedTests",
  ])
    if (!Number.isSafeInteger(budget.ceilings[key]))
      throw Error(`Missing health ceiling: ${key}`);
  for (const [key, max] of Object.entries(SIZE_CEILINGS))
    if (budget.ceilings[key] < 1 || budget.ceilings[key] > max)
      throw Error(`Health ceiling ${key} cannot exceed ${max}`);
  for (const section of ["files", "functions"]) {
    numericMap(budget.grandfathered?.[section], `grandfathered.${section}`);
    if (!budget.locations?.[section] || !budget.fingerprints?.[section])
      throw Error(`Missing grandfathered locations: ${section}`);
    for (const id of Object.keys(budget.grandfathered[section]))
      if (typeof budget.locations[section][id] !== "string")
        throw Error(`Missing grandfathered location: ${id}`);
  }
  for (const section of ["files", "functions"])
    for (const id of Object.keys(budget.grandfathered[section]))
      if (typeof budget.fingerprints[section][id] !== "string")
        throw Error(`Missing grandfathered fingerprint: ${id}`);
  if (!budget.reasons || !budget.moves)
    throw Error("Missing health reasons or moves");
}
export function createBudget(current, thresholds = DEFAULT_THRESHOLDS) {
  const result = {
    version: 4,
    thresholds: sorted(Object.entries(thresholds)),
    ceilings: sorted(Object.entries({ ...SIZE_CEILINGS, ...totals(current) })),
    grandfathered: {},
    locations: {},
    fingerprints: {},
    moves: {},
    reasons: {},
  };
  for (const section of ["files", "functions"]) {
    const entries = Object.entries(valuesOf(current, section)),
      cap = result.ceilings[sizeKey(section)];
    result[section] = sorted(
      entries.filter(([, n]) => n > thresholds[sizeKey(section)] && n <= cap),
    );
    result.grandfathered[section] = sorted(entries.filter(([, n]) => n > cap));
    const hashes =
      section === "files" ? current.fileHashes : current.bodyHashes;
    result.fingerprints[section] = sorted(
      Object.keys(result.grandfathered[section]).map((id) => [id, hashes[id]]),
    );
    result.locations[section] = sorted(
      Object.keys(result.grandfathered[section]).map((id) => [id, id]),
    );
  }
  for (const section of [
    "nonNullAssertions",
    "typeAssertions",
    "definiteAssignments",
    "skippedTests",
  ])
    result[section] = sorted(
      Object.entries(valuesOf(current, section)).filter(([, n]) => n > 0),
    );
  result.duplicates = sorted(
    Object.entries(current.duplicates)
      .filter(([, g]) => g.tokens >= thresholds.duplicateTokens)
      .map(([h, g]) => [h, g.members.length]),
  );
  return sorted(Object.entries(result));
}
export function seedTypeAssertions(budget, metrics) {
  if (budget.typeAssertions !== undefined) return budget;
  // The former implicit per-file count becomes explicit from authenticated
  // baseline source, never from a PR head that deletes its own counter map.
  return {
    ...budget,
    typeAssertions: sorted(
      Object.entries(valuesOf(metrics, "typeAssertions")).filter(
        ([, n]) => n > 0,
      ),
    ),
  };
}
function seedCounters(budget, metrics) {
  return seedTypeAssertions(seedDefiniteAssignments(budget, metrics), metrics);
}
// A v2 baseline is seeded from authenticated base source. v3 records below the
// caps retire, and legacy reason strings never grant an authorization in v4.
export function upgradeBudget(raw, metrics, declarationBaseline = metrics) {
  if (raw.version === 4) {
    validateBudget(raw);
    return seedCounters(migrateReasonLists(raw), declarationBaseline);
  }
  if (raw.version === 2) return createBudget(metrics, raw.thresholds);
  if (raw.version !== 3) throw Error("Unsupported health budget version");
  const next = structuredClone(raw);
  next.version = 4;
  next.locations = {};
  next.fingerprints = {};
  next.reasons = Object.fromEntries(
    Object.entries(raw.reasons).filter(([, r]) => r && typeof r === "object"),
  );
  for (const section of ["files", "functions"]) {
    const cap = next.ceilings[sizeKey(section)],
      values = valuesOf(metrics, section);
    next[section] = sorted(
      Object.entries(raw[section]).filter(([, n]) => n <= cap),
    );
    next.grandfathered[section] = sorted(
      Object.entries(raw.grandfathered[section])
        .filter(([k, n]) => n > cap && values[k] > cap)
        .map(([k, n]) => [k, Math.min(n, values[k])]),
    );
    const hashes =
      section === "files" ? metrics.fileHashes : metrics.bodyHashes;
    next.fingerprints[section] = sorted(
      Object.keys(next.grandfathered[section]).map((id) => [id, hashes[id]]),
    );
    next.locations[section] = sorted(
      Object.keys(next.grandfathered[section]).map((k) => [k, k]),
    );
  }
  return seedCounters(sorted(Object.entries(next)), declarationBaseline);
}
