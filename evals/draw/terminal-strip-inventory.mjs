// Compare measured strip labels with the linked native inventory, independently
// of the renderer's coverage fields and the oracle's incidence reconstruction.
const normalize = (s) => String(s).replace(/\s+/gu, "").replaceAll("->", "→");
export function stripInventoryEquality(table, ink) {
  const labels = [
    ...ink.incidences.map((i) => ({ at: i.at, text: i.text })),
    ...ink.bridgeLabels.map((i) => ({
      at: i.at,
      text: i.text.replace(/^B\d+\s/u, "").split("; continued on sheet ")[0],
    })),
  ];
  const rows = table.rows.map((row) => {
    const expected = row.cells
      .slice(4, 6)
      .filter((s) => !s.startsWith("No "))
      .flatMap((s) => s.split("; "))
      .map(normalize)
      .sort();
    const measured = labels
      .filter((i) => i.at === row.key)
      .map((i) => normalize(i.text))
      .sort();
    return {
      terminal: row.key,
      expected,
      measured,
      equal: JSON.stringify(expected) === JSON.stringify(measured),
    };
  });
  return {
    rows,
    findings: rows
      .filter((r) => !r.equal)
      .map((r) => ({ kind: "strip-inventory-incidence-mismatch", ...r })),
  };
}
