import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { units, unitKey } from "./marker-scopes.mjs";
import { measurements, envelope } from "./marker-metrics.mjs";
import { canonical } from "./support.mjs";
import { checkKey } from "./locators.mjs";
export const copy = (x) => structuredClone(x);
export const same = (a, b, message) => assert(equal(a, b), message);
export const scopeId = (id, scope) => {
  keys(scope, ["case", "sheet", "medium"], "scope");
  assert(
    typeof scope.case === "string" &&
      typeof scope.sheet === "string" &&
      scope.case &&
      scope.sheet &&
      ["svg", "html", "pdf"].includes(scope.medium),
    "Invalid scope selector",
  );
  return JSON.stringify([id, unitKey(scope)]);
};
export const keys = (x, allowed, where) => {
  assert(x && typeof x === "object" && !Array.isArray(x), `Invalid ${where}`);
  for (const k of Object.keys(x))
    assert(allowed.includes(k), `Unknown ${where} field: ${k}`);
};
export const range = (x, n, where) => {
  assert(
    Array.isArray(x) &&
      x.length === n &&
      x.every((v) => Number.isFinite(v) && v >= 0),
    `Invalid ${where}`,
  );
  assert(
    x.every((v, i) => i === 0 || v >= x[i - 1]),
    `Unordered ${where}`,
  );
};
export const measured = (rows, marker, scope) =>
  rows.some(
    (r) =>
      !r.expectation &&
      r.case === scope.case &&
      r.dq === marker.dq &&
      (r.check ?? checkKey(r)) === marker.check &&
      scope.medium ===
        (r.medium ??
          (r.id.includes("/html-")
            ? "html"
            : r.id.includes("/pdf-")
              ? "pdf"
              : "svg")) &&
      (scope.sheet === "packet" ||
        scope.sheet === r.viewScope ||
        scope.sheet === `sheet:${r.sheet}`) &&
      ["pass", "fail", "xfail"].includes(r.status),
  );
export function classCheck(entry, kind) {
  assert(
    entry.classification ===
      (kind === "iso-cap-height-policy" ? "policy-gap" : "drawing"),
    "Explicit policy-gap/drawing classification required",
  );
}
export function referenceFor(registry, inventory, id, metric) {
  const marker = registry.markers.find((m) => m.id === id);
  assert(marker, "Unknown envelope marker");
  const allowed = new Set(units(marker).map(unitKey));
  const groups = [...inventory.groups.values()].filter(
    (g) => g.markerId === id && allowed.has(unitKey(g.scope)),
  );
  assert(groups.length, "No measured envelope observations");
  if (metric === "occurrences")
    return envelope(groups.map((g) => ({ v: g.occurrences }))).v;
  const value = envelope(groups.flatMap((g) => g.findings.map(measurements)))[
    metric
  ];
  assert(value, `Unknown/unmeasured envelope metric: ${metric}`);
  return canonical(value);
}
