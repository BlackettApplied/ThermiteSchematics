// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function tagSample(c) {
  const { own, layers, p, layerHit, blend, contrast } = c;
  let background = [255, 255, 255],
    known = true;
  const after = [];
  for (const layer of layers) {
    const hit = layerHit(layer, p);
    if (!hit) continue;
    if (layer.order > own.order) {
      after.push({ layer, hit });
      continue;
    }
    if (hit.unknown) {
      known = false;
      continue;
    }
    // Earlier lettering supplies no continuous substrate for a row
    // which erases its glyphs. Shape paint establishes the background.
    if (layer.text) continue;
    background = blend(hit.colour, hit.alpha, background);
    if (hit.alpha >= 0.999) known = true;
  }
  if (!known) return false;
  let foreground = blend(own.fill, own.alpha, background);
  for (const { layer, hit } of after) {
    if (hit.unknown) return false;
    foreground = blend(hit.colour, hit.alpha, foreground);
    // Shape paint covers both glyphs and surrounding substrate; text
    // covers its own glyphs only. Translucent paint also changes contrast.
    if (!layer.text) background = blend(hit.colour, hit.alpha, background);
  }
  const ratio = contrast(foreground, background);
  return { ratio, after };
}

export function strokeIntervals(c) {
  const {
    e,
    clip,
    matrix,
    subdivide,
    strokePainted,
    filled,
    length,
    count,
    clips,
    orders,
    occluders,
    point,
    contains,
  } = c;
  const intervals = [],
    pieces = [];
  let start,
    previous,
    previousPainted = false;
  const order = orders.get(e);
  const covers = occluders.filter((o) => o.order > order);
  for (let i = 0; i <= count; i++) {
    const local = e.getPointAtLength((length * i) / count),
      q = local.matrixTransform(matrix),
      p = point(q.x, q.y);
    const painted =
      ((strokePainted && e.isPointInStroke(local)) ||
        (filled && e.isPointInFill(local))) &&
      [clip, ...clips].every((b) => contains(b, p)) &&
      !covers.some(
        (o) =>
          contains(o.bbox, p) &&
          o.clips.every((b) => contains(b, p)) &&
          o.e.isPointInFill(new DOMPoint(q.x, q.y).matrixTransform(o.inverse)),
      );
    if (subdivide && painted && previousPainted) pieces.push([previous, p]);
    previousPainted = painted;
    if (painted && !start) start = p;
    if ((!painted || i === count) && start) {
      intervals.push([start, painted ? p : previous]);
      start = undefined;
    }
    previous = p;
  }
  return subdivide ? pieces : intervals;
}

export function tagLayerFields1(c) {
  const {
    b,
    clips,
    colour,
    css,
    e,
    fill,
    inverse,
    orders,
    pad,
    strokeAlpha,
    strokeColour,
    strokeWidth,
    text,
    unknown,
    v,
  } = c;
  return {
    e,
    text,
    inverse,
    clips: clips && [v.clip, ...clips],
    order: orders.get(e),
    fill: colour(css.fill),
    alpha: fill.alpha,
    stroke: strokeColour,
    strokeAlpha,
    strokeWidth,
    strokeFirst: css.paintOrder.startsWith("stroke"),
    unknown,
    bbox: {
      x: b.x - pad,
      y: b.y - pad,
      w: b.w + pad * 2,
      h: b.h + pad * 2,
    },
  };
}

