// Store horizontal runs on the common sheet-millimetre grid.
export function terminalLabelInkRows(box, step, hit) {
  const rows = [];
  const firstX = Math.ceil(box.x / step),
    lastX = Math.floor((box.x + box.w) / step);
  const firstY = Math.ceil(box.y / step),
    lastY = Math.floor((box.y + box.h) / step);
  for (let row = firstY; row <= lastY; row++) {
    const runs = [];
    let start;
    for (let col = firstX; col <= lastX; col++) {
      if (hit({ x: col * step, y: row * step })) {
        start ??= col;
      } else if (start !== undefined) {
        runs.push([start, col - 1]);
        start = undefined;
      }
    }
    if (start !== undefined) runs.push([start, lastX]);
    if (runs.length) rows.push({ row, runs });
  }
  return rows;
}

// Compare painted ink runs to avoid pairing individual samples.
export function terminalLabelStrokeGap(c, label, shape, minimum) {
  const { rr, sx, sy, contains, glyphAt, intersect, h } = c;
  const step = 0.005;
  const labelRegion = intersect(
    label.bbox,
    h.expandClearanceBox(shape.bbox, minimum),
  );
  const strokeRegion = intersect(
    shape.bbox,
    h.expandClearanceBox(label.bbox, minimum),
  );
  if (
    labelRegion.w <= 0 ||
    labelRegion.h <= 0 ||
    strokeRegion.w <= 0 ||
    strokeRegion.h <= 0
  )
    return minimum;

  const ink = h.terminalLabelInkRows(labelRegion, step, (p) =>
    glyphAt(label, p),
  );
  if (!ink.length) return minimum;
  const stroke = h.terminalLabelInkRows(strokeRegion, step, (p) => {
    if (!shape.clips.every((clip) => contains(clip, p))) return false;
    const screen = new DOMPoint(rr.x + p.x / sx, rr.y + p.y / sy);
    return (
      shape.e.isPointInStroke(screen.matrixTransform(shape.inverse)) &&
      !shape.covers.some(
        (cover) =>
          contains(cover.bbox, p) &&
          cover.clips.every((clip) => contains(clip, p)) &&
          cover.e.isPointInFill(screen.matrixTransform(cover.inverse)),
      )
    );
  });
  const limit = (minimum / step) ** 2;
  let best = limit,
    first = 0;
  for (const { row, runs } of stroke) {
    while (
      first < ink.length &&
      ink[first].row < row &&
      (row - ink[first].row) ** 2 >= best
    )
      first++;
    for (let i = first; i < ink.length; i++) {
      const dy = (row - ink[i].row) ** 2;
      if (dy >= best) break;
      for (const [a, b] of runs)
        for (const [x, y] of ink[i].runs)
          best = Math.min(best, dy + Math.max(0, a - y, x - b) ** 2);
      if (best === 0) return best;
    }
  }
  return best === limit ? minimum : Math.sqrt(best) * step;
}

export function expandClearanceBox({ x, y, w, h }, pad) {
  return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad };
}

export function terminalLabelBody(c, owner) {
  const { visible, orders, intersect, sx, sy, h } = c;
  const shapes = owner.querySelectorAll(
    "path,line,polyline,polygon,rect,circle,ellipse",
  );
  return [...shapes].flatMap((e) => {
    if (
      !e.closest(
        "[data-circuit-mark],[data-function-interface],[data-magnetic-association],[data-symbol-id]",
      ) ||
      e.closest("[data-terminal-key],[data-terminal-attachment]") ||
      e.closest("[data-circuit-functions],[data-device-uid]") !== owner ||
      e.matches(".device-frame,.circuit-device-frame")
    )
      return [];
    const v = visible(e),
      css = getComputedStyle(e);
    const rgba = c.colour(css.stroke);
    if (
      !v ||
      !rgba?.[3] ||
      Number(css.opacity) === 0 ||
      Number(css.strokeOpacity) === 0 ||
      c
        .ancestors(e)
        .some((node) => Number(getComputedStyle(node).opacity) === 0)
    )
      return [];
    const m = e.getScreenCTM();
    // Only the broad phase uses a bounding box. Native hit tests resolve ink.
    const radius = Number.parseFloat(css.strokeWidth) / 2;
    const join = css.strokeLinejoin.startsWith("miter")
      ? Math.max(2, Number(css.strokeMiterlimit))
      : 2;
    const pad =
      radius *
      join *
      Math.max(Math.hypot(m.a, m.c) * sx, Math.hypot(m.b, m.d) * sy);
    const bbox = h.expandClearanceBox(v.b, pad);
    return [
      {
        e,
        bbox,
        inverse: m.inverse(),
        clips: [v.clip, ...c.shapeClips(e)],
        covers: c.occluders.filter((o) => {
          const shared = intersect(o.bbox, bbox);
          return o.order > orders.get(e) && shared.w > 0 && shared.h > 0;
        }),
      },
    ];
  });
}

export function terminalLabelClearances(c, minimum) {
  const { texts, elementsById, ids, h } = c;
  const bodies = new Map();
  return texts.flatMap((text) => {
    const e = elementsById.get(text.element),
      terminal = e?.closest("[data-terminal-key]"),
      owner = terminal?.parentElement?.closest(
        "[data-circuit-functions],[data-device-uid]",
      );
    if (!text.reviewPainted || !owner) return [];
    const label = {
      e,
      text,
      bbox: text.bbox,
      inverse: e.getScreenCTM().inverse(),
    };
    let nearest,
      gapMm = minimum;
    if (!bodies.has(owner)) bodies.set(owner, h.terminalLabelBody(c, owner));
    for (const shape of bodies.get(owner)) {
      const gap = h.terminalLabelStrokeGap(c, label, shape, gapMm);
      if (gap < gapMm) {
        gapMm = gap;
        nearest = shape;
      }
    }
    if (!nearest) return [];
    return [
      {
        caption: text,
        terminalKey: terminal.getAttribute("data-terminal-key"),
        bodyElement: ids.get(nearest.e),
        gapMm: Math.round(gapMm * 1000) / 1000,
        minimumMm: minimum,
      },
    ];
  });
}
