import {
  nativeConductors,
  terminalKey,
  finding,
  segmentOverlap,
  extent,
  pointDistance,
  inside,
} from "./tranche3-geometry.mjs";
import { physicalOracleGeometry } from "./tranche3-identities.mjs";
function sharedInk(a, b, g, ends) {
  const aa = g.tranche3?.routeInk?.[a.element],
    bb = g.tranche3?.routeInk?.[b.element];
  if (!aa?.length || !bb?.length) return null;
  const terminals = (g.terminals ?? []).filter((t) =>
    ends.some(
      (e) => e.deviceUid === t.deviceUid && e.terminalKey === t.terminal,
    ),
  );
  for (const x of aa)
    for (const y of bb) {
      const overlap = segmentOverlap(
        x,
        y,
        ((a.stroke ?? 0) + (b.stroke ?? 0)) / 2,
      );
      if (
        overlap &&
        !terminals.some(
          (t) => t.bbox && overlap.every((p) => inside(p, t.bbox)),
        )
      )
        return overlap;
    }
  return null;
}
function overlapFindings(routes, source, g) {
  const out = [];
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i],
        b = routes[j];
      if (a.wire === b.wire || a.appearanceScope !== b.appearanceScope)
        continue;
      const ends =
        source
          .get(a.wire)
          ?.filter(
            (e) =>
              e &&
              source
                .get(b.wire)
                ?.some((f) => terminalKey(e) === terminalKey(f)),
          ) ?? [];
      if (!ends.length) continue;
      const overlap = sharedInk(a, b, g, ends);
      if (overlap)
        out.push(
          finding(
            "native-conductors-share-landing-ink",
            { ...a, bbox: extent(overlap) },
            { wires: [a.wire, b.wire].sort(), commonTerminals: ends, overlap },
          ),
        );
    }
  return out;
}
function dotFindings(g, source) {
  const dots = new Map(
    [
      ...g.shapes.filter((s) => s.cls?.includes("junction-dot")),
      ...(g.tranche3?.circuitJunctions ?? []),
    ].map((dot) => [dot.element, dot]),
  );
  return [...dots.values()].flatMap((dot) => {
    const p = {
      x: dot.bbox.x + dot.bbox.w / 2,
      y: dot.bbox.y + dot.bbox.h / 2,
    };
    const nodes = (g.terminals ?? []).filter(
      (t) =>
        t.appearanceScope === dot.appearanceScope &&
        t.point &&
        pointDistance(t.point, p) <= 0.01,
    );
    const degree = Math.max(
      0,
      ...nodes.map((t) =>
        [...source.values()].reduce(
          (count, ends) =>
            count +
            (ends?.filter(
              (e) =>
                e &&
                e.deviceUid === t.deviceUid &&
                e.terminalKey === t.terminal,
            ).length ?? 0),
          0,
        ),
      ),
    );
    return degree >= 3
      ? []
      : [
          finding("junction-dot-without-native-node", dot, {
            nativeDegree: degree,
            point: p,
          }),
        ];
  });
}
export function physicalLandingAudit(input, ir) {
  const g = physicalOracleGeometry(input, ir);
  const routes = g.shapes.filter((s) => s.conductor),
    source = nativeConductors(ir),
    out = [];
  for (const r of routes) {
    if (!r.wire) {
      if (
        r.edgeOwnerKey?.[0] !== "net" ||
        !ir.nets?.some((n) => n.id === r.edgeOwnerKey[1])
      )
        out.push(
          finding("physical-conductor-native-owner-unavailable", r, {
            reason: "Anonymous or unresolved route identity",
          }),
        );
      continue;
    }
    if (!source.has(r.wire) || r.identityConflict) {
      out.push(
        finding("physical-conductor-native-owner-unavailable", r, {
          wire: r.wire,
        }),
      );
      continue;
    }
    if (
      JSON.stringify((r.endpoints ?? []).map(terminalKey).sort()) !==
      JSON.stringify(source.get(r.wire).map(terminalKey).sort())
    )
      out.push(
        finding("physical-conductor-native-ends-disagree", r, {
          wire: r.wire,
          nativeEnds: source.get(r.wire),
          declaredEnds: r.endpoints,
        }),
      );
    if (!g.tranche3?.routeInk?.[r.element]?.length)
      out.push(
        finding("physical-landing-ink-unavailable", r, { wire: r.wire }),
      );
  }
  const physical = routes.filter((r) => source.has(r.wire));
  out.push(...overlapFindings(physical, source, g));
  if (physical.length) out.push(...dotFindings(g, source));
  return {
    findings: out,
    eligible: physical.length,
    unresolved: routes.length - physical.length,
  };
}
