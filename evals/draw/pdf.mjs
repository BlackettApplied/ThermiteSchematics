import { maskLossRegions } from "./pdf-operators.mjs";
import {
  createCanvas,
  loadImage,
  DOMMatrix,
  Path2D,
  ImageData,
} from "@napi-rs/canvas";
import { readFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { command, hash } from "./support.mjs";
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.Path2D ??= Path2D;
globalThis.ImageData ??= ImageData;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
export async function loadPdf(path) {
  const bytes = await readFile(path);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
    fontExtraProperties: true,
  }).promise;
  document.fontFamilies = [
    ...new Set(
      [...bytes.toString("latin1").matchAll(/\/BaseFont\s*\/([^\s/<>]+)/g)].map(
        (m) =>
          m[1]
            .replace(/^[A-Z]{6}\+/, "")
            .replace(/-(Regular|Bold|Italic|BoldItalic)$/, ""),
      ),
    ),
  ].sort();
  document.fontCaps = Object.fromEntries(
    [
      ...bytes.toString("latin1").matchAll(/\d+\s+0\s+obj([\s\S]*?)endobj/g),
    ].flatMap((m) => {
      const name = m[1].match(/\/FontName\s*\/([^\s/<>]+)/)?.[1];
      const cap = m[1].match(/\/CapHeight\s+([-\d.]+)/)?.[1];
      return name && cap
        ? [[name.replace(/^[A-Z]{6}\+/, ""), Number(cap) / 1000]]
        : [];
    }),
  );
  return document;
}
export async function renderPdf(page, dpi = 96, box) {
  const viewport = page.getViewport({ scale: dpi / 72 }),
    scale = dpi / 25.4;
  const canvas = createCanvas(
    Math.ceil(box ? box.w * scale : viewport.width),
    Math.ceil(box ? box.h * scale : viewport.height),
  );
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    background: "white",
    ...(box ? { transform: [1, 0, 0, 1, -box.x * scale, -box.y * scale] } : {}),
  }).promise;
  return canvas;
}
export async function pdfText(page, families = [], fontCaps = {}) {
  await page.getOperatorList();
  const content = await page.getTextContent({ disableNormalization: true }),
    viewport = page.getViewport({ scale: 25.4 / 72 });
  return content.items
    .filter((x) => x.str?.trim())
    .map((x) => {
      const t = pdfjs.Util.transform(viewport.transform, x.transform),
        size = Math.hypot(t[2], t[3]);
      const face = page.commonObjs
        .get(x.fontName)
        ?.name?.replace(/^[A-Z]{6}\+/, "");
      const capRatio = fontCaps[face];
      return {
        painted: true,
        fontSize: size,
        capReferenceEmMm: Math.hypot(t[0], t[1]),
        capHeightMm: capRatio === undefined ? undefined : capRatio * size,
        fontFace: face,
        fontMeasured: face
          ? "PDF FontDescriptor /CapHeight for " + face
          : undefined,
        text: x.str.trim(),
        bbox: { x: t[4], y: t[5] - size, w: (x.width * 25.4) / 72, h: size },
        font:
          face?.replace(/-(Regular|Bold|Italic|BoldItalic)$/, "") ??
          x.fontName.replace(/g_d\d+_/, ""),
        fontFamily: `${content.styles[x.fontName]?.fontFamily ?? "unknown"} [${families.join(",")}]`,
      };
    });
}
export async function imageCanvas(bytes) {
  const img = await loadImage(bytes);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}
export function ink(canvas, b, dpi = 96) {
  const s = dpi / 25.4,
    x = Math.max(0, Math.floor(b.x * s)),
    y = Math.max(0, Math.floor(b.y * s)),
    w = Math.min(canvas.width - x, Math.max(1, Math.ceil(b.w * s))),
    h = Math.min(canvas.height - y, Math.max(1, Math.ceil(b.h * s)));
  if (w <= 0 || h <= 0) return 0;
  const data = canvas.getContext("2d").getImageData(x, y, w, h).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4)
    if (Math.max(data[i], data[i + 1], data[i + 2]) < 160 && data[i + 3] > 100)
      n++;
  return n;
}
export async function nativeTool(root) {
  if (process.env.THERMITE_DRAW_PDFKIT === "0" || process.platform !== "darwin")
    return null;
  const dir = join(root, "evals/out/draw-tools");
  await mkdir(dir, { recursive: true });
  const exe = join(
    dir,
    `pdfkit-${hash(await readFile(join(root, "evals/draw/pdfkit.swift"))).slice(0, 12)}`,
  );
  try {
    await access(exe);
  } catch {
    const r = await command(
      root,
      "xcrun",
      ["swiftc", join(root, "evals/draw/pdfkit.swift"), "-o", exe],
      120000,
    );
    if (r.code !== 0)
      throw Error(`PDFKit helper failed to compile: ${r.stderr}`);
  }
  return exe;
}

export async function portableLabelRisks(page) {
  return maskLossRegions(
    await page.getOperatorList(),
    pdfjs.OPS,
    page.view,
    page.getViewport({ scale: 25.4 / 72 }).transform,
  );
}
