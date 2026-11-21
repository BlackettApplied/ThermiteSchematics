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

export function collectWireTerminals(c) {
  const { attr, identity, ids, root, shapeClips, visible } = c;
  const wireTerminals = Array.from(
    root.querySelectorAll(
      "circle[data-terminal-key],circle[data-loop-terminal],g[data-cable-uid][data-conductor-id] > circle",
    ),
  ).flatMap((e) => {
    const v = visible(e),
      css = getComputedStyle(e);
    let alpha = Number(css.strokeOpacity);
    for (let p = e; p; p = p.parentElement)
      alpha *= Number(getComputedStyle(p).opacity);
    if (!v || alpha < 0.2 || css.stroke === "none") return [];
    const clips = shapeClips(e);
    if (
      clips === null ||
      [v.clip, ...clips].some(
        (c) =>
          v.b.x < c.x - 0.002 ||
          v.b.y < c.y - 0.002 ||
          v.b.x + v.b.w > c.x + c.w + 0.002 ||
          v.b.y + v.b.h > c.y + c.h + 0.002,
      )
    )
      return [];
    let terminal;
    if (e.hasAttribute("data-loop-terminal")) {
      try {
        terminal = JSON.parse(e.getAttribute("data-loop-terminal"));
      } catch {
        return [];
      }
    } else if (e.hasAttribute("data-terminal-key"))
      terminal = [
        attr(e, "data-device-uid"),
        e.getAttribute("data-terminal-key"),
      ];
    const cable = e.parentElement;
    const circles = Array.from(cable.children).filter(
      (n) => n.tagName.toLowerCase() === "circle",
    );
    return [
      {
        ...identity(e),
        terminal,
        bbox: v.b,
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
