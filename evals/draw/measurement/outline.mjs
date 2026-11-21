// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function collectConnectors(c) {
  const { ids, point, root, texts } = c;
  const connectors = [...root.querySelectorAll('a[href^="#sheet-"]')].flatMap(
    (a) => {
      const line = a.querySelector("path,line");
      const owned = texts.filter((t) => t.continuationLink === ids.get(a));
      const rows = [];
      for (const t of owned.slice().sort((a, b) => a.anchor.y - b.anchor.y)) {
        const last = rows.at(-1);
        if (last && Math.abs(last.y - t.anchor.y) <= 0.17)
          last.text += t.renderedString ?? t.text;
        else rows.push({ y: t.anchor.y, text: t.renderedString ?? t.text });
      }
      const references = rows
        .map((t) => t.text.match(/^([^\s/]+)\s*\//)?.[1])
        .filter(Boolean);
      const idsForLink = [...new Set(references)].filter(
        (id) => references.filter((r) => r === id).length === 1,
      );
      if (!line || typeof line.getPointAtLength !== "function") return [];
      const p = line.getPointAtLength(0),
        m = line.getScreenCTM(),
        q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return idsForLink.map((id) => ({
        id,
        element: ids.get(a),
        toSheet: Number(a.getAttribute("href").slice(7)),
        anchor: point(q.x, q.y),
      }));
    },
  );
  Object.assign(c, { connectors });
}

export const paintedShapeBounds = (
  e,
  bbox,
  viewport,
  clips,
  points,
  css,
  { matrix, intersect, point, rr, sx, sy },
) => {
  if (clips === null) return null;
  const masks = [viewport, ...clips];
  if (
    masks.every(
      (c) =>
        bbox.x >= c.x &&
        bbox.y >= c.y &&
        bbox.x + bbox.w <= c.x + c.w &&
        bbox.y + bbox.h <= c.y + c.h,
    )
  )
    return bbox;
  const clip = masks.reduce(intersect);
  if (clip.w <= 0 || clip.h <= 0) return null;
  const inverse = matrix.inverse(),
    candidates = [];
  const include = (p) => {
    if (
      p.x < clip.x ||
      p.y < clip.y ||
      p.x > clip.x + clip.w ||
      p.y > clip.y + clip.h
    )
      return;
    const local = new DOMPoint(
      p.x / sx + rr.x,
      p.y / sy + rr.y,
    ).matrixTransform(inverse);
    if (
      (css.fill !== "none" &&
        Number(css.fillOpacity) > 0 &&
        e.isPointInFill(local)) ||
      (css.stroke !== "none" &&
        Number(css.strokeOpacity) > 0 &&
        e.isPointInStroke(local))
    )
      candidates.push(p);
  };
  // Exact command endpoints retain corners and disjoint subpath ends which
  // need not coincide with the existing outline sampling phases.
  if (e.tagName.toLowerCase() === "path") {
    const d = e.getAttribute("d") ?? "",
      sizes = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
    let i = 0,
      command = "",
      x = 0,
      y = 0,
      start;
    const skip = () => {
      while (i < d.length && /[\s,]/.test(d[i])) i++;
    };
    const parameter = (flag) => {
      skip();
      // Arc flags are single characters, including compact forms like 001.
      const token = d
        .slice(i)
        .match(
          flag ? /^[01]/ : /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/,
        );
      if (!token || !Number.isFinite(Number(token[0])))
        throw Error("DQ-12 invalid SVG path");
      i += token[0].length;
      return Number(token[0]);
    };
    while (i < d.length) {
      skip();
      if (i === d.length) break;
      if (/^[a-zA-Z]$/.test(d[i])) command = d[i++];
      const kind = command.toUpperCase(),
        relative = command !== kind;
      if (kind === "Z") {
        if (!start) throw Error("DQ-12 invalid SVG path");
        [x, y] = start;
        command = "";
      } else {
        const count = sizes[kind];
        if (!count) throw Error("DQ-12 invalid SVG path");
        const a = Array.from({ length: count }, (_, j) =>
          parameter(kind === "A" && (j === 3 || j === 4)),
        );
        if (kind === "H") x = relative ? x + a[0] : a[0];
        else if (kind === "V") y = relative ? y + a[0] : a[0];
        else {
          x = (relative ? x : 0) + a.at(-2);
          y = (relative ? y : 0) + a.at(-1);
        }
        if (kind === "M") {
          start = [x, y];
          command = relative ? "l" : "L";
        }
      }
      const p = new DOMPoint(x, y).matrixTransform(matrix);
      include(point(p.x, p.y));
    }
  }
  // Rectangles and ellipse extrema have exact native bbox points too.
  for (const x of [bbox.x, bbox.x + bbox.w / 2, bbox.x + bbox.w])
    for (const y of [bbox.y, bbox.y + bbox.h / 2, bbox.y + bbox.h])
      include({ x, y });
  // Clip the existing 0.2 mm outline samples. Native hit tests reject phantom
  // segments between SVG subpaths and respect fill holes and dashed strokes.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    let low = 0,
      high = 1;
    for (const [p, q] of [
      [-dx, a.x - clip.x],
      [dx, clip.x + clip.w - a.x],
      [-dy, a.y - clip.y],
      [dy, clip.y + clip.h - a.y],
    ]) {
      if (p === 0) {
        if (q < 0) high = -1;
      } else if (p < 0) low = Math.max(low, q / p);
      else high = Math.min(high, q / p);
    }
    if (low <= high) {
      include({ x: a.x + low * dx, y: a.y + low * dy });
      include({ x: a.x + high * dx, y: a.y + high * dy });
    }
  }
  // A clip wholly inside a fill has no outline crossing it.
  if (css.fill !== "none" && Number(css.fillOpacity) > 0)
    for (const x of [clip.x, clip.x + clip.w])
      for (const y of [clip.y, clip.y + clip.h]) include({ x, y });
  if (!candidates.length) return null;
  const xs = candidates.map((p) => p.x),
    ys = candidates.map((p) => p.y),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
