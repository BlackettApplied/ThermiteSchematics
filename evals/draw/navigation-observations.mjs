import { repeatNavigation } from "./repeat-navigation.mjs";
import { mirrorReturns } from "./mirror-returns.mjs";
const repeatAudits = new WeakMap(),
  mirrorAudits = new WeakMap();

function repeatObservations(c, s, repeats, obs) {
  const out = [];
  if (
    repeats.measurements.some((m) => m.sheet === s.number) ||
    repeats.findings.some((f) => f.sheet === s.number)
  )
    out.push(
      obs(
        "DQ-07",
        repeats.findings.filter((f) => f.sheet === s.number),
        {
          id: `${c.id}/DQ-07/repeats-${s.number}`,
          evidence: {
            findings: repeats.findings.filter((f) => f.sheet === s.number),
            findingCount: repeats.findings.filter((f) => f.sheet === s.number)
              .length,
            measurements: repeats.measurements.filter(
              (m) => m.sheet === s.number,
            ),
            appearanceCount: repeats.appearanceCount,
            repeatCount: repeats.repeatCount,
          },
          scope:
            "M5 full repeats: native terminal membership and measured geometry; one label per device/view/sheet, measured targets, qualifier, locality and clearance. M2 mirror/return observations are separate.",
        },
      ),
    );
  return out;
}
function mirrorObservations(c, s, mirrors, obs) {
  const out = [];
  for (const [index, r] of mirrors.records
    .filter((r) => r.sheet === s.number)
    .entries()) {
    out.push(
      obs("DQ-07", r.findings, {
        id: `${c.id}/DQ-07/${r.kind === "coil" ? "mirror" : "return"}-${s.number}-${index}`,
        status: r.findings.length
          ? "fail"
          : r.assessment === "direct-actuation"
            ? "pass"
            : r.assessment === "outside-direct-actuation-scope"
              ? "not-applicable"
              : "manual",
        evidence: {
          findingCount: r.findings.length,
          findings: r.findings,
          measurements: r.measurements,
          source: { deviceUid: r.uid, functionKey: r.functionKey },
          view: r.view,
          assessment: r.assessment,
        },
        scope:
          "One full native coil/contact appearance; direct same-device actuation, authored state/terminals, all measured destinations or not drawn. Mirror locality uses visible ink and frames; reciprocal distance measured without a threshold.",
      }),
    );
  }
  if (mirrors.extra.some((f) => f.sheet === s.number))
    out.push(
      obs(
        "DQ-07",
        mirrors.extra.filter((f) => f.sheet === s.number),
        { id: `${c.id}/DQ-07/reconciliation-${s.number}` },
      ),
    );
  return out;
}
export function navigationObservations(
  c,
  s,
  packet,
  geometries,
  ir,
  request,
  obs,
) {
  if (!repeatAudits.has(packet))
    repeatAudits.set(packet, repeatNavigation(packet, geometries, ir, request));
  if (!mirrorAudits.has(packet))
    mirrorAudits.set(packet, mirrorReturns(packet, geometries, ir, request));
  const repeats = repeatAudits.get(packet),
    mirrors = mirrorAudits.get(packet),
    out = [
      ...repeatObservations(c, s, repeats, obs),
      ...mirrorObservations(c, s, mirrors, obs),
    ];
  // Absence is a packet-level native-audit result, not a missing-row fallback.
  // Any obligation, unmatched annotation or reconciliation finding prevents it.
  if (
    s.number === packet.sheets[0].number &&
    repeats.repeatCount === 0 &&
    repeats.measurements.length === 0 &&
    repeats.findings.length === 0 &&
    mirrors.records.length === 0 &&
    mirrors.extra.length === 0
  )
    out.push(
      obs("DQ-07", [], absenceObservation(c, repeats, mirrors, ir, packet)),
    );
  return out;
}

function absenceObservation(c, repeats, mirrors, ir, packet) {
  const nativeFunctions = {
    coils: (ir.functions ?? []).filter((f) => f.kind === "coil").length,
    contacts: (ir.functions ?? []).filter((f) => f.kind === "contact").length,
    actuates: (ir.internalRelations ?? []).filter((r) => r.verb === "actuates")
      .length,
  };
  const packetViewKinds = [
    ...new Set(
      packet.sheets
        .map((s) => s.view?.kind)
        .filter((k) => typeof k === "string"),
    ),
  ].sort();
  const reason =
    "Native packet audits found no full-repeat, coil-mirror or contact-return obligation, and no unmatched navigation annotation.";
  return {
    id: `${c.id}/DQ-07/not-applicable`,
    status: "not-applicable",
    reason:
      nativeFunctions.coils || nativeFunctions.contacts
        ? `${reason} Native source has ${nativeFunctions.coils} coils and ${nativeFunctions.contacts} contacts; no full coil/contact function bodies were measured in packet views: ${packetViewKinds.join(", ") || "unspecified"}.`
        : reason,
    evidence: {
      findingCount: 0,
      findings: [],
      repeatObligations: repeats.repeatCount,
      mirrorReturnAppearances: mirrors.records.length,
      nativeFunctions,
      packetViewKinds,
    },
  };
}
