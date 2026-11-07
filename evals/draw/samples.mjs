import { classifyTextGeometry } from "./text-classification.mjs";
import { gunzipSync } from "node:zlib";
// Explicit visual acceptance step; never invoked by check or ordinary runs.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  launch,
  openSheet,
  cropBox,
  screenshotCrop,
  measureSheet,
} from "./browser.mjs";
import { loadPdf, renderPdf } from "./pdf.mjs";
import { readJson, json } from "./support.mjs";
const checkpoint = resolve(process.argv[2]),
  name = process.argv[3];
assert(
  name && /^[a-zA-Z0-9._-]+$/.test(name),
  "samples.mjs <checkpoint-directory> <sample-name>",
);
const dest = resolve("evals/out/draw-samples", name);
await mkdir(dest, { recursive: true });
const report = await readJson(
    process.argv[4] ?? join(checkpoint, "summary.json"),
  ),
  families = new Map();
for (const row of report.results.filter((r) =>
  ["fail", "xfail"].includes(r.status),
))
  for (const f of row.evidence?.findings ?? []) {
    if (!families.has(row.dq)) families.set(row.dq, []);
    const instances = f.instances ?? [f];
    families.get(row.dq).push(
      ...instances.map((i) => ({
        row,
        f: { ...f, ...i, instances: undefined },
      })),
    );
  }
let randomState = Number(process.env.DRAW_SAMPLE_SEED ?? 4242);
const random = () =>
  (randomState = (randomState * 1103515245 + 12345) % 2147483648) / 2147483648;
const browser = await launch(),
  context = await browser.newContext({
    deviceScaleFactor: 300 / 96,
    viewport: { width: 1800, height: 1800 },
  }),
  page = await context.newPage(),
  samples = [],
  gaps = [];
