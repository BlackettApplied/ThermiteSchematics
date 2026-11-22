// Executed in the browser. No renderer attributes are accepted as evidence.
export function identifyZones() {
  const root = document.querySelector("body>svg"),
    direct = [...root.children],
    rr = root.getBoundingClientRect(),
    W = root.viewBox.baseVal.width,
    k = W / rr.width,
    box = (e) => {
      const b = e.getBoundingClientRect();
      return {
        x: (b.x - rr.x) * k,
        y: (b.y - rr.y) * k,
        w: b.width * k,
        h: b.height * k,
      };
    },
    border = direct.find(
      (e) => e.tagName === "rect" && e.getAttribute("fill") === "none",
    ),
    m = box(border).x;
  for (const e of root.querySelectorAll(
    "[data-oracle-zone-text],[data-oracle-zone-tick]",
  )) {
    e.removeAttribute("data-oracle-zone-text");
    e.removeAttribute("data-oracle-zone-tick");
  }
  const rules = direct
      .filter((e) => e.tagName === "path")
      .map(box)
      .filter((b) => b.h < 0.02 && b.w > box(border).w * 0.8),
    T = Math.max(...rules.map((b) => b.y));
  const texts = direct.filter((e) => e.tagName === "text");
  function sequences(candidates, values, axis) {
    const out = [];
    for (const a of candidates.filter((e) => e.textContent === values[0]))
      for (const b of candidates.filter(
        (e) => e.textContent === values.at(-1),
      )) {
        const coord = (e) => +(e.getAttribute(axis) || 0),
          step = (coord(b) - coord(a)) / (values.length - 1);
        if (step < 5) continue;
        const cross = axis === "x" ? "y" : "x",
          base = +(a.getAttribute(cross) || 0);
        const seq = values.map((v, i) =>
          candidates.filter(
            (e) =>
              e.textContent === v &&
              Math.abs(coord(e) - coord(a) - step * i) < 0.003 &&
              Math.abs(+(e.getAttribute(cross) || 0) - base) < 0.003,
          ),
        );
        if (seq.every((s) => s.length === 1)) out.push(seq.map((s) => s[0]));
      }
    return out;
  }
  const nums = ["1", "2", "3", "4", "5", "6"],
    letters = ["A", "B", "C", "D"];
  const top = sequences(
      texts.filter((e) => box(e).y < m + 14),
      nums,
      "x",
    ),
    bottom = sequences(
      texts.filter((e) => box(e).y > T - 5 && box(e).y < T),
      nums,
      "x",
    );
  const left = sequences(
      texts.filter(
        (e) => box(e).x < m + 4 && box(e).y > m + 13 && box(e).y < T - 3,
      ),
      letters,
      "y",
    ),
    right = sequences(
      texts.filter(
        (e) =>
          box(e).x + box(e).w > W - m - 4 &&
          box(e).y > m + 13 &&
          box(e).y < T - 3,
      ),
      letters,
      "y",
    );
  const match = (a, b, axis) =>
    a.every(
      (e, i) =>
        Math.abs(+e.getAttribute(axis) - +b[i].getAttribute(axis)) < 0.003,
    );
  const horizontal = top.flatMap((a) =>
      bottom.filter((b) => match(a, b, "x")).map((b) => [a, b]),
    ),
    vertical = left.flatMap((a) =>
      right.filter((b) => match(a, b, "y")).map((b) => [a, b]),
    );
  if (horizontal.length !== 1 || vertical.length !== 1)
    throw Error(
      "Ambiguous/incomplete independently measured zone strips: " +
        horizontal.length +
        "/" +
        vertical.length,
    );
  const [[zt, zb]] = horizontal,
    [[zl, zr]] = vertical;
  for (const [side, group] of [
    ["top", zt],
    ["bottom", zb],
    ["left", zl],
    ["right", zr],
  ])
    for (const e of group) e.setAttribute("data-oracle-zone-text", side);
  const x0 = +zt[0].getAttribute("x"),
    dx = (+zt.at(-1).getAttribute("x") - x0) / 5,
    y0 = +zl[0].getAttribute("y"),
    dy = (+zl.at(-1).getAttribute("y") - y0) / 3;
  for (const e of direct.filter((e) => e.tagName === "path")) {
    const b = box(e);
    let side;
    if (
      b.w < 0.02 &&
      b.h <= 2.1 &&
      Array.from({ length: 7 }, (_, i) => x0 + dx * (i - 0.5)).some(
        (x) => Math.abs(b.x - x) < 0.003,
      )
    ) {
      if (b.y >= m + 7.7 && b.y < m + 11) side = "top";
      if (b.y >= T - 2.1 && b.y < T) side = "bottom";
    }
    if (
      b.h < 0.02 &&
      b.w <= 2.1 &&
      Array.from({ length: 5 }, (_, i) => y0 + dy * (i - 0.5)).some(
        (y) => Math.abs(b.y - y) < 0.003,
      )
    ) {
      if (b.x < m + 3) side = "left";
      if (b.x + b.w > W - m - 3) side = "right";
    }
    if (side) e.setAttribute("data-oracle-zone-tick", side);
  }
  for (const [side, count] of [
    ["top", 7],
    ["bottom", 7],
    ["left", 5],
    ["right", 5],
  ])
    if (
      direct.filter((e) => e.getAttribute("data-oracle-zone-tick") === side)
        .length !== count
    )
      throw Error(`Incomplete independently measured ${side} ticks`);
  return {
    labels: 20,
    ticks: direct.filter((e) => e.hasAttribute("data-oracle-zone-tick")).length,
    margin: m,
    titleTop: T,
  };
}
