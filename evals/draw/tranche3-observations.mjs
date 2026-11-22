import { physicalLandingAudit } from "./physical-landings.mjs";
import { wireLabelSupportAudit } from "./wire-label-support.mjs";
import { contactCaptionMediaAudit } from "./contact-role-media.mjs";
import { conversionQualifierAudit } from "./qualifier-oracle.mjs";
import { inventoryScopeAudit } from "./inventory-scope.mjs";
export function tranche3Observations(
  c,
  s,
  packet,
  g,
  ir,
  geometries,
  observation,
) {
  const audits = [
    ["DQ-14", "native-landings", "N3", physicalLandingAudit(g, ir)],
    ["DQ-16", "label-support", "N4", wireLabelSupportAudit(g, ir)],
    ["DQ-04", "contact-role", "N5", contactCaptionMediaAudit(g, ir)],
    [
      "DQ-10",
      "conversion-qualifiers",
      "N6",
      conversionQualifierAudit(g, ir, s),
    ],
    [
      "DQ-19",
      "inventory-scope",
      "N12",
      inventoryScopeAudit(s, packet, geometries, ir),
    ],
  ];
  return audits.map(([dq, key, mechanism, a]) =>
    observation(c, s, dq, a.findings, {
      id: `${c.id}/${dq}/check3-${key}-${s.number}`,
      mechanism,
      ...(a.findings.length
        ? {}
        : a.manual
          ? {
              status: "manual",
              reason:
                "No approved label attachment convention distinguishes all legitimate short vertical labels from the reported long-label ambiguity; support witnesses are not a strict threshold.",
            }
          : a.unresolved
            ? {
                status: "not-implemented",
                reason:
                  "Net-level route identities do not establish separate physical conductors.",
              }
            : a.eligible
              ? {}
              : { status: "not-applicable" }),
      ...(a.unresolved ? { unresolvedNativeRoutes: a.unresolved } : {}),
      evidence: {
        findingCount: a.findings.length,
        findings: a.findings,
        eligible: a.eligible,
        ...(a.reviewCandidates ? { reviewCandidates: a.reviewCandidates } : {}),
      },
      scope:
        "CHECK3 C1: independent native identity and painted geometry; renderer success flags are not evidence.",
    }),
  );
}
