import { imageCanvas } from "../pdf.mjs";
import { mkdir, writeFile } from "node:fs/promises";
export function shapeRaster(page, p, { artifactDir, tag }) {
  const restore = async () =>
    page.evaluate((styles) => {
      for (const s of styles) {
        const e = document.querySelector(`[data-ext-id="${s.id}"]`);
        if (s.css === null) e.removeAttribute("style");
        else e.setAttribute("style", s.css);
      }
    }, p.styles);
  async function hide(ids, shapeIds = [], hideRule = false) {
    await restore();
    await page.evaluate(
      ({ ids, shapes, ruleIds, hideRule }) => {
        for (const id of ids) {
          const e = document.querySelector(`[data-ext-id="${id}"]`);
          e.style.setProperty("opacity", "0", "important");
        }
        for (const s of shapes) {
          const e = document.querySelector(`[data-ext-id="${s.id}"]`);
          e.style.setProperty("stroke", "transparent", "important");
          if (!s.preserveFill)
            e.style.setProperty("fill", "transparent", "important");
        }
        if (hideRule)
          for (const id of ruleIds)
            document
              .querySelector(`[data-ext-id="${id}"]`)
              .style.setProperty("opacity", "0", "important");
      },
      {
        ids,
        shapes: shapeIds.map((id) => p.shapes.find((s) => s.id === id)),
        ruleIds: p.ruleIds,
        hideRule,
      },
    );
  }
  const crop = (b, g = 0.35) => {
    const x = Math.max(0, b.x - g),
      y = Math.max(0, b.y - g),
      r = Math.min(p.W, b.x + b.w + g),
      d = Math.min(p.H, b.y + b.h + g);
    return { x, y, w: r - x, h: d - y };
  };
  const shot = async (r) =>
    page.screenshot({
      clip: {
        x: (r.x * 96) / 25.4,
        y: (r.y * 96) / 25.4,
        width: (r.w * 96) / 25.4,
        height: (r.h * 96) / 25.4,
      },
    });
  async function pixels(r) {
    const c = await imageCanvas(await shot(r));
    return {
      w: c.width,
      h: c.height,
      d: c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
      buf: c.toBuffer("image/png"),
    };
  }
  const mask = (a, b) => {
    if (a.w !== b.w || a.h !== b.h) throw Error("Raster phase changed");
    const m = new Uint8Array(a.w * a.h);
    for (let i = 0; i < m.length; i++) {
      const j = i * 4,
        d = a.d;
      if (
        (d[j] + d[j + 1] + d[j + 2]) / 3 < 245 &&
        Math.max(...[0, 1, 2].map((k) => Math.abs(d[j + k] - b.d[j + k]))) > 8
      )
        m[i] = 1;
    }
    return m;
  };
  async function pairHit(pair, kind) {
    const r = crop(pair.a.bbox);
    const a = pair.a.id,
      bs = pair.bs.map((s) => s.id);
    await hide([a]);
    const A = await pixels(r);
    await hide([a], bs);
    const B = await pixels(r);
    await hide([], bs);
    const C = await pixels(r),
      s = mask(A, B),
      t = mask(C, B);
    let n = 0;
    for (let i = 0; i < s.length; i++) n += s[i] && t[i] ? 1 : 0;
    if (!n) return null;
    const result = {
      kind,
      target: pair.a.text,
      shapes: pair.bs.map((s) => ({ tag: s.tag, stub: s.stub, id: s.id })),
      paintedOverlapPixels: n,
      cropMm: r,
      ...(pair.a.cid ? { cid: pair.a.cid, end: pair.a.end } : {}),
      side: pair.a.side,
    };
    if (artifactDir) {
      await restore();
      await mkdir(artifactDir, { recursive: true });
      const path = artifactDir + "/" + tag + "-" + kind + "-" + a + ".png";
      await writeFile(path, await shot(r));
      result.crop = path;
    }
    return result;
  }
  return { restore, hide, pixels, pairHit, mask };
}
