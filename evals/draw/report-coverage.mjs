import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";

export function requireCheckCoverage(report, specs) {
  for (const c of report.cases)
    for (let n = 1; n <= 24; n++) {
      const spec = specs.find((s) => s.id === c);
      const partner =
        n === 11 && spec.sweep
          ? specs.find(
              (s) => s.flow === "top-to-bottom" && equal(s.sweep, spec.sweep),
            )
          : undefined;
      assert(
        report.results.some(
          (r) =>
            !r.expectation &&
            (r.case === c ||
              (partner && r.id === `${partner.id}/DQ-11/flow-comparison`)) &&
            r.dq === `DQ-${String(n).padStart(2, "0")}`,
        ),
        `Missing check observation: ${c}/DQ-${n}`,
      );
    }
}
