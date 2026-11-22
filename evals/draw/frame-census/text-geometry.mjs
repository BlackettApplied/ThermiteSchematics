export function textVisibility(root, rr, k, box, inter, clipped) {
  return function visible(e) {
    if (e.closest("defs,clipPath,mask,symbol,pattern")) return null;
    const cs = getComputedStyle(e);
    if (
      cs.visibility !== "visible" ||
      cs.display === "none" ||
      (cs.fill === "none" && cs.stroke === "none")
    )
      return null;
    for (let p = e; p && p !== root.parentElement; p = p.parentElement)
      if (
        +getComputedStyle(p).opacity === 0 ||
        getComputedStyle(p).display === "none"
      )
        return null;
    let b = box(e);
    if (!b.w || !b.h) return null;
    for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
      if (p.tagName === "svg" && getComputedStyle(p).overflow !== "visible") {
        const a = p.parentElement.getScreenCTM(),
          own = p.transform?.baseVal?.consolidate()?.matrix,
          mx = own ? a.multiply(own) : a;
        const x = p.x.baseVal.value,
          y = p.y.baseVal.value,
          w = p.width.baseVal.value,
          h = p.height.baseVal.value;
        const pts = [
          [x, y],
          [x + w, y],
          [x, y + h],
          [x + w, y + h],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(mx));
        const xs = pts.map((q) => (q.x - rr.x) * k),
          ys = pts.map((q) => (q.y - rr.y) * k),
          clip = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys),
          };
        b = inter(b, clip);
        if (!b) {
          clipped.push({
            id: +e.getAttribute("data-census-id"),
            text: e.textContent,
            reason: "nested-viewport",
          });
          return null;
        }
      }
    }
    return b;
  };
}

export function textGeometry(visibility) {
  const root = document.querySelector("body>svg"),
    rr = root.getBoundingClientRect(),
    W = root.viewBox.baseVal.width,
    H = root.viewBox.baseVal.height,
    k = W / rr.width;
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return {
      x: (r.x - rr.x) * k,
      y: (r.y - rr.y) * k,
      w: r.width * k,
      h: r.height * k,
    };
  };
  const inter = (a, b) => {
    const x = Math.max(a.x, b.x),
      y = Math.max(a.y, b.y),
      r = Math.min(a.x + a.w, b.x + b.w),
      d = Math.min(a.y + a.h, b.y + b.h);
    return r > x && d > y ? { x, y, w: r - x, h: d - y } : null;
  };
  const frame = [...root.children].find(
      (e) => e.tagName === "rect" && e.getAttribute("fill") === "none",
    ),
    fb = box(frame),
    m = fb.x;
  const rules = [...root.children]
      .filter((e) => e.tagName === "path")
      .map((e) => ({ e, b: box(e) }))
      .filter((v) => v.b.h < 0.02 && v.b.w > fb.w * 0.8)
      .sort((a, b) => a.b.y - b.b.y),
    top = rules.at(-1).b.y;
  const all = [...root.querySelectorAll("text,path,rect")];
  all.forEach((e, i) => e.setAttribute("data-census-id", i));
  const direct = [...root.children],
    ztexts = direct.filter((e) => e.hasAttribute("data-oracle-zone-text"));
  const zticks = direct.filter((e) => e.hasAttribute("data-oracle-zone-tick"));
  const zones = [...ztexts, ...zticks].map((e) => ({
    id: +e.getAttribute("data-census-id"),
    text: e.textContent || "tick",
    kind: e.tagName,
    side: /^\d+$/.test(e.textContent)
      ? box(e).y < H / 2
        ? "top"
        : "bottom"
      : /^[A-Z]$/.test(e.textContent)
        ? box(e).x < W / 2
          ? "left"
          : "right"
        : box(e).w < 0.02
          ? box(e).y < H / 2
            ? "top"
            : "bottom"
          : box(e).x < W / 2
            ? "left"
            : "right",
    bbox: box(e),
  }));
  const zset = new Set([...ztexts, ...zticks]),
    clipped = [],
    texts = [];
  const visible = visibility(root, rr, k, box, inter, clipped);
  for (const e of root.querySelectorAll("text")) {
    if (zset.has(e)) continue;
    const b = visible(e);
    if (b)
      texts.push({
        id: +e.getAttribute("data-census-id"),
        text: e.textContent,
        baseline:
          ((e.y.baseVal.numberOfItems
            ? new DOMPoint(
                e.x.baseVal.getItem(0).value,
                e.y.baseVal.getItem(0).value,
              ).matrixTransform(e.getScreenCTM()).y
            : NaN) -
            rr.y) *
          k,
        bbox: b,
        continuation: !!e.closest("a[data-continuation-id]"),
      });
  }
  const near = (a, b, g = 0.55) =>
    a.x < b.x + b.w + g &&
    b.x < a.x + a.w + g &&
    a.y < b.y + b.h + g &&
    b.y < a.y + a.h + g;
  const pairs = zones.flatMap((z) =>
    texts
      .filter((t) => near(z.bbox, t.bbox))
      .map((t) => ({ zone: z, text: t })),
  );
  const laneRects = [
    { side: "left", x: m, y: m + 13, w: 2.6, h: top - 3 - m - 13 },
    {
      side: "right",
      x: W - m - 2.6,
      y: m + 13,
      w: 2.6,
      h: top - 3 - m - 13,
    },
    { side: "top", x: m, y: m + 7.8, w: W - 2 * m, h: 5.2 },
    { side: "bottom", x: m, y: top - 3, w: W - 2 * m, h: 3 },
  ];
  const lanePairs = laneRects.flatMap((l) =>
    texts.filter((t) => near(l, t.bbox, 0)).map((t) => ({ lane: l, text: t })),
  );
  const titleRules = direct.flatMap((e) => {
    if (e.tagName === "rect" && e.getAttribute("stroke-width") === "0.25") {
      const b = box(e);
      return [
        {
          id: +e.getAttribute("data-census-id"),
          x: b.x,
          y: b.y,
          w: b.w,
          h: 0.25,
        },
        {
          id: +e.getAttribute("data-census-id"),
          x: b.x,
          y: b.y + b.h,
          w: b.w,
          h: 0.25,
        },
      ];
    }
    return [];
  });
  const titleHits = texts
    .filter((t) => t.bbox.y >= top)
    .flatMap((t) =>
      titleRules
        .filter((r) => near(r, t.bbox, 0))
        .map((r) => ({ text: t, rule: r })),
    );
  return {
    W,
    H,
    m,
    titleTop: top,
    zones,
    texts,
    pairs,
    lanePairs,
    laneRects,
    titleHits,
    titleRuleIds: [...new Set(titleRules.map((r) => r.id))],
    clipped,
  };
}
