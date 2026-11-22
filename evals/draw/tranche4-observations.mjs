import { conductorIdentityAudit } from "./conductor-identity-oracle.mjs";
import { nativePartAudit } from "./native-part-references.mjs";
import { junctionRayAudit } from "./junction-rays-oracle.mjs";
import { finalIndexAudit } from "./final-index-oracle.mjs";
import { assemblyNoteAudit } from "./assembly-note-oracle.mjs";
import { issuedRows } from "./m3-documents.mjs";
function auditRow(c, s, dq, key, mechanism, a, observation) {
  return observation(c, s, dq, a.findings, {
    id: `${c.id}/${dq}/check3c3-${key}-${s.number}`,
    mechanism,
    scope: "SVG semantic check only; does not independently certify HTML/PDF.",
    ...(!a.findings.length && !a.eligible ? { status: "not-applicable" } : {}),
    evidence: {
      findingCount: a.findings.length,
      findings: a.findings,
      eligible: a.eligible,
      ...(a.findings.length && ["N14", "N17"].includes(mechanism)
        ? {
            summary:
              mechanism === "N14"
                ? `Filled marker requires three native incident directions; ${a.findings.length} finding(s). Unattributed paint is excluded.`
                : `Assembly notes have ${a.findings.length} unresolved native delivery finding(s): ${a.findings[0].designation}`,
          }
        : {}),
      ...(a.findings.length
        ? { svg: `${c.id}/sheet-${String(s.number).padStart(3, "0")}.svg` }
        : {}),
      ...(a.measurement ? { measurement: a.measurement } : {}),
    },
  });
}
function sheetAudit(a, s, eligible) {
  return {
    ...a,
    findings: a.findings.filter((f) => f.sheet === s.number),
    eligible,
  };
}
function feasibilityRow(c, s, parts, observation) {
  const witnesses = parts.feasibility.filter((p) => p.sheet === s.number);
  if (witnesses.length)
    return observation(c, s, "DQ-12", [], {
      id: `${c.id}/DQ-12/check3c3-native-part-feasibility-${s.number}`,
      mechanism: "N11",
      status: "manual",
      reason:
        "No approved packing threshold establishes a same-paper feasible alternative without an independently rendered witness.",
      evidence: { findingCount: 0, findings: [], witnesses },
    });
}
export function tranche4Observations(
  c,
  packet,
  geometries,
  ir,
  request,
  observation,
) {
  const rows = issuedRows(packet, geometries),
    out = [];
  const parts = nativePartAudit(packet, geometries, ir, request);
  const index = finalIndexAudit(packet, geometries, request);
  const assembly = assemblyNoteAudit(packet, geometries, ir, request);
  for (const [i, s] of packet.sheets.entries()) {
    const g = geometries[i],
      identity = conductorIdentityAudit(s, g, ir, rows);
    const ownParts = parts.parts.filter((p) => p.sheet === s.number);
    const off = (f) => ["card", "continuation"].includes(f.surface);
    const audits = [
      [
        "DQ-08",
        "conductor-aliases",
        "N8",
        {
          findings: identity.findings.filter((f) => off(f) || !f.surface),
          eligible: identity.offpageEligible,
        },
      ],
      [
        "DQ-24",
        "conductor-aliases",
        "N8",
        {
          findings: identity.findings.filter((f) => !off(f)),
          eligible: identity.localEligible,
        },
      ],
      [
        "DQ-08",
        "native-part-references",
        "N11",
        sheetAudit(parts, s, ownParts.length),
      ],
      ["DQ-13", "native-junction-rays", "N14", junctionRayAudit(g, ir)],
      [
        "DQ-19",
        "assembly-notes",
        "N17",
        sheetAudit(
          assembly,
          s,
          s.view.kind === "connector-assembly" ? assembly.eligible : 0,
        ),
      ],
    ];
    for (const [dq, key, mechanism, a] of audits)
      out.push(auditRow(c, s, dq, key, mechanism, a, observation));
    if (s.number === index.sheet)
      out.push(
        auditRow(c, s, "DQ-19", "final-index", "N15", index, observation),
      );
    const manual = feasibilityRow(c, s, parts, observation);
    if (manual) out.push(manual);
  }
  return out;
}
