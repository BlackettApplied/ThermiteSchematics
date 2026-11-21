// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function readLandingPorts(c) {
  const { attr, e, end } = c;
  let candidates = [],
    reason;
  const layoutPort = attr(e, `data-layout-${end}-port`),
    semanticPort = attr(e, `data-route-${end}-port-key`);
  Object.assign(c, { candidates, reason, layoutPort, semanticPort });
}

export function resolveLandingCandidates(c) {
  const {
    all,
    attr,
    e,
    elementsById,
    endpoints,
    ids,
    index,
    layoutPort,
    ownerKey,
    scope,
    semanticPort,
    terminalCaptionOwners,
  } = c;
  let { candidates, reason } = c;
  if (layoutPort) {
    candidates = all.filter(
      (a) =>
        a.closest("svg") === scope &&
        a.closest("[data-circuit-group]") ===
          e.closest("[data-circuit-group]") &&
        a.getAttribute("data-layout-port") === layoutPort,
    );
    const stems = candidates.filter((a) =>
      a.hasAttribute("data-terminal-attachment"),
    );
    candidates = stems.length ? stems : candidates;
  } else if (semanticPort) {
    try {
      const port = ownerKey(semanticPort, "port"),
        node = JSON.parse(port[1]);
      if (port[0] !== "port") throw Error("Invalid route port");
      if (node[0] === "junction")
        candidates = all.filter(
          (a) =>
            a.closest("svg") === scope &&
            a.classList.contains("junction-dot") &&
            ownerKey(a.id.replace(/^.*?(junction-)/, "$1"), "junction")[0] ===
              port[1],
        );
      else {
        const owner = terminalCaptionOwners.get(
          JSON.stringify([ids.get(scope), port[1], port[2]]),
        );
        if (owner?.anchorElement)
          candidates = [elementsById.get(owner.anchorElement)];
      }
    } catch {
      reason = "invalid-route-port-owner";
    }
  } else if (attr(e, "data-wiring-conductor")) {
    const ep = endpoints[index];
    candidates = all.filter(
      (a) =>
        a.closest("svg") === scope &&
        a.matches("circle[data-terminal-key]") &&
        attr(a, "data-device-uid") === ep?.deviceUid &&
        a.getAttribute("data-terminal-key") === ep?.terminalKey,
    );
  } else reason = "missing-route-port-owner";
  Object.assign(c, { candidates, reason });
}

export function measureLandingAnchor(c) {
  const { attr, candidates, point } = c;
  const anchorElement = candidates.length === 1 ? candidates[0] : undefined;
  let anchor,
    terminal = anchorElement && attr(anchorElement, "data-terminal-key"),
    deviceUid = anchorElement && attr(anchorElement, "data-device-uid");
  if (anchorElement) {
    const stem = anchorElement.getAttribute("data-attachment-to"),
      marker = anchorElement.matches("circle,rect")
        ? anchorElement
        : anchorElement.querySelector("circle,rect");
    let localAnchor;
    if (stem) {
      const path = anchorElement.querySelector("path");
      if (path) localAnchor = path.getPointAtLength(path.getTotalLength());
    } else if (marker) {
      const b = marker.getBBox();
      localAnchor = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    if (localAnchor) {
      const q = new DOMPoint(localAnchor.x, localAnchor.y).matrixTransform(
        (stem ? anchorElement.querySelector("path") : marker).getScreenCTM(),
      );
      anchor = point(q.x, q.y);
    }
    for (const name of [
      "data-terminal-id",
      "data-loop-terminal",
      "data-terminal-attachment",
    ])
      if (attr(anchorElement, name)) {
        try {
          [deviceUid, terminal] = JSON.parse(attr(anchorElement, name));
        } catch {}
      }
    terminal ??=
      attr(anchorElement, "data-communication-port") ??
      attr(anchorElement, "data-connector-port");
  }
  Object.assign(c, { anchorElement, anchor, terminal, deviceUid });
}

export function checkLandingOwner(c) {
  const { deviceUid, endpoints, terminal } = c;
  let { anchor, reason } = c;
  if (
    anchor &&
    endpoints.some((p) => p.deviceUid && p.terminalKey) &&
    !endpoints.some(
      (p) => p.deviceUid === deviceUid && p.terminalKey === terminal,
    )
  ) {
    reason = "owned-terminal-mismatch";
    anchor = undefined;
  }
  Object.assign(c, { reason, anchor });
}

export function landingFields1(c) {
  const {
    anchor,
    anchorElement,
    candidates,
    deviceUid,
    end,
    endpoint,
    ids,
    reason,
    scope,
    terminal,
  } = c;
  return {
    end,
    endpoint,
    anchor,
    deviceUid,
    terminal,
    anchorElement: ids.get(anchorElement),
    appearanceScope: ids.get(scope),
    ...(c.e.hasAttribute("data-circuit-fan-in")
      ? { physicalTerminal: c.h.fanInPhysicalTerminal(c) }
      : {}),
    reason: anchor
      ? undefined
      : (reason ??
        (candidates.length > 1
          ? "ambiguous-owned-anchor"
          : "missing-owned-anchor")),
  };
}

export function landingRow(c) {
  const { e, index, point, inClip, h } = c;
  const local = e.getPointAtLength(index ? e.getTotalLength() : 0),
    p = local.matrixTransform(e.getScreenCTM()),
    endpoint = point(p.x, p.y);
  if (!inClip(endpoint)) return [];
  const s = { ...c, local, p, endpoint };
  h.readLandingPorts(s);
  h.resolveLandingCandidates(s);
  h.measureLandingAnchor(s);
  h.checkLandingOwner(s);
  return [{ ...h.landingFields1(s) }];
}

export function ownedLandings(e, endpoints, c) {
  const { clip, h } = c;
  const inClip = (p) =>
    p.x >= clip.x - 0.001 &&
    p.y >= clip.y - 0.001 &&
    p.x <= clip.x + clip.w + 0.001 &&
    p.y <= clip.y + clip.h + 0.001;
  const scope = e.closest("svg");
  return ["source", "target"].flatMap((end, index) =>
    h.landingRow({ ...c, e, endpoints, inClip, scope, end, index }),
  );
}