export function tagLayer(c) {
  const {
    e,
    colour,
    fillPaint,
    shapeClips,
    sx,
    sy,
    textPaintRows,
    visible,
    h,
  } = c;
  if (
    !e.matches(
      "path,polygon,polyline,rect,circle,ellipse,image,foreignObject,text,tspan",
    )
  )
    return [];
  const text = textPaintRows.get(e);
  if (e.matches("text,tspan") && !text) return [];
  const v = visible(e);
  if (!v) return [];
  const css = getComputedStyle(e),
    fill = fillPaint(e),
    strokeColour = colour(css.stroke);
  let opacity = 1,
    filtered = false;
  for (let node = e; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    opacity *= Number(style.opacity);
    filtered ||= style.filter !== "none";
  }
  if (opacity === 0) return [];
  const inverse = e.getScreenCTM().inverse(),
    scale = Math.max(
      Math.hypot(inverse.a, inverse.b),
      Math.hypot(inverse.c, inverse.d),
    ),
    strokeWidth = parseFloat(css.strokeWidth),
    strokeAlpha =
      ((strokeColour?.[3] ?? 0) / 255) * Number(css.strokeOpacity) * opacity;
  let clips;
  try {
    clips = shapeClips(e);
  } catch {
    clips = null;
  }
  const boxPaint = e.matches("image,foreignObject"),
    unknown =
      boxPaint || filtered || (css.fill !== "none" && !colour(css.fill));
  const pad =
      strokeAlpha > 0 ? ((strokeWidth / scale) * Math.max(sx, sy)) / 2 : 0,
    b = text?.bbox ?? v.b;
  const s = {
    ...c,
    text,
    inverse,
    clips,
    v,
    css,
    fill,
    strokeColour,
    strokeAlpha,
    strokeWidth,
    unknown,
    b,
    pad,
  };
  return [{ ...h.tagLayerFields1(s) }];
}

export function paintCanvas(c) {
  const paintCanvas = document.createElement("canvas");
  paintCanvas.width = paintCanvas.height = 1;
  const paintContext = paintCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const colourCache = new Map();
  Object.assign(c, { paintCanvas, paintContext, colourCache });
}

export const colour = ({ fill, colourCache, paintContext }) => {
  if (!colourCache.has(fill)) {
    let rgba = null;
    if (CSS.supports("color", fill)) {
      paintContext.clearRect(0, 0, 1, 1);
      paintContext.fillStyle = fill;
      paintContext.fillRect(0, 0, 1, 1);
      rgba = [...paintContext.getImageData(0, 0, 1, 1).data];
    }
    colourCache.set(fill, rgba);
  }
  return colourCache.get(fill);
};

export const fillPaint = ({ e, colour }) => {
  const css = getComputedStyle(e),
    rgba = colour(css.fill);
  let alpha = rgba ? (rgba[3] / 255) * Number(css.fillOpacity) : 0;
  for (let node = e; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      ["hidden", "collapse"].includes(style.visibility)
    )
      alpha = 0;
    alpha *= Number(style.opacity);
  }
  return {
    alpha,
    background: rgba?.slice(0, 3).every((c) => c === 255) ?? false,
  };
};

export function collectOccluders(c) {
  const { all, fillPaint, orders, shapeClips, visible } = c;
  const occluders = all
    .filter((e) => e.matches("path,polygon,polyline,rect,circle,ellipse"))
    .flatMap((e) => {
      const v = visible(e),
        paint = fillPaint(e);
      if (!v || paint.alpha < 0.95) return [];
      try {
        const clips = shapeClips(e);
        if (clips === null) return [];
        return [
          {
            e,
            bbox: v.b,
            clips: [v.clip, ...clips],
            inverse: e.getScreenCTM().inverse(),
            order: orders.get(e),
          },
        ];
      } catch {
        return [];
      }
    });
  Object.assign(c, { occluders });
}

export const contains = (b, { p }) =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

export const occlusion = ({
  t,
  contains,
  intersect,
  occluders,
  rr,
  sx,
  sy,
}) => {
  const candidates = occluders.filter(
    (o) =>
      o.order > t.order &&
      intersect(o.bbox, t.bbox).w > 0 &&
      intersect(o.bbox, t.bbox).h > 0,
  );
  if (!candidates.length) return 0;
  let covered = 0;
  // 45 interior samples across the ink box; majority coverage excludes small
  // crossings and isolated glyph overlaps. Coordinates may be off-viewport.
  for (let x = 0; x < 15; x++)
    for (let y = 0; y < 3; y++) {
      const p = {
        x: t.bbox.x + (t.bbox.w * (x + 0.5)) / 15,
        y: t.bbox.y + (t.bbox.h * (y + 0.5)) / 3,
      };
      if (
        candidates.some(
          (o) =>
            contains(o.bbox, p) &&
            o.clips.every((b) => contains(b, p)) &&
            o.e.isPointInFill(
              new DOMPoint(rr.x + p.x / sx, rr.y + p.y / sy).matrixTransform(
                o.inverse,
              ),
            ),
        )
      )
        covered++;
    }
  return covered / 45;
};

