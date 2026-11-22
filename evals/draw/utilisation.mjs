// DQ-12 measures the envelope of visible outline geometry (stroke centre lines).
export function visibleShapeBounds(shape, sheet) {
  if (shape.clips === null || shape.paintedBbox === null) return null;
  let box = { ...(shape.paintedBbox ?? shape.bbox) };
  for (const clip of [sheet, shape.viewport, ...(shape.clips ?? [])]) {
    if (!clip) continue;
    if (clip.w <= 0 || clip.h <= 0) return null;
    if (
      box.x >= clip.x &&
      box.y >= clip.y &&
      box.x + box.w <= clip.x + clip.w &&
      box.y + box.h <= clip.y + clip.h
    )
      continue;
    const x = Math.max(box.x, clip.x),
      y = Math.max(box.y, clip.y),
      right = Math.min(box.x + box.w, clip.x + clip.w),
      bottom = Math.min(box.y + box.h, clip.y + clip.h);
    if (right < x || bottom < y) return null;
    box = { x, y, w: right - x, h: bottom - y };
  }
  return box;
}

export function utilisation(g) {
  if (g.utilisationErrors?.length)
    throw Error(g.utilisationErrors.map((e) => e.reason).join("; "));
  const sheet = { x: 0, y: 0, w: g.width, h: g.height },
    shapes = g.shapes
      .filter((s) => s.conductor || s.symbol || s.mark)
      .map((s) => visibleShapeBounds(s, sheet))
      .filter((b) => b && b.x >= 20 && b.y >= 25 && b.y + b.h < g.height - 35);
  if (!shapes.length) return null;
  const x = Math.min(...shapes.map((b) => b.x)),
    y = Math.min(...shapes.map((b) => b.y)),
    right = Math.max(...shapes.map((b) => b.x + b.w)),
    bottom = Math.max(...shapes.map((b) => b.y + b.h)),
    bbox = { x, y, w: right - x, h: bottom - y },
    area = (g.width - 56) * (g.height - 80);
  if (area <= 0) throw Error("DQ-12 requires a positive drawing area");
  // The visible outline geometry envelope saturates at the nominal drawing area.
  const fraction = Math.min(1, (bbox.w * bbox.h) / area);
  return { bbox, fraction };
}
