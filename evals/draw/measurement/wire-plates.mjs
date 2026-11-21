// Browser-only paint measurements for DQ-16. Alpha, transforms, order and
// clips come from the painted SVG. The label group only locates candidates.
export function wirePlateGeometry(c) {
  const fills = new Map(),
    plates = [];
  for (const t of c.texts) {
    const e = c.elementsById.get(t.element);
    if (!e) continue;
    for (const shape of c.h.wirePlateShapes(e)) {
      if (!fills.has(shape)) fills.set(shape, c.h.wirePlateFill(c, shape));
      const paint = fills.get(shape);
      if (paint) plates.push({ ...paint, text: t.element });
    }
  }
  if (!plates.length) return { plates, strokes: {}, markers: [], leaders: [] };
  const strokes = Object.fromEntries(
    c.shapes
      .filter((s) => s.conductor && s.stroke > 0)
      .map((s) => [s.element, c.h.wirePlateStroke(c, s)]),
  );
  return {
    plates,
    strokes,
    markers: c.h.wirePlateMarkers(c),
    leaders: c.h.wirePlateLeaders(c),
  };
}

export function wirePlateShapes(e) {
  const selector = "path,polygon,polyline,rect,circle,ellipse,use";
  const group = e.closest("[data-wire-label],[data-wiring-conductor]");
  if (group) return [...group.querySelectorAll(selector)];
  if (!e.classList.contains("label-conductor")) return [];
  // Rooted captions share one SVG layer. A text element terminates each
  // caption, so collect the local non-text candidates in that sequence.
  const shapes = [];
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (p.matches("text") || p.querySelector("text")) break;
    if (p.matches(selector)) shapes.push(p);
    else shapes.push(...p.querySelectorAll(selector));
  }
  return shapes;
}

export function wirePlateClip(c, e, viewport) {
  try {
    const clips = c.shapeClips(e);
    return (
      clips?.reduce((box, clip) => c.intersect(box, clip), viewport) ?? null
    );
  } catch {
    return null;
  }
}

export function wirePlateAlpha(c, e, property) {
  const css = getComputedStyle(e);
  const paint = css[property];
  if (paint === "none") return 0;
  const rgba = c.colour(paint);
  // Non-solid paint such as a pattern still has a fill geometry.
  let alpha = (rgba ? rgba[3] / 255 : 1) * Number(css[property + "Opacity"]);
  for (let node = e; node; node = node.parentElement)
    alpha *= Number(getComputedStyle(node).opacity);
  return alpha;
}

export function wirePlateFill(c, e) {
  const v = c.visible(e);
  if (!v || c.h.wirePlateAlpha(c, e, "fill") <= 0) return undefined;
  const clip = c.h.wirePlateClip(c, e, v.clip);
  const bbox = clip ? c.intersect(v.b, clip) : v.b;
  if (bbox.w <= 0 || bbox.h <= 0) return undefined;
  return {
    element: c.ids.get(e),
    order: c.orders.get(e),
    bbox,
    heightMm: v.b.h,
    clip,
  };
}

export function wirePlateStroke(c, s) {
  const e = c.elementsById.get(s.element);
  return {
    order: c.orders.get(e),
    painted: c.h.wirePlateAlpha(c, e, "stroke") > 0,
    clip: c.h.wirePlateClip(c, e, s.viewport),
  };
}

export function wirePlateMarkers(c) {
  return [...c.root.querySelectorAll("circle,ellipse")].flatMap((e) => {
    const v = c.visible(e);
    if (!v) return [];
    const css = getComputedStyle(e);
    const stroke = c.h.wirePlateAlpha(c, e, "stroke");
    if (stroke <= 0 && c.h.wirePlateAlpha(c, e, "fill") <= 0) return [];
    const m = e.getScreenCTM(),
      radius = stroke > 0 ? parseFloat(css.strokeWidth) / 2 : 0;
    const dx = radius * Math.hypot(m.a, m.c) * c.sx,
      dy = radius * Math.hypot(m.b, m.d) * c.sy;
    const { x, y, w, h } = v.b;
    return [
      {
        bbox: { x: x - dx, y: y - dy, w: w + 2 * dx, h: h + 2 * dy },
        junction: e.matches(
          ".junction-dot,[data-wiring-junction],[data-circuit-junction]",
        ),
        order: c.orders.get(e),
        clip: c.h.wirePlateClip(c, e, v.clip),
      },
    ];
  });
}

export function wirePlateLeaders(c) {
  const selector = "path.wire-label-leader[data-label-leader-owner]";
  return [...c.root.querySelectorAll(selector)].flatMap((e) => {
    const v = c.visible(e);
    if (!v || e.closest("[data-circuit-conductor],[data-wiring-conductor]"))
      return [];
    // An annotation is one open path. A disconnected pair of dashes cannot
    // establish a connection just by putting both subpaths in one element.
    const d = e.getAttribute("d") ?? "";
    if (d.match(/[Mm]/g)?.length !== 1 || /[Zz]/.test(d)) return [];
    const m = e.getScreenCTM(),
      length = e.getTotalLength(),
      end = (distance) => {
        const p = e.getPointAtLength(distance).matrixTransform(m);
        return c.point(p.x, p.y);
      },
      segments = c.strokeInk(e, v.clip, m);
    if (!segments.length) return [];
    return [
      {
        wire: e.getAttribute("data-label-leader-owner"),
        start: end(0),
        end: end(length),
        segments,
      },
    ];
  });
}
