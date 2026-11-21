import { routeQuality, routePoints, strokesAndDots } from "./checks.mjs";
import { finding, pointDistance } from "./review-geometry.mjs";
export function electricalLoopRoutes(g, ir) {
  return g.shapes
    .filter(
      (s) =>
        (s.loopConductor || s.loopCandidate) &&
        s.stroke > 0 &&
        (!s.shapeTag || ["path", "line", "polyline"].includes(s.shapeTag)),
    )
    .map((s) => {
      const sameEnds = (w) =>
        JSON.stringify(
          w.endpoints
            ?.map((e) => e.terminal)
            .map((t) => JSON.stringify([t.deviceUid, t.terminalKey]))
            .sort(),
        ) ===
        JSON.stringify(
          s.terminalEnds
            ?.map((t) => JSON.stringify([t.deviceUid, t.terminalKey]))
            .sort(),
        );
      const candidates = [...(ir.wires ?? []), ...(ir.jumpers ?? [])].filter(
        (w) => (s.loopConductor ? w.uid === s.loopConductor : sameEnds(w)),
      );
      const native =
        candidates.length === 1 && (!s.terminalEnds || sameEnds(candidates[0]))
          ? candidates[0]
          : undefined;
      const core = ir.cableConductors?.find(
        (c) =>
          JSON.stringify(c.id) === s.loopConductor ||
          `${c.id.cableUid}/${c.id.conductorId}` === s.loopConductor,
      );
      return { ...s, conductor: true, native: native ?? core };
    });
}
export function loopRouteFindings(g, ir) {
  const routes = electricalLoopRoutes(g, ir);
  return [
    ...routes
      .filter((s) => !s.native)
      .map((s) =>
        finding("loop-conductor-source-unresolved", s, {
          conductor: s.loopConductor,
        }),
      ),
    ...routeQuality({ ...g, shapes: routes }),
  ];
}
function attachmentOwner(s, ir) {
  try {
    const [uid, key] = JSON.parse(s.attachment);
    return ir.terminals?.find(
      (t) => t.id.deviceUid === uid && t.id.terminalKey === key,
    )?.id;
  } catch {
    return undefined;
  }
}
export function attachmentAudit(g, ir) {
  const findings = [],
    unassessed = [];
  const rays = g.shapes.filter(
    (s) =>
      (s.attachment || s.attachmentCandidate) &&
      s.stroke > 0 &&
      s.inkSegments?.length,
  );
  const routes = [
    ...g.shapes.filter((s) => s.conductor),
    ...electricalLoopRoutes(g, ir),
  ];
  for (const ray of rays) {
    const owner = attachmentOwner(ray, ir),
      points = routePoints(ray);
    if (!owner || !points?.length) {
      findings.push(
        finding("attachment-owner-unresolved", ray, {
          attachment: ray.attachment,
        }),
      );
      continue;
    }
    const touching = routes.filter((s) =>
      (s.ownedLandings ?? []).some(
        (l) =>
          (l.appearanceScope ?? s.appearanceScope) === ray.appearanceScope &&
          l.endpoint &&
          points.some((p) => pointDistance(p, l.endpoint) <= 0.01),
      ),
    );
    if (
      touching.length &&
      !touching.some((s) =>
        (s.ownedLandings ?? []).some(
          (l) =>
            l.deviceUid === owner.deviceUid && l.terminal === owner.terminalKey,
        ),
      )
    )
      findings.push(
        finding("attachment-owner-geometry-mismatch", ray, {
          attachment: owner,
          conductors: touching.map((s) => s.element),
        }),
      );
    const incident = routes.filter((s) =>
      (s.ownedLandings ?? []).some(
        (l) =>
          l.deviceUid === owner.deviceUid &&
          l.terminal === owner.terminalKey &&
          (l.appearanceScope ?? s.appearanceScope) === ray.appearanceScope &&
          l.endpoint &&
          points.some((p) => pointDistance(p, l.endpoint) <= 0.01),
      ),
    );
    if (!incident.length) {
      unassessed.push({
        element: ray.element,
        owner,
        reason: "no-selected-incident-conductor",
      });
      continue;
    }
    const min = Math.min(...incident.map((s) => s.stroke));
    if (ray.stroke > min + 0.01)
      findings.push(
        finding("attachment-heavier-than-incident-conductor", ray, {
          attachment: owner,
          rayMm: ray.stroke,
          incidentMm: min,
          conductors: incident.map((s) => s.element),
        }),
      );
  }
  return { findings, unassessed, rayCount: rays.length };
}
export function strokesIncludingAttachments(g) {
  // Attachment paths are electrical ink. They contribute geometric rays at
  // terminal dots, but their non-electrical white knockout strokes never do.
  return strokesAndDots({
    ...g,
    shapes: g.shapes.map((s) =>
      s.attachment && s.inkSegments?.length ? { ...s, conductor: true } : s,
    ),
  });
}
export function routePatternMeasurements(g) {
  return g.shapes
    .filter(
      (s) =>
        (s.conductor || s.loopConductor || s.loopCandidate) &&
        s.stroke > 0 &&
        (!s.shapeTag || ["path", "line", "polyline"].includes(s.shapeTag)),
    )
    .flatMap((s) => {
      const p = routePoints(s);
      if (!p || p.length < 3) return [];
      const length = p
          .slice(1)
          .reduce((n, q, i) => n + pointDistance(p[i], q), 0),
        manhattan =
          Math.abs(p[0].x - p.at(-1).x) + Math.abs(p[0].y - p.at(-1).y);
      return length > manhattan + 0.01
        ? [
            {
              element: s.element,
              lengthMm: length,
              manhattanMm: manhattan,
              excessMm: length - manhattan,
              bends: p.length - 2,
              assessment: "manual-feasible-alternative-required",
            },
          ]
        : [];
    });
}
