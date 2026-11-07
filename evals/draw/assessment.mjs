import assert from "node:assert/strict";
import { hash, json, canonical, round } from "./support.mjs";
import { identityKey, markerId, checkKey } from "./locators.mjs";
import { units, unitKey } from "./marker-scopes.mjs";
import { measurements, envelope } from "./marker-metrics.mjs";
// Used only for checker/corpus provenance, never for matching a defect.
export const signature = (finding) => hash(json(finding));
export function observations(rows) {
  const grouped = new Map();
  for (const row of rows.filter(
    (r) => r.status === "fail" || r.status === "xfail",
  ))
    for (const [index, f] of (row.evidence?.findings ?? []).entries()) {
      assert(
        f.identities?.length,
        `Missing stable locator: ${row.id}/${f.element}`,
      );
      for (const identity of f.identities) {
        const unit = {
            case: row.case,
            sheet: identity.sheet,
            medium: identity.medium,
          },
          key = identityKey(identity),
          u = unitKey(unit),
          combined = JSON.stringify([key, u]);
        if (!grouped.has(combined))
          grouped.set(combined, {
            key,
            identity,
            unit,
            findings: [],
            occurrences: 0,
            links: [],
          });
        const group = grouped.get(combined);
        group.findings.push(
          ...(f.instances?.map((i) => ({
            ...f,
            ...i,
            instances: undefined,
          })) ?? [f]),
        );
        group.occurrences += f.instances?.length ?? f.instanceCount ?? 1;
        group.links.push({ row, index, f });
      }
    }
  return [...grouped.values()].sort((a, b) =>
    JSON.stringify([a.key, a.unit]) < JSON.stringify([b.key, b.unit]) ? -1 : 1,
  );
}
function rangeDifferent(a, b) {
  // Compare on the exported 0.001 lattice, including when reassessing a saved
  // report. Binary subtraction must not turn one reporting quantum into drift.
  return [0, 1].some(
    (i) => Math.abs(Math.round(a[i] * 1000) - Math.round(b[i] * 1000)) > 1,
  );
}
export function assess(rows, registry, selectedCases, context = {}) {
  assert.equal(
    new Set(rows.map((r) => r.id)).size,
    rows.length,
    "Duplicate observation identity",
  );
  assert.equal(
    registry.format,
    "thermite-draw-expectations/2.0",
    "Unsupported expectation format",
  );
  for (const row of rows)
    for (const f of row.evidence?.findings ?? []) delete f.assessments;
  const markers = new Map(),
    ids = new Set(),
    drift = [];
  for (const marker of registry.markers) {
    assert.equal(
      marker.id,
      markerId(marker),
      "Marker ID must follow defect identity",
    );
    assert(!ids.has(marker.id), "Duplicate marker ID");
    ids.add(marker.id);
    const expected = units(marker);
    if (context.allCases)
      for (const u of expected)
        assert(
          context.allCases.has(u.case),
          `Stale marker case: ${marker.id}/${u.case}`,
        );
    assert.equal(
      new Set(expected.map(unitKey)).size,
      expected.length,
      "Overlapping marker scopes",
    );
    markers.set(identityKey(marker), {
      marker,
      expected: new Map(expected.map((u) => [unitKey(u), u])),
      seen: new Set(),
      observed: [],
    });
  }
  for (const group of observations(rows)) {
    const entry = markers.get(group.key),
      u = unitKey(group.unit),
      match = entry?.expected.has(u),
      deltas = [];
    if (match) {
      entry.seen.add(u);
      entry.observed.push(group);
      const values = envelope(group.findings.map(measurements));
      for (const [metric, [lo, , , hi]] of Object.entries(
        entry.marker.bands ?? {},
      )) {
        assert(values[metric], `Missing band measurement ${metric}`);
        for (const raw of values[metric]) {
          const value = round(raw);
          if (value < lo || value > hi)
            deltas.push({
              metric,
              allowed: [lo, hi],
              observed: value,
              delta: value < lo ? value - lo : value - hi,
            });
        }
      }
    }
    const status = match && !deltas.length ? "xfail" : "fail";
    for (const { f } of group.links) {
      f.assessments ??= [];
      f.assessments.push({
        locator: group.identity.locator,
        status,
        ...(entry ? { marker: entry.marker.id } : {}),
        ...(!match
          ? {
              reason: entry
                ? "new scope of pinned defect"
                : "new defect identity",
            }
          : {}),
        ...(deltas.length
          ? { reason: "measurement outside marker band", deltas }
          : {}),
      });
    }
  }
  // A mixed row fails if even one identity/measurement is unexpected.
  for (const row of rows.filter(
    (r) => r.status === "fail" || r.status === "xfail",
  )) {
    if (
      row.evidence?.findings?.length &&
      row.evidence.findings.every(
        (f) =>
          f.assessments?.length &&
          f.assessments.every((a) => a.status === "xfail"),
      )
    )
      row.status = "xfail";
    else row.status = "fail";
  }
  for (const entry of markers.values()) {
    const { marker } = entry;
    for (const [key, u] of entry.expected) {
      if (!selectedCases.has(u.case) || entry.seen.has(key)) continue;
      const state = context.caseStates?.[u.case];
      const compatible = rows.filter(
        (r) =>
          r.case === u.case &&
          r.dq === marker.dq &&
          (r.check ?? checkKey(r)) === marker.check &&
          (u.sheet === "packet" ||
            u.sheet === r.viewScope ||
            u.sheet === `sheet:${r.sheet}`) &&
          u.medium ===
            (r.medium ??
              (r.id.includes("/html-")
                ? "html"
                : r.id.includes("/pdf-")
                  ? "pdf"
                  : "svg")),
      );
      const measured = compatible.some((r) =>
        ["pass", "fail", "xfail"].includes(r.status),
      );
      const eliminatedSheet =
        /^sheet:\d+$/.test(u.sheet) &&
        state?.status === "rendered" &&
        !state.sheets.includes(+u.sheet.slice(6));
      const rendered =
        marker.kind === "render-refusal" && state?.status === "rendered";
      const missing =
        state?.status === "infrastructure" ||
        (state?.status === "refused" && marker.kind !== "render-refusal") ||
        (!measured && !eliminatedSheet && !rendered);
      rows.push({
        id: `expectation/${marker.id}/${hash(key).slice(0, 12)}`,
        dq: marker.dq,
        case: u.case,
        sheet: u.sheet,
        check: marker.check,
        status: missing ? "fail" : "xpass",
        reason: missing
          ? "Pinned observation was not measured; instrumentation, view or render missing"
          : "Pinned defect is absent: review and retire this scope",
        ...(marker.kind === "iso-cap-height-policy"
          ? { classification: "policy-gap" }
          : {}),
        expectation: {
          marker: marker.id,
          scope: u,
          kind: marker.kind,
          locator: marker.locator,
        },
        evidence: { findingCount: 0, findings: [] },
      });
    }
    if (entry.observed.length) {
      const values = envelope(
          entry.observed.flatMap((g) => g.findings.map(measurements)),
        ),
        countRange = envelope(
          entry.observed.map((g) => ({
            occurrences: g.occurrences ?? g.findings.length,
          })),
        ).occurrences;
      const changes = [];
      for (const [metric, [, lo, hi]] of Object.entries(marker.bands ?? {}))
        if (values[metric] && rangeDifferent(values[metric], [lo, hi]))
          changes.push({
            metric,
            reference: [lo, hi],
            observed: values[metric],
          });
      if (marker.count && rangeDifferent(countRange, marker.count))
        changes.push({
          metric: "occurrences",
          reference: marker.count,
          observed: countRange,
        });
      if (changes.length)
        drift.push({
          marker: marker.id,
          dq: marker.dq,
          locator: marker.locator,
          partialScope: [...entry.expected.values()].some(
            (u) => !selectedCases.has(u.case),
          ),
          changes,
          withinBand: entry.observed.every((g) =>
            g.links.every(({ f }) =>
              f.assessments
                .filter((a) => a.marker === marker.id)
                .every((a) => !a.deltas?.length),
            ),
          ),
        });
    }
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return canonical({
    drift: drift.sort((a, b) => (a.marker < b.marker ? -1 : 1)),
  });
}
export function exitCode(rows, reportOnly = false) {
  if (rows.some((r) => r.status === "infrastructure-error")) return 2;
  return !reportOnly && rows.some((r) => ["fail", "xpass"].includes(r.status))
    ? 1
    : 0;
}
export const summary = (rows) =>
  Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => {
      const dq = `DQ-${String(i + 1).padStart(2, "0")}`;
      return [
        dq,
        Object.fromEntries(
          [
            "pass",
            "fail",
            "xfail",
            "xpass",
            "manual",
            "not-implemented",
            "infrastructure-error",
          ].map((status) => [
            status,
            rows.filter(
              (r) =>
                r.dq === dq &&
                r.status === status &&
                r.classification !== "policy-gap",
            ).length,
          ]),
        ),
      ];
    }),
  );
