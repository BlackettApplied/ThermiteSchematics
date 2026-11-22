import { expectations } from "./expectations.mjs";
// Called only after every protocol/location/fixture assertion has succeeded.
// A false desired predicate is xfail solely for the pinned observed signature.
export function assess(id, evidence, passed) {
  const marker = expectations[id];
  return {
    assessment: true,
    status: passed
      ? marker
        ? "xpass"
        : "pass"
      : marker?.signature(evidence)
        ? "xfail"
        : "fail",
    ...(marker && { gap: { owner: marker.owner, reason: marker.reason } }),
    ...(!passed && {
      failure: marker
        ? "Desired predicate absent; observed behavior must match the registered signature"
        : "Actionability/assessment predicate failed",
    }),
    ...(passed && marker && { failure: "stale expectation: retire marker" }),
    evidence,
  };
}
export function exitCode(results, reportOnly = false) {
  const rows = Object.values(results).flatMap((value) =>
    Array.isArray(value) ? value : [value],
  );
  if (rows.some((row) => row.status === "infrastructure-error")) return 2;
  if (reportOnly) return 0;
  return rows.some((row) =>
    ["fail", "xpass", "not-overlapped"].includes(row.status),
  )
    ? 1
    : 0;
}
