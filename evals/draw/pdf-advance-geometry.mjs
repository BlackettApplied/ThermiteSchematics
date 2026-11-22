// DQ-21 geometry from actual content-stream glyph advances, not inferred spaces.
import assert from "node:assert/strict";
const compact = (text) => text.replace(/\s/gu, "");
const adjacent = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
function extendSpaces(owned, all) {
  const result = owned.slice();
  const compatible = (a, b) =>
    !a.text.trim() &&
    a.font === b.font &&
    Math.abs(a.size - b.size) < 0.001 &&
    (a.visible || !a.points.length);
  for (let i = all.indexOf(result[0]) - 1; i >= 0; i--) {
    const next = all[i],
      first = result[0];
    if (!compatible(next, first) || !adjacent(next.end, first.base)) break;
    result.unshift(next);
  }
  for (let i = all.indexOf(result.at(-1)) + 1; i < all.length; i++) {
    const next = all[i],
      last = result.at(-1);
    if (!compatible(next, last) || !adjacent(last.end, next.base)) break;
    result.push(next);
  }
  return result;
}
export function nativeAdvanceItem(item, owned, all, [ux, uy]) {
  assert(
    compact(owned.map((g) => g.text).join("")) === compact(item.text),
    "Ambiguous native PDF advance/text association",
  );
  // PDF.js can omit literal end spaces as well as infer unpainted ones. Retain
  // adjacent native space glyphs, including their real character/word spacing.
  const glyphs = extendSpaces(owned, all),
    projected = glyphs
      .flatMap((g) => [g.base, g.end])
      .map(([x, y]) => x * ux + y * uy),
    width = Math.max(...projected) - Math.min(...projected);
  assert(Number.isFinite(width) && width >= 0, "Invalid native PDF advance");
  return { ...item, bbox: { ...item.bbox, w: width } };
}