export function textPaintRows(c) {
  const { elementsById, textCandidates } = c;
  const textPaintRows = new Map(
    textCandidates.map((t) => [elementsById.get(t.element), t]),
  );
  Object.assign(c, { textPaintRows });
}

export function collectTagLayers(c) {
  const { all, h } = c;
  const tagLayers = all.flatMap((e) => h.tagLayer({ ...c, e }));
  c.tagLayers = tagLayers;
}

export function glyphMaskIndex(c) {
  const glyphMasks = new Map();
  Object.assign(c, { glyphMasks });
}

export const glyphAt = (
  layer,
  { p, glyphMasks, rr, sx, sy, textPaintGeometry },
) => {
  const t = layer.text,
    data = textPaintGeometry.get(layer.e);
  if (!data) return false;
  if (!glyphMasks.has(layer.e)) {
    const canvas = document.createElement("canvas"),
      pixels = 12;
    canvas.width = Math.max(1, Math.ceil(data.width * pixels));
    canvas.height = Math.max(1, Math.ceil(data.height * pixels));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.scale(pixels, pixels);
    ctx.font = data.font;
    ctx.fillText(t.renderedString, data.left, data.ascent);
    glyphMasks.set(layer.e, {
      bytes: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      w: canvas.width,
      h: canvas.height,
    });
  }
  const mask = glyphMasks.get(layer.e),
    q = new DOMPoint(rr.x + p.x / sx, rr.y + p.y / sy).matrixTransform(
      layer.inverse,
    ),
    x = Math.floor(((q.x - data.local.x) / data.local.width) * mask.w),
    y = Math.floor(((q.y - data.local.y) / data.local.height) * mask.h);
  return (
    x >= 0 &&
    y >= 0 &&
    x < mask.w &&
    y < mask.h &&
    mask.bytes[(y * mask.w + x) * 4 + 3] >= 128
  );
};

export const layerHit = (o, { p, contains, glyphAt, rr, sx, sy }) => {
  if (
    !contains(o.bbox, p) ||
    (o.clips && !o.clips.every((b) => contains(b, p)))
  )
    return null;
  if (o.unknown || !o.clips) return { unknown: true };
  if (o.text) return glyphAt(o, p) ? { colour: o.fill, alpha: o.alpha } : null;
  const local = new DOMPoint(rr.x + p.x / sx, rr.y + p.y / sy).matrixTransform(
    o.inverse,
  );
  const fill = o.alpha > 0 && o.e.isPointInFill(local),
    stroke = o.strokeAlpha > 0 && o.e.isPointInStroke(local);
  if (fill && o.strokeFirst) return { colour: o.fill, alpha: o.alpha };
  if (stroke) return { colour: o.stroke, alpha: o.strokeAlpha };
  return fill ? { colour: o.fill, alpha: o.alpha } : null;
};

export const blend = (foreground, alpha, { background }) =>
  background.map((c, i) => foreground[i] * alpha + c * (1 - alpha));

export const luminance = ({ rgb }) =>
  rgb
    .map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);

export const contrast = (a, { b, luminance }) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

export const tagPaint = ({
  t,
  blend,
  contrast,
  glyphAt,
  intersect,
  layerHit,
  tagLayers,
  h,
}) => {
  const own = tagLayers.find((l) => l.text === t);
  if (!own || own.unknown || own.alpha < 0.2 || !own.fill) return false;
  // A thick stroke painted after fill can erase the row's own glyphs.
  const css = getComputedStyle(own.e);
  if (
    own.strokeAlpha >= 0.2 &&
    !own.stroke?.slice(0, 3).every((c, i) => c === own.fill[i]) &&
    own.strokeWidth >= parseFloat(css.fontSize) / 4 &&
    !css.paintOrder.startsWith("stroke")
  )
    return false;
  const layers = tagLayers.filter(
    (o) =>
      o !== own &&
      intersect(o.bbox, t.bbox).w > 0 &&
      intersect(o.bbox, t.bbox).h > 0,
  );
  let samples = 0,
    legible = 0,
    covered = 0,
    minimum = Infinity;
  for (let x = 0; x < 30; x++)
    for (let y = 0; y < 7; y++) {
      const p = {
        x: t.bbox.x + (t.bbox.w * (x + 0.5)) / 30,
        y: t.bbox.y + (t.bbox.h * (y + 0.5)) / 7,
      };
      if (!glyphAt(own, p)) continue;
      samples++;
      const sampled = h.tagSample({
        own,
        layers,
        p,
        layerHit,
        blend,
        contrast,
      });
      if (!sampled) return false;
      const { ratio, after } = sampled;
      minimum = Math.min(minimum, ratio);
      if (after.length && ratio < 3) covered++;
      if (ratio >= 3) legible++;
    }
  t.tagContrastMinimum = Number.isFinite(minimum) ? minimum : 0;
  t.tagOcclusion = samples ? covered / samples : 1;
  return samples > 0 && legible / samples > 0.5;
};

