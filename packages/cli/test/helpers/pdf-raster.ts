import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
  loadImage,
  type Canvas,
} from "@napi-rs/canvas";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
export type Crop = { x: number; y: number; width: number; height: number };
export const pixelsPerMm = 300 / 25.4;
export async function pdfCrop(bytes: Buffer, crop: Crop): Promise<Canvas> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const document = await task.promise,
      page = await document.getPage(1),
      canvas = createCanvas(
        Math.ceil(crop.width * pixelsPerMm),
        Math.ceil(crop.height * pixelsPerMm),
      ),
      viewport = page.getViewport({
        scale: 300 / 72,
        offsetX: -crop.x * pixelsPerMm,
        offsetY: -crop.y * pixelsPerMm,
      });
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    await task.destroy();
  }
}
export function inkBounds(canvas: Canvas) {
  const { width, height } = canvas,
    data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let left = width,
    right = -1,
    top = height,
    bottom = -1,
    count = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (
        data[offset]! < 160 &&
        data[offset + 1]! < 160 &&
        data[offset + 2]! < 160 &&
        data[offset + 3]! > 128
      ) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        count++;
      }
    }
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, right - left + 1),
    height: Math.max(0, bottom - top + 1),
    count,
  };
}
export function pixelDifference(a: Canvas, b: Canvas) {
  if (a.width !== b.width || a.height !== b.height)
    throw Error("Raster dimensions differ.");
  const av = a.getContext("2d").getImageData(0, 0, a.width, a.height).data,
    bv = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
  let changed = 0;
  for (let i = 0; i < av.length; i += 4)
    if (
      Math.abs(av[i]! - bv[i]!) > 16 ||
      Math.abs(av[i + 1]! - bv[i + 1]!) > 16 ||
      Math.abs(av[i + 2]! - bv[i + 2]!) > 16
    )
      changed++;
  return changed;
}
const candidates = [
  process.env.THERMITE_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
];
for (const cache of [
  join(homedir(), "Library/Caches/ms-playwright"),
  join(homedir(), ".cache/ms-playwright"),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright"),
]) {
  if (!cache || !existsSync(cache)) continue;
  for (const entry of readdirSync(cache)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .reverse())
    for (const suffix of [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      "chrome-linux64/chrome",
      "chrome-linux/chrome",
      "chrome-win/chrome.exe",
      "chrome-win64/chrome.exe",
    ])
      candidates.push(join(cache, entry, suffix));
}
const detectedBrowser = candidates.find(
  (path): path is string => !!path && existsSync(path),
);
// An explicit invalid override simulates a browser-less host for policy tests.
export const browserPath =
  process.env.THERMITE_TEST_BROWSER !== undefined
    ? existsSync(process.env.THERMITE_TEST_BROWSER)
      ? process.env.THERMITE_TEST_BROWSER
      : undefined
    : detectedBrowser;
if (process.env.THERMITE_REQUIRE_BROWSER === "1" && !browserPath)
  throw Error(
    "THERMITE_REQUIRE_BROWSER=1 requires Chrome/Chromium. Set THERMITE_TEST_BROWSER to its executable.",
  );
export const launchBrowser = (): Promise<Browser> =>
  chromium.launch({ executablePath: browserPath!, headless: true });
/** Actual painted faces, rather than CSS family names that may fall back. */
export async function browserFonts(browser: Browser, svg: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(svg);
    await page.evaluate(() => document.fonts.ready);
    const session = await page.context().newCDPSession(page);
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeIds } = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "text",
    });
    return await Promise.all(
      nodeIds.map(
        async (nodeId) =>
          (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts,
      ),
    );
  } finally {
    await page.close();
  }
}
export async function browserCrop(
  browser: Browser,
  svg: string,
  crop: Crop,
): Promise<Canvas> {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1400 },
    deviceScaleFactor: 300 / 96,
  });
  try {
    await page.setContent(
      `<style>body{margin:0;background:white}svg{display:block}</style>${svg}`,
    );
    await page.evaluate(() => document.fonts.ready);
    const data = await page.screenshot({
        clip: {
          x: (crop.x * 96) / 25.4,
          y: (crop.y * 96) / 25.4,
          width: (crop.width * 96) / 25.4,
          height: (crop.height * 96) / 25.4,
        },
      }),
      image = await loadImage(data),
      canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas;
  } finally {
    await page.close();
  }
}

export async function browserTextCrops(
  browser: Browser,
  svg: string,
  label: string,
): Promise<Crop[]> {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1400 },
  });
  try {
    await page.setContent(
      `<style>body{margin:0}svg{display:block}</style>${svg}`,
    );
    return await page.evaluate(
      (value) =>
        [...document.querySelectorAll("text")]
          .filter((text) => text.textContent === value)
          .map((text) => {
            const box = text.getBoundingClientRect(),
              mm = 25.4 / 96;
            return {
              x: box.x * mm - 0.4,
              y: box.y * mm - 0.4,
              width: box.width * mm + 0.8,
              height: box.height * mm + 0.8,
            };
          }),
      label,
    );
  } finally {
    await page.close();
  }
}

export async function pdfText(bytes: Buffer): Promise<string> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const document = await task.promise,
      pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number),
        content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

/** Internal loop SVGs use translate/scale groups; derive PDF crops without Chrome. */
export async function svgTextCrops(
  svg: string,
  label: string,
): Promise<Crop[]> {
  const { parseHTML } = await import("linkedom"),
    { measureText } = await import("../../../render/src/text-metrics.js"),
    document = parseHTML(svg).document;
  return [...document.querySelectorAll("text")]
    .filter((text) => text.textContent === label)
    .map((text) => {
      const size = Number(text.getAttribute("font-size")),
        width = measureText(label, size).width,
        x = Number(text.getAttribute("x")),
        y = Number(text.getAttribute("y")),
        anchor = text.getAttribute("text-anchor"),
        left =
          x - (anchor === "middle" ? width / 2 : anchor === "end" ? width : 0);
      const project = (point: [number, number]) => {
        let node = text.parentElement;
        while (node) {
          const operations = [
            ...(node.getAttribute("transform") ?? "").matchAll(
              /(translate|scale)\(([^)]+)\)/gu,
            ),
          ].reverse();
          for (const operation of operations) {
            const values = operation[2]!.trim().split(/[ ,]+/u).map(Number);
            if (operation[1] === "scale")
              point = [
                point[0] * values[0]!,
                point[1] * (values[1] ?? values[0]!),
              ];
            else point = [point[0] + values[0]!, point[1] + (values[1] ?? 0)];
          }
          node = node.parentElement;
        }
        return point;
      };
      const a = project([left, y - size * 1.2]),
        b = project([left + width, y + size * 0.4]);
      return {
        x: a[0] - 0.4,
        y: a[1] - 0.4,
        width: b[0] - a[0] + 0.8,
        height: b[1] - a[1] + 0.8,
      };
    });
}

/** Compare painted shapes across rasterizers, allowing a one-pixel AA edge. */
export function unmatchedInk(a: Canvas, b: Canvas): number {
  const av = a.getContext("2d").getImageData(0, 0, a.width, a.height).data,
    bv = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
  const dark = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
    data[(y * width + x) * 4]! < 160;
  let count = 0,
    unmatched = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (!dark(av, a.width, x, y)) continue;
      count++;
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (
            x + dx >= 0 &&
            y + dy >= 0 &&
            x + dx < b.width &&
            y + dy < b.height &&
            dark(bv, b.width, x + dx, y + dy)
          ) {
            found = true;
            break;
          }
      if (!found) unmatched++;
    }
  return count ? unmatched / count : 0;
}
