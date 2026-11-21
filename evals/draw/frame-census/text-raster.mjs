import { imageCanvas } from "../pdf.mjs";
export const SCALE = 300 / 25.4;
export async function textRaster(page, broad) {
  const originalOpacity = await page.evaluate(() =>
    [...document.querySelectorAll("[data-census-id]")].map((e) => ({
      id: +e.getAttribute("data-census-id"),
      value: e.style.getPropertyValue("opacity"),
      priority: e.style.getPropertyPriority("opacity"),
    })),
  );
  const zoneIds = broad.zones.map((z) => z.id);
  async function state(hiddenTarget, visibleZone, hiddenRules = []) {
    await page.evaluate(
      ({
        zoneIds,
        hiddenTarget,
        visibleZone,
        originalOpacity,
        hiddenRules,
      }) => {
        const reset = new Map(originalOpacity.map((x) => [x.id, x]));
        for (const e of document.querySelectorAll(
          "[data-census-rule-hidden]",
        )) {
          const o = reset.get(+e.getAttribute("data-census-id"));
          if (o.value) e.style.setProperty("opacity", o.value, o.priority);
          else e.style.removeProperty("opacity");
          e.removeAttribute("data-census-rule-hidden");
        }
        for (const id of hiddenRules) {
          const e = document.querySelector(`[data-census-id="${id}"]`);
          e.setAttribute("data-census-rule-hidden", "true");
          e.style.setProperty("opacity", "0", "important");
        }
        for (const id of zoneIds) {
          const e = document.querySelector(`[data-census-id="${id}"]`),
            o = reset.get(id);
          if (id === visibleZone) {
            if (o.value) e.style.setProperty("opacity", o.value, o.priority);
            else e.style.removeProperty("opacity");
          } else e.style.setProperty("opacity", "0", "important");
        }
        const was = document.querySelector("[data-census-hidden-target]");
        if (was) {
          const o = reset.get(+was.getAttribute("data-census-id"));
          if (o.value) was.style.setProperty("opacity", o.value, o.priority);
          else was.style.removeProperty("opacity");
          was.removeAttribute("data-census-hidden-target");
        }
        if (hiddenTarget != null) {
          const e = document.querySelector(
            `[data-census-id="${hiddenTarget}"]`,
          );
          e.setAttribute("data-census-hidden-target", "true");
          e.style.setProperty("opacity", "0", "important");
        }
      },
      { zoneIds, hiddenTarget, visibleZone, originalOpacity, hiddenRules },
    );
  }
  const rectangle = (a, b, g = 0.65) => {
    const x = Math.max(0, Math.min(a.x, b.x) - g),
      y = Math.max(0, Math.min(a.y, b.y) - g),
      r = Math.min(broad.W, Math.max(a.x + a.w, b.x + b.w) + g),
      d = Math.min(broad.H, Math.max(a.y + a.h, b.y + b.h) + g);
    return { x, y, w: r - x, h: d - y };
  };
  async function shot(r) {
    return page.screenshot({
      clip: {
        x: (r.x * 96) / 25.4,
        y: (r.y * 96) / 25.4,
        width: (r.w * 96) / 25.4,
        height: (r.h * 96) / 25.4,
      },
    });
  }
  async function pixels(buf) {
    const c = await imageCanvas(buf);
    return {
      w: c.width,
      h: c.height,
      data: c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
    };
  }
  const diff = (a, b) => {
    if (a.w !== b.w || a.h !== b.h) throw Error("Raster phase changed");
    const m = new Uint8Array(a.w * a.h);
    for (let i = 0; i < m.length; i++)
      m[i] =
        Math.max(
          ...[0, 1, 2, 3].map((c) =>
            Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]),
          ),
        ) > 8
          ? 1
          : 0;
    return m;
  };
  return { originalOpacity, state, rectangle, shot, pixels, diff };
}
