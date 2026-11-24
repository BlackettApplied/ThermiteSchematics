import assert from "node:assert/strict";
import { EVALS_VERSION } from "./version.mjs";

// Only 5.3 receives zero-counter compatibility. Other known versions stay exact.
const completeVersions = new Set([
  "4.1",
  "4.2",
  "4.3",
  "4.4",
  "4.5",
  "4.6",
  "4.7",
  "4.8",
  "4.9",
  "5.0",
  "5.1",
  "5.2",
  "5.4",
  "5.5",
  "5.6",
  "5.7",
  "5.8",
  "5.9",
  "5.10",
  "5.11",
  "5.12",
  "5.13",
  "5.14",
  "5.15",
  "5.16",
  "5.17",
  "5.18",
  "5.19",
  "5.20",
  "5.21",
  "5.22",
  "5.23",
  "5.24",
  "5.25",
  "5.26",
  "5.27",
  "5.31",
  "5.32",
  "5.33",
  "5.35",
  "5.38",
  "5.39",
  "5.40",
  "5.41",
  "5.42",
  "5.43",
  "5.44",
  "5.45",
  EVALS_VERSION,
]);

export function readReportSummary(report, current = false) {
  assert(
    !current || report.evalsVersion === EVALS_VERSION,
    "Current report eval version is stale",
  );
  assert(
    report.evalsVersion === "5.3" || completeVersions.has(report.evalsVersion),
    `Unsupported report summary version: ${report.evalsVersion}`,
  );
  if (report.evalsVersion !== "5.3") return report.summary;
  const summary = structuredClone(report.summary);
  for (const counts of Object.values(summary))
    for (const status of ["not-applicable", "not-measured"])
      if (!Object.hasOwn(counts, status)) counts[status] = 0;
  return summary;
}
