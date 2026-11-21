import { mkdir, writeFile } from "node:fs/promises";
import { SCALE } from "./text-raster.mjs";
export async function textContacts(
  page,
  broad,
  raster,
  { artifactDir, tag, cropPositives },
) {
  const { state, rectangle, shot, pixels, diff, originalOpacity } = raster;
  const hits = [],
    nearHits = [];
  for (const pair of broad.pairs) {
    const crop = rectangle(pair.zone.bbox, pair.text.bbox);
    await state(null, null);
    const A = await pixels(await shot(crop));
    await state(pair.text.id, null);
    const B = await pixels(await shot(crop));
    await state(pair.text.id, pair.zone.id);
    const C = await pixels(await shot(crop));
    const t = diff(A, B),
      z = diff(C, B);
    let overlap = 0,
      dist = Infinity;
    const radius = Math.ceil(0.5 * SCALE);
    for (let i = 0; i < z.length; i++) {
      if (!z[i]) continue;
      if (t[i]) overlap++;
      const x = i % A.w,
        y = Math.floor(i / A.w);
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const X = x + dx,
            Y = y + dy;
          if (
            X < 0 ||
            Y < 0 ||
            X >= A.w ||
            Y >= A.h ||
            dx * dx + dy * dy > radius * radius
          )
            continue;
          if (t[Y * A.w + X]) dist = Math.min(dist, Math.hypot(dx, dy) / SCALE);
        }
    }
    const result = {
      zone: pair.zone.text,
      side: pair.zone.side,
      text: pair.text.text,
      overlapPixels: overlap,
      nearestInkMm: dist === Infinity ? null : dist,
      bbox: crop,
    };
    if (overlap) hits.push(result);
    else if (dist <= 0.5) nearHits.push(result);
    if (artifactDir && cropPositives && (overlap || dist <= 0.5)) {
      await page.evaluate(
        ({ originalOpacity }) => {
          for (const o of originalOpacity) {
            const e = document.querySelector(`[data-census-id="${o.id}"]`);
            if (o.value) e.style.setProperty("opacity", o.value, o.priority);
            else e.style.removeProperty("opacity");
          }
        },
        { originalOpacity },
      );
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        artifactDir +
          "/" +
          tag +
          "-" +
          (hits.length + nearHits.length) +
          ".png",
        await shot(crop),
      );
    }
  }
  return { hits, nearHits };
}
export async function laneContacts(broad, raster) {
  const { state, shot, pixels, diff } = raster;
  const laneHits = [];
  for (const pair of broad.lanePairs) {
    const cut = {
      x: Math.max(pair.lane.x, pair.text.bbox.x),
      y: Math.max(pair.lane.y, pair.text.bbox.y),
      w: 0,
      h: 0,
    };
    cut.w =
      Math.min(pair.lane.x + pair.lane.w, pair.text.bbox.x + pair.text.bbox.w) -
      cut.x;
    cut.h =
      Math.min(pair.lane.y + pair.lane.h, pair.text.bbox.y + pair.text.bbox.h) -
      cut.y;
    if (cut.w <= 0 || cut.h <= 0) continue;
    const crop = {
      x: Math.max(0, cut.x - 0.1),
      y: Math.max(0, cut.y - 0.1),
      w: cut.w + 0.2,
      h: cut.h + 0.2,
    };
    await state(null, null);
    const A = await pixels(await shot(crop));
    await state(pair.text.id, null);
    const B = await pixels(await shot(crop)),
      mask = diff(A, B);
    let painted = 0;
    for (let i = 0; i < mask.length; i++) {
      const x = crop.x + ((i % A.w) + 0.5) / SCALE,
        y = crop.y + (Math.floor(i / A.w) + 0.5) / SCALE;
      if (
        mask[i] &&
        x >= cut.x &&
        x <= cut.x + cut.w &&
        y >= cut.y &&
        y <= cut.y + cut.h
      )
        painted++;
    }
    if (painted)
      laneHits.push({
        side: pair.lane.side,
        text: pair.text.text,
        paintedPixels: painted,
        bbox: cut,
      });
  }
  return laneHits;
}
export async function titleContacts(broad, raster) {
  const { state, rectangle, shot, pixels, diff } = raster;
  const titleHits = [];
  for (const pair of broad.titleHits) {
    const crop = rectangle(pair.rule, pair.text.bbox, 0.3);
    await state(null, null, broad.titleRuleIds);
    const A = await pixels(await shot(crop));
    await state(pair.text.id, null, broad.titleRuleIds);
    const B = await pixels(await shot(crop)),
      mask = diff(A, B);
    let painted = 0;
    for (let i = 0; i < mask.length; i++) {
      const x = crop.x + ((i % A.w) + 0.5) / SCALE,
        y = crop.y + (Math.floor(i / A.w) + 0.5) / SCALE;
      if (
        mask[i] &&
        x >= pair.rule.x &&
        x <= pair.rule.x + pair.rule.w &&
        Math.abs(y - pair.rule.y) <= 0.125
      )
        painted++;
    }
    const baselineStruck = Math.abs(pair.text.baseline - pair.rule.y) <= 0.126;
    if (painted || baselineStruck)
      titleHits.push({
        text: pair.text.text,
        paintedPixels: painted,
        baselineStruck,
        rule: pair.rule,
      });
  }
  return titleHits;
}
