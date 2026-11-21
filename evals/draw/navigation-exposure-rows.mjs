import { elementNavigationAudit } from "./element-navigation-oracle.mjs";
import { portNavigationAudit } from "./port-navigation-oracle.mjs";
export function navigationExposure(packet, geometries, ir, request) {
  const audits = [
    ["DQ-07", 396, elementNavigationAudit(packet, geometries, ir, request)],
    ["DQ-08", 398, portNavigationAudit(packet, geometries, ir, request)],
  ];
  return audits.flatMap(([dq, owner, a]) =>
    packet.sheets.map((s) => {
      const findings = a.findings.filter((f) => f.sheet === s.number),
        failures = a.failures.filter((f) => f.sheet === s.number),
        obligations = a.obligations.filter((o) => o.sheet === s.number);
      return {
        id: `CHECK5/${owner}/sheet-${s.number}`,
        dq,
        owner: `#${owner}`,
        sheet: s.number,
        strict: false,
        repinNow: false,
        medium: "svg",
        assessment: failures.length
          ? "infrastructure-error"
          : findings.length
            ? "fail"
            : obligations.length
              ? "pass"
              : "not-applicable",
        findings,
        failures,
        obligations,
      };
    }),
  );
}