try {
  for (const [dq, all] of [...families].sort()) {
    const groups = new Map();
    for (const entry of all) {
      const key = entry.f.kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const chosen = [];
    while (chosen.length < Math.min(10, all.length)) {
      let added = false;
      for (const entries of groups.values()) {
        const candidates = entries.filter((e) => !chosen.includes(e));
        if (candidates.length) {
          chosen.push(candidates[Math.floor(random() * candidates.length)]);
          added = true;
        }
        if (chosen.length === 10) break;
      }
      if (!added) break;
    }
    for (const [index, { row, f }] of chosen.entries()) {
      if (!Number.isInteger(row.sheet) || row.sheet < 1) {
        gaps.push({
          dq,
          id: row.id,
          reason: "No sheet exists; diagnostic only",
        });
        continue;
      }
      const svg = await readFile(
        join(
          checkpoint,
          row.case,
          `sheet-${String(row.sheet).padStart(3, "0")}.svg`,
        ),
        "utf8",
      );
      const ir = await readJson(join(checkpoint, row.case, "ir.json"));
      let selector = "body>svg",
        g;
      if (row.medium === "html" || f.medium === "html") {
        const bytes = await readFile(
          join(checkpoint, row.case, "packet.html.gz"),
        );
        await page.setContent(gunzipSync(bytes).toString("utf8"));
        selector = `#sheet-${row.sheet}>svg`;
        g = classifyTextGeometry(
          await page.evaluate(measureSheet, { selector, textOnly: true }),
          ir,
        );
      } else g = classifyTextGeometry(await openSheet(page, svg), ir);
      let region = f.bbox,
        regionSource = "measured finding";
      if (dq === "DQ-16" && region) {
        region = {
          x: region.x - 12,
          y: region.y - 12,
          w: region.w + 24,
          h: region.h + 24,
        };
        regionSource = "measured label plus conductor neighbourhood";
      }
      if (dq === "DQ-12") {
        region = g.frame;
        regionSource = "actual full frame for utilisation context";
      }
      if (dq === "DQ-10" && f.positions?.length) {
        const lo = Math.min(...f.positions),
          hi = Math.max(...f.positions);
        region =
          f.axis === "x"
            ? { x: lo - 10, y: f.bbox.y - 10, w: hi - lo + 20, h: 20 }
            : { x: f.bbox.x - 10, y: lo - 10, w: 20, h: hi - lo + 20 };
        regionSource = "measured phase-terminal positions";
      }
      if (!region && dq === "DQ-18") {
        region = g.titleBlock;
        regionSource = "measured title divider and frame";
      }
      if (!region && dq === "DQ-09" && g.frame) {
        region = {
          x: g.frame.x + g.frame.w - 8,
          y: g.frame.y + 8,
          w: 8,
          h: (g.titleBlock?.y ?? g.frame.y + g.frame.h) - g.frame.y - 8,
        };
        regionSource = "actual right frame border strip";
      }
      if (!region && ["DQ-19", "DQ-23"].includes(dq)) {
        const ts = g.texts.filter((t) => t.row);
        if (ts.length) {
          const x = Math.min(...ts.map((t) => t.bbox.x)),
            y = Math.min(...ts.map((t) => t.bbox.y));
          region = {
            x,
            y,
            w: Math.max(...ts.map((t) => t.bbox.x + t.bbox.w)) - x,
            h: Math.max(...ts.map((t) => t.bbox.y + t.bbox.h)) - y,
          };
          regionSource = "measured report rows";
        }
      }
      if (!region) {
        region = g.frame;
        regionSource = "actual frame, for packet/sheet-level review";
      }
      if (
        !region ||
        region.x >= g.width ||
        region.y >= g.height ||
        region.x + region.w <= 0 ||
        region.y + region.h <= 0
      ) {
        gaps.push({
          dq,
          id: row.id,
          kind: f.kind,
          reason: "No on-sheet region; inspect retained SVG/geometry",
        });
        continue;
      }
      const box = cropBox(region, g.width, g.height),
        prefix = `${dq}-${String(index + 1).padStart(2, "0")}`,
        svgName = prefix + "-svg.png",
        pdfName = prefix + "-pdf.png";
      const sourceOverlay =
        f.medium === "pdf"
          ? (g.texts.find((t) => t.element === f.element)?.bbox ??
            g.texts.find(
              (t) =>
                t.text.replace(/\s+/g, " ") ===
                String(f.text ?? f.designation).replace(/\s+/g, " "),
            )?.bbox)
          : f.bbox;
      if (sourceOverlay)
        await page.evaluate(
          ({ b, selector }) => {
            const r = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "rect",
            );
            for (const [k, v] of Object.entries({
              x: b.x,
              y: b.y,
              width: b.w,
              height: b.h,
              fill: "none",
              stroke: "#e00000",
              "stroke-width": 0.1,
            }))
              r.setAttribute(k, String(v));
            r.setAttribute("data-draw-evidence-box", "true");
            document.querySelector(selector).appendChild(r);
          },
          { b: sourceOverlay, selector },
        );
      const svgBox =
        f.medium === "pdf" && sourceOverlay
          ? cropBox(sourceOverlay, g.width, g.height)
          : box;
      await screenshotCrop(page, svgBox, join(dest, svgName), selector);
      const pdf = await loadPdf(join(checkpoint, row.case, "packet.pdf"));
      try {
        const canvas = await renderPdf(await pdf.getPage(row.sheet), 300, box);
        if (f.medium === "pdf" && f.bbox) {
          const c = canvas.getContext("2d"),
            k = 300 / 25.4;
          c.strokeStyle = "#1565c0";
          c.lineWidth = 1;
          c.strokeRect(
            (f.bbox.x - box.x) * k,
            (f.bbox.y - box.y) * k,
            f.bbox.w * k,
            f.bbox.h * k,
          );
        }
        await writeFile(join(dest, pdfName), canvas.toBuffer("image/png"));
      } finally {
        await pdf.loadingTask.destroy();
      }
      samples.push({
        dq,
        id: row.id,
        kind: f.kind,
        medium: f.medium ?? row.medium ?? "svg",
        boxKind: f.boxKind ?? "measured SVG/HTML ink",
        element: f.element,
        text: f.text,
        designation: f.designation,
        bbox: f.bbox,
        sourceOverlay,
        sourceRegion: svgBox,
        region: box,
        regionSource,
        dpi: 300,
        svg: svgName,
        pdf: pdfName,
        measurement: {
          capHeightMm: f.capHeightMm,
          fontSizeMm: f.fontSizeMm,
          font: f.font,
          medium: f.medium,
          advanceRatio: f.advanceRatio,
          ratio: f.ratio,
          deltaMm: f.deltaMm,
          expected: f.expected,
          printed: f.printed,
          missing: f.missing,
          sides: f.sides,
        },
      });
    }
  }
} finally {
  await context.close();
  await browser.close();
}
await writeFile(
  join(dest, "manifest.json"),
  json({
    selection: {
      seed: Number(process.env.DRAW_SAMPLE_SEED ?? 4242),
      stratifiedBy: "finding kind",
      perFamily: 10,
    },
    sourceCorpus: report.corpusSha256,
    samples,
    gaps,
    acceptance:
      "Unreviewed: inspect at print size; never automatically pin these candidates",
  }),
);
const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
await writeFile(
  join(dest, "gallery.html"),
  `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui}article{break-inside:avoid;margin:20px}img{max-width:48%;vertical-align:top;border:1px solid #ccc}</style><h1>300 dpi visual acceptance samples</h1>${samples.map((s) => `<article><h2>${escapeHtml(s.dq)} ${escapeHtml(s.id)} ${escapeHtml(s.kind)}</h2><p>${escapeHtml(JSON.stringify(s.measurement))}</p><img src="${s.svg}"><img src="${s.pdf}"></article>`).join("")}`,
);
process.stdout.write(
  `${samples.length} samples; ${gaps.length} no-drawing gaps; ${dest}\n`,
);
