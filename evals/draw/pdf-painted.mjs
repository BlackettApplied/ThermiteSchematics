import { nativeAdvanceItem } from "./pdf-advance-geometry.mjs";
// Associate extraction items to native glyph placement by geometry/font only.
export class PaintedPdfMeasurementError extends Error {}
const assert = (condition, message) => {
  if (!condition) throw new PaintedPdfMeasurementError(message);
};
import { pdfGlyphRuns } from "./pdf-ink-operators.mjs";
import { embeddedGlyphMetric } from "./pdf-glyph-metrics.mjs";
import {
  pdfGlyphClips,
  pointBounds,
  intersectPdfBoxes,
} from "./pdf-clip-operators.mjs";
import { multiply } from "./pdf-operators.mjs";
export function paintedItems(items, raw, glyphs, viewport, measure = (p) => p) {
  assert(items.length === raw.length, "PDF extraction inventory changed");
  return items.flatMap((p, i) => {
    const m = multiply(viewport.transform, raw[i].transform),
      norm = Math.hypot(m[0], m[1]),
      ux = m[0] / norm,
      uy = m[1] / norm;
    const owned = ownedGlyphs(glyphs, raw[i], p, m, ux, uy);
    assert(owned.length, "PDF item has no native glyph association");
    const ink = owned.filter((g) => g.points.length);
    if (!ink.some((g) => g.visible)) return [];
    if (ink.every((g) => g.visible))
      return [measure(p, owned, glyphs, [ux, uy])];
    assert(
      new Set(owned.map((g) => g.run)).size === 1,
      "Ambiguous partially clipped PDF item",
    );
    const fragments = [];
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const text = group.map((g) => g.text).join("");
      if (text.trim()) {
        const first = group[0],
          last = group.at(-1);
        fragments.push(
          measure(
            {
              ...p,
              text: text.trim(),
              renderedString: text,
              fontSize: first.size,
              ...(p.anchor
                ? { anchor: { x: first.base[0], y: first.base[1] } }
                : {}),
              bbox: {
                x: first.base[0],
                y: first.base[1] - first.size,
                w: Math.hypot(
                  last.end[0] - first.base[0],
                  last.end[1] - first.base[1],
                ),
                h: first.size,
              },
            },
            group,
            glyphs,
            [ux, uy],
          ),
        );
      }
      group = [];
    };
    for (const g of owned) {
      if (g.visible || !g.points.length) group.push(g);
      else flush();
    }
    flush();
    return fragments;
  });
}
async function paintedInventory(page, items, raw) {
  const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const list = await page.getOperatorList(),
    viewport = page.getViewport({ scale: 25.4 / 72 }),
    clips = pdfGlyphClips(list, OPS, viewport),
    glyphs = [];
  pdfGlyphRuns(
    list,
    OPS,
    viewport.transform,
    embeddedGlyphMetric(page),
    (g) => {
      const clip = clips.get(g.operator);
      assert(clip, "Missing native PDF glyph clip");
      const overlap = g.points.length
        ? intersectPdfBoxes(pointBounds(g.points), clip)
        : null;
      glyphs.push({
        ...g,
        visible: !!overlap && overlap.w > 0 && overlap.h > 0,
      });
    },
  );
  if (!raw)
    raw = (
      await page.getTextContent({ disableNormalization: true })
    ).items.filter((x) => x.str?.trim());
  return { items, raw, glyphs, viewport };
}

function ownedGlyphs(glyphs, raw, p, m, ux, uy) {
  return glyphs.filter((g) => {
    const dx = g.base[0] - m[4],
      dy = g.base[1] - m[5],
      along = dx * ux + dy * uy,
      across = dy * ux - dx * uy;
    return (
      g.font === raw.fontName &&
      Math.abs(g.size - p.fontSize) < 0.001 &&
      Math.abs(across) < 0.001 &&
      along >= -0.001 &&
      along < p.bbox.w - 0.001
    );
  });
}

export async function paintedPdfItems(page, items, raw, measure) {
  const data = await paintedInventory(page, items, raw);
  return paintedItems(
    data.items,
    data.raw,
    data.glyphs,
    data.viewport,
    measure,
  );
}
export async function paintedPdfMeasurements(page, items) {
  const data = await paintedInventory(page, items);
  const args = [data.items, data.raw, data.glyphs, data.viewport];
  return {
    text: paintedItems(...args),
    metrics: paintedItems(...args, nativeAdvanceItem),
  };
}
