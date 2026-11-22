// Cohesive geometry bundle; functions are serialized with explicit dependencies.
export const geometry = {
  sheetCoordinates: (c) => {
    const { options } = c;
    const root = document.querySelector(options.selector ?? "svg"),
      rr = root.getBoundingClientRect(),
      vb = root.viewBox.baseVal;
    const sx = vb.width / rr.width,
      sy = vb.height / rr.height;
    Object.assign(c, { root, rr, vb, sx, sy });
  },
  point: (x, { y, rr, sx, sy }) => ({
    x: (x - rr.x) * sx,
    y: (y - rr.y) * sy,
  }),
  screenBox: ({ r, rr, sx, sy }) => ({
    x: (r.x - rr.x) * sx,
    y: (r.y - rr.y) * sy,
    w: r.width * sx,
    h: r.height * sy,
  }),
  bounds: (e, { box, point }) => {
    const b = box ?? e.getBBox(),
      m = e.getScreenCTM();
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
      .map((p) => point(p.x, p.y));
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
  intersect: (a, { b }) => ({
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
  }),
  visible: (e, { keepHidden = false, bounds, intersect, point, root, vb }) => {
    if (
      e.closest("defs,clipPath,mask,symbol,pattern,marker") ||
      getComputedStyle(e).display === "none" ||
      getComputedStyle(e).visibility === "hidden"
    )
      return null;
    let clip = { x: 0, y: 0, w: vb.width, h: vb.height };
    for (let p = e.parentElement; p && p !== root; p = p.parentElement)
      if (
        p.tagName.toLowerCase() === "svg" &&
        getComputedStyle(p).overflow !== "visible"
      ) {
        const v = p.viewBox.baseVal,
          m = p.getScreenCTM();
        const a = new DOMPoint(v.x, v.y).matrixTransform(m),
          b = new DOMPoint(v.x + v.width, v.y + v.height).matrixTransform(m);
        const aa = point(a.x, a.y),
          bb = point(b.x, b.y);
        clip = intersect(clip, {
          x: Math.min(aa.x, bb.x),
          y: Math.min(aa.y, bb.y),
          w: Math.abs(aa.x - bb.x),
          h: Math.abs(aa.y - bb.y),
        });
      }
    const b = bounds(e),
      v = intersect(
        { ...b, w: Math.max(b.w, 0.02), h: Math.max(b.h, 0.02) },
        clip,
      );
    return keepHidden || (v.w > 0.001 && v.h > 0.001)
      ? { b, clip, painted: v.w > 0.001 && v.h > 0.001 }
      : null;
  },
  attr: (e, { name }) => e.closest(`[${name}]`)?.getAttribute(name),
  elementIndex: (c) => {
    const { root } = c;
    const all = Array.from(root.querySelectorAll("*"));
    const orders = new Map(all.map((e, i) => [e, i]));
    const ids = new Map(
      all.map((e, i) => [e, `${e.tagName.toLowerCase()}-${i}`]),
    );
    const elementsById = new Map([...ids].map(([e, id]) => [id, e]));
    Object.assign(c, { all, orders, ids, elementsById });
  },
  tagIdentity: ({ e, attr, ids }) => {
    const owner = attr(e, "data-tag-owner-uid"),
      kind = attr(e, "data-tag-kind");
    if (!owner) return { tagField: attr(e, "data-tag-field") };
    let terminal;
    try {
      terminal = JSON.parse(attr(e, "data-tag-terminal-id") ?? "null");
    } catch {}
    let rootedOwner;
    if (e.classList.contains("label-device")) {
      try {
        const hex = e.getAttribute("clip-path").match(/-clip-([a-f0-9]+)\)/)[1];
        const label = JSON.parse(
          hex
            .match(/.{4}/g)
            .map((h) => String.fromCharCode(parseInt(h, 16)))
            .join(""),
        );
        const identity = JSON.parse(label[2]);
        if (
          label[0] === "label" &&
          label[1] === "device" &&
          identity[0] === "device"
        )
          rootedOwner = identity[1];
      } catch {}
    }
    const parent = attr(e, "data-device-uid");
    return {
      tagOwnerUid: owner,
      tagField: attr(e, "data-tag-field"),
      tagKind: kind,
      tagKey: attr(e, "data-tag-key"),
      tagRowStart: e.hasAttribute("data-tag-row-start")
        ? Number(e.getAttribute("data-tag-row-start"))
        : undefined,
      tagRowEnd: e.hasAttribute("data-tag-row-end")
        ? Number(e.getAttribute("data-tag-row-end"))
        : undefined,
      tagReferenceEntry: !!e.closest(
        '[data-device-reference-entry],[data-device-legend-entry][data-tag-kind="reference"]',
      ),
      tagBlock: attr(e, "data-tag-block"),
      tagContainer:
        ids.get(
          kind === "legend"
            ? e.closest('[data-device-legend-entry][data-tag-kind="legend"]')
            : kind === "body"
              ? e.closest("[data-device-uid]")
              : e.closest(
                  'g[data-tag-kind="reference"][data-tag-block],.off-view-annotation',
                ),
        ) ?? rootedOwner,
      tagTerminal: terminal,
      tagTerminalDeclared: attr(e, "data-tag-terminal-id") != null,
      tagRef: attr(e, "data-tag-ref"),
      tagOwnershipValid:
        kind === "body"
          ? (parent ?? rootedOwner) === owner &&
            !e.closest('[data-tag-kind="reference"],.off-view-annotation')
          : kind === "legend"
            ? !!e.closest(
                '[data-device-legend-entry][data-tag-kind="legend"]',
              ) &&
              attr(
                e.closest('[data-device-legend-entry][data-tag-kind="legend"]'),
                "data-tag-owner-uid",
              ) === owner &&
              !e.closest("[data-device-uid],.off-view-annotation")
            : kind === "reference" &&
              (!parent || parent === owner) &&
              (!e.closest(
                '[data-device-reference-entry],[data-device-legend-entry][data-tag-kind="reference"]',
              ) ||
                (attr(
                  e.closest(
                    '[data-device-reference-entry],[data-device-legend-entry][data-tag-kind="reference"]',
                  ),
                  "data-tag-owner-uid",
                ) === owner &&
                  !parent)),
    };
  },
  ancestors: ({ e, root }) => {
    const result = [];
    for (let p = e.parentElement; p && p !== root; p = p.parentElement)
      result.push(p);
    return result;
  },
  documentIdentity: ({ e, attr, ids }) => {
    const kind = attr(e, "data-document-kind");
    const peer = e.closest("[data-peer-reference]");
    return {
      row: attr(e, "data-report-row"),
      documentId: attr(e, "data-document-id"),
      documentOrigin: attr(e, "data-document-origin"),
      columnName: attr(e, "data-column-name"),
      reportRowScope: ids.get(e.closest("[data-report-row]")),
      ...(typeof kind === "string" ? { documentKind: kind } : {}),
      ...(peer
        ? {
            peerReference: peer.getAttribute("data-peer-reference"),
            peerSource: peer.getAttribute("data-peer-source"),
            ...(peer !== e ? { peerGroup: ids.get(peer) } : {}),
          }
        : {}),
    };
  },
  identity: ({ e, ancestors, attr, ids, documentIdentity }) => ({
    element: ids.get(e),
    appearanceScope: ids.get(e.closest("svg")),
    primitiveIds: [e, ...ancestors(e)].map((n) => n.id).filter(Boolean),
    navigationView: attr(e, "data-navigation-view"),
    navigationAnnotation: attr(e, "data-navigation-annotation"),
    navigationOwner: attr(e, "data-navigation-owner"),
    navigationRole: attr(e, "data-navigation-role"),
    navigationContainer: ids.get(e.closest("[data-navigation-role]")),
    mirrorRow: attr(e, "data-navigation-mirror-row"),
    mirrorRowScope: ids.get(e.closest("[data-navigation-mirror-row]")),
    gangedFunctions: attr(e, "data-ganged-functions"),
    mechanicalAssociation: attr(e, "data-mechanical-association"),
    glyphBody: !!e.closest(".symbol"),
    nativeFunctionScope: ids.get(e.closest("[data-circuit-functions]")),
    functionScope: ids.get(
      e.closest(
        "[data-symbol-id],[data-function-key],[data-aggregate-key],.symbol,[data-circuit-functions]",
      ),
    ),
    deviceUid: attr(e, "data-device-uid"),
    designation: attr(e, "data-designation"),
    terminal: attr(e, "data-terminal-key"),
    pinTerminal: attr(e, "data-pin-terminal"),
    ...documentIdentity(e),
    reportNote: e.getAttribute("data-report-note"),
    textContainer: ids.get(e.parentElement),
    authoredText: e.getAttribute("data-authored-text"),
    functionKey: attr(e, "data-function-key"),
    circuitGroup: attr(e, "data-circuit-group"),
    communicationPort: attr(e, "data-communication-port"),
    circuitHeading: e.getAttribute("data-circuit-source-heading"),
    wire:
      attr(e, "data-wire-label") ??
      attr(e, "data-wire-uid") ??
      attr(e, "data-circuit-conductor") ??
      attr(e, "data-wiring-conductor") ??
      attr(e, "data-loop-conductor"),
    net: attr(e, "data-net-id"),
    symbolGroup: ids.get(
      e.closest("[data-symbol-id],[data-function-key],[data-aggregate-key]"),
    ),
    markGroup: ids.get(e.closest("[data-circuit-mark],[data-function-id]")),
    symbolPortId: e.getAttribute("data-symbol-port-id"),
    qualifier: e.getAttribute("data-symbol-qualifier"),
    polarity: e.getAttribute("data-polarity"),
    primitiveRole: e.getAttribute("data-circuit-role"),
    attachment: attr(e, "data-terminal-attachment"),
    attachmentCandidate: !!e.closest(
      "[data-attachment-from],[data-attachment-to]",
    ),
    layoutPort: attr(e, "data-layout-port"),
    outsideConnections: attr(e, "data-outside-connections"),
    loopConductor: attr(e, "data-loop-conductor"),
    loopCandidate: !!e.closest("[data-terminal-ends][data-net-id]"),
    terminalEnds: (() => {
      try {
        return JSON.parse(attr(e, "data-terminal-ends") ?? "null");
      } catch {
        return null;
      }
    })(),
    dependencyId: attr(e, "data-document-dependency"),
    circuitFunctions: (() => {
      try {
        return JSON.parse(attr(e, "data-circuit-functions") ?? "[]");
      } catch {
        return [];
      }
    })(),
  }),
  terminalDescriptionOwner: (e, { uid }) => {
    if (!uid || !e.matches("text")) return undefined;
    // Vertical terminal legends precede their markers. Resolve the printed
    // terminal prefix against an actual same-body marker, then against IR.
    const terminals = [
      ...e.parentElement.querySelectorAll("circle[data-loop-terminal]"),
    ].flatMap((marker) => {
      try {
        const [owner, key] = JSON.parse(
          marker.getAttribute("data-loop-terminal"),
        );
        return owner === uid ? [key] : [];
      } catch {
        return [];
      }
    });
    for (
      let line = e;
      line?.matches("text");
      line = line.previousElementSibling
    ) {
      const terminal = terminals.find((key) =>
        line.textContent.startsWith(key + ": "),
      );
      if (terminal) return terminal;
    }
    for (
      let previous = e.previousElementSibling;
      previous;
      previous = previous.previousElementSibling
    ) {
      if (previous.hasAttribute("data-loop-terminal")) {
        try {
          const [owner, key] = JSON.parse(
            previous.getAttribute("data-loop-terminal"),
          );
          return owner === uid ? key : undefined;
        } catch {
          return undefined;
        }
      }
      if (!previous.matches("text")) return undefined;
    }
    return undefined;
  },
  reportRuns: (
    e,
    rendered,
    { matrix, bounds, continuationOwner, point, h },
  ) => {
    if (!e.closest("[data-report-row]") && !continuationOwner(e))
      return undefined;
    const count = e.getNumberOfChars(),
      points = Array.from(rendered);
    const utf16 = count === rendered.length;
    if (!utf16 && count !== points.length)
      throw new h.IdentifierMeasurementError(
        "Identifier measurement: SVG character inventory differs from rendered text",
      );
    const runs = [];
    let offset = 0;
    for (let index = 0; index < points.length; index++) {
      const char = points[index],
        position = utf16 ? offset : index;
      const start = e.getStartPositionOfChar(position).matrixTransform(matrix);
      const anchor = point(start.x, start.y),
        bbox = bounds(e, e.getExtentOfChar(position));
      const last = runs.at(-1);
      if (last && Math.abs(last.anchor.y - anchor.y) <= 0.17) {
        last.text += char;
        const right = Math.max(last.bbox.x + last.bbox.w, bbox.x + bbox.w);
        const bottom = Math.max(last.bbox.y + last.bbox.h, bbox.y + bbox.h);
        last.bbox.x = Math.min(last.bbox.x, bbox.x);
        last.bbox.y = Math.min(last.bbox.y, bbox.y);
        last.bbox.w = right - last.bbox.x;
        last.bbox.h = bottom - last.bbox.y;
      } else runs.push({ text: char, anchor, bbox });
      offset += char.length;
    }
    return runs;
  },
  shapeClips: ({ e, point, root }) => {
    const clips = [];
    for (let owner = e; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner);
      if (
        css.display === "none" ||
        css.visibility === "hidden" ||
        Number(css.opacity) === 0
      )
        return null;
      if (css.maskImage && css.maskImage !== "none")
        throw Error("DQ-12 unsupported mask: " + css.maskImage);
      const ref = css.clipPath;
      if (ref && ref !== "none") {
        const id = ref.match(/url\(["']?(?:[^#]*#)([^"')]+)["']?\)/)?.[1],
          clip = id && root.querySelector(`#${CSS.escape(id)}`),
          rect = clip?.children[0];
        if (
          typeof owner.getScreenCTM !== "function" ||
          clip?.tagName.toLowerCase() !== "clippath" ||
          clip.children.length !== 1 ||
          rect?.tagName.toLowerCase() !== "rect" ||
          rect.rx.baseVal.value ||
          rect.ry.baseVal.value ||
          getComputedStyle(clip).clipPath !== "none"
        )
          throw Error("DQ-12 unsupported clip path: " + ref);
        let matrix = owner.getScreenCTM();
        if (clip.clipPathUnits.baseVal === 2) {
          const box = owner.getBBox();
          matrix = new DOMMatrix([
            matrix.a,
            matrix.b,
            matrix.c,
            matrix.d,
            matrix.e,
            matrix.f,
          ])
            .translate(box.x, box.y)
            .scale(box.width, box.height);
        }
        for (const node of [clip, rect]) {
          const transform = node.transform.baseVal.consolidate();
          if (transform) matrix = matrix.multiply(transform.matrix);
        }
        if (matrix.b !== 0 || matrix.c !== 0)
          throw Error("DQ-12 unsupported rotated clip path: " + ref);
        const length = (name) => {
          const value = rect[name].baseVal;
          return clip.clipPathUnits.baseVal === 2 && value.unitType === 2
            ? value.valueInSpecifiedUnits / 100
            : value.value;
        };
        const a = new DOMPoint(length("x"), length("y")).matrixTransform(
            matrix,
          ),
          b = new DOMPoint(
            length("x") + length("width"),
            length("y") + length("height"),
          ).matrixTransform(matrix),
          aa = point(a.x, a.y),
          bb = point(b.x, b.y);
        clips.push({
          x: Math.min(aa.x, bb.x),
          y: Math.min(aa.y, bb.y),
          w: Math.abs(aa.x - bb.x),
          h: Math.abs(aa.y - bb.y),
        });
      }
    }
    return clips;
  },
  routeShape: ({
    e,
    attr,
    identity,
    ownerKey,
    point,
    rr,
    shapeClips,
    sx,
    sy,
    visible,
  }) => {
    const id = identity(e),
      v = visible(e),
      css = getComputedStyle(e);
    if (
      !v ||
      !(id.wire || id.loopConductor || attr(e, "data-edge-key")) ||
      ["none", "rgb(255, 255, 255)"].includes(css.stroke)
    )
      return [];
    const m = e.getScreenCTM();
    let clips, clipError;
    try {
      clips = shapeClips(e);
    } catch (error) {
      clipError = error.message;
    }
    let points;
    if (e.matches("line"))
      points = [
        [e.x1.baseVal.value, e.y1.baseVal.value],
        [e.x2.baseVal.value, e.y2.baseVal.value],
      ].map(([x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(m);
        return point(p.x, p.y);
      });
    if (e.matches("polyline"))
      points = Array.from({ length: e.points.numberOfItems }, (_, i) => {
        const p = e.points.getItem(i).matrixTransform(m);
        return point(p.x, p.y);
      });
    return [
      {
        ...id,
        conductor: true,
        routePath: e.getAttribute("d"),
        points,
        routeMatrix: [
          m.a * sx,
          m.b * sy,
          m.c * sx,
          m.d * sy,
          (m.e - rr.x) * sx,
          (m.f - rr.y) * sy,
        ],
        viewport: v.clip,
        clips,
        clipError,
        edgeOwnerKey: attr(e, "data-edge-key")
          ? ownerKey(attr(e, "data-edge-key"), "edge")
          : undefined,
      },
    ];
  },
  routeGeometry: (c) => {
    const { root, vb } = c;
    const h = c.h;
    return {
      width: vb.width,
      height: vb.height,
      shapes: [...root.querySelectorAll("path,line,polyline")].flatMap((e) =>
        h.routeShape({ ...c, e }),
      ),
    };
  },
};
