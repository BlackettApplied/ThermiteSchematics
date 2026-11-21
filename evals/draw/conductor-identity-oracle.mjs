import {
  nativeConductors4,
  identityValue,
  sameEnds,
  elementKey,
} from "./tranche4-source.mjs";
import { physicalOracleGeometry } from "./tranche3-identities.mjs";
import {
  connectorRows,
  referenceHeader,
  referenceRow,
} from "./continuation-labels.mjs";
import { finding, painted, groupBy } from "./review-geometry.mjs";
import { cardIdentityFindings } from "./conductor-cards-oracle.mjs";
function labelFindings(g, catalog) {
  const groups = groupBy(
    g.texts.filter(
      (t) =>
        t.wire &&
        !t.row &&
        !t.continuationLink &&
        t.labelRole !== "net" &&
        painted(t),
    ),
    (t) =>
      JSON.stringify([t.wire, t.wireBlock ?? t.textContainer ?? t.element]),
  );
  const findings = [];
  for (const ts of groups.values()) {
    const w = catalog.get(ts[0].wire),
      routes = g.shapes.filter((s) => s.conductor && s.wire === ts[0].wire);
    if (
      !w ||
      w.physical === false ||
      ts.some((t) => t.identityConflict) ||
      !routes.length ||
      routes.some(
        (r) =>
          r.identityConflict ||
          !sameEnds(r.endpoints, w.ends) ||
          !g.tranche3?.routeInk?.[r.element]?.length,
      )
    ) {
      findings.push(
        finding("conductor-label-native-owner-unavailable", ts[0], {
          conductor: ts[0].wire,
        }),
      );
      continue;
    }
    let prefix = "";
    const matched = ts
      .slice()
      .sort((a, b) => a.order - b.order)
      .some((t) => {
        prefix += t.text;
        return identityValue(prefix, w);
      });
    if (!matched)
      findings.push(
        finding("conductor-label-primary-identity-disagrees", ts[0], {
          conductor: w.key,
          actual: ts.map((t) => t.text).join(" "),
          primary: w.primary,
        }),
      );
  }
  return { findings, count: groups.size };
}
function continuationFindings(sheet, g, catalog) {
  const findings = [];
  for (const c of sheet.continuations ?? []) {
    const w = catalog.get(elementKey(c.provenance ?? c.sourceElement));
    const { source, rows } = connectorRows(g, c, 0),
      ref = referenceRow(rows, c.id),
      header = ref && referenceHeader(ref, c.id);
    const text = rows.map((t) => (t === ref ? header?.body : t.text)).join("");
    if (!w || !source || !header || !identityValue(text, w))
      findings.push(
        finding("conductor-continuation-native-identity-disagrees", rows[0], {
          conductor: w?.key ?? c.conductor,
          id: c.id,
          actual: text,
          primary: w?.primary,
        }),
      );
  }
  return findings;
}
export function conductorIdentityAudit(sheet, input, ir, rows = []) {
  if (
    !Array.isArray(input?.texts) ||
    !Array.isArray(input?.shapes) ||
    !Array.isArray(input?.tranche4?.cards)
  )
    return {
      eligible: 1,
      findings: [finding("conductor-measurement-unavailable")],
    };
  const g = physicalOracleGeometry(input, ir),
    findings = [];
  let catalog;
  try {
    catalog = nativeConductors4(ir);
  } catch (e) {
    return {
      eligible: 1,
      findings: [
        finding("conductor-native-data-unavailable", {}, { reason: e.message }),
      ],
    };
  }
  const labels = labelFindings(g, catalog);
  findings.push(...labels.findings.map((f) => ({ ...f, surface: "stroke" })));
  const cards = g.tranche4?.cards ?? [];
  for (const card of cards)
    findings.push(...cardIdentityFindings(card, catalog, ir));
  findings.push(
    ...continuationFindings(sheet, g, catalog).map((f) => ({
      ...f,
      surface: "continuation",
    })),
  );
  const inventory = rows.filter(
    (r) => r.sheet === sheet.number && r.kind === "wires",
  );
  for (const r of inventory) {
    const w = catalog.get(r.key);
    if (!w || !r.visible || !identityValue(r.cells[0], w))
      findings.push(
        finding("conductor-inventory-native-identity-disagrees", r.texts[0], {
          conductor: r.key,
          actual: r.cells[0],
          primary: w?.primary,
          surface: "inventory",
        }),
      );
  }
  return {
    findings,
    offpageEligible: cards.length + (sheet.continuations?.length ?? 0),
    localEligible: labels.count + inventory.length,
    eligible:
      labels.count +
      cards.length +
      (sheet.continuations?.length ?? 0) +
      inventory.length,
  };
}
