import { finding } from "./review-geometry.mjs";
export function inventoryScopeProse(g, heading, ids) {
  const notes = new Map();
  for (const t of g.texts.filter(
    (t) =>
      t.reportNote != null &&
      ids.has(t.documentId) &&
      t.painted !== false &&
      t.reviewPainted !== false,
  )) {
    const key = JSON.stringify([t.documentId, t.reportNote]);
    notes.set(key, [...(notes.get(key) ?? []), t.text]);
  }
  return [heading.text, ...[...notes.values()].map((ts) => ts.join(" "))];
}
const units = "cable[- ]cores?|conductors?|jumpers?|wires?|rows?|endpoints?";
function completeScopeFindings(prose, retained, source, heading, qualified) {
  if (
    !source.length ||
    retained.length !== source.length ||
    !prose.some(qualified)
  )
    return [];
  const scope = prose.filter(qualified).join(" ");
  return /\b(?:partial|subset)\b/i.test(scope) ||
    !new RegExp(
      "\\ball\\s+\\d+(?:,\\d{3})*\\s+(?:native\\s+)?(?:" + units + ")\\b",
      "i",
    ).test(scope)
    ? [
        finding("complete-wire-inventory-scope-misdescribed", heading, {
          scope,
          nativeRows: source.length,
        }),
      ]
    : [];
}
function quantity(rows, unit) {
  const kind = unit.toLowerCase().replace(/[- ]/g, "").replace(/s$/, "");
  if (kind === "endpoint")
    return rows.reduce((n, r) => n + (r.ends ?? []).filter(Boolean).length, 0);
  if (["row", "conductor"].includes(kind)) return rows.length;
  return rows.filter(
    (r) =>
      r.element.kind ===
      { wire: "wire", jumper: "jumper", cablecore: "cable_conductor" }[kind],
  ).length;
}
export function inventoryCountFindings(
  prose,
  rows,
  source,
  heading,
  qualified,
) {
  const retained = source.filter((s) => rows.some((r) => r.key === s.key)),
    out = completeScopeFindings(prose, retained, source, heading, qualified);
  for (const line of prose.filter((s, i) => i === 0 || qualified(s))) {
    const fractions = [
      ...line.matchAll(
        new RegExp(
          "(\\d+(?:,\\d{3})*)\\s+of\\s+(\\d+(?:,\\d{3})*)\\s+(?:source\\s+)?(" +
            units +
            ")\\b",
          "gi",
        ),
      ),
    ];
    for (const m of fractions) {
      const actual = [
          Number(m[1].replaceAll(",", "")),
          Number(m[2].replaceAll(",", "")),
        ],
        expected = [quantity(retained, m[3]), quantity(source, m[3])];
      if (actual.some((v, i) => v !== expected[i]))
        out.push(
          finding("wire-inventory-scope-count-disagrees", heading, {
            printed: m[0],
            actual,
            expected,
          }),
        );
    }
    const singles = [
      ...line.matchAll(
        new RegExp("(\\d+(?:,\\d{3})*)\\s+(" + units + ")\\b", "gi"),
      ),
    ];
    for (const m of singles) {
      if (
        fractions.some(
          (f) => m.index >= f.index && m.index < f.index + f[0].length,
        )
      )
        continue;
      const omitted = /^\s+(?:omitted|not included)\b/i.test(
        line.slice(m.index + m[0].length),
      );
      const expected = omitted
        ? quantity(source, m[2]) - quantity(retained, m[2])
        : quantity(retained, m[2]);
      const actual = Number(m[1].replaceAll(",", ""));
      if (actual !== expected)
        out.push(
          finding("wire-inventory-scope-count-disagrees", heading, {
            printed: m[0],
            actual,
            expected,
            omitted,
          }),
        );
    }
  }
  return out;
}
