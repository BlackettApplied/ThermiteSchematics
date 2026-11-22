// Semantic IDs reconcile folded copies; otherwise the source DOM path inside
// the tiled SVG identifies an individual text, never the string "undefined".
export function retainLostText(geometries, views) {
  const key = (t, i) =>
    views[i] +
    "/" +
    (t.semantic ??
      (t.sourceTextKey
        ? "text:" + t.sourceTextKey
        : `sheet:${i + 1}/${t.element}`));
  const visible = new Set(
      geometries.flatMap((g, i) => g.texts.map((t) => key(t, i))),
    ),
    lost = new Set();
  for (const [i, g] of geometries.entries())
    for (const t of g.hiddenTexts ?? []) {
      const k = key(t, i);
      if (!t.nested || (!visible.has(k) && !lost.has(k))) {
        g.texts.push(t);
        lost.add(k);
      }
    }
}
