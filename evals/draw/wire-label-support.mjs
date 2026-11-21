import {
  distance,
  routePoints,
  segments,
  finding,
  painted,
  extent,
  inside,
  nativeConductors,
  terminalKey,
} from "./tranche3-geometry.mjs";
const EPSILON = 0.17; // Existing calibrated print-ink uncertainty, not a new clearance.
import {
  physicalOracleGeometry,
  conductorIdentity,
} from "./tranche3-identities.mjs";
import { nativeLabelIdentity } from "./wire-label-source.mjs";
import { wireLabelMaskFinding } from "./wire-label-mask.mjs";
function supportSegments(s, g, inline) {
  return inline
    ? segments(routePoints(s))
    : (g.tranche3?.routeInk?.[s.element] ?? []);
}
function inlinePlate(texts, routes) {
  return texts.some(
    (t) =>
      t.plate &&
      texts.every(
        (q) =>
          inside(q.bbox, t.plate.bbox) &&
          inside(
            { x: q.bbox.x + q.bbox.w, y: q.bbox.y + q.bbox.h },
            t.plate.bbox,
          ),
      ) &&
      routes.some((r) =>
        segments(routePoints(r)).some(
          ([a, b]) =>
            distance(
              {
                x: t.plate.bbox.x + t.plate.bbox.w / 2,
                y: t.plate.bbox.y + t.plate.bbox.h / 2,
              },
              a,
              b,
            ) <
            (r.stroke ?? 0) / 2 + 0.01,
        ),
      ),
  );
}
function leaderOwns(texts, own, g) {
  const box = extent(
    texts.flatMap((t) => [
      t.bbox,
      { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
    ]),
  );
  return (g.tranche3?.leaders ?? []).some((l) => {
    if (conductorIdentity(l.wire) !== texts[0].wire || !l.segments?.length)
      return false;
    if (
      l.segments.some(
        ([a], i) =>
          i > 0 &&
          Math.hypot(
            a.x - l.segments[i - 1][1].x,
            a.y - l.segments[i - 1][1].y,
          ) > 0.01,
      )
    )
      return false;
    const a = l.segments[0][0],
      b = l.segments.at(-1)[1];
    const near = (p) =>
      Math.hypot(
        Math.max(box.x - p.x, 0, p.x - box.x - box.w),
        Math.max(box.y - p.y, 0, p.y - box.y - box.h),
      ) <= EPSILON;
    const lands = (p) =>
      own.some((r) =>
        (g.tranche3?.routeInk?.[r.element] ?? []).some(
          (s) => distance(p, ...s) <= EPSILON,
        ),
      );
    return (near(a) && lands(b)) || (near(b) && lands(a));
  });
}
function supportFinding(texts, g, routes) {
  const t = texts[0],
    own = routes.filter((r) => r.wire === t.wire);
  if (
    !own.length ||
    own.some((r) => !g.tranche3?.routeInk?.[r.element]?.length)
  )
    return finding("wire-label-support-unavailable", t, {
      wire: t.wire,
      reason: "Missing owned painted route",
    });
  const box = extent(
    texts.flatMap((t) => [
      t.bbox,
      { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
    ]),
  );
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    inline = inlinePlate(texts, own);
  const measure = (r) =>
    Math.min(
      ...supportSegments(r, g, inline && r.wire === t.wire).map((s) =>
        Math.max(0, distance(center, ...s) - (r.stroke ?? 0) / 2),
      ),
    );
  const ownDistance = Math.min(...own.map(measure)),
    other = Math.min(...routes.filter((r) => r.wire !== t.wire).map(measure));
  if (!Number.isFinite(ownDistance))
    return finding("wire-label-support-unavailable", t, { wire: t.wire });
  if (other + EPSILON < ownDistance && !leaderOwns(texts, own, g))
    return finding(
      "wire-label-support-ambiguous",
      { ...t, bbox: box },
      {
        wire: t.wire,
        text: texts.map((t) => t.text).join(" "),
        center,
        ownSupportMm: ownDistance,
        competingSupportMm: other,
        epsilonMm: EPSILON,
      },
    );
}
export function wireLabelSupportAudit(input, ir) {
  const g = physicalOracleGeometry(input, ir);
  const groups = new Map(),
    maskRoutes = g.shapes.filter((s) => s.conductor),
    routes = maskRoutes.filter((s) => s.wire);
  for (const t of g.texts.filter(
    (t) => t.wire && t.labelRole !== "net" && painted(t),
  )) {
    const key = JSON.stringify([
      t.wire,
      t.wireBlock ?? t.textContainer ?? t.element,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const source = nativeConductors(ir),
    findings = [],
    reviewCandidates = [];
  for (const ts of groups.values()) {
    const own = routes.filter((r) => r.wire === ts[0].wire),
      ends = source.get(ts[0].wire);
    const nativeOwner =
      !!ends &&
      !ts.some((t) => t.identityConflict) &&
      nativeLabelIdentity(ts, ir) &&
      own.every(
        (r) =>
          !r.identityConflict &&
          JSON.stringify((r.endpoints ?? []).map(terminalKey).sort()) ===
            JSON.stringify(ends.map(terminalKey).sort()),
      );
    const mask = wireLabelMaskFinding(ts, g, maskRoutes, nativeOwner);
    if (mask) findings.push(mask);
    if (!nativeOwner)
      findings.push(
        finding("wire-label-native-owner-unavailable", ts[0], {
          wire: ts[0].wire,
        }),
      );
    else {
      const f = supportFinding(ts, g, routes);
      if (f?.kind === "wire-label-support-ambiguous")
        reviewCandidates.push({ ...f, kind: "wire-label-support-review" });
      else if (f) findings.push(f);
    }
  }
  for (const t of g.texts.filter(
    (t) =>
      painted(t) && !t.wire && (t.wireBlock || t.labelRole === "conductor"),
  ))
    findings.push(
      finding("wire-label-native-owner-unavailable", t, {
        reason: "Printed conductor label has no native identity",
      }),
    );
  return {
    findings,
    reviewCandidates,
    manual: groups.size > 0,
    eligible: groups.size,
  };
}
