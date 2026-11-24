// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function collectTerminals(c) {
  const { identity, root, visible } = c;
  const terminals = Array.from(
    root.querySelectorAll(
      "circle.terminal-marker,[data-terminal-id] circle,circle[data-terminal-key]",
    ),
  ).flatMap((e) => {
    if (e.closest('[data-tag-kind="reference"],.off-view-annotation'))
      return [];
    const v = visible(e);
    if (!v) return [];
    const b = v.b;
    return [
      {
        ...identity(e),
        bbox: b,
        viewport: v.clip,
        painted: (() => {
          let alpha = 1;
          for (let n = e; n; n = n.parentElement)
            alpha *= Number(getComputedStyle(n).opacity);
          return alpha >= 0.2;
        })(),
        point: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        fill: getComputedStyle(e).fill,
      },
    ];
  });
  Object.assign(c, { terminals });
}

export function isEligibleWireTerminalCircle(e) {
  return (
    e.tagName.toLowerCase() === "circle" &&
    !e.closest('[data-tag-kind="reference"],.off-view-annotation') &&
    !e.classList.contains("junction-dot") &&
    !e.hasAttribute("data-circuit-junction") &&
    !e.hasAttribute("data-wiring-junction") &&
    !e.hasAttribute("data-circuit-landing-for") &&
    !e.hasAttribute("data-wiring-landing-for")
  );
}

export function parseCssOpacity(raw) {
  if (raw === undefined || raw === null) return 1;
  const text = String(raw).trim();
  if (!text) return 1;
  const pct = text.endsWith("%");
  const value = Number(pct ? text.slice(0, -1) : text);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, pct ? value / 100 : value));
}

export function paintColorAlpha(raw) {
  if (!raw) return 0;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === "none" || text === "transparent" || text === "white")
    return 0;
  const alpha = (token) => {
    const t = token.trim();
    if (t === "none") return 0;
    const pct = t.endsWith("%");
    const v = Number(pct ? t.slice(0, -1) : t);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, pct ? v / 100 : v)) : 0;
  };
  const hex = text.match(
    /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/,
  );
  if (hex) {
    const d = hex[1];
    const byte = (i) =>
      d.length <= 4
        ? parseInt(d[i] + d[i], 16)
        : parseInt(d.slice(i * 2, i * 2 + 2), 16);
    const a = d.length === 4 || d.length === 8 ? byte(3) / 255 : 1;
    return byte(0) === 255 && byte(1) === 255 && byte(2) === 255 ? 0 : a;
  }
  const fn = text.match(/^([a-z][a-z0-9-]*)\(([^)]+)\)$/);
  if (!fn) return 0;
  const [, name, body] = fn;
  const [head, slash] = body.split("/");
  const parts = head.trim().split(/[\s,]+/);
  const ch = (s, scale) =>
    s === "none"
      ? 0
      : s.endsWith("%")
        ? (Number(s.slice(0, -1)) * scale) / 100
        : Number(s);
  if (name === "rgb" || name === "rgba") {
    if (parts.length < 3) return 0;
    const [r, g, b] = parts.slice(0, 3).map((s) => ch(s, 255));
    if (![r, g, b].every(Number.isFinite)) return 0;
    const a =
      slash !== undefined ? alpha(slash) : parts[3] ? alpha(parts[3]) : 1;
    return r >= 255 && g >= 255 && b >= 255 ? 0 : a;
  }
  const a =
    slash !== undefined
      ? alpha(slash)
      : (name === "hsl" || name === "hsla") && parts[3]
        ? alpha(parts[3])
        : 1;
  if (name === "color" && parts.length >= 4) {
    const rgb = parts.slice(1, 4).map((s) => ch(s, 1));
    if (!rgb.every(Number.isFinite)) return 0;
    const spaces = [
      "srgb",
      "srgb-linear",
      "display-p3",
      "a98-rgb",
      "prophoto-rgb",
      "rec2020",
    ];
    if (spaces.includes(parts[0]) && rgb.every((v) => v >= 1)) return 0;
  }
  return a;
}

export function wireTerminalCirclePainted(e, visible, shapeClips, h) {
  const v = visible(e);
  if (!v || !(v.b.w > 0 && v.b.h > 0)) return null;
  const css = getComputedStyle(e);
  let opacity = 1;
  for (let p = e; p; p = p.parentElement)
    opacity *= h.parseCssOpacity(getComputedStyle(p).opacity);
  const strokePainted =
    h.paintColorAlpha(css.stroke) *
      h.parseCssOpacity(css.strokeOpacity) *
      opacity >=
      0.2 && parseFloat(css.strokeWidth) > 0;
  const fillPainted =
    h.paintColorAlpha(css.fill) *
      h.parseCssOpacity(css.fillOpacity) *
      opacity >=
    0.2;
  if (!strokePainted && !fillPainted) return null;
  const clips = shapeClips(e);
  if (
    clips === null ||
    [v.clip, ...clips].some(
      (clip) =>
        v.b.x < clip.x - 0.002 ||
        v.b.y < clip.y - 0.002 ||
        v.b.x + v.b.w > clip.x + clip.w + 0.002 ||
        v.b.y + v.b.h > clip.y + clip.h + 0.002,
    )
  )
    return null;
  return v;
}

