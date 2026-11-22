// Separate DOM identity measurement from the existing physical landing geometry.
// This function is serialized into Chromium; it imports no engine/renderer code.
export function measureRelationDeclarations(options = {}) {
  const root = document.querySelector(options.selector ?? "svg");
  const all = Array.from(root.querySelectorAll("*"));
  const ids = new Map(
    all.map((e, i) => [e, `${e.tagName.toLowerCase()}-${i}`]),
  );
  const attr = (e, name) => e.closest(`[${name}]`)?.getAttribute(name);
  const selector =
    "[data-loop-conductor],[data-terminal-ends][data-net-id],[data-communication-link],[data-connector-assembly],[data-cable-assembly][data-layout-source-port]";
  const parse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const relations = all
    .filter((e) => e.matches("path") && e.closest(selector))
    .map((e) => {
      const owner = e.closest(selector);
      const declarations = [
        ["loop", "data-loop-conductor", "data-terminal-ends"],
        [
          "communication",
          "data-communication-link",
          "data-communication-endpoints",
        ],
        ["assembly", "data-connector-assembly", "data-assembly-endpoints"],
        ["loop-bundle", "data-cable-assembly"],
      ].filter(([, key]) => owner.hasAttribute(key));
      const [family, key, claim] =
        declarations.length === 1 ? declarations[0] : [];
      return {
        element: ids.get(e),
        relationFamily: family,
        relationKey: key && owner.getAttribute(key),
        declaredEndpoints:
          claim && owner.hasAttribute(claim)
            ? parse(owner.getAttribute(claim))
            : undefined,
        bundleMembers:
          family === "loop-bundle"
            ? parse(owner.querySelector(":scope > desc")?.textContent)
            : undefined,
      };
    });
  const anchors = Object.fromEntries(
    all
      .filter((e) => options.anchors.includes(ids.get(e)))
      .map((e) => [
        ids.get(e),
        {
          ownerDeviceUid: attr(e, "data-device-uid"),
          anchorKind:
            attr(e, "data-communication-port") != null
              ? "communication"
              : attr(e, "data-connector-port") != null
                ? "assembly"
                : e.querySelector('[data-connector-interface="assembly"]')
                  ? "loop-bundle"
                  : "loop",
          bundleUid: e
            .getAttribute("data-layout-port")
            ?.match(/^n\d+_(?:in|out)_assembly:(.+)$/)?.[1],
        },
      ]),
  );
  return { relations, anchors };
}
export function measureMarkerIdentityClaims(options) {
  const root = document.querySelector("svg"),
    selected = new Set(options.anchors);
  const fields = [
    "data-terminal-key",
    "data-terminal-id",
    "data-loop-terminal",
    "data-terminal-attachment",
    "data-communication-port",
    "data-connector-port",
  ];
  return Object.fromEntries(
    Array.from(root.querySelectorAll("*")).flatMap((e, i) => {
      const id = `${e.tagName.toLowerCase()}-${i}`;
      if (!selected.has(id)) return [];
      const claims = fields.flatMap((field) => {
        const value = e.closest(`[${field}]`)?.getAttribute(field);
        return value == null ? [] : [{ field, value }];
      });
      return [[id, claims]];
    }),
  );
}
export function attachRelationDeclarations(g, declarations, claims = {}) {
  const byElement = new Map(declarations.relations.map((r) => [r.element, r]));
  for (const r of g.relationLandings ?? []) {
    Object.assign(r, byElement.get(r.element));
    for (const p of r.ownedLandings ?? []) {
      Object.assign(p, declarations.anchors[p.anchorElement]);
      p.identityClaims = claims[p.anchorElement];
    }
    byElement.delete(r.element);
  }
  // Older endpoint-only loop paths were visible shapes, but had no relation key.
  // Retain them as unresolved instead of silently dropping the source check.
  for (const r of byElement.values()) {
    const shape = g.shapes.find(
      (s) => s.element === r.element && s.loopCandidate,
    );
    if (shape)
      (g.relationLandings ??= []).push({
        ...r,
        bbox: shape.bbox,
        ownedLandings: [],
      });
  }
  return g;
}
// Historical endpoint arrays still identify a relation candidate when its key
// is absent. Do not infer a source from those arrays or silently omit the ink.
export function measureUnkeyedRelations() {
  const root = document.querySelector("svg"),
    rr = root.getBoundingClientRect();
  const vb = root.viewBox.baseVal;
  const selector =
    "[data-terminal-ends]:not([data-loop-conductor]),[data-communication-endpoints]:not([data-communication-link]),[data-assembly-endpoints]:not([data-connector-assembly])";
  return Array.from(root.querySelectorAll("*")).flatMap((e, i) => {
    if (!e.matches("path") || !e.closest(selector)) return [];
    const css = getComputedStyle(e),
      box = e.getBoundingClientRect();
    if (
      css.stroke === "none" ||
      css.stroke === "rgb(255, 255, 255)" ||
      Number(css.strokeOpacity) === 0 ||
      parseFloat(css.strokeWidth) <= 0
    )
      return [];
    for (let n = e; n; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      )
        return [];
      if (n.tagName.toLowerCase() === "svg") {
        const clip = n.getBoundingClientRect();
        if (
          box.right < clip.left ||
          box.left > clip.right ||
          box.bottom < clip.top ||
          box.top > clip.bottom
        )
          return [];
      }
    }
    if (!(box.width > 0 || box.height > 0)) return [];
    return [
      {
        element: `path-${i}`,
        bbox: {
          x: ((box.x - rr.x) * vb.width) / rr.width,
          y: ((box.y - rr.y) * vb.height) / rr.height,
          w: (box.width * vb.width) / rr.width,
          h: (box.height * vb.height) / rr.height,
        },
        ownedLandings: [],
      },
    ];
  });
}
