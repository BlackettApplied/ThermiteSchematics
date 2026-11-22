import { inventoryScopeAudit } from "./inventory-scope.mjs";
import { pdfOracleTexts } from "./tranche3-media.mjs";
export function inventoryMediaObservations(
  c,
  packet,
  geometries,
  ir,
  observation,
) {
  const out = [];
  for (const medium of ["html", "pdf"]) {
    const missing = new Map();
    const measured = geometries.map((g, i) => {
      if (packet.sheets[i].view.kind !== "wires") return g;
      if (medium === "html")
        return {
          ...g,
          ...(g.tranche3?.htmlGeometry ?? { texts: [], reportCells: [] }),
        };
      const projected = pdfOracleTexts(
        { ...g, pdfTexts: g.tranche3?.pdfTexts ?? [] },
        () => true,
      );
      missing.set(i, projected.missing);
      return { ...g, texts: projected.texts };
    });
    for (const [i, s] of packet.sheets.entries()) {
      if (s.view.kind !== "wires") continue;
      const a = inventoryScopeAudit(s, packet, measured, ir),
        findings = [...a.findings, ...(missing.get(i) ?? [])].map((f) => ({
          ...f,
          medium,
        }));
      out.push(
        observation(c, s, "DQ-19", findings, {
          id: `${c.id}/DQ-19/check3-inventory-scope-${medium}-${s.number}`,
          medium,
          mechanism: "N12",
        }),
      );
    }
  }
  return out;
}
