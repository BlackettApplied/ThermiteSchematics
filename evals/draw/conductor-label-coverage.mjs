import {
  wirePlacement,
  wirePlacementCoverage,
  routePoints,
} from "./checks.mjs";
import {
  connectorRows,
  printedConductor,
  identityMatches,
} from "./continuation-labels.mjs";
import { finding, painted, pointDistance } from "./review-geometry.mjs";
const viewKey = (s) => JSON.stringify(s.view);
const routeIdentity = (s, ir) =>
  printedConductor(
    {
      conductor: s.wire,
      sourceElement:
        s.edgeOwnerKey?.[0] === "wire"
          ? { kind: "wire", uid: s.edgeOwnerKey[1] }
          : undefined,
    },
    ir,
  );
export function conductorLabelCoverage(sheet, packet, g, geometries, ir) {
  const previous = wirePlacementCoverage(g);
  if (!previous.status) return { findings: [], extra: {} };
  if (previous.reasonCode === "label-identity-unavailable")
    return { findings: [], extra: previous };
  const findings = [],
    measurements = [];
  const peers = packet.sheets.flatMap((s, i) =>
    viewKey(s) === viewKey(sheet)
      ? [
          {
            sheet: s,
            g: (s.number === sheet.number ? g : geometries[i]) ?? {
              texts: [],
              shapes: [],
            },
          },
        ]
      : [],
  );
  const named = new Set();
  for (const { sheet: s, g: q } of peers) {
    for (const t of q.texts.filter((t) => t.wire && painted(t))) {
      const r = q.shapes.filter((r) => r.conductor && r.wire === t.wire);
      if (r.length && !wirePlacement({ ...q, texts: [t] }).length) {
        const source = printedConductor({ conductor: t.wire }, ir);
        if (source && (t.text === source.text || t.text === source.uid))
          named.add(source.uid ?? source.text);
      }
    }
    const occurrences = new Map();
    for (const c of s.continuations ?? []) {
      const key = JSON.stringify([c.id, c.toSheet]),
        occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const { source, rows } = connectorRows(
          { ...q, texts: q.texts.filter(painted) },
          c,
          occurrence,
        ),
        native = printedConductor(c, ir);
      const peer = packet.sheets.find((p) => p.number === c.toSheet);
      if (
        source &&
        identityMatches(rows, c, native) &&
        q.shapes.some((r) => {
          const identity = routeIdentity(r, ir),
            points = routePoints(r);
          return (
            r.conductor &&
            identity &&
            (identity.uid ?? identity.text) === (native.uid ?? native.text) &&
            source.anchor &&
            points?.length &&
            [points[0], points.at(-1)].some(
              (p) => pointDistance(p, source.anchor) <= 0.01,
            )
          );
        }) &&
        peer?.continuations?.some(
          (p) =>
            p !== c &&
            p.id === c.id &&
            p.toSheet === s.number &&
            p.conductor === c.conductor,
        )
      )
        named.add(native.uid ?? native.text);
    }
  }
  for (const route of g.shapes.filter((s) => s.conductor)) {
    const native = routeIdentity(route, ir);
    if (!native) {
      findings.push(
        finding("conductor-label-source-unresolved", route, {
          wire: route.wire,
          edgeOwnerKey: route.edgeOwnerKey,
        }),
      );
      continue;
    }
    const isNamed = named.has(native.uid ?? native.text);
    if (!isNamed)
      findings.push(
        finding("conductor-fragment-without-visible-identity", route, {
          conductor: native.text,
          reason: "no-owned-visible-label-in-logical-view",
        }),
      );
    measurements.push({
      element: route.element,
      conductor: native.text,
      visibleIdentityInView: isNamed,
    });
  }
  return {
    findings,
    extra: {
      scope:
        "Label-free fragments: native conductor identity must be visibly and verifiably labelled on a continuation or another fragment of this same logical view.",
      evidence: { findingCount: findings.length, findings, measurements },
    },
  };
}
