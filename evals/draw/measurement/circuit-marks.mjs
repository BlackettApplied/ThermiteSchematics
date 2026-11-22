export function circuitRouteFields(e, endpoints) {
  return {
    endpoints,
    circuitFanIn: endpoints
      ? (e.getAttribute("data-circuit-fan-in") ?? undefined)
      : undefined,
  };
}

export function circuitCaptionFallbacks({ root, identity, visible }) {
  const selector = "[data-circuit-caption-fallback]";
  const markers = [...root.querySelectorAll(selector)];
  if (root.matches(selector)) markers.unshift(root);
  return markers.map((e) => ({
    ...identity(e),
    bbox: visible(e)?.b,
    fallback: e.getAttribute("data-circuit-caption-fallback"),
    text: e.textContent.trim(),
  }));
}

export function fanInPhysicalTerminal(c) {
  const { all, anchor, anchorElement, deviceUid, e, h, scope, terminal } = c;
  const port = anchorElement?.getAttribute("data-circuit-landing-for");
  if (!port) return anchor;
  const group = e.closest("[data-circuit-group]");
  const candidates = all.filter(
    (element) =>
      element.getAttribute("data-layout-port") === port &&
      element.closest("svg") === scope &&
      element.closest("[data-circuit-group]") === group,
  );
  const physical = { ...c, candidates };
  h.measureLandingAnchor(physical);
  if (physical.deviceUid === deviceUid && physical.terminal === terminal)
    return physical.anchor;
}
