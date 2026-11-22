import { partIdentityFindings } from "./native-part-identities.mjs";
import { nativeConductors4 } from "./tranche4-source.mjs";
import { finding } from "./review-geometry.mjs";
import { circuitParts } from "./native-circuit-parts.mjs";
import { communicationParts } from "./native-communication-parts.mjs";
export { inView } from "./tranche4-views.mjs";
export { selectedCircuit } from "./native-circuit-parts.mjs";
export function nativePartPopulation(packet, geometries, ir, request) {
  if (
    !Array.isArray(request?.views) ||
    ![
      "relations",
      "wires",
      "jumpers",
      "cables",
      "cableConductors",
      "devices",
      "deviceTypes",
      "terminals",
      "functions",
    ].every((k) => Array.isArray(ir?.[k])) ||
    geometries.length !== packet.sheets.length ||
    geometries.some(
      (g) =>
        !Array.isArray(g?.texts) || !Array.isArray(g?.shapes) || !g.tranche4,
    )
  )
    return {
      parts: [],
      findings: [
        {
          ...finding("native-part-source-unavailable"),
          sheet: packet.sheets[0]?.number,
        },
      ],
    };
  const findings = [];
  let catalog;
  try {
    catalog = nativeConductors4(ir);
  } catch (e) {
    return {
      parts: [],
      findings: [
        {
          ...finding(
            "native-part-source-unavailable",
            {},
            { reason: e.message },
          ),
          sheet: packet.sheets[0].number,
        },
      ],
    };
  }
  const parts = [
    ...circuitParts(packet, geometries, request, ir, catalog, findings),
    ...communicationParts(packet, geometries, request, ir, findings),
  ];
  findings.push(...partIdentityFindings(parts));
  return { parts, findings };
}