export function wireTerminalIdentity(e, attr, h) {
  const parseTuple = (raw) => {
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) &&
        value.length === 2 &&
        value.every((s) => typeof s === "string")
        ? value
        : null;
    } catch {
      return null;
    }
  };
  if (e.hasAttribute("data-loop-terminal"))
    return parseTuple(e.getAttribute("data-loop-terminal"));
  if (e.hasAttribute("data-terminal-key"))
    return [attr(e, "data-device-uid"), e.getAttribute("data-terminal-key")];
  const parent = e.parentElement;
  if (!parent || parent.tagName.toLowerCase() !== "g") return undefined;
  const hasPortIdentity =
    parent.hasAttribute("data-loop-terminal") ||
    parent.hasAttribute("data-terminal-id") ||
    (parent.hasAttribute("data-layout-port") &&
      parent.hasAttribute("data-terminal-key"));
  if (!hasPortIdentity) return undefined;
  if (e.getAttribute("data-terminal-marker") !== "true") return null;
  const marked = Array.from(parent.children).filter((n) =>
    n.hasAttribute("data-terminal-marker"),
  );
  if (
    marked.length !== 1 ||
    marked[0] !== e ||
    !h.isEligibleWireTerminalCircle(e)
  )
    return null;
  if (parent.hasAttribute("data-loop-terminal"))
    return parseTuple(parent.getAttribute("data-loop-terminal"));
  if (parent.hasAttribute("data-terminal-id")) {
    const tuple = parseTuple(parent.getAttribute("data-terminal-id"));
    if (!tuple) return null;
    const ownerUid = attr(parent, "data-device-uid");
    const portKey = parent.getAttribute("data-terminal-key");
    return (!ownerUid || ownerUid === tuple[0]) &&
      (!portKey || portKey === tuple[1])
      ? tuple
      : null;
  }
  return [
    attr(parent, "data-device-uid"),
    parent.getAttribute("data-terminal-key"),
  ];
}

export function collectWireTerminals(c) {
  const { attr, h, identity, ids, root, shapeClips, sx, sy, visible } = c;
  const wireTerminals = Array.from(
    root.querySelectorAll(
      "circle[data-terminal-key],circle[data-loop-terminal],g[data-terminal-id] > circle[data-terminal-marker],g[data-loop-terminal] > circle[data-terminal-marker],g[data-layout-port][data-terminal-key] > circle[data-terminal-marker],g[data-cable-uid][data-conductor-id] > circle",
    ),
  ).flatMap((e) => {
    if (!h.isEligibleWireTerminalCircle(e)) return [];
    const v = h.wireTerminalCirclePainted(e, visible, shapeClips, h);
    if (!v) return [];
    const terminal = h.wireTerminalIdentity(e, attr, h);
    if (terminal === null) return [];
    const css = getComputedStyle(e),
      m = e.getScreenCTM();
    const stroke =
      h.paintColorAlpha(css.stroke) > 0 && parseFloat(css.strokeWidth) > 0
        ? parseFloat(css.strokeWidth) *
          Math.max(
            Math.hypot(m.a * sx, m.b * sy),
            Math.hypot(m.c * sx, m.d * sy),
          )
        : 0;
    const cable = e.parentElement;
    const circles = Array.from(cable.children).filter(
      (n) => n.tagName.toLowerCase() === "circle",
    );
    return [
      {
        ...identity(e),
        terminal,
        bbox: v.b,
        stroke,
        point: { x: v.b.x + v.b.w / 2, y: v.b.y + v.b.h / 2 },
        cableScope: ids.get(cable),
        cableUid: cable.getAttribute("data-cable-uid"),
        conductorId: cable.getAttribute("data-conductor-id"),
        slot: circles.indexOf(e),
        markerCount: circles.length,
      },
    ];
  });
  Object.assign(c, { wireTerminals });
}

export function captionOwnerIndex(c) {
  const terminalCaptionOwners = new Map();
  Object.assign(c, { terminalCaptionOwners });
}

