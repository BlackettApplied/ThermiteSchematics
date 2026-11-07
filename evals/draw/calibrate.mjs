// Based on the reviewer inkcheck.mjs: compare the kit's measured text ink boxes with pixel ink from an
// isolated 300 dpi Chromium raster of each text element.
// Usage (from review worktree root): bun <this> <checkpoint-dir> <case/sheet>...
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const wt = process.cwd();
const { launch, openSheet } = await import(
  process.env.BROWSER_MODULE ?? join(wt, "evals/draw/browser.mjs")
);
const { loadImage, createCanvas } = await import("@napi-rs/canvas");
const checkpoint = resolve(process.argv[2]);
const targets = process.argv.slice(3);
let seed = 4242;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const browser = await launch();
const context = await browser.newContext({
  deviceScaleFactor: 300 / 96,
  viewport: { width: 1800, height: 1800 },
});
const page = await context.newPage();
const rows = [];
for (const t of targets) {
  const [kase, sheet] = t.split("/");
  const svg = await readFile(
    join(checkpoint, kase, `sheet-${sheet.padStart(3, "0")}.svg`),
    "utf8",
  );
  const g = await openSheet(page, svg);
  const pool = g.texts.filter(
    (x) =>
      x.painted !== false &&
      x.text.trim() &&
      (!process.env.INK_TEXT ||
        new RegExp(process.env.INK_TEXT).test(x.text)) &&
      Math.abs(x.angle) < 1 &&
      (!process.env.INK_FONT || (x.font ?? "").includes(process.env.INK_FONT)),
  );
  // Same isolated-text raster and integer-aligned 300 dpi clip as reviewer;
  // selection is seeded and stratified by semantic role/report/frame class.
  const groups = new Map();
  for (const x of pool) {
    const kind = x.role || (x.row ? "report" : "unclassified");
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(x);
  }
  const chosen = [];
  while (chosen.length < Math.min(12, pool.length))
    for (const list of groups.values()) {
      const available = list.filter((x) => !chosen.includes(x));
      if (available.length)
        chosen.push(available[Math.floor(rnd() * available.length)]);
      if (chosen.length === Math.min(12, pool.length)) break;
    }
  for (const x of chosen) {
    const idx = +x.element.split("-")[1];
    const em = x.emBbox,
      pad = 1.0;
    const region = {
      x: em.x - pad,
      y: em.y - pad,
      w: em.w + 2 * pad,
      h: em.h + 2 * pad,
    };
    const clip = await page.evaluate(
      ({ idx, region }) => {
        const root = document.querySelector("body>svg");
        const all = Array.from(root.querySelectorAll("*"));
        const st =
          document.getElementById("rv-style") ??
          document.head.appendChild(
            Object.assign(document.createElement("style"), { id: "rv-style" }),
          );
        st.textContent =
          "body>svg *{visibility:hidden!important} body>svg [data-rv-target], body>svg [data-rv-target] *, body>svg clipPath, body>svg clipPath *{visibility:visible!important}";
        for (const e of all) e.removeAttribute("data-rv-target");
        all[idx].setAttribute("data-rv-target", "1");
        const r = root.getBoundingClientRect(),
          v = root.viewBox.baseVal;
        const k = r.width / v.width,
          ox = r.x + scrollX,
          oy = r.y + scrollY;
        const x0 = Math.floor(ox + region.x * k),
          y0 = Math.floor(oy + region.y * k);
        const x1 = Math.ceil(ox + (region.x + region.w) * k),
          y1 = Math.ceil(oy + (region.y + region.h) * k);
        return {
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          mmX: (x0 - ox) / k,
          mmY: (y0 - oy) / k,
          mmPerDevPx: 1 / (k * devicePixelRatio),
        };
      },
      { idx, region },
    );
    const png = await page.screenshot({
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
      fullPage: true,
      scale: "device",
    });
    const img = await loadImage(png);
    const cv = createCanvas(img.width, img.height),
      ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < img.height; y++)
      for (let xx = 0; xx < img.width; xx++) {
        const i = (y * img.width + xx) * 4;
        if (d[i] + d[i + 1] + d[i + 2] < 3 * +(process.env.INK_T ?? 136)) {
          x0 = Math.min(x0, xx);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, xx);
          y1 = Math.max(y1, y);
        }
      }
    if (x1 < 0) {
      rows.push({ t, text: x.text, note: "no ink" });
      continue;
    }
    const sx = clip.mmPerDevPx,
      sy = clip.mmPerDevPx;
    const pix = {
      x: clip.mmX + x0 * sx,
      y: clip.mmY + y0 * sy,
      w: (x1 - x0 + 1) * sx,
      h: (y1 - y0 + 1) * sy,
    };
    const b = x.bbox;
    const dev = {
      left: +(pix.x - b.x).toFixed(3),
      top: +(pix.y - b.y).toFixed(3),
      right: +(b.x + b.w - (pix.x + pix.w)).toFixed(3),
      bottom: +(b.y + b.h - (pix.y + pix.h)).toFixed(3),
    };
    rows.push({
      t,
      raw: JSON.stringify(x.text) !== JSON.stringify(x.text.trim()) ? "ws" : "",
      element: x.element,
      baseline: x.baseline,
      text: x.text.slice(0, 80),
      role: x.role,
      font: x.font,
      emH: +em.h.toFixed(3),
      inkH: +b.h.toFixed(3),
      pixH: +pix.h.toFixed(3),
      dev,
    });
  }
}
await browser.close();
// Positive dev = measured box extends beyond pixel ink (conservative); negative = pixel ink outside measured box.
const all = rows.filter((r) => r.dev);
const worst = (k) => all.reduce((m, r) => Math.min(m, r.dev[k]), 1e9);
const most = (k) => all.reduce((m, r) => Math.max(m, r.dev[k]), -1e9);
console.log(
  JSON.stringify({
    n: all.length,
    noInk: rows.length - all.length,
    minDev: {
      left: worst("left"),
      top: worst("top"),
      right: worst("right"),
      bottom: worst("bottom"),
    },
    maxDev: {
      left: most("left"),
      top: most("top"),
      right: most("right"),
      bottom: most("bottom"),
    },
  }),
);
const sorted = [...all].sort(
  (a, b) =>
    Math.min(...Object.values(a.dev)) - Math.min(...Object.values(b.dev)),
);
for (const r of sorted.slice(0, 12)) console.log(JSON.stringify(r));
const hist = {};
for (const r of all) {
  const w = Math.min(...Object.values(r.dev));
  const k =
    w < -0.3
      ? "<-0.3"
      : w < -0.15
        ? "-0.3..-0.15"
        : w < -0.09
          ? "-0.15..-0.09"
          : ">=-0.09";
  hist[k] = (hist[k] || 0) + 1;
}
console.log(JSON.stringify(hist));
if (!process.env.INK_OUT)
  throw Error("Set INK_OUT to an ignored evals/out path");
writeFileSync(process.env.INK_OUT, JSON.stringify(rows));
if (
  all.length < Number(process.env.INK_MIN_COUNT ?? 40) ||
  rows.length !== all.length ||
  all.some((r) => Object.values(r.dev).some((d) => Math.abs(d) > 0.17))
)
  throw Error("Ink calibration exceeds the two-pixel (0.17 mm) accuracy bound");
