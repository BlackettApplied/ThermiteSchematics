export function shapeVisibility(root, box, k, rr, inter) {
  return function visible(e, stroke = false) {
    if (e.closest("defs,clipPath,mask,symbol,pattern")) return null;
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility !== "visible") return null;
    for (let a = e; a && a !== root.parentElement; a = a.parentElement)
      if (
        +getComputedStyle(a).opacity === 0 ||
        getComputedStyle(a).display === "none"
      )
        return null;
    let b = box(e);
    if (stroke && cs.stroke !== "none") {
      const a = e.getScreenCTM(),
        s =
          (parseFloat(cs.strokeWidth) *
            Math.max(Math.hypot(a.a, a.b), Math.hypot(a.c, a.d)) *
            k) /
          2;
      b = { x: b.x - s, y: b.y - s, w: b.w + 2 * s, h: b.h + 2 * s };
    }
    if (!b.w || !b.h) return null;
    for (let a = e.parentElement; a && a !== root; a = a.parentElement)
      if (a.tagName === "svg" && getComputedStyle(a).overflow !== "visible") {
        const parent = a.parentElement.getScreenCTM(),
          own = a.transform?.baseVal?.consolidate()?.matrix,
          ctm = own ? parent.multiply(own) : parent;
        const x = a.x.baseVal.value,
          y = a.y.baseVal.value,
          w = a.width.baseVal.value,
          h = a.height.baseVal.value,
          pts = [
            [x, y],
            [x + w, y],
            [x, y + h],
            [x + w, y + h],
          ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(ctm)),
          xs = pts.map((q) => (q.x - rr.x) * k),
          ys = pts.map((q) => (q.y - rr.y) * k);
        b = inter(b, {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        });
        if (!b) return null;
      }
    return b;
  };
}

export function shapeGeometry(visibility) {
  const root = document.querySelector("body>svg"),
    rr = root.getBoundingClientRect(),
    W = root.viewBox.baseVal.width,
    H = root.viewBox.baseVal.height,
    k = W / rr.width;
  const all = [
    ...root.querySelectorAll(
      "text,path,line,rect,circle,ellipse,polygon,polyline,use,image",
    ),
  ];
  all.forEach((e, i) => e.setAttribute("data-ext-id", i));
  const box = (e) => {
      const b = e.getBoundingClientRect();
      return {
        x: (b.x - rr.x) * k,
        y: (b.y - rr.y) * k,
        w: b.width * k,
        h: b.height * k,
      };
    },
    inter = (a, b) => {
      const x = Math.max(a.x, b.x),
        y = Math.max(a.y, b.y),
        r = Math.min(a.x + a.w, b.x + b.w),
        d = Math.min(a.y + a.h, b.y + b.h);
      return r > x && d > y ? { x, y, w: r - x, h: d - y } : null;
    };
  const border = [...root.children].find(
      (e) => e.tagName === "rect" && e.getAttribute("fill") === "none",
    ),
    m = box(border).x,
    T = Math.max(
      ...[...root.children]
        .filter((e) => e.tagName === "path")
        .map(box)
        .filter((b) => b.h < 0.02 && b.w > box(border).w * 0.8)
        .map((b) => b.y),
    );
  const visible = visibility(root, box, k, rr, inter);
  const id = (e) => +e.getAttribute("data-ext-id"),
    zoneEls = all.filter(
      (e) =>
        e.hasAttribute("data-oracle-zone-text") ||
        e.hasAttribute("data-oracle-zone-tick"),
    ),
    zoneSet = new Set(zoneEls),
    zones = zoneEls
      .map((e) => ({
        id: id(e),
        side:
          e.getAttribute("data-oracle-zone-text") ||
          e.getAttribute("data-oracle-zone-tick"),
        text: e.textContent || "tick",
        bbox: visible(e, e.tagName !== "text"),
      }))
      .filter((z) => z.bbox);
  const shapes = [];
  for (const e of all) {
    if (e.tagName === "text" || zoneSet.has(e) || e === border) continue;
    const cs = getComputedStyle(e),
      raw = box(e);
    if (
      e.parentElement === root &&
      (raw.w > W - 2 * m - 0.1 || raw.y >= T - 0.01)
    )
      continue;
    const b = visible(e, true);
    if (!b || b.y >= T || (cs.stroke === "none" && cs.fill === "none"))
      continue;
    const rgb = cs.fill.match(/[\d.]+/g)?.map(Number) ?? [],
      white = rgb.length >= 3 && rgb.slice(0, 3).every((v) => v >= 245);
    shapes.push({
      id: id(e),
      tag: e.tagName,
      bbox: b,
      preserveFill: white,
      wire:
        ["path", "line", "polyline"].includes(e.tagName) &&
        cs.stroke !== "none",
      stub: !!e.closest("a[data-continuation-id]"),
    });
  }
  const labels = [];
  for (const a of root.querySelectorAll("a[data-continuation-id]")) {
    const path = [...a.children].find((e) => e.tagName === "path"),
      nums = path
        ?.getAttribute("d")
        .match(/[-+]?(?:\d*\.)?\d+/g)
        ?.map(Number);
    if (!nums || nums.length !== 4) continue;
    const [x, y, X, Y] = nums,
      side =
        Math.abs(y - Y) < 0.001
          ? X > x
            ? "right"
            : "left"
          : Y > y
            ? "bottom"
            : "top";
    for (const e of a.querySelectorAll("text")) {
      const b = visible(e);
      if (b)
        labels.push({
          id: id(e),
          text: e.textContent,
          bbox: b,
          side,
          cut: { x, y },
          stubTip: { x: X, y: Y },
          bank:
            side +
            ":" +
            (side === "left" || side === "right" ? x : y).toFixed(3),
          anchorX: +e.getAttribute("x"),
          anchorY: +e.getAttribute("y"),
          cid: a.getAttribute("data-continuation-id"),
          end: a.getAttribute("data-continuation-end"),
        });
    }
  }
  const near = (a, b, g = 0.2) =>
    a.x < b.x + b.w + g &&
    b.x < a.x + a.w + g &&
    a.y < b.y + b.h + g &&
    b.y < a.y + a.h + g;
  const zoneShape = zones.flatMap((z) =>
      shapes.filter((s) => near(z.bbox, s.bbox)).map((s) => ({ a: z, b: s })),
    ),
    labelWire = labels.flatMap((t) =>
      shapes
        .filter((s) => s.wire && near(t.bbox, s.bbox))
        .map((s) => ({ a: t, b: s })),
    );
  const bottom = zones.filter((z) => z.side === "bottom" && z.text !== "tick"),
    ruleEls = [...root.children].filter(
      (e) =>
        e.tagName === "path" &&
        Math.abs(box(e).y - T) < 0.002 &&
        box(e).w > W - 2 * m - 0.1,
    );
  return {
    W,
    H,
    m,
    T,
    zones,
    shapes,
    labels,
    zoneShape,
    labelWire,
    bottom,
    ruleIds: ruleEls.map(id),
    styles: all.map((e) => ({ id: id(e), css: e.getAttribute("style") })),
  };
}
