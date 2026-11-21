// Native SVG geometry, never renderer label planners or sourcePortId helpers.
import { pointDistance } from "./review-geometry.mjs";
import { sourceOrderedRoute } from "./net-route-geometry.mjs";
import { survivingRailCaption } from "./net-rail-caption.mjs";
export const normalizedNetText = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
const labels = (g) =>
  [...g.texts, ...(g.omittedNetLabels ?? [])].filter(
    (t) => t.labelRole === "net" && t.labelOwnerKind === "edge",
  );
const routesFor = (g, label) =>
  g.shapes.filter(
    (s) =>
      s.conductor &&
      s.edgeOwnerKey &&
      s.appearanceScope === label.appearanceScope &&
      JSON.stringify(s.edgeOwnerKey) === JSON.stringify(label.labelOwnerKey),
  );
export function netOwnershipGaps(g) {
  return labels(g).flatMap((label) => {
    const routes = routesFor(g, label);
    return !Array.isArray(label.labelOwnerKey) ||
      !routes.length ||
      sourceOrderedRoute(routes).reason ||
      routes.some(
        (s) =>
          s.landingOwners?.some((p) => p.landingEnd === "unknown") ||
          s.ownedLandings?.some((p) => p.reason === "missing-route-port-owner"),
      )
      ? [
          {
            element: label.element,
            reason: `Net-label source ownership unavailable: ${sourceOrderedRoute(routes).reason ?? "historical route-port keys are unavailable"}`,
          },
        ]
      : [];
  });
}
// Locate the painted reservation on the polyline itself. TAIL occupies the
// source half of the route; endpoint owner flags cannot reverse path direction.
function tailPosition(route, label, issue) {
  if (label.omitted) return; // An empty reservation is not a painted label position.
  const points = route.points ?? [];
  if (points.length < 2 || !label.bbox) return;
  const center = {
    x: label.bbox.x + label.bbox.w / 2,
    y: label.bbox.y + label.bbox.h / 2,
  };
  let total = 0,
    best = Infinity,
    at = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = pointDistance(a, b);
    if (!length) continue;
    const u = Math.max(
      0,
      Math.min(
        1,
        ((center.x - a.x) * (b.x - a.x) + (center.y - a.y) * (b.y - a.y)) /
          (length * length),
      ),
    );
    const d = pointDistance(center, {
      x: a.x + u * (b.x - a.x),
      y: a.y + u * (b.y - a.y),
    });
    if (d < best) {
      best = d;
      at = total + u * length;
    }
    total += length;
  }
  if (total > 0 && at > total / 2 + 0.05)
    return issue("net-label-not-at-route-source", label, {
      edgeOwnerKey: label.labelOwnerKey,
      routeLength: total,
      labelDistanceAlongRoute: at,
    });
}
export function netLabelFindings(g, captionOwnershipFinding, issue, ir) {
  const out = [];
  for (const label of labels(g).filter((t) => Array.isArray(t.labelOwnerKey))) {
    const routes = routesFor(g, label),
      source = sourceOrderedRoute(routes);
    if (source.mismatch)
      out.push(
        issue("net-label-source-geometry-mismatch", label, {
          edgeOwnerKey: label.labelOwnerKey,
          ...source.mismatch,
        }),
      );
    else if (source.points) {
      const position = tailPosition(source, label, issue);
      if (position) out.push(position);
    }
    const repeated = netRepetitionFinding(
      g,
      label,
      routes,
      captionOwnershipFinding,
      issue,
      ir,
    );
    if (repeated) out.push(repeated);
  }
  return out;
}
function netRepetitionFinding(
  g,
  label,
  routes,
  captionOwnershipFinding,
  issue,
  ir,
) {
  const names = [
    ...new Set(
      routes.map((s) => normalizedNetText(s.potentialName)).filter(Boolean),
    ),
  ];
  const text = label.omitted
    ? names.length === 1
      ? names[0]
      : undefined
    : normalizedNetText(label.text);
  if (!text) return;
  const caption = g.texts.find(
    (t) =>
      t.labelRole === "terminal" &&
      !captionOwnershipFinding(t) &&
      normalizedNetText(t.text) === text &&
      t.appearanceScope === label.appearanceScope &&
      routes.some((s) =>
        s.landingOwners?.some(
          (p) =>
            p.landingEnd === "source" &&
            p.deviceUid === t.deviceUid &&
            p.terminal === t.terminal &&
            p.terminalAppearance === t.terminalAppearance,
        ),
      ),
  );
  if (
    label.omitted &&
    !caption &&
    !survivingRailCaption(g, label, routes, text, ir)
  )
    return issue("net-label-suppressed-without-source-caption", label, {
      text,
      edgeOwnerKey: label.labelOwnerKey,
      reason: "no-matching-source-caption",
    });
  else if (!label.omitted && caption)
    return issue("net-label-repeats-terminal-caption", label, {
      text: label.text,
      edgeOwnerKey: label.labelOwnerKey,
      terminal: caption.terminal,
      deviceUid: caption.deviceUid,
      terminalAppearance: caption.terminalAppearance,
      otherElement: caption.element,
      otherBbox: caption.bbox,
    });
}
