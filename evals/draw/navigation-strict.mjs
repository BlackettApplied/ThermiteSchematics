import { tranche4Observations } from "./tranche4-observations.mjs";
import { elementNavigationAudit } from "./element-navigation-oracle.mjs";
import { portNavigationAudit } from "./port-navigation-oracle.mjs";

// No row means no native obligation, finding OR measurement gap. It is never
// a passing measurement. The standalone exposure retains the explicit n/a row.
export function navigationStrictObservations(
  c,
  packet,
  geometries,
  ir,
  request,
  observation,
) {
  const audits = [
    [
      "element-navigation",
      "#396",
      elementNavigationAudit(packet, geometries, ir, request),
    ],
    [
      "port-navigation",
      "#398",
      portNavigationAudit(packet, geometries, ir, request),
    ],
  ];
  const rows = [];
  for (const [key, owner, audit] of audits)
    for (const sheet of packet.sheets) {
      const local = (xs) => xs.filter((x) => x.sheet === sheet.number),
        findings = local(audit.findings),
        failures = local(audit.failures),
        obligations = local(audit.obligations);
      const common = {
        owner,
        repinNow: false,
        scope:
          "Independent native selection and measured SVG ink only; HTML/PDF navigation is not independently certified.",
      };
      if (failures.length)
        rows.push(
          observation(c, sheet, "DQ-08", [], {
            ...common,
            id: `${c.id}/DQ-08/check6-${key}-measurement-${sheet.number}`,
            status: "infrastructure-error",
            instrumentation: "native-navigation",
            reason: failures.map((f) => f.kind).join("; "),
            evidence: { findingCount: 0, findings: [], failures, obligations },
          }),
        );
      // A measurement gap cannot turn another independently observed defect
      // into infrastructure, nor can it give the unmeasured obligation a pass.
      if (findings.length || (obligations.length && !failures.length))
        rows.push(
          observation(c, sheet, "DQ-08", findings, {
            ...common,
            id: `${c.id}/DQ-08/check6-${key}-${sheet.number}`,
            evidence: {
              findingCount: findings.length,
              findings,
              eligible: obligations.length,
              obligations,
              ...(findings.length
                ? {
                    svg: `${c.id}/sheet-${String(sheet.number).padStart(3, "0")}.svg`,
                  }
                : {}),
            },
          }),
        );
    }
  return rows;
}

export function packetSemanticObservations(...args) {
  return [
    ...tranche4Observations(...args),
    ...navigationStrictObservations(...args),
  ];
}