export function collectCaptionOwners(c) {
  const { attr, ids, root, terminalCaptionOwners } = c;
  for (const group of root.querySelectorAll("g[data-symbol-id]")) {
    const uid = group.getAttribute("data-device-uid");
    const kind = group.matches(".rail-symbol")
      ? "rail"
      : group.getAttribute("data-representation") === "terminal"
        ? "terminal"
        : group.hasAttribute("data-function-key")
          ? "function"
          : "aggregate";
    const key = group.getAttribute(
      `data-${kind === "rail" ? "terminal" : kind}-key`,
    );
    const node = [kind, uid, key];
    if (kind === "rail") node.push(group.getAttribute("data-boundary-kind"));
    for (const marker of group.querySelectorAll("circle.terminal-marker")) {
      const port = marker.id.match(/terminal-([a-f0-9]+(?:--[a-f0-9]+)*)$/);
      if (!port) continue;
      const parts = port[1].split("--").map((part) =>
        part.length % 4
          ? null
          : part
              .match(/.{4}/g)
              .map((h) => String.fromCharCode(parseInt(h, 16)))
              .join(""),
      );
      const terminal = marker.getAttribute("data-terminal-key");
      if (
        parts.length !== 3 ||
        !uid ||
        !key ||
        !terminal ||
        parts[0] !== uid ||
        parts[1] !== terminal ||
        !parts[2] ||
        attr(marker, "data-device-uid") !== uid
      )
        continue;
      const ownerKey = JSON.stringify([
        ids.get(group.closest("svg")),
        JSON.stringify(node),
        parts[2],
      ]);
      // Duplicate or inconsistent marker declarations cannot establish an owner.
      terminalCaptionOwners.set(
        ownerKey,
        terminalCaptionOwners.has(ownerKey)
          ? undefined
          : {
              deviceUid: uid,
              terminal,
              terminalAppearance: ids.get(group),
              anchorElement: ids.get(marker),
            },
      );
    }
  }
}

export const ownerKey = (raw, { prefix }) => {
  const hex = raw?.match(new RegExp(`^${prefix}-([a-f0-9]+)$`))?.[1];
  if (!hex || hex.length % 4) throw Error("Invalid exported owner key");
  return JSON.parse(
    hex
      .match(/.{4}/g)
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join(""),
  );
};

export const landingOwners = (
  e,
  { endpoints, attr, ids, ownerKey, terminalCaptionOwners },
) => {
  const scope = ids.get(e.closest("svg")) ?? null;
  return ["source", "target"].flatMap((end, index) => {
    const raw = attr(e, `data-route-${end}-port-key`);
    if (raw !== null && raw !== undefined) {
      try {
        const port = ownerKey(raw, "port");
        if (port[0] !== "port") return [];
        const owner = terminalCaptionOwners.get(
          JSON.stringify([scope, port[1], port[2]]),
        );
        return owner &&
          endpoints.some(
            (p) =>
              p.deviceUid === owner.deviceUid &&
              p.terminalKey === owner.terminal,
          )
          ? [{ ...owner, landingEnd: end }]
          : [];
      } catch {
        return [];
      }
    }
    // Historical SVGs export electrical endpoints but no landing port keys.
    // Resolve only a unique body appearance within this nested drawing.
    const endpoint = endpoints[index];
    const candidates = [...terminalCaptionOwners.entries()]
      .filter(
        ([key, owner]) =>
          JSON.parse(key)[0] === scope &&
          owner &&
          owner.deviceUid === endpoint?.deviceUid &&
          owner.terminal === endpoint?.terminalKey,
      )
      .map(([, owner]) => owner);
    return new Set(candidates.map((o) => o.terminalAppearance)).size === 1
      ? candidates
          .slice(0, 1)
          .map((owner) => ({ ...owner, landingEnd: "unknown" }))
      : [];
  });
};

export const omittedNetLabels = ({
  bounds,
  identity,
  intersect,
  ownerKey,
  root,
  visible,
}) => {
  return [...root.querySelectorAll("text[clip-path]")].flatMap((e) => {
    if (e.textContent !== "") return [];
    const ref = e.getAttribute("clip-path")?.match(/url\(#(.+)\)/)?.[1];
    const hex = ref?.match(/clip-([a-f0-9]+)$/)?.[1];
    const rect = ref && document.getElementById(ref)?.querySelector("rect");
    const v = visible(e, true);
    if (!hex || !rect || !v) return [];
    try {
      const key = ownerKey(`label-${hex}`, "label");
      if (key[0] !== "label" || key[1] !== "edge" || key[3] !== "net")
        return [];
      const bbox = intersect(bounds(e, rect.getBBox()), v.clip);
      if (bbox.w <= 0.001 || bbox.h <= 0.001) return [];
      return [
        {
          ...identity(e),
          omitted: true,
          bbox,
          boxKind: "label-reservation",
          labelRole: "net",
          labelOwnerKind: "edge",
          labelOwnerKey:
            typeof key[2] === "string" ? JSON.parse(key[2]) : key[2],
        },
      ];
    } catch {
      return [];
    }
  });
};

export const continuationOwner = ({ e }) => {
  const a = e.closest('a[href^="#sheet-"]');
  return a?.querySelector("path,line") ? a : null;
};

export const continuationInfo = ({ e, continuationOwner, point }) => {
  const a = continuationOwner(e),
    line = a?.querySelector("path,line");
  if (!line || typeof line.getPointAtLength !== "function") return undefined;
  const p = line.getPointAtLength(0),
    m = line.getScreenCTM();
  const q = new DOMPoint(p.x, p.y).matrixTransform(m);
  return {
    anchor: point(q.x, q.y),
    toSheet: Number(a.getAttribute("href").slice(7)),
  };
};
