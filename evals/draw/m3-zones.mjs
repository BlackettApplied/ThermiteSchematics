import { painted } from "./review-geometry.mjs";
import { quantize } from "./repeat-appearances.mjs";
// NAV3 review L4: the complete measured row may span several printed zones.
// The quantized center remains canonical, but any intersected zone may be named.
export function rowZones(g, region) {
  if (!region) return [];
  const top = g.texts
    .filter(
      (t) =>
        painted(t) &&
        t.sheetText &&
        /^[1-6]$/.test(t.text) &&
        t.anchor &&
        t.bbox.y < 30,
    )
    .sort((a, b) => Number(a.text) - Number(b.text));
  const left = g.texts
    .filter(
      (t) =>
        painted(t) &&
        t.sheetText &&
        /^[A-D]$/.test(t.text) &&
        t.anchor &&
        t.bbox.x < 20,
    )
    .sort((a, b) => (a.text < b.text ? -1 : 1));
  if (top.length !== 6 || left.length !== 4) return [];
  const boundaries = (labels, axis) => [
    -Infinity,
    ...labels
      .slice(1)
      .map((t, i) => quantize((labels[i].anchor[axis] + t.anchor[axis]) / 2)),
    Infinity,
  ];
  const xs = boundaries(top, "x"),
    ys = boundaries(left, "y"),
    result = [];
  const x0 = quantize(region.x),
    x1 = quantize(region.x + region.w),
    y0 = quantize(region.y),
    y1 = quantize(region.y + region.h);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 6; x++)
      if (
        Math.min(x1, xs[x + 1]) > Math.max(x0, xs[x]) &&
        Math.min(y1, ys[y + 1]) > Math.max(y0, ys[y])
      )
        result.push(`${"ABCD"[y]}${x + 1}`);
  return result;
}
