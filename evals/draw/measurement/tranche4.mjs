// Private inputs for CHECK3 C3. Structural attributes locate candidates only.
export function tranche4Json(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export function tranche4Group(c, e) {
  const v = c.visible(e);
  return {
    ...c.identity(e),
    bbox: v?.b,
    texts: c.texts.filter((t) => e.contains(c.elementsById.get(t.element))),
  };
}
export function tranche4Groups(c, selector, fields) {
  return [...c.root.querySelectorAll(selector)]
    .filter((e) => c.visible(e))
    .map((e) => ({
      ...c.h.tranche4Group(c, e),
      ...fields(e),
    }));
}
export function tranche4Cards(c) {
  return c.h.tranche4Groups(c, "[data-off-view-conductors]", (e) => ({
    conductors: c.h.tranche4Json(e.getAttribute("data-off-view-conductors")),
    terminalId: c.h.tranche4Json(e.getAttribute("data-off-view-terminal-id")),
    headingElements: [...e.querySelectorAll(".off-view-heading")].map((t) =>
      c.ids.get(t),
    ),
  }));
}
export function tranche4References(c) {
  const h = c.h;
  return h.tranche4Groups(
    c,
    "[data-circuit-continuation],[data-communication-continuation-device]",
    (e) => ({
      kind: e.hasAttribute("data-circuit-continuation")
        ? "circuit"
        : "communication",
      group: e.getAttribute("data-circuit-continuation"),
      terminalId: h.tranche4Json(e.getAttribute("data-continuation-terminal")),
      uid: e.getAttribute("data-communication-continuation-device"),
      view: Number(e.getAttribute("data-communication-view")),
      part: Number(e.getAttribute("data-from-part")),
      targetParts: h.tranche4Json(e.getAttribute("data-destination-parts")),
      targetSheets: h.tranche4Json(e.getAttribute("data-destination-sheets")),
    }),
  );
}
export function tranche4Parts(c) {
  return c.h.tranche4Groups(c, "[data-circuit-part]", (e) => ({
    part: Number(e.getAttribute("data-circuit-part")),
    total: Number(e.getAttribute("data-circuit-parts")),
    groups: [...e.querySelectorAll("[data-circuit-group]")].map((q) =>
      q.getAttribute("data-circuit-group"),
    ),
    routeElements: c.shapes
      .filter((s) => e.contains(c.elementsById.get(s.element)))
      .map((s) => s.element),
    terminals: c.terminals.filter((t) =>
      e.contains(c.elementsById.get(t.element)),
    ),
  }));
}
export function tranche4Ports(c) {
  return c.h.tranche4Groups(
    c,
    "[data-connector-port],[data-communication-port]",
    (e) => {
      const circle = e.querySelector("circle"),
        visible = circle && c.visible(circle),
        b =
          visible &&
          (c.options.textOnly ||
            c.strokeInk(circle, visible.clip, circle.getScreenCTM(), true)
              .length)
            ? visible.b
            : null;
      return {
        key:
          e.getAttribute("data-connector-port") ??
          e.getAttribute("data-communication-port"),
        kind: e.hasAttribute("data-connector-port")
          ? "assembly"
          : "communication",
        point: b && { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        radius: b && Math.max(b.w, b.h) / 2,
      };
    },
  );
}
export function tranche4LinkPaths(c, e) {
  const paths = [];
  if (!c.options.textOnly)
    for (const p of e.querySelectorAll("path,line,polyline")) {
      const v = c.visible(p),
        matrix = p.getScreenCTM();
      const ink = v && c.strokeInk(p, v.clip, matrix, true);
      if (!ink?.length || typeof p.getTotalLength !== "function") continue;
      const ends = [0, p.getTotalLength()].map((n) => {
        const q = p.getPointAtLength(n),
          a = new DOMPoint(q.x, q.y).matrixTransform(matrix);
        return c.point(a.x, a.y);
      });
      paths.push({ ends, ink });
    }
  return {
    paths: paths.map((p) => ({ ends: p.ends })),
    ink: paths.flatMap((p) => p.ink),
  };
}
export function tranche4Links(c, kind) {
  const key = kind === "assembly" ? "connector-assembly" : "communication-link";
  const ends =
    kind === "assembly" ? "assembly-endpoints" : "communication-endpoints";
  return c.h.tranche4Groups(c, `[data-${key}]`, (e) => ({
    uid: e.getAttribute(`data-${key}`),
    ends: c.h.tranche4Json(e.getAttribute(`data-${ends}`)),
    ...c.h.tranche4LinkPaths(c, e),
  }));
}
export function tranche4Fields(c) {
  const h = c.h;
  return {
    tranche4: {
      cards: h.tranche4Cards(c),
      partRefs: h.tranche4References(c),
      circuitParts: h.tranche4Parts(c),
      ports: h.tranche4Ports(c),
      assemblies: h.tranche4Links(c, "assembly"),
      communicationLinks: h.tranche4Links(c, "communication"),
      markers: c.options.textOnly ? [] : h.tranche4Markers(c),
    },
  };
}
export function tranche4Markers(c) {
  const result = [];
  for (const e of c.root.querySelectorAll(
    "circle.terminal-marker,[data-terminal-id] circle,circle[data-terminal-key],circle[data-circuit-junction],circle[data-wiring-junction],circle.junction-dot",
  )) {
    if (e.closest('[data-tag-kind="reference"],.off-view-annotation')) continue;
    const v = c.visible(e);
    if (!v) continue;
    const fill = c.fillPaint(e),
      m = e.getScreenCTM(),
      css = getComputedStyle(e),
      ink = c.strokeInk(e, v.clip, m, true),
      stroke =
        ink.length > 0 && css.stroke !== "none"
          ? parseFloat(css.strokeWidth) *
            Math.max(
              Math.hypot(m.a * c.sx, m.b * c.sy),
              Math.hypot(m.c * c.sx, m.d * c.sy),
            )
          : 0;
    result.push({
      ...c.identity(e),
      junction:
        e.classList.contains("junction-dot") ||
        e.hasAttribute("data-circuit-junction") ||
        e.hasAttribute("data-wiring-junction"),
      bbox: v.b,
      stroke,
      point: { x: v.b.x + v.b.w / 2, y: v.b.y + v.b.h / 2 },
      filled: fill.alpha >= 0.2 && !fill.background,
      painted: ink.length > 0,
      inkSegments: ink,
    });
  }
  return result;
}
