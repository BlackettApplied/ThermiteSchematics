import { groupBy, finding } from "./review-geometry.mjs";
export function partIdentityFindings(parts) {
  const findings = [];
  for (const ps of groupBy(parts, (p) =>
    JSON.stringify([p.kind, p.view, p.group]),
  ).values()) {
    const totals = [...new Set(ps.map((p) => p.total))],
      n = totals[0];
    if (
      totals.length !== 1 ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > 100 ||
      ps.length !== n ||
      ps
        .map((p) => p.part)
        .sort((a, b) => a - b)
        .some((part, i) => part !== i + 1)
    )
      findings.push({
        ...finding(
          "native-part-population-identity-disagrees",
          {},
          {
            partKind: ps[0].kind,
            view: ps[0].view,
            group: ps[0].group,
            totals,
            parts: ps.map((p) => p.part),
          },
        ),
        sheet: ps[0].sheet,
      });
  }
  return findings;
}
