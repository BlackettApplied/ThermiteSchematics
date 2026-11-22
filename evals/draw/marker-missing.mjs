import { hash } from "./support.mjs";
export function missingMarkerRow(
  marker,
  key,
  unit,
  missing,
  compatible,
  state,
) {
  const identifierCheck =
    marker.kind.startsWith("identifier-") ||
    marker.kind === "report-null-placeholder" ||
    marker.kind === "terminal-plan-is-table";
  const infrastructure =
    (identifierCheck &&
      compatible.some(
        (r) =>
          r.status === "infrastructure-error" &&
          r.instrumentation === "identifier",
      )) ||
    state?.instrumentation === "identifier";
  return {
    id: `expectation/${marker.id}/${hash(key).slice(0, 12)}`,
    dq: marker.dq,
    case: unit.case,
    sheet: unit.sheet,
    check: marker.check,
    status: infrastructure
      ? "infrastructure-error"
      : missing
        ? "fail"
        : "xpass",
    reason: infrastructure
      ? "Pinned observation could not be measured: identifier infrastructure error"
      : missing
        ? "Pinned observation was not measured; instrumentation, view or render missing"
        : "Pinned defect is absent: review and retire this scope",
    ...(infrastructure ? { instrumentation: "identifier" } : {}),
    ...(marker.kind === "iso-cap-height-policy"
      ? { classification: "policy-gap" }
      : {}),
    expectation: {
      marker: marker.id,
      scope: unit,
      kind: marker.kind,
      locator: marker.locator,
    },
    evidence: { findingCount: 0, findings: [] },
  };
}