export function classifyTagPaint(c) {
  const { elementsById, fillPaint, shapeClips, tagPaint, texts } = c;
  for (const t of texts.filter((t) => t.tagOwnerUid)) {
    const e = elementsById.get(t.element),
      paint = fillPaint(e);
    t.tagPaintAlpha = paint.alpha;
    try {
      const clips = shapeClips(e);
      t.tagPainted =
        t.painted &&
        clips !== null &&
        paint.alpha >= 0.2 &&
        tagPaint(t) &&
        [t.viewport, ...clips].every(
          (b) =>
            t.bbox.x >= b.x - 0.001 &&
            t.bbox.y >= b.y - 0.001 &&
            t.bbox.x + t.bbox.w <= b.x + b.w + 0.001 &&
            t.bbox.y + t.bbox.h <= b.y + b.h + 0.001,
        );
    } catch (error) {
      t.tagPainted = false;
      t.tagVisibilityError = error.message;
    }
  }
}

export function classifyReviewPaint(c) {
  const { elementsById, fillPaint, occlusion, shapeClips, texts } = c;
  for (const t of texts) {
    const e = elementsById.get(t.element),
      paint = fillPaint(e);
    t.reviewPainted =
      t.painted !== false &&
      paint.alpha >= 0.2 &&
      !paint.background &&
      occlusion(t) <= 0.5;
    try {
      const clips = shapeClips(e);
      t.reviewPainted &&=
        clips !== null &&
        [t.viewport, ...(clips ?? [])].every(
          (b) =>
            !b ||
            (t.bbox.x >= b.x - 0.001 &&
              t.bbox.y >= b.y - 0.001 &&
              t.bbox.x + t.bbox.w <= b.x + b.w + 0.001 &&
              t.bbox.y + t.bbox.h <= b.y + b.h + 0.001),
        );
    } catch {
      t.reviewPainted = false;
    }
  }
}

export const strokeInk = (
  e,
  clip,
  matrix,
  {
    subdivide = false,
    colour,
    contains,
    fillPaint,
    occluders,
    orders,
    point,
    shapeClips,
    sx,
    sy,
    h,
  },
) => {
  if (typeof e.getTotalLength !== "function") return [];
  const css = getComputedStyle(e),
    rgba = colour(css.stroke);
  let alpha = rgba ? (rgba[3] / 255) * Number(css.strokeOpacity) : 0;
  // visible() already rejects display:none / visibility:hidden and zero boxes.
  // Opacity is not inherited, so multiply it through the ancestor chain here.
  for (let node = e; node; node = node.parentElement)
    alpha *= Number(getComputedStyle(node).opacity);
  const strokePainted =
    alpha >= 0.2 && !rgba?.slice(0, 3).every((c) => c === 255);
  const fill = subdivide ? fillPaint(e) : null;
  const filled = fill && fill.alpha >= 0.2 && !fill.background;
  if (!strokePainted && !filled) return [];
  const length = e.getTotalLength(),
    scale = Math.max(
      Math.hypot(matrix.a * sx, matrix.b * sy),
      Math.hypot(matrix.c * sx, matrix.d * sy),
    );
  const count = Math.min(
    20000,
    Math.max(1, Math.ceil((length * scale) / (subdivide ? 0.2 : 0.025))),
  );
  let clips;
  try {
    clips = shapeClips(e);
  } catch {
    return [];
  }
  if (clips === null) return [];
  return h.strokeIntervals({
    e,
    clip,
    matrix,
    subdivide,
    strokePainted,
    filled,
    length,
    count,
    clips,
    orders,
    occluders,
    point,
    contains,
  });
};
