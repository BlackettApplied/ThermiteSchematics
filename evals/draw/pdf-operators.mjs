// Portable PDF operator audit for the pre-WS-B luminosity-mask failure.
// pdf.js itself paints these masks correctly. The audit detects label glyphs
// outside the untransformed page bounds under a scaled luminosity soft mask,
// the construct Quartz clips. It never fabricates a raster-ink measurement.
export const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function maskLossRegions(list, ops, page, viewport) {
  let state = {
      matrix: [1, 0, 0, 1, 0, 0],
      mask: false,
      fontSize: 1,
      text: [1, 0, 0, 1, 0, 0],
    },
    stack = [];
  const regions = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const f = list.fnArray[i],
      a = list.argsArray[i];
    if (f === ops.save)
      stack.push({
        ...state,
        matrix: state.matrix.slice(),
        text: state.text.slice(),
      });
    else if (f === ops.restore) state = stack.pop() ?? state;
    else if (f === ops.transform) state.matrix = multiply(state.matrix, a);
    else if (f === ops.setFont) state.fontSize = a[1];
    else if (f === ops.setTextMatrix)
      state.text = Array.from(a.length === 1 ? a[0] : a);
    else if (f === ops.setGState) {
      for (const [key, value] of a[0])
        if (key === "SMask") state.mask = value === true;
    } else if (f === ops.showText && state.mask) {
      const [, , , , x, y] = state.text;
      if (x >= page[0] && x <= page[2] && y >= page[1] && y <= page[3])
        continue;
      const m = multiply(viewport, multiply(state.matrix, state.text)),
        height = state.fontSize * Math.hypot(m[2], m[3]);
      const width =
        (a[0].reduce((n, g) => n + (g.width ?? 0), 0) / 1000) *
        state.fontSize *
        Math.hypot(m[0], m[1]);
      regions.push({
        bbox: {
          x: m[4],
          y: m[5] - height,
          w: Math.max(width, 0.1),
          h: height,
        },
        localOrigin: { x, y },
        untransformedPageBounds: Array.from(page),
        construct: "scaled-luminosity-soft-mask",
      });
    }
  }
  return regions;
}
